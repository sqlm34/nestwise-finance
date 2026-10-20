-- Separate origins; CRM facts are never fabricated for a manual posting.
CREATE TABLE nestwise.manual_operations (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
  actor uuid NOT NULL REFERENCES nestwise.users, payload jsonb NOT NULL,
  kind text NOT NULL CHECK(kind IN ('income','expense','transfer','refund')),
  paid_on date NOT NULL CHECK(paid_on BETWEEN '1900-01-01' AND '2199-12-31'),
  amount_cents bigint NOT NULL CHECK(amount_cents BETWEEN 1 AND 9007199254740991),
  destination_account uuid, reference_operation uuid REFERENCES nestwise.manual_operations,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id),
  FOREIGN KEY(workspace_id,destination_account) REFERENCES nestwise.financial_accounts(workspace_id,id),
  CHECK((kind='transfer')=(destination_account IS NOT NULL)),
  CHECK((kind='refund')=(reference_operation IS NOT NULL)),
  CHECK(destination_account IS DISTINCT FROM account_id), CHECK(id IS DISTINCT FROM reference_operation),
  UNIQUE(workspace_id,id)
);
CREATE TRIGGER manual_operations_immutable BEFORE UPDATE OR DELETE ON nestwise.manual_operations
  FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
ALTER TABLE nestwise.journal_transactions ALTER COLUMN event_id DROP NOT NULL;
ALTER TABLE nestwise.journal_transactions ADD COLUMN manual_id uuid;
ALTER TABLE nestwise.journal_transactions ADD CONSTRAINT journal_manual_origin
  FOREIGN KEY(workspace_id,manual_id) REFERENCES nestwise.manual_operations(workspace_id,id);
ALTER TABLE nestwise.journal_transactions ADD CONSTRAINT journal_exactly_one_origin CHECK(num_nonnulls(event_id,manual_id)=1);
CREATE UNIQUE INDEX journal_manual_account ON nestwise.journal_transactions(manual_id,account_id) WHERE manual_id IS NOT NULL;
ALTER TABLE nestwise.journal_entries DROP CONSTRAINT journal_entries_code_check;
ALTER TABLE nestwise.journal_entries ADD CONSTRAINT journal_entries_code_check
  CHECK(code IN ('clearing','receipts','refunds','parts_cost','parts_payable','fees','expenses','transfers'));

