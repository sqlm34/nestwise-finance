-- Private object metadata. Originals are immutable R2 objects, never ledger entries.
CREATE TABLE nestwise.statement_documents (
  workspace_id uuid NOT NULL,account_id uuid NOT NULL,file_hash text NOT NULL CHECK(file_hash ~ '^[0-9a-f]{64}$'),
  byte_count integer NOT NULL CHECK(byte_count BETWEEN 1 AND 2000000),
  uploaded_by uuid NOT NULL REFERENCES nestwise.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,file_hash),
  FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TABLE nestwise.statement_archived (
  account_id uuid NOT NULL,file_hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,file_hash),FOREIGN KEY(account_id,file_hash) REFERENCES nestwise.statement_documents(account_id,file_hash)
);
CREATE TRIGGER statement_documents_immutable BEFORE UPDATE OR DELETE ON nestwise.statement_documents FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER statement_archived_immutable BEFORE UPDATE OR DELETE ON nestwise.statement_archived FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE FUNCTION nestwise.document_access(p_subject text,p_workspace uuid,p_account uuid,p_write boolean) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN PERFORM reconciliation_actor(p_subject,p_workspace,p_account,p_write);RETURN true;END $$;
CREATE FUNCTION nestwise.prepare_document(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_bytes integer) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; previous integer;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  PERFORM 1 FROM financial_accounts WHERE id=p_account FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF p_hash IS NULL OR p_hash!~'^[0-9a-f]{64}$' OR p_bytes IS NULL OR p_bytes NOT BETWEEN 1 AND 2000000 THEN RAISE EXCEPTION 'invalid_document';END IF;
  SELECT byte_count INTO previous FROM statement_documents WHERE account_id=p_account AND file_hash=p_hash;
  IF FOUND THEN
    IF previous<>p_bytes THEN RAISE EXCEPTION 'invalid_document';END IF;
    RETURN;
  END IF;
  IF (SELECT count(*) FROM statement_documents WHERE account_id=p_account)>=100 THEN RAISE EXCEPTION 'archive_full';END IF;
  INSERT INTO statement_documents(workspace_id,account_id,file_hash,byte_count,uploaded_by) VALUES(p_workspace,p_account,p_hash,p_bytes,actor);
END $$;
CREATE FUNCTION nestwise.complete_document(p_subject text,p_workspace uuid,p_account uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
  PERFORM reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF NOT EXISTS(SELECT 1 FROM statement_documents WHERE workspace_id=p_workspace AND account_id=p_account AND file_hash=p_hash) THEN RAISE EXCEPTION 'forbidden';END IF;
  INSERT INTO statement_archived(account_id,file_hash) VALUES(p_account,p_hash) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION nestwise.read_documents(p_subject text,p_workspace uuid,p_account uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
  PERFORM reconciliation_actor(p_subject,p_workspace,p_account,false);
  -- Hard quota bounds this complete list to 100 records (including pending uploads).
  RETURN coalesce((SELECT jsonb_agg(jsonb_build_object('hash',d.file_hash,'bytes',d.byte_count,'created_at',d.created_at,
    'uploaded_by',d.uploaded_by,'archived',a.file_hash IS NOT NULL,'linked_groups',
    (SELECT count(*) FROM reconciliation_groups g WHERE g.account_id=p_account AND g.file_hash=d.file_hash)) ORDER BY d.created_at DESC,d.file_hash)
    FROM statement_documents d LEFT JOIN statement_archived a USING(account_id,file_hash)
    WHERE d.workspace_id=p_workspace AND d.account_id=p_account),'[]'::jsonb);
END $$;
REVOKE ALL ON FUNCTION nestwise.document_access(text,uuid,uuid,boolean),nestwise.prepare_document(text,uuid,uuid,text,integer),nestwise.complete_document(text,uuid,uuid,text),nestwise.read_documents(text,uuid,uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.document_access(text,uuid,uuid,boolean),nestwise.prepare_document(text,uuid,uuid,text,integer),nestwise.complete_document(text,uuid,uuid,text),nestwise.read_documents(text,uuid,uuid) TO nestwise_api;
