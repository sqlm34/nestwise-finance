-- Durable user assertions, never ledger postings or accountant approval.
CREATE TABLE nestwise.reconciliation_groups (
  id uuid PRIMARY KEY,workspace_id uuid NOT NULL,account_id uuid NOT NULL,
  created_by uuid NOT NULL REFERENCES nestwise.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  file_hash text NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
  rows jsonb NOT NULL,transactions jsonb NOT NULL,amount numeric NOT NULL CHECK(amount<>0),
  FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE INDEX reconciliation_history ON nestwise.reconciliation_groups(workspace_id,account_id,created_at,id);
CREATE TABLE nestwise.reconciliation_cancellations (
  group_id uuid PRIMARY KEY REFERENCES nestwise.reconciliation_groups,
  actor uuid NOT NULL REFERENCES nestwise.users,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  reason text NOT NULL CHECK(reason IN ('mistake','duplicate','recheck'))
);
CREATE TABLE nestwise.reconciliation_claims (
  account_id uuid NOT NULL REFERENCES nestwise.financial_accounts,
  kind text NOT NULL CHECK(kind IN ('bank_line','bank_fingerprint','journal')),
  claim text NOT NULL,group_id uuid NOT NULL REFERENCES nestwise.reconciliation_groups,
  PRIMARY KEY(account_id,kind,claim)
);
CREATE TRIGGER reconciliation_groups_immutable BEFORE UPDATE OR DELETE ON nestwise.reconciliation_groups FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER reconciliation_cancellations_immutable BEFORE UPDATE OR DELETE ON nestwise.reconciliation_cancellations FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE FUNCTION nestwise.reconciliation_actor(p_subject text,p_workspace uuid,p_account uuid,p_write boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT u.id INTO actor FROM users u JOIN memberships m ON m.user_id=u.id
    JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE u.subject=p_subject AND m.workspace_id=p_workspace AND a.id=p_account
    AND (NOT p_write OR m.role IN ('owner','accountant'))
    AND (m.all_accounts OR EXISTS(SELECT 1 FROM account_grants g WHERE g.workspace_id=p_workspace AND g.account_id=p_account AND g.user_id=u.id));
  IF actor IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;RETURN actor;
END $$;
CREATE FUNCTION nestwise.save_reconciliation(p_subject text,p_workspace uuid,p_account uuid,p_payload jsonb) RETURNS uuid
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
    JOIN source_events se ON se.id=jt.event_id AND se.status='posted'
    JOIN journal_entries je ON je.transaction_id=jt.id AND je.code='clearing' AND je.cents<>0
    WHERE se.kind IN ('job.payment_recorded','job.part_cost_recorded','job.customer_refund_issued','job.supplier_credit_received','job.processor_fee_recorded','job.processor_fee_refunded')
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
CREATE FUNCTION nestwise.cancel_reconciliation(p_subject text,p_workspace uuid,p_account uuid,p_group uuid,p_reason text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  PERFORM 1 FROM financial_accounts WHERE id=p_account FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF NOT EXISTS(SELECT 1 FROM reconciliation_groups WHERE id=p_group AND workspace_id=p_workspace AND account_id=p_account) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_reason IS NULL OR p_reason NOT IN ('mistake','duplicate','recheck') THEN RAISE EXCEPTION 'invalid_reconciliation'; END IF;
  IF EXISTS(SELECT 1 FROM reconciliation_cancellations WHERE group_id=p_group) THEN RETURN p_group; END IF;
  INSERT INTO reconciliation_cancellations(group_id,actor,reason) VALUES(p_group,actor,p_reason);
  DELETE FROM reconciliation_claims WHERE group_id=p_group;
  RETURN p_group;
END $$;
CREATE FUNCTION nestwise.read_reconciliations(p_subject text,p_workspace uuid,p_account uuid,p_cursor uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; anchor_time timestamptz; result jsonb; can_write boolean;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,false);
  SELECT role IN ('owner','accountant') INTO can_write FROM memberships WHERE workspace_id=p_workspace AND user_id=actor;
  IF p_cursor IS NOT NULL THEN
    SELECT created_at INTO anchor_time FROM reconciliation_groups WHERE id=p_cursor AND workspace_id=p_workspace AND account_id=p_account;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_cursor'; END IF;
  END IF;
  WITH candidates AS (
    SELECT g.*,c.recorded_at canceled_at,c.actor canceled_by,c.reason
    FROM reconciliation_groups g LEFT JOIN reconciliation_cancellations c ON c.group_id=g.id
    WHERE g.workspace_id=p_workspace AND g.account_id=p_account AND (p_cursor IS NULL OR (g.created_at,g.id)<(anchor_time,p_cursor))
    ORDER BY g.created_at DESC,g.id DESC LIMIT 51
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY created_at DESC,id DESC) n FROM candidates), page AS (
    SELECT id,created_at,created_by,file_hash,rows,transactions,amount::text,canceled_at,canceled_by,reason,n FROM numbered WHERE n<=50
  ) SELECT jsonb_build_object('groups',coalesce(jsonb_agg(to_jsonb(page)-'n' ORDER BY n),'[]'::jsonb),'can_write',can_write,
    'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>50 THEN (SELECT id::text FROM numbered WHERE n=50) ELSE NULL END) INTO result FROM page;
  RETURN result;
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA nestwise FROM PUBLIC;
REVOKE ALL ON FUNCTION nestwise.reconciliation_actor(text,uuid,uuid,boolean),nestwise.save_reconciliation(text,uuid,uuid,jsonb),nestwise.cancel_reconciliation(text,uuid,uuid,uuid,text),nestwise.read_reconciliations(text,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.save_reconciliation(text,uuid,uuid,jsonb),nestwise.cancel_reconciliation(text,uuid,uuid,uuid,text),nestwise.read_reconciliations(text,uuid,uuid,uuid) TO nestwise_api;
