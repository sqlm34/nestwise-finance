-- Additive read-only API; old clients and existing functions remain valid.
CREATE INDEX journal_by_event_date ON nestwise.journal_transactions(workspace_id,account_id,occurred_at,id);
CREATE FUNCTION nestwise.user_journal_page(
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
    OR p_code NOT IN ('all','clearing','receipts','refunds','parts_cost','parts_payable','fees')
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
    FROM journal_transactions jt JOIN source_events se ON se.id=jt.event_id
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
