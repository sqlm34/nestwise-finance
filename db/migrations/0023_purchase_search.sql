-- Search existing payments, including bank-origin bookings, without posting or
-- automatically asserting that equal amounts describe the same purchase.
CREATE FUNCTION nestwise.purchase_candidates(p_subject text,p_workspace uuid,p_account uuid,p_query text,p_from date,p_to date,p_min bigint) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 PERFORM reconciliation_actor(p_subject,p_workspace,p_account,false);
 IF p_query IS NULL OR length(p_query)>120 OR p_min IS NULL OR p_min<0 OR p_min>9007199254740991
 OR (p_from IS NOT NULL AND p_to IS NOT NULL AND p_from>p_to) THEN RAISE EXCEPTION 'invalid_parts';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(rows) ORDER BY paid_on DESC,id),'[]'::jsonb) INTO result FROM (
  SELECT jt.id,to_char(jt.paid_at AT TIME ZONE 'UTC','YYYY-MM-DD') paid_on,mo.amount_cents::text amount_cents,mo.payload->>'note' note,
   bb.file_hash,bb.row_data->>'date' bank_date,
   (SELECT coalesce(sum(r.amount_cents),0)::text FROM manual_operations r WHERE r.reference_operation=mo.id) refund_cents
  FROM journal_transactions jt JOIN manual_operations mo ON mo.id=jt.manual_id
  LEFT JOIN bank_bookings bb ON bb.id=mo.id
  WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account AND mo.kind='expense' AND jt.paid_at IS NOT NULL
   AND mo.amount_cents>=p_min AND (p_query='' OR strpos(lower(mo.payload->>'note'),lower(p_query))>0)
   AND (p_from IS NULL OR jt.paid_at>=(p_from::timestamp AT TIME ZONE 'UTC'))
   AND (p_to IS NULL OR jt.paid_at<((p_to+1)::timestamp AT TIME ZONE 'UTC'))
  ORDER BY jt.paid_at DESC,jt.id LIMIT 101
 ) rows;
 IF jsonb_array_length(result)>100 THEN RAISE EXCEPTION 'parts_search_limit';END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.purchase_candidates(text,uuid,uuid,text,date,date,bigint) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.purchase_candidates(text,uuid,uuid,text,date,date,bigint) TO nestwise_api;

