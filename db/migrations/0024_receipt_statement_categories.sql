-- Additive entry point: older clients keep the original receipt posting contract.
-- Cash posting and the owner's Statement allocation either both commit or neither does.
CREATE FUNCTION nestwise.post_receipt_categorized(p_subject text,p_workspace uuid,p_account uuid,p_hash text,
  p_review uuid,p_operation uuid,p_paid date,p_allocations jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE tx uuid;
BEGIN
  PERFORM business_report_actor(p_subject,p_workspace,p_account,true);
  IF jsonb_typeof(p_allocations) IS DISTINCT FROM 'array' OR jsonb_array_length(p_allocations) NOT BETWEEN 1 AND 43
    THEN RAISE EXCEPTION 'invalid_report'; END IF;
  -- Use deterministic category ordering for retries, including calls outside the API.
  SELECT jsonb_agg(value ORDER BY value->>'category') INTO p_allocations FROM jsonb_array_elements(p_allocations);
  PERFORM post_receipt(p_subject,p_workspace,p_account,p_hash,p_review,p_operation,p_paid);
  SELECT id INTO STRICT tx FROM journal_transactions WHERE manual_id=p_operation AND account_id=p_account;
  -- Mapping identity is stable across retries. The existing mapping contract checks
  -- exact positive totals, expense-only category IDs, actor, scope and revision.
  PERFORM propose_report_mapping(p_subject,p_workspace,p_account,jsonb_build_object(
    'id',p_operation,'transaction',tx,'line',2,'expected_revision',0,'allocations',p_allocations));
  RETURN p_operation;
END $$;
REVOKE ALL ON FUNCTION nestwise.post_receipt_categorized(text,uuid,uuid,text,uuid,uuid,date,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.post_receipt_categorized(text,uuid,uuid,text,uuid,uuid,date,jsonb) TO nestwise_api;
