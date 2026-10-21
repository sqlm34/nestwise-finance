-- Evidence and physical consumption only: these functions never post cash.
CREATE TABLE nestwise.parts_commands (
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,account_id uuid NOT NULL,
 lot_id uuid NOT NULL,revision integer NOT NULL CHECK(revision>0),
 actor uuid NOT NULL REFERENCES nestwise.users,payload jsonb NOT NULL,state jsonb NOT NULL,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,lot_id,revision),
 FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TRIGGER parts_commands_immutable BEFORE UPDATE OR DELETE ON nestwise.parts_commands FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE VIEW nestwise.parts_current AS SELECT DISTINCT ON(account_id,lot_id) * FROM nestwise.parts_commands ORDER BY account_id,lot_id,revision DESC;
REVOKE ALL ON nestwise.parts_commands,nestwise.parts_current FROM PUBLIC,nestwise_api;

CREATE FUNCTION nestwise.parts_command(p_subject text,p_workspace uuid,p_account uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; prior parts_commands; current parts_commands; command uuid; lot uuid; kind text;
 s jsonb; qty integer; used integer; unit bigint; source journal_transactions; amount bigint; allocated numeric;
BEGIN
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR NOT p_data ?& ARRAY['id','lot','expected_revision','kind'] THEN RAISE EXCEPTION 'invalid_parts';END IF;
 command:=(p_data->>'id')::uuid;lot:=(p_data->>'lot')::uuid;kind:=p_data->>'kind';
 IF command IS NULL OR lot IS NULL OR kind NOT IN ('create','evidence','consume','return','archive') THEN RAISE EXCEPTION 'invalid_parts';END IF;
 -- Serialize all stock allocations, including cross-account links to the same payment.
 PERFORM pg_advisory_xact_lock(20921,1);
 who:=business_report_actor(p_subject,p_workspace,p_account,true);
 SELECT * INTO prior FROM parts_commands WHERE id=command;
 IF FOUND THEN
  IF prior.actor<>who OR prior.workspace_id<>p_workspace OR prior.account_id<>p_account OR prior.payload<>p_data THEN RAISE EXCEPTION 'parts_conflict';END IF;
  RETURN command;
 END IF;
 SELECT * INTO current FROM parts_current WHERE account_id=p_account AND lot_id=lot;
 IF (p_data->>'expected_revision')::integer IS DISTINCT FROM coalesce(current.revision,0) THEN RAISE EXCEPTION 'parts_conflict';END IF;
 IF (SELECT count(*) FROM parts_commands WHERE account_id=p_account)>=10000 THEN RAISE EXCEPTION 'parts_limit';END IF;
 IF coalesce(current.revision,0)>=1000 THEN RAISE EXCEPTION 'parts_limit';END IF;
 IF kind='create' THEN
  IF current.id IS NOT NULL OR (SELECT count(*) FROM parts_current WHERE account_id=p_account)>=1000
   OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>9 OR NOT p_data ?& ARRAY['name','quantity','unit_cents','paid_on','note']
   OR jsonb_typeof(p_data->'name') IS DISTINCT FROM 'string' OR length(trim(p_data->>'name')) NOT BETWEEN 1 AND 120
   OR jsonb_typeof(p_data->'note') IS DISTINCT FROM 'string' OR length(p_data->>'note')>500
   OR (p_data->>'quantity')!~'^[1-9][0-9]{0,5}$' OR (p_data->>'unit_cents')!~'^(0|[1-9][0-9]{0,11})$' THEN RAISE EXCEPTION 'invalid_parts';END IF;
  qty:=(p_data->>'quantity')::integer;unit:=(p_data->>'unit_cents')::bigint;
  IF qty IS NULL OR unit IS NULL OR qty::numeric*unit>9007199254740991 THEN RAISE EXCEPTION 'invalid_parts';END IF;
  IF p_data->>'paid_on' IS NOT NULL AND (p_data->>'paid_on'!~'^\d{4}-\d{2}-\d{2}$' OR to_char((p_data->>'paid_on')::date,'YYYY-MM-DD')<>p_data->>'paid_on') THEN RAISE EXCEPTION 'invalid_parts';END IF;
  s:=jsonb_build_object('name',trim(p_data->>'name'),'quantity',qty,'unit_cents',unit::text,'paid_on',p_data->>'paid_on','note',p_data->>'note','transaction',NULL,'used',0,'archived',false,'uses','[]'::jsonb);
 ELSE
  IF current.id IS NULL OR (current.state->>'archived')::boolean THEN RAISE EXCEPTION 'parts_conflict';END IF;
  s:=current.state;qty:=(s->>'quantity')::integer;used:=(s->>'used')::integer;unit:=(s->>'unit_cents')::bigint;
  IF kind='evidence' THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>7 OR NOT p_data ?& ARRAY['transaction','paid_on','note']
    OR jsonb_typeof(p_data->'note') IS DISTINCT FROM 'string' OR length(p_data->>'note')>500 THEN RAISE EXCEPTION 'invalid_parts';END IF;
   IF p_data->>'transaction' IS NOT NULL THEN
    SELECT * INTO source FROM journal_transactions WHERE id=(p_data->>'transaction')::uuid;
    IF NOT FOUND OR source.paid_at IS NULL OR source.manual_id IS NULL THEN RAISE EXCEPTION 'invalid_parts';END IF;
    PERFORM reconciliation_actor(p_subject,source.workspace_id,source.account_id,true);
    IF source.account_id<>p_account AND NOT EXISTS(SELECT 1 FROM active_owner_expenses WHERE account_id=p_account AND source_transaction=source.id) THEN RAISE EXCEPTION 'invalid_parts';END IF;
    SELECT mo.amount_cents-coalesce((SELECT sum(amount_cents) FROM manual_operations WHERE reference_operation=mo.id),0) INTO amount FROM manual_operations mo WHERE mo.id=source.manual_id AND mo.kind='expense';
    IF amount IS NULL THEN RAISE EXCEPTION 'invalid_parts';END IF;
    IF source.account_id<>p_account THEN SELECT least(amount,business_cents) INTO amount FROM active_owner_expenses WHERE account_id=p_account AND source_transaction=source.id;END IF;
    SELECT coalesce(sum((state->>'quantity')::numeric*(state->>'unit_cents')::numeric),0) INTO allocated FROM parts_current
     WHERE state->>'transaction'=source.id::text AND NOT(account_id=p_account AND lot_id=lot);
    IF allocated+qty::numeric*unit>amount THEN RAISE EXCEPTION 'parts_overallocated';END IF;
    IF p_data->>'paid_on' IS DISTINCT FROM to_char(source.paid_at AT TIME ZONE 'UTC','YYYY-MM-DD') THEN RAISE EXCEPTION 'invalid_parts';END IF;
   ELSIF p_data->>'paid_on' IS NOT NULL AND (p_data->>'paid_on'!~'^\d{4}-\d{2}-\d{2}$' OR to_char((p_data->>'paid_on')::date,'YYYY-MM-DD')<>p_data->>'paid_on') THEN RAISE EXCEPTION 'invalid_parts';END IF;
   s:=s||jsonb_build_object('transaction',p_data->>'transaction','paid_on',p_data->>'paid_on','note',p_data->>'note');
  ELSIF kind IN ('consume','return') THEN
   IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>7 OR NOT p_data ?& ARRAY['quantity','job','used_on']
    OR p_data->>'quantity' IS NULL OR (p_data->>'quantity')!~'^[1-9][0-9]{0,5}$' OR jsonb_typeof(p_data->'job') IS DISTINCT FROM 'string'
    OR length(trim(p_data->>'job')) NOT BETWEEN 1 AND 120 OR p_data->>'used_on' IS NULL
    OR to_char((p_data->>'used_on')::date,'YYYY-MM-DD')<>p_data->>'used_on' THEN RAISE EXCEPTION 'invalid_parts';END IF;
   IF kind='consume' AND used+(p_data->>'quantity')::integer>qty THEN RAISE EXCEPTION 'parts_overallocated';END IF;
   IF kind='return' AND (p_data->>'quantity')::integer>coalesce((SELECT sum((u->>'quantity')::integer) FROM jsonb_array_elements(s->'uses') u WHERE u->>'job'=trim(p_data->>'job')),0) THEN RAISE EXCEPTION 'parts_overallocated';END IF;
   used:=(p_data->>'quantity')::integer*CASE WHEN kind='consume' THEN 1 ELSE -1 END;
   s:=s||jsonb_build_object('used',(s->>'used')::integer+used,'uses',(s->'uses')||jsonb_build_array(jsonb_build_object('id',command,'job',trim(p_data->>'job'),'quantity',used,'used_on',p_data->>'used_on')));
  ELSE
   IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>4 OR used<>0 THEN RAISE EXCEPTION 'invalid_parts';END IF;
   s:=s||jsonb_build_object('archived',true);
  END IF;
 END IF;
 INSERT INTO parts_commands VALUES(command,p_workspace,p_account,lot,coalesce(current.revision,0)+1,who,p_data,s,clock_timestamp());
 RETURN command;
END $$;

CREATE FUNCTION nestwise.read_parts(p_subject text,p_workspace uuid,p_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
 PERFORM business_report_actor(p_subject,p_workspace,p_account,false);
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',lot_id,'revision',revision,'state',state,'created_at',created_at) ORDER BY created_at DESC,lot_id) FROM parts_current WHERE workspace_id=p_workspace AND account_id=p_account),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION nestwise.parts_command(text,uuid,uuid,jsonb),nestwise.read_parts(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.parts_command(text,uuid,uuid,jsonb),nestwise.read_parts(text,uuid,uuid) TO nestwise_api;


