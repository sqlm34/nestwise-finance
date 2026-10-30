-- Personal evidence never modifies the CRM or business reports.
CREATE TABLE nestwise.personal_statements(
 workspace_id uuid NOT NULL,account_id uuid NOT NULL,hash text NOT NULL CHECK(hash~'^[a-f0-9]{64}$'),
 bytes integer NOT NULL CHECK(bytes BETWEEN 12 AND 5000000),archived boolean NOT NULL DEFAULT false,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),actor uuid NOT NULL REFERENCES nestwise.users,
 data jsonb,revision integer NOT NULL DEFAULT 0,command uuid,ocr_at timestamptz,ocr_day date,ocr_count integer NOT NULL DEFAULT 0,
 PRIMARY KEY(account_id,hash),FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TABLE nestwise.personal_statement_reviews(
 id uuid PRIMARY KEY,account_id uuid NOT NULL,hash text NOT NULL,revision integer NOT NULL,data jsonb NOT NULL,
 actor uuid NOT NULL REFERENCES nestwise.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,hash) REFERENCES nestwise.personal_statements(account_id,hash),UNIQUE(account_id,hash,revision)
);
CREATE TRIGGER personal_statement_review_immutable BEFORE UPDATE OR DELETE ON nestwise.personal_statement_reviews FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TABLE nestwise.personal_receipt_expenses(
 account_id uuid NOT NULL,hash text NOT NULL,review_id uuid NOT NULL REFERENCES nestwise.receipt_reviews,
 command uuid NOT NULL UNIQUE,actor uuid NOT NULL REFERENCES nestwise.users,paid_on date NOT NULL,
 bank_id text,bank_snapshot jsonb,operation_id uuid REFERENCES nestwise.manual_operations,
 item_categories jsonb NOT NULL,extra_category text NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,hash),UNIQUE(account_id,bank_id),FOREIGN KEY(account_id,hash) REFERENCES nestwise.receipt_archived(account_id,hash),
 CHECK((bank_id IS NULL)<>(operation_id IS NULL))
);
CREATE TRIGGER personal_receipt_expense_immutable BEFORE UPDATE OR DELETE ON nestwise.personal_receipt_expenses FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
REVOKE ALL ON nestwise.personal_statements,nestwise.personal_statement_reviews,nestwise.personal_receipt_expenses FROM PUBLIC,nestwise_api;

CREATE FUNCTION nestwise.personal_document(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_action text,p_data jsonb DEFAULT '{}'::jsonb)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; f personal_statements; r receipt_reviews; old personal_receipt_expenses; b bank_feed_rows;
 c text; v jsonb; op uuid; total bigint; result jsonb;
