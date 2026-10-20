-- Read-only account inbox, including orders with no posted transactions.
CREATE INDEX source_events_account_received ON nestwise.source_events(workspace_id,account_id,received_at,id);
CREATE FUNCTION nestwise.user_account_events(p_subject text,p_workspace uuid,p_account uuid,
  p_status text DEFAULT 'attention',p_query text DEFAULT '',p_cursor uuid DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; anchor_time timestamptz; result jsonb;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_status IS NULL OR p_status NOT IN ('attention','all','waiting','needs_review','posted','asserted')
    OR p_query IS NULL OR length(p_query)>128 OR p_query ~ '[[:cntrl:]]' THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  IF p_cursor IS NOT NULL THEN
    SELECT received_at INTO anchor_time FROM source_events
      WHERE id=p_cursor AND workspace_id=p_workspace AND account_id=p_account;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_cursor'; END IF;
  END IF;
  WITH matching AS MATERIALIZED (
    SELECT id,received_at,status,error_code FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account
      AND (p_query='' OR strpos(lower(source_order_id),lower(p_query))>0 OR strpos(lower(source_event_id::text),lower(p_query))>0)
  ), candidates AS (
    SELECT * FROM matching WHERE (p_status='all' OR status=p_status OR (p_status='attention' AND status IN ('waiting','needs_review')))
      AND (p_cursor IS NULL OR (received_at,id)<(anchor_time,p_cursor))
    ORDER BY received_at DESC,id DESC LIMIT 101
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY received_at DESC,id DESC) n FROM candidates),
  page AS (
    SELECT n,ep.summary || jsonb_build_object('cursor',numbered.id,'guidance',
      CASE WHEN numbered.status='waiting' THEN 'earlier_revision'
        WHEN numbered.status<>'needs_review' THEN 'none'
        WHEN numbered.error_code='refund_exceeds_source' THEN 'excess_refund'
        WHEN numbered.error_code='snapshot_mismatch' THEN 'snapshot_mismatch'
        WHEN numbered.error_code IN ('reference_not_posted','invalid_cost_reference','reference_already_adjusted','invalid_reference_type','use_latest_cost_revision') THEN 'reference'
        ELSE 'review' END) item
    FROM numbered JOIN event_provenance ep ON ep.internal_id=numbered.id WHERE n<=100
  )
  SELECT jsonb_build_object('events',coalesce((SELECT jsonb_agg(item ORDER BY n) FROM page),'[]'::jsonb),
    'next_cursor',CASE WHEN (SELECT count(*) FROM candidates)>100 THEN (SELECT id FROM numbered WHERE n=100) ELSE NULL END,
    'counts',jsonb_build_object('waiting',(SELECT count(*) FROM matching WHERE status='waiting')::text,
      'needs_review',(SELECT count(*) FROM matching WHERE status='needs_review')::text,
      'posted',(SELECT count(*) FROM matching WHERE status='posted')::text,
      'asserted',(SELECT count(*) FROM matching WHERE status='asserted')::text)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.user_account_events(text,uuid,uuid,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_account_events(text,uuid,uuid,text,text,uuid) TO nestwise_api;
