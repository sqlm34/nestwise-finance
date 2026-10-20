CREATE TABLE nestwise.workspace_admin_audit (
  id uuid PRIMARY KEY,workspace_id uuid NOT NULL REFERENCES nestwise.workspaces,
  actor uuid NOT NULL REFERENCES nestwise.users,payload jsonb NOT NULL,
  before_state jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TRIGGER workspace_admin_audit_immutable BEFORE UPDATE OR DELETE ON nestwise.workspace_admin_audit
  FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
REVOKE ALL ON nestwise.workspace_admin_audit FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.workspace_command(p_subject text,p_workspace uuid,p_payload jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; request_id uuid; target uuid; account uuid; action text; label text; prior workspace_admin_audit; previous jsonb:='{}';
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_payload IS NULL OR jsonb_typeof(p_payload)<>'object' OR NOT p_payload ?& ARRAY['id','action','target'] THEN RAISE EXCEPTION 'invalid_workspace_command'; END IF;
  request_id:=(p_payload->>'id')::uuid;target:=(p_payload->>'target')::uuid;action:=p_payload->>'action';label:=btrim(p_payload->>'name');
  IF request_id IS NULL OR target IS NULL OR action IS NULL THEN RAISE EXCEPTION 'invalid_workspace_command'; END IF;
  IF action='create_workspace' THEN
    PERFORM id FROM users WHERE id=actor FOR UPDATE;
    IF p_workspace<>target OR jsonb_typeof(p_payload->'kind') IS DISTINCT FROM 'string' OR p_payload->>'kind' NOT IN ('family','personal','business')
      OR (SELECT count(*) FROM jsonb_object_keys(p_payload))<>5 THEN RAISE EXCEPTION 'invalid_workspace_command'; END IF;
  ELSE
    PERFORM id FROM workspaces WHERE id=p_workspace FOR UPDATE;
    IF NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=p_workspace AND user_id=actor AND role='owner') THEN RAISE EXCEPTION 'forbidden'; END IF;
  END IF;
  SELECT * INTO prior FROM workspace_admin_audit WHERE id=request_id;
  IF FOUND THEN
    IF prior.workspace_id<>p_workspace OR prior.actor<>actor OR prior.payload<>p_payload THEN RAISE EXCEPTION 'workspace_command_conflict'; END IF;
    RETURN request_id;
  END IF;
  IF action IN ('create_workspace','rename_workspace','create_account','rename_account') THEN
    IF jsonb_typeof(p_payload->'name') IS DISTINCT FROM 'string' OR length(label) NOT BETWEEN 1 AND 120 OR label~'[[:cntrl:]]'
      OR (action<>'create_workspace' AND (SELECT count(*) FROM jsonb_object_keys(p_payload))<>4) THEN RAISE EXCEPTION 'invalid_workspace_command'; END IF;
  END IF;
  CASE action
    WHEN 'create_workspace' THEN
      IF (SELECT count(*) FROM memberships WHERE user_id=actor AND role='owner')>=20 THEN RAISE EXCEPTION 'workspace_limit'; END IF;
      INSERT INTO workspaces VALUES(target,label,p_payload->>'kind');
      INSERT INTO memberships VALUES(target,actor,'owner',true);
    WHEN 'rename_workspace' THEN
      IF target<>p_workspace THEN RAISE EXCEPTION 'invalid_workspace_command'; END IF;
      SELECT to_jsonb(w) INTO previous FROM workspaces w WHERE id=p_workspace;
      UPDATE workspaces SET name=label WHERE id=p_workspace;
    WHEN 'create_account' THEN
      IF (SELECT count(*) FROM financial_accounts WHERE workspace_id=p_workspace)>=100 THEN RAISE EXCEPTION 'workspace_limit'; END IF;
      INSERT INTO financial_accounts(id,workspace_id,name) VALUES(target,p_workspace,label);
      INSERT INTO account_grants VALUES(p_workspace,actor,target);
    WHEN 'rename_account' THEN
      SELECT to_jsonb(a) INTO previous FROM financial_accounts a WHERE id=target AND workspace_id=p_workspace FOR UPDATE;
      IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
      UPDATE financial_accounts SET name=label WHERE id=target;
    WHEN 'set_member' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>5 OR p_payload->>'role' IS NULL OR p_payload->>'role' NOT IN ('owner','member','accountant','reviewer')
        OR jsonb_typeof(p_payload->'all_accounts') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_workspace_command'; END IF;
      SELECT to_jsonb(m) INTO previous FROM memberships m WHERE workspace_id=p_workspace AND user_id=target;
      IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF; -- Inviting new identities is a separate authenticated workflow.
      IF previous->>'role'='owner' AND p_payload->>'role'<>'owner' AND (SELECT count(*) FROM memberships WHERE workspace_id=p_workspace AND role='owner')<=1
        THEN RAISE EXCEPTION 'last_workspace_owner'; END IF;
      UPDATE memberships SET role=p_payload->>'role',all_accounts=(p_payload->>'all_accounts')::boolean WHERE workspace_id=p_workspace AND user_id=target;
    WHEN 'set_account_grant' THEN
      IF (SELECT count(*) FROM jsonb_object_keys(p_payload))<>5 OR jsonb_typeof(p_payload->'allowed') IS DISTINCT FROM 'boolean' THEN RAISE EXCEPTION 'invalid_workspace_command'; END IF;
      account:=(p_payload->>'account')::uuid;
      IF NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=p_workspace AND user_id=target)
        OR NOT EXISTS(SELECT 1 FROM financial_accounts WHERE workspace_id=p_workspace AND id=account) THEN RAISE EXCEPTION 'forbidden'; END IF;
      previous:=jsonb_build_object('allowed',EXISTS(SELECT 1 FROM account_grants WHERE workspace_id=p_workspace AND user_id=target AND account_id=account));
      IF (p_payload->>'allowed')::boolean THEN INSERT INTO account_grants VALUES(p_workspace,target,account) ON CONFLICT DO NOTHING;
      ELSE DELETE FROM account_grants WHERE workspace_id=p_workspace AND user_id=target AND account_id=account; END IF;
    ELSE RAISE EXCEPTION 'invalid_workspace_command';
  END CASE;
  INSERT INTO workspace_admin_audit(id,workspace_id,actor,payload,before_state) VALUES(request_id,p_workspace,actor,p_payload,previous);
  RETURN request_id;
