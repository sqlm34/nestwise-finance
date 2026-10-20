CREATE TABLE nestwise.receipt_originals (
  workspace_id uuid NOT NULL,account_id uuid NOT NULL,hash text NOT NULL CHECK(hash~'^[0-9a-f]{64}$'),
  bytes integer NOT NULL CHECK(bytes BETWEEN 12 AND 5000000),mime text NOT NULL CHECK(mime IN('image/jpeg','image/png','image/webp','application/pdf')),
  actor uuid NOT NULL REFERENCES nestwise.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,hash),FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TABLE nestwise.receipt_archived (
  account_id uuid NOT NULL,hash text NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(account_id,hash),FOREIGN KEY(account_id,hash) REFERENCES nestwise.receipt_originals(account_id,hash)
);
CREATE TABLE nestwise.receipt_reviews (
  id uuid PRIMARY KEY,account_id uuid NOT NULL,hash text NOT NULL,revision integer NOT NULL CHECK(revision>0),
  actor uuid NOT NULL REFERENCES nestwise.users,data jsonb NOT NULL,recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(account_id,hash,revision),FOREIGN KEY(account_id,hash) REFERENCES nestwise.receipt_archived(account_id,hash)
);
CREATE TABLE nestwise.receipt_postings (
  account_id uuid NOT NULL,hash text NOT NULL,review_id uuid NOT NULL REFERENCES nestwise.receipt_reviews,
  operation_id uuid NOT NULL UNIQUE REFERENCES nestwise.manual_operations,actor uuid NOT NULL REFERENCES nestwise.users,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),PRIMARY KEY(account_id,hash),
  FOREIGN KEY(account_id,hash) REFERENCES nestwise.receipt_archived(account_id,hash)
);
CREATE TRIGGER receipt_originals_immutable BEFORE UPDATE OR DELETE ON nestwise.receipt_originals FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER receipt_archived_immutable BEFORE UPDATE OR DELETE ON nestwise.receipt_archived FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER receipt_reviews_immutable BEFORE UPDATE OR DELETE ON nestwise.receipt_reviews FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER receipt_postings_immutable BEFORE UPDATE OR DELETE ON nestwise.receipt_postings FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();

CREATE FUNCTION nestwise.prepare_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_bytes integer,p_mime text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; old receipt_originals;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  PERFORM id FROM financial_accounts WHERE id=p_account FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  SELECT * INTO old FROM receipt_originals WHERE account_id=p_account AND hash=p_hash;
  IF FOUND THEN IF old.bytes<>p_bytes OR old.mime<>p_mime THEN RAISE EXCEPTION 'receipt_conflict'; END IF;RETURN;END IF;
  IF (SELECT count(*) FROM receipt_originals WHERE account_id=p_account)>=1000 THEN RAISE EXCEPTION 'receipt_limit'; END IF;
  INSERT INTO receipt_originals(workspace_id,account_id,hash,bytes,mime,actor) VALUES(p_workspace,p_account,p_hash,p_bytes,p_mime,actor);
END $$;
CREATE FUNCTION nestwise.complete_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
  PERFORM reconciliation_actor(p_subject,p_workspace,p_account,true);
  INSERT INTO receipt_archived(account_id,hash) VALUES(p_account,p_hash) ON CONFLICT DO NOTHING;