CREATE FUNCTION nestwise.post_manual_operation(p_subject text,p_workspace uuid,p_account uuid,p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; operation_id uuid; destination uuid; reference_id uuid; prior manual_operations;
  original manual_operations; k text; amount bigint; paid date; item jsonb; total numeric:=0; tx uuid; other_tx uuid; cash bigint; counterpart text;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>8
    OR NOT p_payload ?& ARRAY['id','kind','paid_on','amount_cents','note','destination_account','reference_operation','allocations']
    OR jsonb_typeof(p_payload->'allocations') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload->'note') IS DISTINCT FROM 'string' OR length(p_payload->>'note')>1000
    OR jsonb_typeof(p_payload->'amount_cents') IS DISTINCT FROM 'string'
    OR (p_payload->>'amount_cents')!~'^[1-9][0-9]{0,15}$'
    OR (p_payload->>'amount_cents')::numeric>9007199254740991
    OR (p_payload->>'paid_on') IS NULL OR (p_payload->>'paid_on')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
    THEN RAISE EXCEPTION 'invalid_manual_operation'; END IF;
  operation_id:=(p_payload->>'id')::uuid; destination:=(p_payload->>'destination_account')::uuid;
  reference_id:=(p_payload->>'reference_operation')::uuid; k:=p_payload->>'kind';
  amount:=(p_payload->>'amount_cents')::bigint; paid:=(p_payload->>'paid_on')::date;
  IF operation_id IS NULL OR k IS NULL OR k NOT IN ('income','expense','transfer','refund')
    OR paid NOT BETWEEN '1900-01-01'::date AND '2199-12-31'::date
    OR (k='transfer')<>(destination IS NOT NULL) OR (k='refund')<>(reference_id IS NOT NULL)
    OR destination=p_account OR operation_id=reference_id THEN RAISE EXCEPTION 'invalid_manual_operation'; END IF;
  IF destination IS NOT NULL THEN PERFORM reconciliation_actor(p_subject,p_workspace,destination,true); END IF;
  -- Shared deterministic lock order serializes refunds, retries and opposite transfers.
  PERFORM id FROM financial_accounts WHERE workspace_id=p_workspace AND id IN(p_account,destination) ORDER BY id FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF destination IS NOT NULL THEN PERFORM reconciliation_actor(p_subject,p_workspace,destination,true); END IF;
  SELECT * INTO prior FROM manual_operations WHERE id=operation_id;
  IF FOUND THEN
    IF prior.workspace_id<>p_workspace OR prior.account_id<>p_account OR prior.actor<>actor OR prior.payload<>p_payload
      THEN RAISE EXCEPTION 'manual_operation_conflict'; END IF;
    RETURN operation_id;
  END IF;
  IF k IN ('income','expense') THEN
    IF jsonb_array_length(p_payload->'allocations') NOT BETWEEN 1 AND 50 THEN RAISE EXCEPTION 'invalid_manual_operation'; END IF;
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'allocations') LOOP
      IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2
        OR (item->>'category') IS NULL OR (item->>'category')!~'^[a-z][a-z0-9_]{0,63}$'
        OR jsonb_typeof(item->'cents') IS DISTINCT FROM 'string' OR (item->>'cents')!~'^[1-9][0-9]{0,15}$'
        OR (item->>'cents')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_manual_operation'; END IF;
      total:=total+(item->>'cents')::numeric;
    END LOOP;
    IF total<>amount OR (SELECT count(DISTINCT value->>'category') FROM jsonb_array_elements(p_payload->'allocations'))<>jsonb_array_length(p_payload->'allocations')
      THEN RAISE EXCEPTION 'invalid_manual_operation'; END IF;
  ELSIF jsonb_array_length(p_payload->'allocations')<>0 THEN RAISE EXCEPTION 'invalid_manual_operation'; END IF;
  IF k='refund' THEN
    SELECT * INTO original FROM manual_operations WHERE id=reference_id AND workspace_id=p_workspace AND account_id=p_account;
    IF NOT FOUND OR original.kind NOT IN ('income','expense') OR paid<original.paid_on
      THEN RAISE EXCEPTION 'invalid_manual_operation'; END IF;
    IF amount+(SELECT coalesce(sum(amount_cents),0) FROM manual_operations WHERE reference_operation=reference_id)>original.amount_cents
      THEN RAISE EXCEPTION 'manual_refund_exceeded'; END IF;
  END IF;
  INSERT INTO manual_operations(id,workspace_id,account_id,actor,payload,kind,paid_on,amount_cents,destination_account,reference_operation)
    VALUES(operation_id,p_workspace,p_account,actor,p_payload,k,paid,amount,destination,reference_id);
  cash:=CASE WHEN k='income' OR k='refund' AND original.kind='expense' THEN amount ELSE -amount END;
  counterpart:=CASE WHEN k='transfer' THEN 'transfers' WHEN k='expense' OR k='refund' AND original.kind='expense' THEN 'expenses'
    WHEN k='refund' THEN 'refunds' ELSE 'receipts' END;
  INSERT INTO journal_transactions(workspace_id,account_id,manual_id,occurred_at,paid_at)
    VALUES(p_workspace,p_account,operation_id,paid::timestamp AT TIME ZONE 'UTC',paid::timestamp AT TIME ZONE 'UTC') RETURNING id INTO tx;
  INSERT INTO journal_entries VALUES(tx,p_workspace,1,'clearing',cash),(tx,p_workspace,2,counterpart,-cash);
  IF k='transfer' THEN
    INSERT INTO journal_transactions(workspace_id,account_id,manual_id,occurred_at,paid_at)
      VALUES(p_workspace,destination,operation_id,paid::timestamp AT TIME ZONE 'UTC',paid::timestamp AT TIME ZONE 'UTC') RETURNING id INTO other_tx;
    INSERT INTO journal_entries VALUES(other_tx,p_workspace,1,'clearing',amount),(other_tx,p_workspace,2,'transfers',-amount);
  END IF;
  RETURN operation_id;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range OR not_null_violation OR check_violation
  THEN RAISE EXCEPTION 'invalid_manual_operation';