EXCEPTION WHEN unique_violation THEN RAISE EXCEPTION 'workspace_command_conflict';
  WHEN invalid_text_representation OR not_null_violation OR check_violation THEN RAISE EXCEPTION 'invalid_workspace_command';
END $$;
CREATE FUNCTION nestwise.workspace_administration(p_subject text,p_workspace uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF NOT EXISTS(SELECT 1 FROM memberships WHERE workspace_id=p_workspace AND user_id=actor AND role='owner') THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN jsonb_build_object('actor',actor,'workspace',(SELECT to_jsonb(w) FROM workspaces w WHERE id=p_workspace),
    'accounts',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY a.name,a.id) FROM financial_accounts a WHERE workspace_id=p_workspace),'[]'::jsonb),
    'members',coalesce((SELECT jsonb_agg(jsonb_build_object('user_id',m.user_id,'role',m.role,'all_accounts',m.all_accounts,
      'account_ids',(SELECT coalesce(jsonb_agg(g.account_id ORDER BY g.account_id),'[]'::jsonb) FROM account_grants g WHERE g.workspace_id=p_workspace AND g.user_id=m.user_id)) ORDER BY m.user_id)
      FROM memberships m WHERE m.workspace_id=p_workspace),'[]'::jsonb),
    'audit',coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.recorded_at DESC,q.id DESC) FROM
      (SELECT id,actor,payload,before_state,recorded_at FROM workspace_admin_audit WHERE workspace_id=p_workspace ORDER BY recorded_at DESC,id DESC LIMIT 50) q),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION nestwise.workspace_command(text,uuid,jsonb),nestwise.workspace_administration(text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.workspace_command(text,uuid,jsonb),nestwise.workspace_administration(text,uuid) TO nestwise_api;