END $$;
CREATE FUNCTION nestwise.review_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_id uuid,p_expected integer,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; old receipt_reviews; current_revision integer;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  PERFORM id FROM financial_accounts WHERE id=p_account FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF NOT EXISTS(SELECT 1 FROM receipt_archived WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT * INTO old FROM receipt_reviews WHERE id=p_id;
  IF FOUND THEN IF old.account_id<>p_account OR old.hash<>p_hash OR old.actor<>actor OR old.data<>p_data OR old.revision<>p_expected+1 THEN RAISE EXCEPTION 'receipt_conflict'; END IF;RETURN p_id;END IF;
  IF EXISTS(SELECT 1 FROM receipt_postings WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'receipt_already_posted'; END IF;
  SELECT coalesce(max(revision),0) INTO current_revision FROM receipt_reviews WHERE account_id=p_account AND hash=p_hash;
  IF p_expected IS NULL OR current_revision<>p_expected OR current_revision>=1000 THEN RAISE EXCEPTION 'receipt_conflict'; END IF;
  IF p_data IS NULL OR jsonb_typeof(p_data)<>'object' OR octet_length(p_data::text)>60000 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
  INSERT INTO receipt_reviews VALUES(p_id,p_account,p_hash,current_revision+1,actor,p_data,clock_timestamp());RETURN p_id;
END $$;
CREATE FUNCTION nestwise.post_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_review uuid,p_operation uuid,p_paid date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; old receipt_postings; review receipt_reviews; item jsonb; data jsonb; total numeric:=0; k text; payload jsonb;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  PERFORM id FROM financial_accounts WHERE id=p_account FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  SELECT * INTO old FROM receipt_postings WHERE account_id=p_account AND hash=p_hash;
  IF FOUND THEN IF old.review_id<>p_review OR old.operation_id<>p_operation OR old.actor<>actor OR (SELECT paid_on FROM manual_operations WHERE id=old.operation_id) IS DISTINCT FROM p_paid THEN RAISE EXCEPTION 'receipt_already_posted'; END IF;RETURN old.operation_id;END IF;
  SELECT * INTO review FROM receipt_reviews WHERE id=p_review AND account_id=p_account AND hash=p_hash;
  IF NOT FOUND OR review.revision<>(SELECT max(revision) FROM receipt_reviews WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'receipt_conflict'; END IF;
  data:=review.data;
  IF data->>'currency' IS DISTINCT FROM 'USD' OR coalesce(length(btrim(data->>'supplier')),0) NOT BETWEEN 1 AND 200
    OR jsonb_typeof(data->'items') IS DISTINCT FROM 'array' OR jsonb_array_length(data->'items') NOT BETWEEN 1 AND 100
    OR data->>'date' IS NULL OR (data->>'date')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$' THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
  IF (data->>'date')::date NOT BETWEEN '1900-01-01'::date AND '2199-12-31'::date THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
  FOR item IN SELECT value FROM jsonb_array_elements(data->'items') LOOP
    IF coalesce(length(btrim(item->>'description')),0) NOT BETWEEN 1 AND 300 OR jsonb_typeof(item->'cents') IS DISTINCT FROM 'string' OR (item->>'cents')!~'^(0|[1-9][0-9]{0,15})$' OR (item->>'cents')::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
    total:=total+(item->>'cents')::numeric;
  END LOOP;
  FOREACH k IN ARRAY ARRAY['tax_cents','tip_cents','shipping_cents','discount_cents','total_cents'] LOOP
    IF data->>k IS NULL OR (data->>k)!~'^(0|[1-9][0-9]{0,15})$' OR (data->>k)::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
  END LOOP;
  total:=total+(data->>'tax_cents')::numeric+(data->>'tip_cents')::numeric+(data->>'shipping_cents')::numeric-(data->>'discount_cents')::numeric;
  IF total<>(data->>'total_cents')::numeric OR total<=0 THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
  -- A receipt cannot appropriate an already recorded manual operation on retry.
  IF EXISTS(SELECT 1 FROM manual_operations WHERE id=p_operation) THEN RAISE EXCEPTION 'receipt_conflict'; END IF;
  payload:=jsonb_build_object('id',p_operation,'kind','expense','paid_on',p_paid,'amount_cents',total::bigint::text,
    'note',data->>'supplier','destination_account',NULL,'reference_operation',NULL,
    'allocations',jsonb_build_array(jsonb_build_object('category','other_expense','cents',total::bigint::text)));
  PERFORM post_manual_operation(p_subject,p_workspace,p_account,payload);
  INSERT INTO receipt_postings VALUES(p_account,p_hash,p_review,p_operation,actor,clock_timestamp());RETURN p_operation;
EXCEPTION WHEN invalid_text_representation OR datetime_field_overflow OR invalid_datetime_format OR numeric_value_out_of_range THEN RAISE EXCEPTION 'invalid_receipt';
END $$;
CREATE FUNCTION nestwise.read_receipts(p_subject text,p_workspace uuid,p_account uuid,p_hash text DEFAULT NULL,p_before text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE boundary timestamptz;
BEGIN
  PERFORM reconciliation_actor(p_subject,p_workspace,p_account,false);
  IF p_before IS NOT NULL THEN
    IF p_hash IS NOT NULL THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
    SELECT created_at INTO boundary FROM receipt_originals WHERE workspace_id=p_workspace AND account_id=p_account AND hash=p_before;
    IF NOT FOUND THEN RAISE EXCEPTION 'invalid_receipt'; END IF;
  END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.hash) FROM (
    SELECT o.hash,o.bytes,o.mime,o.created_at,EXISTS(SELECT 1 FROM receipt_archived a WHERE a.account_id=p_account AND a.hash=o.hash) archived,
      (SELECT jsonb_build_object('id',r.id,'revision',r.revision,'data',r.data,'recorded_at',r.recorded_at) FROM receipt_reviews r WHERE r.account_id=p_account AND r.hash=o.hash ORDER BY revision DESC LIMIT 1) review,
      (SELECT p.operation_id FROM receipt_postings p WHERE p.account_id=p_account AND p.hash=o.hash) operation_id
    FROM receipt_originals o WHERE o.workspace_id=p_workspace AND o.account_id=p_account AND (p_hash IS NULL OR o.hash=p_hash)
      AND (p_before IS NULL OR o.created_at<boundary OR (o.created_at=boundary AND o.hash>p_before))
    ORDER BY o.created_at DESC,o.hash LIMIT 100) q),'[]'::jsonb);
END $$;
REVOKE ALL ON ALL TABLES IN SCHEMA nestwise FROM PUBLIC;
REVOKE ALL ON FUNCTION nestwise.prepare_receipt(text,uuid,uuid,text,integer,text),nestwise.complete_receipt(text,uuid,uuid,text),nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb),nestwise.post_receipt(text,uuid,uuid,text,uuid,uuid,date),nestwise.read_receipts(text,uuid,uuid,text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.prepare_receipt(text,uuid,uuid,text,integer,text),nestwise.complete_receipt(text,uuid,uuid,text),nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb),nestwise.post_receipt(text,uuid,uuid,text,uuid,uuid,date),nestwise.read_receipts(text,uuid,uuid,text,text) TO nestwise_api;

