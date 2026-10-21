-- The Worker obtains the subject from a live Better Auth session, never request JSON.
-- Provisioning subject mappings and memberships remains administrative.
CREATE FUNCTION nestwise.user_access(p_subject text) RETURNS jsonb
LANGUAGE sql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
  SELECT coalesce(jsonb_agg(to_jsonb(w) ORDER BY w.name,w.id),'[]'::jsonb) FROM (
    SELECT s.id,s.name,s.kind,m.role,
      coalesce((SELECT jsonb_agg(jsonb_build_object('id',a.id,'name',a.name,'currency',a.currency) ORDER BY a.name,a.id)
        FROM financial_accounts a WHERE a.workspace_id=s.id AND
          (m.all_accounts OR EXISTS(SELECT 1 FROM account_grants g
            WHERE g.workspace_id=s.id AND g.user_id=u.id AND g.account_id=a.id))),'[]'::jsonb) accounts
    FROM users u JOIN memberships m ON m.user_id=u.id JOIN workspaces s ON s.id=m.workspace_id
    WHERE u.subject=p_subject
  ) w;
$$;
CREATE FUNCTION nestwise.user_journal(p_subject text,p_workspace uuid,p_account uuid) RETURNS jsonb
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
    FROM journal_transactions jt JOIN source_events se ON se.id=jt.event_id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account
    ORDER BY jt.posted_at DESC,jt.id DESC LIMIT 100
  ) j),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION nestwise.user_access(text),nestwise.user_journal(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_access(text),nestwise.user_journal(text,uuid,uuid) TO nestwise_api;
