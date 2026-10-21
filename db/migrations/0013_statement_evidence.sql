-- Read-only evidence projection; never approves a report or changes a posting.
CREATE FUNCTION nestwise.document_evidence(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_fingerprints jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
  PERFORM reconciliation_actor(p_subject,p_workspace,p_account,false);
  IF p_hash IS NULL OR p_hash!~'^[0-9a-f]{64}$' OR p_fingerprints IS NULL OR jsonb_typeof(p_fingerprints)<>'array' OR jsonb_array_length(p_fingerprints)>5000 THEN RAISE EXCEPTION 'invalid_document';END IF;
  RETURN jsonb_build_object('groups',coalesce((SELECT jsonb_agg(jsonb_build_object('id',g.id,'file_hash',g.file_hash,'rows',g.rows,'transactions',g.transactions) ORDER BY g.id)
    FROM reconciliation_groups g WHERE g.account_id=p_account AND g.file_hash=p_hash AND NOT EXISTS(SELECT 1 FROM reconciliation_cancellations c WHERE c.group_id=g.id)),'[]'::jsonb),
    'canceled',(SELECT count(*) FROM reconciliation_groups g JOIN reconciliation_cancellations c ON c.group_id=g.id WHERE g.account_id=p_account AND g.file_hash=p_hash),
    'reserved',coalesce((SELECT jsonb_agg(jsonb_build_object('fingerprint',c.claim,'group_id',c.group_id)) FROM reconciliation_claims c JOIN reconciliation_groups g ON g.id=c.group_id
      WHERE c.account_id=p_account AND c.kind='bank_fingerprint' AND g.file_hash<>p_hash AND c.claim IN(SELECT jsonb_array_elements_text(p_fingerprints))),'[]'::jsonb));
END $$;
REVOKE ALL ON FUNCTION nestwise.document_evidence(text,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.document_evidence(text,uuid,uuid,text,jsonb) TO nestwise_api;