CREATE TABLE nestwise.receipt_ocr_usage(bucket text NOT NULL,day date NOT NULL,calls integer NOT NULL CHECK(calls>0),PRIMARY KEY(bucket,day));
REVOKE ALL ON nestwise.receipt_ocr_usage FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.claim_receipt_ocr(p_subject text,p_workspace uuid,p_account uuid,p_hash text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; used integer;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  IF NOT EXISTS(SELECT 1 FROM receipt_archived WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'forbidden'; END IF;
  INSERT INTO receipt_ocr_usage VALUES('actor:'||actor::text,(clock_timestamp() AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(bucket,day) DO UPDATE SET calls=receipt_ocr_usage.calls+1 WHERE receipt_ocr_usage.calls<20 RETURNING calls INTO used;
  IF used IS NULL THEN RAISE EXCEPTION 'ocr_rate_limited'; END IF;
  used:=NULL;
  INSERT INTO receipt_ocr_usage VALUES('account:'||p_account::text,(clock_timestamp() AT TIME ZONE 'UTC')::date,1)
    ON CONFLICT(bucket,day) DO UPDATE SET calls=receipt_ocr_usage.calls+1 WHERE receipt_ocr_usage.calls<100 RETURNING calls INTO used;
  IF used IS NULL THEN RAISE EXCEPTION 'ocr_rate_limited'; END IF;
END $$;
REVOKE ALL ON FUNCTION nestwise.claim_receipt_ocr(text,uuid,uuid,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.claim_receipt_ocr(text,uuid,uuid,text) TO nestwise_api;