END $$;
REVOKE ALL ON nestwise.manual_operations FROM PUBLIC,nestwise_api;
REVOKE ALL ON FUNCTION nestwise.post_manual_operation(text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.post_manual_operation(text,uuid,uuid,jsonb) TO nestwise_api;

-- Internal projection shared by journal paging and reconciliation; not a CRM inbox.
CREATE VIEW nestwise.journal_sources AS
SELECT jt.id journal_id,se.source_event_id,se.source_order_id,se.kind,se.status FROM nestwise.journal_transactions jt
  JOIN nestwise.source_events se ON se.id=jt.event_id
UNION ALL
SELECT jt.id,m.id,'manual:'||m.id::text,'manual.'||m.kind,'posted' FROM nestwise.journal_transactions jt
  JOIN nestwise.manual_operations m ON m.id=jt.manual_id;
REVOKE ALL ON nestwise.journal_sources FROM PUBLIC,nestwise_api;

CREATE OR REPLACE FUNCTION nestwise.user_journal_page(
  p_subject text,p_workspace uuid,p_account uuid,p_query text DEFAULT '',
  p_from date DEFAULT NULL,p_to date DEFAULT NULL,p_code text DEFAULT 'all',
  p_order text DEFAULT 'newest',p_cursor uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; anchor_time timestamptz; result jsonb;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_query IS NULL OR length(p_query)>128 OR p_code IS NULL OR p_order IS NULL
    OR p_code NOT IN ('all','clearing','receipts','refunds','parts_cost','parts_payable','fees','expenses','transfers')
    OR p_order NOT IN ('newest','oldest') OR p_from>p_to THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  IF p_cursor IS NOT NULL THEN
    SELECT occurred_at INTO anchor_time FROM journal_transactions
      WHERE id=p_cursor AND workspace_id=p_workspace AND account_id=p_account;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_cursor'; END IF;
  END IF;
  -- UUID cursor retains PostgreSQL microsecond precision and is scoped to this account.
  -- Keyset pagination avoids OFFSET shifts when other transactions arrive.
  WITH candidates AS (
    SELECT jt.id,jt.occurred_at,jt.paid_at,jt.posted_at,se.source_event_id,se.source_order_id
    FROM journal_transactions jt JOIN journal_sources se ON se.journal_id=jt.id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account
      AND (p_from IS NULL OR jt.occurred_at >= (p_from::timestamp AT TIME ZONE 'UTC'))
      AND (p_to IS NULL OR jt.occurred_at < ((p_to+1)::timestamp AT TIME ZONE 'UTC'))
      AND (p_code='all' OR EXISTS(SELECT 1 FROM journal_entries je WHERE je.transaction_id=jt.id AND je.code=p_code))
      AND (p_query='' OR strpos(lower(jt.id::text),lower(p_query))>0
        OR strpos(lower(se.source_event_id::text),lower(p_query))>0
        OR strpos(lower(se.source_order_id),lower(p_query))>0)
      AND (p_cursor IS NULL
        OR (p_order='newest' AND (jt.occurred_at,jt.id)<(anchor_time,p_cursor))
        OR (p_order='oldest' AND (jt.occurred_at,jt.id)>(anchor_time,p_cursor)))
    ORDER BY CASE WHEN p_order='newest' THEN jt.occurred_at END DESC,
      CASE WHEN p_order='oldest' THEN jt.occurred_at END ASC,
      CASE WHEN p_order='newest' THEN jt.id END DESC,
      CASE WHEN p_order='oldest' THEN jt.id END ASC LIMIT 101
  ), numbered AS (
    SELECT *,row_number() OVER(ORDER BY
      CASE WHEN p_order='newest' THEN occurred_at END DESC,
      CASE WHEN p_order='oldest' THEN occurred_at END ASC,
      CASE WHEN p_order='newest' THEN id END DESC,
      CASE WHEN p_order='oldest' THEN id END ASC) n FROM candidates
  ), page AS (
    SELECT id,occurred_at,paid_at,posted_at,source_event_id,source_order_id,n,
      (SELECT jsonb_agg(jsonb_build_object('code',code,'cents',cents::text) ORDER BY line)
        FROM journal_entries WHERE transaction_id=numbered.id) entries FROM numbered WHERE n<=100
  )
  SELECT jsonb_build_object('entries',coalesce(jsonb_agg(to_jsonb(page)-'n' ORDER BY n),'[]'::jsonb),
    'limit',100,'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>100
      THEN (SELECT id::text FROM numbered WHERE n=100) ELSE NULL END) INTO result FROM page;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.user_journal_page(text,uuid,uuid,text,date,date,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_journal_page(text,uuid,uuid,text,date,date,text,text,uuid) TO nestwise_api;

CREATE OR REPLACE FUNCTION nestwise.user_period_insights(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; previous_start date; result jsonb;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>365
    OR p_from<'0002-01-01'::date OR p_to>'9998-12-31'::date THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  previous_start:=p_from-(p_to-p_from+1);
  WITH codes AS (SELECT unnest(ARRAY['clearing','receipts','refunds','parts_cost','parts_payable','fees','expenses','transfers']) code),
  periods AS (SELECT 'current' label,p_from first_day,p_to last_day UNION ALL SELECT 'previous',previous_start,p_from-1),
  tx AS MATERIALIZED (
    SELECT id,occurred_at,paid_at FROM journal_transactions WHERE workspace_id=p_workspace AND account_id=p_account
      AND occurred_at>=(previous_start::timestamp AT TIME ZONE 'UTC')
      AND occurred_at<((p_to+1)::timestamp AT TIME ZONE 'UTC')
  ), period_data AS (
    SELECT label,jsonb_build_object('from',first_day,'to',last_day,
      'transaction_count',(SELECT count(*) FROM tx WHERE occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'missing_paid_date',(SELECT count(*) FROM tx WHERE paid_at IS NULL AND occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'totals',(SELECT jsonb_object_agg(code,coalesce((SELECT sum(je.cents) FROM journal_entries je JOIN tx ON tx.id=je.transaction_id
        WHERE je.code=codes.code AND tx.occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND tx.occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC')),0)::text) FROM codes)) summary
    FROM periods
  ), months AS (
    SELECT greatest(p_from,day::date) first_day,least(p_to,(day+interval '1 month - 1 day')::date) last_day
    FROM generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month') day
  ), monthly AS (
    SELECT first_day,jsonb_build_object('from',first_day,'to',last_day,
      'transaction_count',(SELECT count(*) FROM tx WHERE occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'missing_paid_date',(SELECT count(*) FROM tx WHERE paid_at IS NULL AND occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'totals',(SELECT jsonb_object_agg(code,coalesce((SELECT sum(je.cents) FROM journal_entries je JOIN tx ON tx.id=je.transaction_id
        WHERE je.code=codes.code AND tx.occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND tx.occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC')),0)::text) FROM codes)) summary
    FROM months
  )
  SELECT jsonb_build_object('generated_at',statement_timestamp(),'currency',(SELECT currency FROM financial_accounts WHERE id=p_account),
    'current',(SELECT summary FROM period_data WHERE label='current'),
    'previous',(SELECT summary FROM period_data WHERE label='previous'),
    'months',(SELECT jsonb_agg(summary ORDER BY first_day) FROM monthly),
    'attention',jsonb_build_object('waiting',(SELECT count(*) FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='waiting')::text,
      'needs_review',(SELECT count(*) FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='needs_review')::text)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.user_period_insights(text,uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_period_insights(text,uuid,uuid,date,date) TO nestwise_api;

CREATE OR REPLACE FUNCTION nestwise.user_reconciliation_candidates(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date,p_cursor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; anchor_time timestamptz; result jsonb;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>365
    OR p_from<'0002-01-01'::date OR p_to>'9998-12-31'::date THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  IF p_cursor IS NOT NULL THEN
    SELECT paid_at INTO anchor_time FROM journal_transactions
    WHERE id=p_cursor AND workspace_id=p_workspace AND account_id=p_account AND paid_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_cursor'; END IF;
  END IF;
  WITH candidates AS (
    SELECT jt.id,jt.occurred_at,jt.paid_at,jt.posted_at,se.source_event_id,se.source_order_id,se.kind
    FROM journal_transactions jt JOIN journal_sources se ON se.journal_id=jt.id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account AND se.status='posted'
      AND jt.paid_at >= (p_from::timestamp AT TIME ZONE 'UTC')
      AND jt.paid_at < ((p_to+1)::timestamp AT TIME ZONE 'UTC')
      AND se.kind IN ('job.payment_recorded','job.customer_refund_issued','job.part_cost_recorded',
        'job.supplier_credit_received','job.processor_fee_recorded','job.processor_fee_refunded','manual.income','manual.expense','manual.transfer','manual.refund')
      AND EXISTS(SELECT 1 FROM journal_entries je WHERE je.transaction_id=jt.id AND je.code='clearing' AND je.cents<>0)
      AND (p_cursor IS NULL OR (jt.paid_at,jt.id)>(anchor_time,p_cursor))
    ORDER BY jt.paid_at,jt.id LIMIT 101
  ), numbered AS (
    SELECT *,row_number() OVER(ORDER BY paid_at,id) n FROM candidates
  ), page AS (
    SELECT id,occurred_at,paid_at,posted_at,source_event_id,source_order_id,kind,n,
      (SELECT jsonb_agg(jsonb_build_object('code',code,'cents',cents::text) ORDER BY line)
        FROM journal_entries WHERE transaction_id=numbered.id) entries FROM numbered WHERE n<=100
  )
  SELECT jsonb_build_object('entries',coalesce(jsonb_agg(to_jsonb(page)-'n' ORDER BY n),'[]'::jsonb),
    'limit',100,'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>100
      THEN (SELECT id::text FROM numbered WHERE n=100) ELSE NULL END) INTO result FROM page;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.user_reconciliation_candidates(text,uuid,uuid,date,date,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_reconciliation_candidates(text,uuid,uuid,date,date,uuid) TO nestwise_api;

CREATE OR REPLACE FUNCTION nestwise.save_reconciliation(p_subject text,p_workspace uuid,p_account uuid,p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; group_id uuid; previous reconciliation_groups%ROWTYPE; item jsonb; bank_sum numeric; journal_sum numeric; valid_count int; claim_key text;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  -- Serialize claims/reversals for this account, including simultaneous devices.
  PERFORM 1 FROM financial_accounts WHERE id=p_account FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR jsonb_typeof(p_payload->'rows') IS DISTINCT FROM 'array'
    OR jsonb_typeof(p_payload->'transactions') IS DISTINCT FROM 'array' OR (p_payload->>'file_hash') IS NULL
    OR (p_payload->>'file_hash')!~'^[0-9a-f]{64}$' OR (p_payload->>'id') IS NULL THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
  group_id:=(p_payload->>'id')::uuid;
  IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>4 THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
  SELECT * INTO previous FROM reconciliation_groups WHERE id=group_id;
  IF FOUND THEN
    IF previous.workspace_id<>p_workspace OR previous.account_id<>p_account OR previous.created_by<>actor
      OR previous.file_hash<>p_payload->>'file_hash' OR previous.rows<>p_payload->'rows' OR previous.transactions<>p_payload->'transactions'
      THEN RAISE EXCEPTION 'reconciliation_conflict'; END IF;
    RETURN group_id; -- Retries do not resurrect a canceled assertion.
  END IF;
  IF jsonb_array_length(p_payload->'rows') NOT BETWEEN 1 AND 20 OR jsonb_array_length(p_payload->'transactions') NOT BETWEEN 1 AND 20 THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
  bank_sum:=0;
  FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
    IF (SELECT count(*) FROM jsonb_object_keys(item))<>4 THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
    IF jsonb_typeof(item)<>'object' OR (item->>'line') IS NULL OR (item->>'line')!~'^[0-9]+$' OR (item->>'line')::int NOT BETWEEN 2 AND 5001
      OR (item->>'date') IS NULL OR (item->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' OR (item->>'date')::date NOT BETWEEN '0002-01-01'::date AND '9998-12-31'::date
      OR (item->>'cents') IS NULL OR (item->>'cents')!~'^-?[1-9][0-9]{0,15}$' OR abs((item->>'cents')::numeric)>9007199254740991
      OR (item->>'text_hash') IS NULL OR (item->>'text_hash')!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
    bank_sum:=bank_sum+(item->>'cents')::numeric;
  END LOOP;
  IF bank_sum=0 OR (SELECT max((r->>'date')::date)-min((r->>'date')::date) FROM jsonb_array_elements(p_payload->'rows') r)>365
    OR (SELECT count(DISTINCT r->>'line') FROM jsonb_array_elements(p_payload->'rows') r)<>jsonb_array_length(p_payload->'rows')
    OR (SELECT count(DISTINCT value) FROM jsonb_array_elements_text(p_payload->'transactions'))<>jsonb_array_length(p_payload->'transactions') THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
  SELECT count(DISTINCT jt.id),sum(je.cents) INTO valid_count,journal_sum
    FROM jsonb_array_elements_text(p_payload->'transactions') ids
    JOIN journal_transactions jt ON jt.id=ids.value::uuid AND jt.workspace_id=p_workspace AND jt.account_id=p_account
    JOIN journal_sources se ON se.journal_id=jt.id AND se.status='posted'
    JOIN journal_entries je ON je.transaction_id=jt.id AND je.code='clearing' AND je.cents<>0
    WHERE se.kind IN ('job.payment_recorded','job.part_cost_recorded','job.customer_refund_issued','job.supplier_credit_received','job.processor_fee_recorded','job.processor_fee_refunded','manual.income','manual.expense','manual.transfer','manual.refund')
      AND jt.paid_at IS NOT NULL AND EXISTS(SELECT 1 FROM jsonb_array_elements(p_payload->'rows') r
        WHERE abs((jt.paid_at AT TIME ZONE 'UTC')::date-(r->>'date')::date)<=7);
  IF valid_count<>jsonb_array_length(p_payload->'transactions') OR journal_sum IS DISTINCT FROM bank_sum THEN RAISE EXCEPTION 'reconciliation_mismatch'; END IF;
  INSERT INTO reconciliation_groups(id,workspace_id,account_id,created_by,file_hash,rows,transactions,amount)
    VALUES(group_id,p_workspace,p_account,actor,p_payload->>'file_hash',p_payload->'rows',p_payload->'transactions',bank_sum);
  BEGIN
    FOR item IN SELECT value FROM jsonb_array_elements(p_payload->'rows') LOOP
      INSERT INTO reconciliation_claims VALUES(p_account,'bank_line',(p_payload->>'file_hash')||':'||(item->>'line'),group_id);
      claim_key:=(item->>'date')||':'||(item->>'cents')||':'||(item->>'text_hash');
      INSERT INTO reconciliation_claims VALUES(p_account,'bank_fingerprint',claim_key,group_id);
    END LOOP;
    INSERT INTO reconciliation_claims SELECT p_account,'journal',value::uuid::text,group_id FROM jsonb_array_elements_text(p_payload->'transactions');
  EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'reconciliation_conflict'; END;
  RETURN group_id;
END $$;

-- Preserve the existing CRM detail contract; manual origins have their own shape.
ALTER FUNCTION nestwise.user_journal_detail(text,uuid,uuid,uuid,integer) RENAME TO crm_journal_detail;
REVOKE ALL ON FUNCTION nestwise.crm_journal_detail(text,uuid,uuid,uuid,integer) FROM nestwise_api;
CREATE FUNCTION nestwise.user_journal_detail(p_subject text,p_workspace uuid,p_account uuid,p_transaction uuid,p_before integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE operation manual_operations; transaction_data jsonb;
BEGIN
  PERFORM reconciliation_actor(p_subject,p_workspace,p_account,false);
  SELECT m.* INTO operation FROM journal_transactions jt JOIN manual_operations m ON m.id=jt.manual_id
    WHERE jt.id=p_transaction AND jt.workspace_id=p_workspace AND jt.account_id=p_account;
  IF NOT FOUND THEN RETURN crm_journal_detail(p_subject,p_workspace,p_account,p_transaction,p_before); END IF;
  IF p_before IS NOT NULL THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  SELECT jsonb_build_object('id',jt.id,'occurred_at',jt.occurred_at,'paid_at',jt.paid_at,'posted_at',jt.posted_at,
    'source_event_id',operation.id,'source_order_id','manual:'||operation.id::text,
    'entries',(SELECT jsonb_agg(jsonb_build_object('code',code,'cents',cents::text) ORDER BY line) FROM journal_entries WHERE transaction_id=jt.id))
    INTO transaction_data FROM journal_transactions jt WHERE jt.id=p_transaction;
  RETURN jsonb_build_object('manual',operation.payload,'actor',operation.actor,'created_at',operation.created_at,
    'refunded_cents',(SELECT coalesce(sum(amount_cents),0)::text FROM manual_operations WHERE reference_operation=operation.id),
    'transaction',transaction_data);
END $$;
REVOKE ALL ON FUNCTION nestwise.user_journal_detail(text,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_journal_detail(text,uuid,uuid,uuid,integer) TO nestwise_api;

CREATE OR REPLACE FUNCTION nestwise.user_journal(p_subject text,p_workspace uuid,p_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.posted_at DESC,j.id DESC) FROM (
    SELECT jt.id,jt.occurred_at,jt.paid_at,jt.posted_at,se.source_event_id,se.source_order_id,
      (SELECT jsonb_agg(jsonb_build_object('code',code,'cents',cents::text) ORDER BY line)
        FROM journal_entries WHERE transaction_id=jt.id) entries
    FROM journal_transactions jt JOIN journal_sources se ON se.journal_id=jt.id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account
    ORDER BY jt.posted_at DESC,jt.id DESC LIMIT 100
  ) j),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION nestwise.read_journal(p_hash text,p_workspace uuid,p_account uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT user_id INTO actor FROM sessions WHERE token_hash=p_hash
    AND expires_at>clock_timestamp() AND revoked_at IS NULL;
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.posted_at DESC,j.id DESC) FROM (
    SELECT jt.id,jt.occurred_at,jt.paid_at,jt.posted_at,se.source_event_id,se.source_order_id,
      (SELECT jsonb_agg(jsonb_build_object('code',code,'cents',cents::text) ORDER BY line)
        FROM journal_entries WHERE transaction_id=jt.id) entries
    FROM journal_transactions jt JOIN journal_sources se ON se.journal_id=jt.id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account
    ORDER BY jt.posted_at DESC,jt.id DESC LIMIT 100
  ) j),'[]'::jsonb);
END $$;
