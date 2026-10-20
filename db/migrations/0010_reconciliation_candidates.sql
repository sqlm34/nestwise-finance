-- Read-only cash candidates; bank files and draft decisions never enter this database.
CREATE INDEX journal_by_paid_date ON nestwise.journal_transactions(workspace_id,account_id,paid_at,id) WHERE paid_at IS NOT NULL;
CREATE FUNCTION nestwise.user_reconciliation_candidates(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date,p_cursor uuid DEFAULT NULL)
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
    FROM journal_transactions jt JOIN source_events se ON se.id=jt.event_id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account AND se.status='posted'
      AND jt.paid_at >= (p_from::timestamp AT TIME ZONE 'UTC')
      AND jt.paid_at < ((p_to+1)::timestamp AT TIME ZONE 'UTC')
      AND se.kind IN ('job.payment_recorded','job.customer_refund_issued','job.part_cost_recorded',
        'job.supplier_credit_received','job.processor_fee_recorded','job.processor_fee_refunded')
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