BEGIN
 actor:=reconciliation_actor(p_subject,p_workspace,p_account,p_action NOT IN ('list','get','expenses','expense'));
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=p_workspace AND kind='personal') THEN RAISE EXCEPTION 'forbidden';END IF;
 IF p_action='expenses' THEN
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.paid_on DESC,q.created_at DESC) FROM (
   SELECT e.*,reviewed.data FROM personal_receipt_expenses e JOIN receipt_reviews reviewed ON reviewed.id=e.review_id WHERE e.account_id=p_account ORDER BY e.paid_on DESC,e.created_at DESC LIMIT 500) q),'[]'::jsonb);
 END IF;
 IF p_action='expense' THEN RETURN (SELECT to_jsonb(e) FROM personal_receipt_expenses e WHERE e.account_id=p_account AND e.hash=p_hash);END IF;
 IF p_action='list' THEN RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC) FROM (
   SELECT hash,bytes,archived,created_at,revision,data FROM personal_statements WHERE account_id=p_account ORDER BY created_at DESC LIMIT 100) q),'[]'::jsonb);END IF;
 IF p_hash IS NULL OR p_hash!~'^[a-f0-9]{64}$' THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
 IF p_action='get' THEN RETURN (SELECT to_jsonb(s)-'actor'-'ocr_count'-'ocr_day' FROM personal_statements s WHERE s.account_id=p_account AND s.hash=p_hash);END IF;
 PERFORM id FROM financial_accounts WHERE id=p_account FOR UPDATE;
 actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
 IF p_action='expense_save' THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>6 OR p_data->>'extra' NOT IN ('groceries','dining','household','transport','health','clothing','children','pets','entertainment','subscriptions','utilities','other')
    OR jsonb_typeof(p_data->'categories') IS DISTINCT FROM 'array' OR p_data->>'paid_on' IS NULL THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
  SELECT * INTO old FROM personal_receipt_expenses WHERE account_id=p_account AND hash=p_hash;
  IF FOUND THEN
   IF old.command=(p_data->>'id')::uuid AND old.review_id=(p_data->>'review')::uuid AND old.actor=actor AND old.paid_on=(p_data->>'paid_on')::date
    AND old.bank_id IS NOT DISTINCT FROM p_data->>'bank_id' AND old.item_categories=p_data->'categories' AND old.extra_category=p_data->>'extra' THEN RETURN to_jsonb(old);END IF;
   RAISE EXCEPTION 'receipt_conflict';
  END IF;
  SELECT * INTO r FROM receipt_reviews WHERE id=(p_data->>'review')::uuid AND account_id=p_account AND hash=p_hash;
  IF NOT FOUND OR r.revision<>(SELECT max(revision) FROM receipt_reviews WHERE account_id=p_account AND hash=p_hash)
    OR EXISTS(SELECT 1 FROM receipt_postings WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'receipt_conflict';END IF;
  IF jsonb_array_length(p_data->'categories')<>jsonb_array_length(r.data->'items') OR jsonb_array_length(r.data->'items')=0 THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
  FOR c IN SELECT jsonb_array_elements_text(p_data->'categories') LOOP
   IF c IS NULL OR c NOT IN ('groceries','dining','household','transport','health','clothing','children','pets','entertainment','subscriptions','utilities','other') THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
  END LOOP;
  total:=0;
  IF r.data->>'currency' IS DISTINCT FROM 'USD' OR coalesce(length(btrim(r.data->>'supplier')),0)=0 THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
  FOR v IN SELECT value FROM jsonb_array_elements(r.data->'items') LOOP
   IF coalesce(v->>'cents','')!~'^(0|[1-9][0-9]{0,15})$' OR coalesce(length(btrim(v->>'description')),0)=0 THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
   total:=total+(v->>'cents')::bigint;
  END LOOP;
  FOREACH c IN ARRAY ARRAY['tax_cents','tip_cents','shipping_cents','discount_cents','total_cents'] LOOP
   IF coalesce(r.data->>c,'')!~'^(0|[1-9][0-9]{0,15})$' THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
  END LOOP;
  total:=total+(r.data->>'tax_cents')::bigint+(r.data->>'tip_cents')::bigint+(r.data->>'shipping_cents')::bigint-(r.data->>'discount_cents')::bigint;
  IF total<=0 OR total<>(r.data->>'total_cents')::bigint OR (p_data->>'paid_on')::date NOT BETWEEN '1900-01-01' AND '2199-12-31' THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
  IF p_data->>'bank_id' IS NOT NULL THEN
   IF EXISTS(SELECT 1 FROM personal_receipt_expenses WHERE account_id=p_account AND bank_id=p_data->>'bank_id') THEN RAISE EXCEPTION 'bank_match_conflict';END IF;
   SELECT br.* INTO b FROM bank_feed_rows br JOIN bank_feeds bf ON bf.id=br.feed_id WHERE bf.account_id=p_account AND bf.workspace_id=p_workspace AND br.id=p_data->>'bank_id' FOR SHARE OF br;
   IF NOT FOUND OR b.pending OR b.cents<>-total OR abs(b.paid_on-(p_data->>'paid_on')::date)>7 THEN RAISE EXCEPTION 'bank_match_conflict';END IF;
  ELSE
   op:=nestwise.post_receipt(p_subject,p_workspace,p_account,p_hash,r.id,(p_data->>'id')::uuid,(p_data->>'paid_on')::date);
  END IF;
  INSERT INTO personal_receipt_expenses(account_id,hash,review_id,command,actor,paid_on,bank_id,bank_snapshot,operation_id,item_categories,extra_category)
   VALUES(p_account,p_hash,r.id,(p_data->>'id')::uuid,actor,(p_data->>'paid_on')::date,p_data->>'bank_id',CASE WHEN op IS NULL THEN to_jsonb(b) ELSE NULL END,op,p_data->'categories',p_data->>'extra') RETURNING to_jsonb(personal_receipt_expenses.*) INTO result;
  RETURN result;
 END IF;
 SELECT * INTO f FROM personal_statements WHERE account_id=p_account AND hash=p_hash FOR UPDATE;
 IF p_action='prepare' THEN
  IF FOUND THEN IF f.bytes<>(p_data->>'bytes')::integer THEN RAISE EXCEPTION 'receipt_conflict';END IF;RETURN to_jsonb(f);END IF;
  IF (SELECT count(*) FROM personal_statements WHERE account_id=p_account)>=100 THEN RAISE EXCEPTION 'receipt_limit';END IF;
  INSERT INTO personal_statements(workspace_id,account_id,hash,bytes,actor) VALUES(p_workspace,p_account,p_hash,(p_data->>'bytes')::integer,actor);RETURN '{}'::jsonb;
 END IF;
 IF NOT FOUND THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
 IF p_action='complete' THEN UPDATE personal_statements SET archived=true WHERE account_id=p_account AND hash=p_hash;RETURN '{}'::jsonb;END IF;
 IF NOT f.archived THEN RAISE EXCEPTION 'invalid_personal_document';END IF;
 IF p_action='claim_ocr' THEN
  IF f.ocr_at>now()-interval '1 minute' OR (f.ocr_day=current_date AND f.ocr_count>=3)
   OR (SELECT coalesce(sum(ocr_count),0) FROM personal_statements WHERE account_id=p_account AND ocr_day=current_date)>=10 THEN RAISE EXCEPTION 'ocr_rate_limited';END IF;
  UPDATE personal_statements SET ocr_at=clock_timestamp(),ocr_count=CASE WHEN ocr_day=current_date THEN ocr_count+1 ELSE 1 END,ocr_day=current_date WHERE account_id=p_account AND hash=p_hash;RETURN '{}'::jsonb;
 END IF;
 IF p_action='review' THEN
  IF f.command=(p_data->>'id')::uuid AND f.data=p_data->'data' THEN RETURN to_jsonb(f);END IF;
  IF f.revision<>(p_data->>'expected')::integer OR jsonb_typeof(p_data->'data') IS DISTINCT FROM 'object' OR octet_length(p_data::text)>250000 THEN RAISE EXCEPTION 'receipt_conflict';END IF;
  INSERT INTO personal_statement_reviews(id,account_id,hash,revision,data,actor) VALUES((p_data->>'id')::uuid,p_account,p_hash,f.revision+1,p_data->'data',actor);
  UPDATE personal_statements SET data=p_data->'data',revision=revision+1,command=(p_data->>'id')::uuid WHERE account_id=p_account AND hash=p_hash RETURNING to_jsonb(personal_statements.*) INTO result;RETURN result;
 END IF;
 RAISE EXCEPTION 'invalid_personal_document';
END $$;
REVOKE ALL ON FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) TO nestwise_api;

