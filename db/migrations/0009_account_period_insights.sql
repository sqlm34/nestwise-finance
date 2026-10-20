-- Operational, event-date journal summary. Not a bank balance or tax report.
CREATE FUNCTION nestwise.user_period_insights(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date)
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
  WITH codes AS (SELECT unnest(ARRAY['clearing','receipts','refunds','parts_cost','parts_payable','fees']) code),
  periods AS (SELECT 'current' label,p_from first_day,p_to last_day UNION ALL SELECT 'previous',previous_start,p_from-1),
  tx AS MATERIALIZED (
    SELECT id,occurred_at,paid_at FROM journal_transactions WHERE workspace_id=p_workspace AND account_id=p_account
      AND occurred_at>=(previous_start::timestamp AT TIME ZONE 'UTC')
      AND occurred_at<((p_to+1)::timestamp AT TIME ZONE 'UTC')
  ), period_data AS (
    SELECT label,jsonb_build_object('from',first_day,'to',last_day,
      'transaction_count',(SELECT count(*) FROM tx WHERE occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'missing_paid_date',(SELECT count(*) FROM tx WHERE paid_at IS NULL AND occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'totals',(SELECT jsonb_object_agg(code,coalesce((SELECT sum(je.cents) FROM journal_entries je JOIN tx ON tx.id=je.transaction_id
        WHERE je.code=codes.code AND tx.occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND tx.occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC')),0)::text) FROM codes)) summary
    FROM periods
  ), months AS (
    SELECT greatest(p_from,day::date) first_day,least(p_to,(day+interval '1 month - 1 day')::date) last_day
    FROM generate_series(date_trunc('month',p_from::timestamp),date_trunc('month',p_to::timestamp),interval '1 month') day
  ), monthly AS (
    SELECT first_day,jsonb_build_object('from',first_day,'to',last_day,
      'transaction_count',(SELECT count(*) FROM tx WHERE occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'missing_paid_date',(SELECT count(*) FROM tx WHERE paid_at IS NULL AND occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC'))::text,
      'totals',(SELECT jsonb_object_agg(code,coalesce((SELECT sum(je.cents) FROM journal_entries je JOIN tx ON tx.id=je.transaction_id
        WHERE je.code=codes.code AND tx.occurred_at>=(first_day::timestamp AT TIME ZONE 'UTC') AND tx.occurred_at<((last_day+1)::timestamp AT TIME ZONE 'UTC')),0)::text) FROM codes)) summary
    FROM months
  )
  SELECT jsonb_build_object('generated_at',statement_timestamp(),'currency',(SELECT currency FROM financial_accounts WHERE id=p_account),
    'current',(SELECT summary FROM period_data WHERE label='current'),
    'previous',(SELECT summary FROM period_data WHERE label='previous'),
    'months',(SELECT jsonb_agg(summary ORDER BY first_day) FROM monthly),
    'attention',jsonb_build_object('waiting',(SELECT count(*) FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='waiting')::text,
      'needs_review',(SELECT count(*) FROM source_events WHERE workspace_id=p_workspace AND account_id=p_account AND status='needs_review')::text)) INTO result;
  RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.user_period_insights(text,uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_period_insights(text,uuid,uuid,date,date) TO nestwise_api;
