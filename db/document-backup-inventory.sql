-- Read-only owner query. Export the single JSON value to a PRIVATE inventory file.
-- Pending uploads are deliberately excluded: they are not completed originals.
-- The backup tool refuses >500 objects or >50 MB rather than silently truncating.
DO $guard$ BEGIN
  IF current_database() NOT IN ('nestwise_staging','nestwise_production') THEN
    RAISE EXCEPTION 'Not a Nestwise backup source';
  END IF;
END $guard$;
WITH originals AS (
  SELECT 'v1/'||d.workspace_id||'/'||d.account_id||'/'||d.file_hash AS key,
    d.file_hash AS sha256,d.byte_count AS bytes
  FROM nestwise.statement_documents d
  JOIN nestwise.statement_archived a USING(account_id,file_hash)
  UNION ALL
  SELECT 'receipts/v1/'||d.workspace_id||'/'||d.account_id||'/'||d.hash,
    d.hash,d.bytes
  FROM nestwise.receipt_originals d
  JOIN nestwise.receipt_archived a USING(account_id,hash)
)
SELECT jsonb_build_object('schemaVersion',1,
  'environment',CASE current_database() WHEN 'nestwise_production' THEN 'production' ELSE 'staging' END,
  'objects',COALESCE(jsonb_agg(to_jsonb(originals) ORDER BY key),'[]'::jsonb)) AS inventory
FROM originals;