-- A matched receipt's reviewed evidence is immutable, just like a cash posting.
ALTER FUNCTION nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb) RENAME TO review_receipt_before_personal;
REVOKE ALL ON FUNCTION nestwise.review_receipt_before_personal(text,uuid,uuid,text,uuid,integer,jsonb) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.review_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_id uuid,p_expected integer,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
 PERFORM reconciliation_actor(p_subject,p_workspace,p_account,true);
 PERFORM id FROM financial_accounts WHERE id=p_account FOR UPDATE;
 IF EXISTS(SELECT 1 FROM personal_receipt_expenses WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'receipt_already_posted';END IF;
 RETURN review_receipt_before_personal(p_subject,p_workspace,p_account,p_hash,p_id,p_expected,p_data);
END $$;
REVOKE ALL ON FUNCTION nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb) TO nestwise_api;

ALTER FUNCTION nestwise.post_receipt(text,uuid,uuid,text,uuid,uuid,date) RENAME TO post_receipt_before_personal;
REVOKE ALL ON FUNCTION nestwise.post_receipt_before_personal(text,uuid,uuid,text,uuid,uuid,date) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.post_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_review uuid,p_operation uuid,p_paid date) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
BEGIN
 PERFORM reconciliation_actor(p_subject,p_workspace,p_account,true);
 PERFORM id FROM financial_accounts WHERE id=p_account FOR UPDATE;
 IF EXISTS(SELECT 1 FROM personal_receipt_expenses WHERE account_id=p_account AND hash=p_hash AND bank_id IS NOT NULL) THEN RAISE EXCEPTION 'receipt_already_posted';END IF;
 RETURN post_receipt_before_personal(p_subject,p_workspace,p_account,p_hash,p_review,p_operation,p_paid);
END $$;
REVOKE ALL ON FUNCTION nestwise.post_receipt(text,uuid,uuid,text,uuid,uuid,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.post_receipt(text,uuid,uuid,text,uuid,uuid,date) TO nestwise_api;
