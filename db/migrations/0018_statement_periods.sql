-- Additive evidence only. Never posts money or changes original documents.
CREATE TABLE nestwise.statement_periods (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 file_hash text NOT NULL, revision integer NOT NULL CHECK(revision BETWEEN 1 AND 100),
 data jsonb NOT NULL, checks jsonb NOT NULL, actor uuid NOT NULL REFERENCES nestwise.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 UNIQUE(account_id,file_hash,revision),
 FOREIGN KEY(account_id,file_hash) REFERENCES nestwise.statement_archived(account_id,file_hash),
 FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TRIGGER statement_periods_immutable BEFORE UPDATE OR DELETE ON nestwise.statement_periods FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE FUNCTION nestwise.save_statement_period(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_id uuid,p_expected integer,p_data jsonb,p_checks jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; prior statement_periods; current_revision integer;
BEGIN
 who:=reconciliation_actor(p_subject,p_workspace,p_account,true);
 PERFORM 1 FROM financial_accounts WHERE id=p_account FOR UPDATE;
 who:=reconciliation_actor(p_subject,p_workspace,p_account,true);
 IF p_id IS NULL OR p_expected IS NULL OR p_expected NOT BETWEEN 0 AND 99
  OR p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR p_checks IS NULL OR jsonb_typeof(p_checks)<>'object'
  OR NOT EXISTS(SELECT 1 FROM statement_archived WHERE account_id=p_account AND file_hash=p_hash)
  THEN RAISE EXCEPTION 'invalid_statement_period'; END IF;
 IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>6
  OR NOT p_data ?& ARRAY['from','to','opening_cents','closing_cents','last4','confirmed']
  OR p_data->'confirmed' IS DISTINCT FROM 'true'::jsonb
  OR coalesce(p_data->>'last4','')!~'^[0-9]{4}$'
  OR coalesce(p_data->>'from','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR coalesce(p_data->>'to','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
  OR coalesce(p_data->>'opening_cents','')!~'^(0|-?[1-9][0-9]{0,14})$'
  OR coalesce(p_data->>'closing_cents','')!~'^(0|-?[1-9][0-9]{0,14})$'
  OR NOT p_checks ?& ARRAY['net_cents','expected_closing_cents','difference_cents','outside_rows','ambiguous_rows','balanced']
  THEN RAISE EXCEPTION 'invalid_statement_period'; END IF;
 IF (p_data->>'from')::date>(p_data->>'to')::date THEN RAISE EXCEPTION 'invalid_statement_period'; END IF;
 SELECT * INTO prior FROM statement_periods WHERE id=p_id;
 IF FOUND THEN
  IF prior.workspace_id<>p_workspace OR prior.account_id<>p_account OR prior.file_hash<>p_hash
   OR prior.revision<>p_expected+1 OR prior.data<>p_data OR prior.checks<>p_checks OR prior.actor<>who
   THEN RAISE EXCEPTION 'statement_period_conflict'; END IF;
  RETURN p_id;
 END IF;
 SELECT coalesce(max(revision),0) INTO current_revision FROM statement_periods WHERE account_id=p_account AND file_hash=p_hash;
 IF current_revision<>p_expected THEN RAISE EXCEPTION 'statement_period_conflict'; END IF;
 INSERT INTO statement_periods(id,workspace_id,account_id,file_hash,revision,data,checks,actor)
 VALUES(p_id,p_workspace,p_account,p_hash,p_expected+1,p_data,p_checks,who);
 RETURN p_id;
END $$;
CREATE FUNCTION nestwise.read_statement_periods(p_subject text,p_workspace uuid,p_account uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
 PERFORM reconciliation_actor(p_subject,p_workspace,p_account,false);
 -- One document: bounded full audit history. Account: latest revision per original.
 RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',s.id,'hash',s.file_hash,'revision',s.revision,'data',s.data,'check',s.checks,'created_at',s.created_at) ORDER BY s.created_at DESC,s.id)
 FROM statement_periods s WHERE s.workspace_id=p_workspace AND s.account_id=p_account
 AND (p_hash IS NULL AND s.revision=(SELECT max(t.revision) FROM statement_periods t WHERE t.account_id=p_account AND t.file_hash=s.file_hash) OR s.file_hash=p_hash)), '[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION nestwise.save_statement_period(text,uuid,uuid,text,uuid,integer,jsonb,jsonb),nestwise.read_statement_periods(text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.save_statement_period(text,uuid,uuid,text,uuid,integer,jsonb,jsonb),nestwise.read_statement_periods(text,uuid,uuid,text) TO nestwise_api;
