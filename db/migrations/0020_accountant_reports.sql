-- Preliminary accountant working papers only. No tax approval or ledger edits.
CREATE FUNCTION nestwise.business_report_actor(p_subject text,p_workspace uuid,p_account uuid,p_write boolean) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid;
BEGIN
 who:=reconciliation_actor(p_subject,p_workspace,p_account,p_write);
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=p_workspace AND kind='business') THEN RAISE EXCEPTION 'forbidden';END IF;
 RETURN who;
END $$;
REVOKE ALL ON FUNCTION nestwise.business_report_actor(text,uuid,uuid,boolean) FROM PUBLIC,nestwise_api;

-- Explicit sharing of one personally-paid expense into one business account.
-- This is report attribution, not a second cash payment or a tax approval.
CREATE TABLE nestwise.owner_expense_links (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,account_id uuid NOT NULL,
 source_workspace uuid NOT NULL,source_account uuid NOT NULL,source_transaction uuid NOT NULL REFERENCES nestwise.journal_transactions,
 business_cents bigint NOT NULL CHECK(business_cents>0),actor uuid NOT NULL REFERENCES nestwise.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id),
 FOREIGN KEY(source_workspace,source_account) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TABLE nestwise.owner_expense_settlements (
 id uuid PRIMARY KEY,link_id uuid NOT NULL REFERENCES nestwise.owner_expense_links,
 transaction_id uuid NOT NULL REFERENCES nestwise.journal_transactions,
 cents bigint NOT NULL CHECK(cents>0),actor uuid NOT NULL REFERENCES nestwise.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER owner_expense_links_immutable BEFORE UPDATE OR DELETE ON nestwise.owner_expense_links FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER owner_expense_settlements_immutable BEFORE UPDATE OR DELETE ON nestwise.owner_expense_settlements FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
REVOKE ALL ON nestwise.owner_expense_links,nestwise.owner_expense_settlements FROM PUBLIC,nestwise_api;
-- Corrections append audit records; original links and saved reports remain intact.
CREATE TABLE nestwise.owner_expense_cancellations (
 id uuid PRIMARY KEY,link_id uuid UNIQUE REFERENCES nestwise.owner_expense_links,
 settlement_id uuid UNIQUE REFERENCES nestwise.owner_expense_settlements,
 reason text NOT NULL CHECK(length(trim(reason)) BETWEEN 3 AND 500),
 actor uuid NOT NULL REFERENCES nestwise.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK((link_id IS NULL) <> (settlement_id IS NULL))
);
CREATE TRIGGER owner_expense_cancellations_immutable BEFORE UPDATE OR DELETE ON nestwise.owner_expense_cancellations FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE VIEW nestwise.active_owner_expenses AS SELECT l.* FROM nestwise.owner_expense_links l WHERE NOT EXISTS(SELECT 1 FROM nestwise.owner_expense_cancellations c WHERE c.link_id=l.id);
CREATE VIEW nestwise.active_owner_settlements AS SELECT s.* FROM nestwise.owner_expense_settlements s WHERE NOT EXISTS(SELECT 1 FROM nestwise.owner_expense_cancellations c WHERE c.settlement_id=s.id);
REVOKE ALL ON nestwise.owner_expense_cancellations,nestwise.active_owner_expenses,nestwise.active_owner_settlements FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.link_owner_expense(p_subject text,p_workspace uuid,p_account uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; prior owner_expense_links; source journal_transactions; original manual_operations; amount bigint; command uuid;
BEGIN
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>3 OR NOT p_data ?& ARRAY['id','transaction','business_cents']
 OR jsonb_typeof(p_data->'business_cents') IS DISTINCT FROM 'string' OR (p_data->>'business_cents')!~'^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'invalid_report';END IF;
 command:=(p_data->>'id')::uuid;amount:=(p_data->>'business_cents')::bigint;
 SELECT * INTO source FROM journal_transactions WHERE id=(p_data->>'transaction')::uuid;
 IF NOT FOUND OR command IS NULL OR source.manual_id IS NULL OR source.paid_at IS NULL THEN RAISE EXCEPTION 'invalid_report';END IF;
 PERFORM reconciliation_actor(p_subject,source.workspace_id,source.account_id,true);
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=source.workspace_id AND kind IN ('personal','family')) THEN RAISE EXCEPTION 'invalid_report';END IF;
 IF (SELECT currency FROM financial_accounts WHERE id=p_account) IS DISTINCT FROM (SELECT currency FROM financial_accounts WHERE id=source.account_id) THEN RAISE EXCEPTION 'invalid_report';END IF;
 PERFORM id FROM financial_accounts WHERE id IN (p_account,source.account_id) ORDER BY id FOR UPDATE;
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 PERFORM reconciliation_actor(p_subject,source.workspace_id,source.account_id,true);
 SELECT * INTO prior FROM owner_expense_links WHERE id=command;
 IF FOUND THEN
 IF prior.workspace_id<>p_workspace OR prior.account_id<>p_account OR prior.source_transaction<>source.id OR prior.business_cents<>amount OR prior.actor<>who THEN RAISE EXCEPTION 'report_conflict';END IF;RETURN command;END IF;
 SELECT * INTO original FROM manual_operations WHERE id=source.manual_id AND kind='expense';
 IF NOT FOUND OR amount>original.amount_cents-(SELECT coalesce(sum(amount_cents),0) FROM manual_operations WHERE reference_operation=original.id) THEN RAISE EXCEPTION 'invalid_report';END IF;
 IF (SELECT count(*) FROM owner_expense_links WHERE account_id=p_account)>=1000 THEN RAISE EXCEPTION 'report_limit';END IF;
 IF EXISTS(SELECT 1 FROM active_owner_expenses WHERE source_transaction=source.id) THEN RAISE EXCEPTION 'report_conflict';END IF;
 INSERT INTO owner_expense_links VALUES(command,p_workspace,p_account,source.workspace_id,source.account_id,source.id,amount,who,clock_timestamp());RETURN command;
END $$;
CREATE FUNCTION nestwise.settle_owner_expense(p_subject text,p_workspace uuid,p_account uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; link owner_expense_links; prior owner_expense_settlements; amount bigint; command uuid; tx uuid;
BEGIN
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 PERFORM 1 FROM financial_accounts WHERE id=p_account FOR UPDATE;
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>3 OR NOT p_data ?& ARRAY['id','link','transaction'] THEN RAISE EXCEPTION 'invalid_report';END IF;
 command:=(p_data->>'id')::uuid;tx:=(p_data->>'transaction')::uuid;
 SELECT * INTO link FROM active_owner_expenses WHERE id=(p_data->>'link')::uuid AND workspace_id=p_workspace AND account_id=p_account;
 IF NOT FOUND OR command IS NULL OR tx IS NULL THEN RAISE EXCEPTION 'invalid_report';END IF;
 SELECT * INTO prior FROM owner_expense_settlements WHERE id=command;
 IF FOUND THEN IF prior.link_id<>link.id OR prior.transaction_id<>tx OR prior.actor<>who THEN RAISE EXCEPTION 'report_conflict';END IF;RETURN command;END IF;
 SELECT mo.amount_cents INTO amount FROM journal_transactions jt JOIN manual_operations mo ON mo.id=jt.manual_id
 WHERE jt.id=tx AND jt.workspace_id=p_workspace AND jt.account_id=p_account AND mo.kind='expense' AND jt.paid_at>=(SELECT paid_at FROM journal_transactions WHERE id=link.source_transaction)
 AND NOT EXISTS(SELECT 1 FROM manual_operations WHERE reference_operation=mo.id);
 IF NOT FOUND OR amount+(SELECT coalesce(sum(os.cents-(SELECT coalesce(sum(r.amount_cents),0) FROM manual_operations r WHERE r.reference_operation=(SELECT manual_id FROM journal_transactions WHERE id=os.transaction_id))),0) FROM active_owner_settlements os WHERE link_id=link.id)>link.business_cents THEN RAISE EXCEPTION 'invalid_report';END IF;
 IF EXISTS(SELECT 1 FROM active_owner_settlements WHERE transaction_id=tx) THEN RAISE EXCEPTION 'report_conflict';END IF;
 INSERT INTO owner_expense_settlements VALUES(command,link.id,tx,amount,who,clock_timestamp());RETURN command;
END $$;
REVOKE ALL ON FUNCTION nestwise.link_owner_expense(text,uuid,uuid,jsonb),nestwise.settle_owner_expense(text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.link_owner_expense(text,uuid,uuid,jsonb),nestwise.settle_owner_expense(text,uuid,uuid,jsonb) TO nestwise_api;

CREATE FUNCTION nestwise.cancel_owner_expense(p_subject text,p_workspace uuid,p_account uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; command uuid; target uuid; kind text; note text; purchase owner_expense_links; prior owner_expense_cancellations;
BEGIN
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>4 OR NOT p_data ?& ARRAY['id','target','kind','reason'] THEN RAISE EXCEPTION 'invalid_report';END IF;
 command:=(p_data->>'id')::uuid;target:=(p_data->>'target')::uuid;kind:=p_data->>'kind';note:=p_data->>'reason';
 IF command IS NULL OR target IS NULL OR kind IS NULL OR kind NOT IN ('purchase','reimbursement') OR note IS NULL OR length(trim(note)) NOT BETWEEN 3 AND 500 THEN RAISE EXCEPTION 'invalid_report';END IF;
 SELECT * INTO purchase FROM owner_expense_links WHERE id=CASE WHEN kind='purchase' THEN target ELSE (SELECT link_id FROM owner_expense_settlements WHERE id=target) END AND workspace_id=p_workspace AND account_id=p_account;
 IF NOT FOUND THEN RAISE EXCEPTION 'forbidden';END IF;
 PERFORM id FROM financial_accounts WHERE id IN(p_account,purchase.source_account) ORDER BY id FOR UPDATE;
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 SELECT * INTO prior FROM owner_expense_cancellations WHERE id=command;
 IF FOUND THEN
  IF prior.actor<>who OR prior.reason<>note OR (CASE WHEN kind='purchase' THEN prior.link_id ELSE prior.settlement_id END) IS DISTINCT FROM target THEN RAISE EXCEPTION 'report_conflict';END IF;RETURN command;
 END IF;
 IF EXISTS(SELECT 1 FROM owner_expense_cancellations WHERE (kind='purchase' AND link_id=target) OR (kind='reimbursement' AND settlement_id=target)) OR (kind='purchase' AND EXISTS(SELECT 1 FROM active_owner_settlements WHERE link_id=target)) THEN RAISE EXCEPTION 'report_conflict';END IF;
 INSERT INTO owner_expense_cancellations VALUES(command,CASE WHEN kind='purchase' THEN target END,CASE WHEN kind='reimbursement' THEN target END,note,who,clock_timestamp());RETURN command;
END $$;
REVOKE ALL ON FUNCTION nestwise.cancel_owner_expense(text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.cancel_owner_expense(text,uuid,uuid,jsonb) TO nestwise_api;

CREATE TABLE nestwise.report_mappings (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 transaction_id uuid NOT NULL, line integer NOT NULL, revision integer NOT NULL CHECK(revision>0),
 allocations jsonb NOT NULL, owner_link uuid REFERENCES nestwise.owner_expense_links, actor uuid NOT NULL REFERENCES nestwise.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id),
 FOREIGN KEY(transaction_id,line) REFERENCES nestwise.journal_entries(transaction_id,line),
 UNIQUE(account_id,transaction_id,line,revision)
);
CREATE TABLE nestwise.report_snapshots (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,account_id uuid NOT NULL,
 actor uuid NOT NULL REFERENCES nestwise.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 date_from date NOT NULL,date_to date NOT NULL,data jsonb NOT NULL,hash text NOT NULL,
 status text NOT NULL DEFAULT 'Accountant Review' CHECK(status='Accountant Review'),
 FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TRIGGER report_mappings_immutable BEFORE UPDATE OR DELETE ON nestwise.report_mappings FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER report_snapshots_immutable BEFORE UPDATE OR DELETE ON nestwise.report_snapshots FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
REVOKE ALL ON nestwise.report_mappings,nestwise.report_snapshots FROM PUBLIC,nestwise_api;

CREATE FUNCTION nestwise.propose_report_mapping(p_subject text,p_workspace uuid,p_account uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; prior report_mappings; tx uuid; ln integer; latest integer; expected integer; amount numeric; total numeric:=0; item jsonb; code_name text; command uuid; linked uuid;
BEGIN
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 PERFORM 1 FROM financial_accounts WHERE id=p_account FOR UPDATE;
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>5
 OR NOT p_data ?& ARRAY['id','transaction','line','expected_revision','allocations']
 OR jsonb_typeof(p_data->'allocations') IS DISTINCT FROM 'array'
 THEN RAISE EXCEPTION 'invalid_report'; END IF;
 command:=(p_data->>'id')::uuid;tx:=(p_data->>'transaction')::uuid;ln:=(p_data->>'line')::integer;expected:=(p_data->>'expected_revision')::integer;
 IF command IS NULL OR tx IS NULL OR ln IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 99 OR jsonb_array_length(p_data->'allocations') NOT BETWEEN 0 AND 44 THEN RAISE EXCEPTION 'invalid_report';END IF;
 SELECT * INTO prior FROM report_mappings WHERE id=command;
 IF FOUND THEN
  IF prior.actor<>who OR prior.workspace_id<>p_workspace OR prior.account_id<>p_account OR prior.transaction_id<>tx OR prior.line<>ln OR prior.revision<>expected+1 OR prior.allocations<>p_data->'allocations' THEN RAISE EXCEPTION 'report_conflict';END IF;
  RETURN command;
 END IF;
 SELECT je.code,CASE WHEN je.code IN ('receipts','refunds') THEN -je.cents ELSE coalesce((SELECT business_cents FROM active_owner_expenses WHERE source_transaction=jt.id AND workspace_id=p_workspace AND account_id=p_account),je.cents) END INTO code_name,amount
 FROM journal_entries je JOIN journal_transactions jt ON jt.id=je.transaction_id
 WHERE ((jt.workspace_id=p_workspace AND jt.account_id=p_account) OR EXISTS(SELECT 1 FROM active_owner_expenses ol WHERE ol.source_transaction=jt.id AND ol.workspace_id=p_workspace AND ol.account_id=p_account)) AND jt.id=tx AND je.line=ln AND jt.paid_at IS NOT NULL
 AND je.code IN ('receipts','refunds','parts_cost','fees','expenses');
 IF NOT FOUND OR EXISTS(SELECT 1 FROM active_owner_settlements os JOIN journal_transactions st ON st.id=os.transaction_id WHERE os.transaction_id=tx OR EXISTS(SELECT 1 FROM journal_transactions j JOIN manual_operations m ON m.id=j.manual_id WHERE j.id=tx AND m.reference_operation=st.manual_id)) THEN RAISE EXCEPTION 'invalid_report';END IF;
 SELECT coalesce(max(revision),0) INTO latest FROM report_mappings WHERE account_id=p_account AND transaction_id=tx AND line=ln;
 IF latest<>expected THEN RAISE EXCEPTION 'report_conflict';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(p_data->'allocations') LOOP
  IF jsonb_typeof(item)<>'object' OR (SELECT count(*) FROM jsonb_object_keys(item))<>2 OR NOT item ?& ARRAY['category','cents']
   OR jsonb_typeof(item->'category') IS DISTINCT FROM 'string' OR (item->>'category')!~'^tax_(0[0-9]|[123][0-9]|4[0-3])$'
   OR jsonb_typeof(item->'cents') IS DISTINCT FROM 'string' OR (item->>'cents')!~'^-?[1-9][0-9]{0,15}$'
   OR abs((item->>'cents')::numeric)>9007199254740991 OR sign((item->>'cents')::numeric)<>sign(amount)
   OR ((code_name IN ('receipts','refunds')) IS DISTINCT FROM (item->>'category'='tax_00')) THEN RAISE EXCEPTION 'invalid_report';END IF;
  total:=total+(item->>'cents')::numeric;
 END LOOP;
 IF (jsonb_array_length(p_data->'allocations')>0 AND total<>amount) OR (SELECT count(DISTINCT value->>'category') FROM jsonb_array_elements(p_data->'allocations'))<>jsonb_array_length(p_data->'allocations') THEN RAISE EXCEPTION 'invalid_report';END IF;
 SELECT id INTO linked FROM active_owner_expenses WHERE source_transaction=tx AND account_id=p_account;
 INSERT INTO report_mappings VALUES(command,p_workspace,p_account,tx,ln,expected+1,p_data->'allocations',linked,who,clock_timestamp());
 RETURN command;
END $$;

CREATE FUNCTION nestwise.report_input(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM business_report_actor(p_subject,p_workspace,p_account,false);
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>365 OR p_from<'1900-01-01'::date OR p_to>'2199-12-31'::date THEN RAISE EXCEPTION 'invalid_report';END IF;
 -- One statement produces a consistent complete input, never independent paged totals.
 WITH tx AS MATERIALIZED (
  SELECT jt.* FROM journal_transactions jt WHERE ((workspace_id=p_workspace AND account_id=p_account) OR EXISTS(SELECT 1 FROM active_owner_expenses ol WHERE ol.source_transaction=jt.id AND ol.workspace_id=p_workspace AND ol.account_id=p_account))
  AND coalesce(paid_at,occurred_at)>=(p_from::timestamp AT TIME ZONE 'UTC') AND coalesce(paid_at,occurred_at)<((p_to+1)::timestamp AT TIME ZONE 'UTC')
 ), lines AS MATERIALIZED (
  SELECT jt.id transaction_id,je.line,je.code,je.cents::text cents,jt.workspace_id source_workspace,jt.account_id source_account,ol.id owner_link,ol.business_cents::text business_cents,to_char(jt.paid_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') paid_at,to_char(jt.posted_at AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') posted_at,
   CASE WHEN je.code IN ('receipts','refunds') THEN -je.cents ELSE coalesce(ol.business_cents,je.cents) END::text report_cents,
   js.source_event_id::text source_id,js.source_order_id source_order,
   mo.payload->'allocations' operational_allocations,
   coalesce((SELECT jsonb_agg(hash ORDER BY hash) FROM (
     SELECT rp.hash FROM receipt_postings rp WHERE rp.operation_id=jt.manual_id
     UNION SELECT bb.file_hash FROM bank_bookings bb WHERE bb.id=jt.manual_id
     UNION SELECT g.file_hash FROM reconciliation_claims c JOIN reconciliation_groups g ON g.id=c.group_id
       WHERE c.account_id=jt.account_id AND c.kind='journal' AND c.claim=jt.id::text) evidence),'[]'::jsonb) evidence,
   EXISTS(SELECT 1 FROM reconciliation_claims c WHERE c.account_id=jt.account_id AND c.kind='journal' AND c.claim=jt.id::text) reconciled,
   coalesce((SELECT max(revision) FROM report_mappings m WHERE m.account_id=p_account AND m.transaction_id=jt.id AND m.line=je.line),0) mapping_revision,
   (SELECT CASE WHEN m.owner_link IS NOT DISTINCT FROM ol.id AND jsonb_array_length(m.allocations)>0 THEN jsonb_build_object('id',m.id,'revision',m.revision,'allocations',m.allocations,'actor',m.actor,'created_at',m.created_at) ELSE NULL END
    FROM report_mappings m WHERE m.account_id=p_account AND m.transaction_id=jt.id AND m.line=je.line ORDER BY revision DESC LIMIT 1) mapping
  FROM tx jt JOIN journal_entries je ON je.transaction_id=jt.id JOIN journal_sources js ON js.journal_id=jt.id LEFT JOIN manual_operations mo ON mo.id=jt.manual_id LEFT JOIN active_owner_expenses ol ON ol.source_transaction=jt.id AND ol.workspace_id=p_workspace AND ol.account_id=p_account
  WHERE jt.paid_at IS NOT NULL AND NOT EXISTS(SELECT 1 FROM active_owner_settlements os WHERE os.transaction_id=jt.id OR EXISTS(SELECT 1 FROM manual_operations orig WHERE orig.id=jt.manual_id AND orig.reference_operation=(SELECT manual_id FROM journal_transactions WHERE id=os.transaction_id))) AND je.code IN ('receipts','refunds','parts_cost','fees','expenses')
  ORDER BY jt.paid_at,jt.id,je.line LIMIT 5001
 ) SELECT jsonb_build_object('version','accountant-working-paper-v1','form_version','2025-scan-based-labels-v1',
  'entity','Aksenov LLC','scope','business','basis','cash','status','Accountant Review','workspace',p_workspace,'account',p_account,
  'account_name',(SELECT name FROM financial_accounts WHERE id=p_account),'workspace_name',(SELECT name FROM workspaces WHERE id=p_workspace),
  'currency',(SELECT currency FROM financial_accounts WHERE id=p_account),'from',p_from,'to',p_to,
  'lines',coalesce((SELECT jsonb_agg(to_jsonb(lines) ORDER BY paid_at,transaction_id,line) FROM lines),'[]'::jsonb),
  'owner_expenses',coalesce((SELECT jsonb_agg(jsonb_build_object('id',ol.id,'source_transaction',ol.source_transaction,'business_cents',ol.business_cents::text,
   'reimbursed_cents',(SELECT coalesce(sum(os.cents-(SELECT coalesce(sum(r.amount_cents),0) FROM manual_operations r WHERE r.reference_operation=(SELECT manual_id FROM journal_transactions WHERE id=os.transaction_id))),0)::text FROM active_owner_settlements os WHERE link_id=ol.id),
   'settlements',coalesce((SELECT jsonb_agg(jsonb_build_object('id',os.id,'transaction',os.transaction_id,'cents',os.cents::text) ORDER BY os.created_at,os.id) FROM active_owner_settlements os WHERE os.link_id=ol.id),'[]'::jsonb),
   'source_refunds',(SELECT coalesce(sum(r.amount_cents),0)::text FROM manual_operations r WHERE r.reference_operation=jt.manual_id)) ORDER BY ol.created_at,ol.id)
   FROM active_owner_expenses ol JOIN journal_transactions jt ON jt.id=ol.source_transaction WHERE ol.workspace_id=p_workspace AND ol.account_id=p_account),'[]'::jsonb),
  'boundary',jsonb_build_object('transaction_count',(SELECT count(*)::text FROM tx),'latest_posted_at',(SELECT to_char(max(posted_at) AT TIME ZONE 'UTC','YYYY-MM-DD"T"HH24:MI:SS.US"Z"') FROM tx)),
  'exceptions',jsonb_build_object('missing_paid_date',(SELECT count(*)::text FROM tx WHERE paid_at IS NULL),
   'waiting',(SELECT count(*)::text FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='waiting'),
   'needs_review',(SELECT count(*)::text FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='needs_review'))
 ) INTO result;
 IF jsonb_array_length(result->'lines')>5000 THEN RAISE EXCEPTION 'report_too_large';END IF;
 RETURN jsonb_build_object('data',result,'hash',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
END $$;

CREATE FUNCTION nestwise.save_report_snapshot(p_subject text,p_workspace uuid,p_account uuid,p_id uuid,p_from date,p_to date,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; prior report_snapshots; input jsonb;
BEGIN
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 PERFORM 1 FROM financial_accounts WHERE id=p_account FOR UPDATE;
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 IF p_id IS NULL OR p_hash IS NULL OR p_hash!~'^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'invalid_report';END IF;
 SELECT * INTO prior FROM report_snapshots WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id<>p_workspace OR prior.account_id<>p_account OR prior.actor<>who OR prior.date_from IS DISTINCT FROM p_from OR prior.date_to IS DISTINCT FROM p_to OR prior.hash<>p_hash THEN RAISE EXCEPTION 'report_conflict';END IF;
  RETURN jsonb_build_object('id',prior.id,'hash',prior.hash,'data',prior.data,'created_at',prior.created_at);
 END IF;
 IF (SELECT count(*) FROM report_snapshots WHERE account_id=p_account)>=100 THEN RAISE EXCEPTION 'report_limit';END IF;
 input:=report_input(p_subject,p_workspace,p_account,p_from,p_to);
 IF input->>'hash'<>p_hash THEN RAISE EXCEPTION 'report_conflict';END IF;
 INSERT INTO report_snapshots(id,workspace_id,account_id,actor,date_from,date_to,data,hash)
 VALUES(p_id,p_workspace,p_account,who,p_from,p_to,input->'data',p_hash) RETURNING * INTO prior;
 RETURN jsonb_build_object('id',prior.id,'hash',prior.hash,'data',prior.data,'created_at',prior.created_at);
END $$;
CREATE FUNCTION nestwise.read_report_snapshots(p_subject text,p_workspace uuid,p_account uuid,p_id uuid DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM business_report_actor(p_subject,p_workspace,p_account,false);
 IF p_id IS NULL THEN
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'from',date_from,'to',date_to,'hash',hash,'status',status,'created_at',created_at) ORDER BY created_at DESC,id),'[]'::jsonb) INTO result FROM report_snapshots WHERE workspace_id=p_workspace AND account_id=p_account;
 ELSE
  SELECT jsonb_build_object('id',id,'hash',hash,'data',data,'created_at',created_at) INTO result FROM report_snapshots WHERE workspace_id=p_workspace AND account_id=p_account AND id=p_id;
  IF result IS NULL THEN RAISE EXCEPTION 'forbidden';END IF;
 END IF;RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.propose_report_mapping(text,uuid,uuid,jsonb),nestwise.report_input(text,uuid,uuid,date,date),nestwise.save_report_snapshot(text,uuid,uuid,uuid,date,date,text),nestwise.read_report_snapshots(text,uuid,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.propose_report_mapping(text,uuid,uuid,jsonb),nestwise.report_input(text,uuid,uuid,date,date),nestwise.save_report_snapshot(text,uuid,uuid,uuid,date,date,text),nestwise.read_report_snapshots(text,uuid,uuid,uuid) TO nestwise_api;
