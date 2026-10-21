-- Cash summaries use actual paid_at, never delivery time. Undated facts remain
-- visible as exceptions by event date but are excluded from monetary totals.
CREATE INDEX journal_by_cash_review_date ON nestwise.journal_transactions
  (workspace_id,account_id,(coalesce(paid_at,occurred_at)),id);
CREATE OR REPLACE FUNCTION nestwise.user_cash_insights(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; previous_start date; result jsonb;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>365
    OR p_from<'0002-01-01'::date OR p_to>'9998-12-31'::date THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  previous_start:=p_from-(p_to-p_from+1);
  WITH codes AS (SELECT unnest(ARRAY['clearing','receipts','refunds','parts_cost','parts_payable','fees','expenses','transfers']) code),
  periods AS (SELECT 'current' label,p_from first_day,p_to last_day UNION ALL SELECT 'previous',previous_start,p_from-1),
  tx AS MATERIALIZED (
    SELECT id,coalesce(paid_at,occurred_at) AS occurred_at,paid_at FROM journal_transactions WHERE workspace_id=p_workspace AND account_id=p_account
      AND coalesce(paid_at,occurred_at)>=(previous_start::timestamp AT TIME ZONE 'UTC')
      AND coalesce(paid_at,occurred_at)<((p_to+1)::timestamp AT TIME ZONE 'UTC')
  ), period_data AS (
    SELECT label,jsonb_build_object('from',first_day,'to',last_day,
      'transaction_count',(SELECT count(*) FROM tx WHERE occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND coalesce(paid_at,occurred_at)<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'missing_paid_date',(SELECT count(*) FROM tx WHERE paid_at IS NULL AND coalesce(paid_at,occurred_at)>=(first_day::timestamp AT TIME ZONE 'UTC') AND coalesce(paid_at,occurred_at)<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'totals',(SELECT jsonb_object_agg(code,coalesce((SELECT sum(je.cents) FROM journal_entries je JOIN tx ON tx.id=je.transaction_id
        WHERE tx.paid_at IS NOT NULL AND je.code=codes.code AND tx.occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND tx.occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC')),0)::text) FROM codes)) summary
    FROM periods
  ), months AS (
    SELECT greatest(p_from,day::date) first_day,least(p_to,(day+interval '1 month - 1 day')::date) last_day
    FROM generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month') day
  ), monthly AS (
    SELECT first_day,jsonb_build_object('from',first_day,'to',last_day,
      'transaction_count',(SELECT count(*) FROM tx WHERE occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND coalesce(paid_at,occurred_at)<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'missing_paid_date',(SELECT count(*) FROM tx WHERE paid_at IS NULL AND coalesce(paid_at,occurred_at)>=(first_day::timestamp AT TIME ZONE 'UTC') AND coalesce(paid_at,occurred_at)<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'totals',(SELECT jsonb_object_agg(code,coalesce((SELECT sum(je.cents) FROM journal_entries je JOIN tx ON tx.id=je.transaction_id
        WHERE tx.paid_at IS NOT NULL AND je.code=codes.code AND tx.occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND tx.occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC')),0)::text) FROM codes)) summary
    FROM months
  )
  SELECT jsonb_build_object('basis','cash','generated_at',statement_timestamp(),'currency',(SELECT currency FROM financial_accounts WHERE id=p_account),
    'current',(SELECT summary FROM period_data WHERE label='current'),
    'previous',(SELECT summary FROM period_data WHERE label='previous'),
    'months',(SELECT jsonb_agg(summary ORDER BY first_day) FROM monthly),
    'attention',jsonb_build_object('waiting',(SELECT count(*) FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='waiting')::text,
      'needs_review',(SELECT count(*) FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='needs_review')::text)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.user_cash_insights(text,uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_cash_insights(text,uuid,uuid,date,date) TO nestwise_api;

CREATE OR REPLACE FUNCTION nestwise.user_cash_journal_page(
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
    OR p_code NOT IN ('all','clearing','receipts','refunds','parts_cost','parts_payable','fees','expenses','transfers')
    OR p_order NOT IN ('newest','oldest') OR p_from>p_to THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  IF p_cursor IS NOT NULL THEN
    SELECT paid_at INTO anchor_time FROM journal_transactions
      WHERE id=p_cursor AND workspace_id=p_workspace AND account_id=p_account AND paid_at IS NOT NULL;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_cursor'; END IF;
  END IF;
  -- UUID cursor retains PostgreSQL microsecond precision and is scoped to this account.
  -- Keyset pagination avoids OFFSET shifts when other transactions arrive.
  WITH candidates AS (
    SELECT jt.id,jt.occurred_at,jt.paid_at,jt.posted_at,se.source_event_id,se.source_order_id
    FROM journal_transactions jt JOIN journal_sources se ON se.journal_id=jt.id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account AND jt.paid_at IS NOT NULL
      AND (p_from IS NULL OR jt.paid_at >= (p_from::timestamp AT TIME ZONE 'UTC'))
      AND (p_to IS NULL OR jt.paid_at < ((p_to+1)::timestamp AT TIME ZONE 'UTC'))
      AND (p_code='all' OR EXISTS(SELECT 1 FROM journal_entries je WHERE je.transaction_id=jt.id AND je.code=p_code))
      AND (p_query='' OR strpos(lower(jt.id::text),lower(p_query))>0
        OR strpos(lower(se.source_event_id::text),lower(p_query))>0
        OR strpos(lower(se.source_order_id),lower(p_query))>0)
      AND (p_cursor IS NULL
        OR (p_order='newest' AND (jt.paid_at,jt.id)<(anchor_time,p_cursor))
        OR (p_order='oldest' AND (jt.paid_at,jt.id)>(anchor_time,p_cursor)))
    ORDER BY CASE WHEN p_order='newest' THEN jt.paid_at END DESC,
      CASE WHEN p_order='oldest' THEN jt.paid_at END ASC,
      CASE WHEN p_order='newest' THEN jt.id END DESC,
      CASE WHEN p_order='oldest' THEN jt.id END ASC LIMIT 101
  ), numbered AS (
    SELECT *,row_number() OVER(ORDER BY
      CASE WHEN p_order='newest' THEN paid_at END DESC,
      CASE WHEN p_order='oldest' THEN paid_at END ASC,
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
REVOKE ALL ON FUNCTION nestwise.user_cash_journal_page(text,uuid,uuid,text,date,date,text,text,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_cash_journal_page(text,uuid,uuid,text,date,date,text,text,uuid) TO nestwise_api;
