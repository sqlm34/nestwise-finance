-- Read-only, account-scoped connection metadata. No secrets are exposed.
CREATE FUNCTION nestwise.user_crm_status(p_subject text,p_workspace uuid,p_account uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('id',c.id,'enabled',c.enabled,
    'last_received_at',(SELECT max(e.received_at) FROM source_events e WHERE e.connection_id=c.id)))
    FROM source_connections c WHERE c.workspace_id=p_workspace AND c.account_id=p_account
      AND c.id NOT LIKE 'manual-%'),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION nestwise.user_crm_status(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_crm_status(text,uuid,uuid) TO nestwise_api;
