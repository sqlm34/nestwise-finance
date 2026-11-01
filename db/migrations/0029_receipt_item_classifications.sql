-- Item annotations are durable before payment; only paid business shares enter reports.
CREATE TABLE nestwise.receipt_classifications(
 id uuid PRIMARY KEY,workspace_id uuid NOT NULL,account_id uuid NOT NULL,hash text NOT NULL,
 review_id uuid NOT NULL REFERENCES nestwise.receipt_reviews,revision integer NOT NULL CHECK(revision BETWEEN 1 AND 999),
 categories jsonb NOT NULL,items jsonb NOT NULL,allocations jsonb NOT NULL,business_cents bigint NOT NULL CHECK(business_cents>=0),
 business_workspace uuid,business_account uuid,actor uuid NOT NULL REFERENCES nestwise.users,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 FOREIGN KEY(account_id,hash) REFERENCES nestwise.receipt_archived(account_id,hash),
 FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id),
 FOREIGN KEY(business_workspace,business_account) REFERENCES nestwise.financial_accounts(workspace_id,id),
 CHECK((business_workspace IS NULL)=(business_account IS NULL)),UNIQUE(account_id,hash,revision)
);
CREATE TRIGGER receipt_classification_immutable BEFORE UPDATE OR DELETE ON nestwise.receipt_classifications FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE VIEW nestwise.current_receipt_classifications AS SELECT DISTINCT ON(account_id,hash) * FROM nestwise.receipt_classifications ORDER BY account_id,hash,revision DESC;
REVOKE ALL ON nestwise.receipt_classifications,nestwise.current_receipt_classifications FROM PUBLIC,nestwise_api;

CREATE FUNCTION nestwise.classify_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_data jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid; old receipt_classifications; prior receipt_classifications; r receipt_reviews; bw uuid; ba uuid;
 command uuid; expected integer; cats jsonb; item jsonb; field text; n numeric; subtotal numeric:=0; total numeric; extra numeric; output jsonb; allocations jsonb; business numeric;
BEGIN
 who:=reconciliation_actor(p_subject,p_workspace,p_account,p_data IS NOT NULL);
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=p_workspace AND kind='personal') THEN RAISE EXCEPTION 'forbidden';END IF;
 IF NOT EXISTS(SELECT 1 FROM receipt_archived WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'forbidden';END IF;
 SELECT * INTO old FROM current_receipt_classifications WHERE account_id=p_account AND hash=p_hash;
 IF p_data IS NULL THEN RETURN jsonb_build_object('classification',CASE WHEN old.id IS NOT NULL THEN to_jsonb(old) ELSE NULL END,
  'payment',(SELECT to_jsonb(e) FROM personal_receipt_expenses e WHERE e.account_id=p_account AND e.hash=p_hash));END IF;
 IF jsonb_typeof(p_data) IS DISTINCT FROM 'object' OR (SELECT count(*) FROM jsonb_object_keys(p_data))<>6
  OR NOT p_data ?& ARRAY['id','expected','review','categories','business_workspace','business_account']
  OR jsonb_typeof(p_data->'categories') IS DISTINCT FROM 'array' THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 command:=(p_data->>'id')::uuid;expected:=(p_data->>'expected')::integer;bw:=(p_data->>'business_workspace')::uuid;ba:=(p_data->>'business_account')::uuid;cats:=p_data->'categories';
 IF command IS NULL OR expected IS NULL OR expected NOT BETWEEN 0 AND 998 OR (bw IS NULL)<>(ba IS NULL) THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 IF ba IS NOT NULL THEN PERFORM business_report_actor(p_subject,bw,ba,true);END IF;
 PERFORM id FROM financial_accounts WHERE id IN(p_account,ba,old.business_account) ORDER BY id FOR UPDATE;
 who:=reconciliation_actor(p_subject,p_workspace,p_account,true);
 IF ba IS NOT NULL THEN PERFORM business_report_actor(p_subject,bw,ba,true);END IF;
 SELECT * INTO prior FROM receipt_classifications WHERE id=command;
 IF FOUND THEN
  IF prior.actor<>who OR prior.account_id<>p_account OR prior.hash<>p_hash OR prior.review_id<>(p_data->>'review')::uuid OR prior.revision<>expected+1
   OR prior.categories<>cats OR prior.business_workspace IS DISTINCT FROM bw OR prior.business_account IS DISTINCT FROM ba THEN RAISE EXCEPTION 'receipt_classification_conflict';END IF;
  RETURN to_jsonb(prior);
 END IF;
 SELECT * INTO old FROM current_receipt_classifications WHERE account_id=p_account AND hash=p_hash;
 IF coalesce(old.revision,0)<>expected THEN RAISE EXCEPTION 'receipt_classification_conflict';END IF;
 SELECT * INTO r FROM receipt_reviews WHERE account_id=p_account AND hash=p_hash ORDER BY revision DESC LIMIT 1;
 IF NOT FOUND OR r.id IS DISTINCT FROM (p_data->>'review')::uuid OR jsonb_array_length(cats)<>jsonb_array_length(r.data->'items')
  OR jsonb_array_length(cats) NOT BETWEEN 1 AND 100 OR r.data->>'currency' IS DISTINCT FROM 'USD'
  OR coalesce(length(btrim(r.data->>'supplier')),0)=0 OR coalesce(r.data->>'date','')!~'^\d{4}-\d{2}-\d{2}$' THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 FOR item IN SELECT value FROM jsonb_array_elements(cats) LOOP
  IF item<>'null'::jsonb AND (jsonb_typeof(item)<>'string' OR (item#>>'{}' NOT IN ('groceries','dining','household','transport','health','clothing','children','pets','entertainment','subscriptions','utilities','other')
   AND item#>>'{}'!~'^tax_(0[1-9]|[123][0-9]|4[0-3])$')) THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 END LOOP;
 FOR item IN SELECT value FROM jsonb_array_elements(r.data->'items') LOOP
  IF coalesce(item->>'cents','')!~'^(0|[1-9][0-9]{0,15})$' OR coalesce(length(btrim(item->>'description')),0)=0 THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
  n:=(item->>'cents')::numeric;IF n>9007199254740991 THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;subtotal:=subtotal+n;
 END LOOP;
 FOREACH field IN ARRAY ARRAY['tax_cents','tip_cents','shipping_cents','discount_cents','total_cents'] LOOP
  IF coalesce(r.data->>field,'')!~'^(0|[1-9][0-9]{0,15})$' OR (r.data->>field)::numeric>9007199254740991 THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 END LOOP;
 total:=(r.data->>'total_cents')::numeric;extra:=(r.data->>'tax_cents')::numeric+(r.data->>'tip_cents')::numeric+(r.data->>'shipping_cents')::numeric-(r.data->>'discount_cents')::numeric;
 IF subtotal<=0 OR total<=0 OR subtotal+extra<>total THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 WITH parts AS (
  SELECT value,ordinality-1 idx,div(total*(value->>'cents')::numeric,subtotal) base,mod(total*(value->>'cents')::numeric,subtotal) remainder FROM jsonb_array_elements(r.data->'items') WITH ORDINALITY
 ), ranked AS (SELECT *,row_number() OVER(ORDER BY remainder DESC,idx) rank,total-sum(base) OVER() remaining FROM parts)
 SELECT jsonb_agg(jsonb_build_object('index',idx,'description',value->>'description','cents',value->>'cents','gross_cents',(base+CASE WHEN rank<=remaining THEN 1 ELSE 0 END)::bigint::text,'category',cats->idx::integer) ORDER BY idx) INTO output FROM ranked;
 SELECT coalesce(sum((value->>'gross_cents')::bigint),0) INTO business FROM jsonb_array_elements(output) WHERE value->>'category' LIKE 'tax_%';
 IF EXISTS(SELECT 1 FROM jsonb_array_elements(cats) c WHERE c#>>'{}' LIKE 'tax_%') AND ba IS NULL THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 IF ba IS NOT NULL AND (SELECT currency FROM financial_accounts WHERE id=ba) IS DISTINCT FROM 'USD' THEN RAISE EXCEPTION 'invalid_receipt_classification';END IF;
 -- Existing manual sharing must be resolved before adopting item-level attribution.
 IF business>0 AND EXISTS(SELECT 1 FROM personal_receipt_expenses e JOIN journal_transactions t ON t.manual_id=e.operation_id JOIN active_owner_expenses l ON l.source_transaction=t.id WHERE e.account_id=p_account AND e.hash=p_hash)
 THEN RAISE EXCEPTION 'receipt_business_already_linked';END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('category',category,'cents',amount::text) ORDER BY category),'[]'::jsonb) INTO allocations FROM (
  SELECT value->>'category' category,sum((value->>'gross_cents')::bigint)::bigint amount FROM jsonb_array_elements(output) WHERE value->>'category' LIKE 'tax_%' GROUP BY value->>'category' HAVING sum((value->>'gross_cents')::bigint)>0
 ) q;
 INSERT INTO receipt_classifications VALUES(command,p_workspace,p_account,p_hash,r.id,expected+1,cats,output,allocations,business::bigint,bw,ba,who,clock_timestamp()) RETURNING * INTO prior;
 RETURN to_jsonb(prior);
END $$;
REVOKE ALL ON FUNCTION nestwise.classify_receipt(text,uuid,uuid,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.classify_receipt(text,uuid,uuid,text,jsonb) TO nestwise_api;

-- Do not permit a second manual owner link for an already classified receipt.
ALTER FUNCTION nestwise.link_owner_expense(text,uuid,uuid,jsonb) RENAME TO link_owner_expense_before_items;
REVOKE ALL ON FUNCTION nestwise.link_owner_expense_before_items(text,uuid,uuid,jsonb) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.link_owner_expense(p_subject text,p_workspace uuid,p_account uuid,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE source_account uuid;
BEGIN
 PERFORM business_report_actor(p_subject,p_workspace,p_account,true);
 SELECT account_id INTO source_account FROM journal_transactions WHERE id=(p_data->>'transaction')::uuid;
 PERFORM id FROM financial_accounts WHERE id IN(p_account,source_account) ORDER BY id FOR UPDATE;
 IF EXISTS(SELECT 1 FROM journal_transactions t JOIN personal_receipt_expenses e ON e.operation_id=t.manual_id JOIN current_receipt_classifications c ON c.account_id=e.account_id AND c.hash=e.hash
  WHERE t.id=(p_data->>'transaction')::uuid AND c.business_cents>0) THEN RAISE EXCEPTION 'receipt_business_already_linked';END IF;
 RETURN link_owner_expense_before_items(p_subject,p_workspace,p_account,p_data);
END $$;
REVOKE ALL ON FUNCTION nestwise.link_owner_expense(text,uuid,uuid,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.link_owner_expense(text,uuid,uuid,jsonb) TO nestwise_api;

-- Preserve all earlier snapshots. New paid receipt evidence is a distinct report
-- source, never a fabricated cash journal posting or a second bank withdrawal.
ALTER FUNCTION nestwise.report_input(text,uuid,uuid,date,date) RENAME TO report_input_before_receipt_items;
REVOKE ALL ON FUNCTION nestwise.report_input_before_receipt_items(text,uuid,uuid,date,date) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.report_input(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result jsonb; receipts jsonb; pending bigint;
BEGIN
 result:=report_input_before_receipt_items(p_subject,p_workspace,p_account,p_from,p_to)->'data';
 WITH candidates AS MATERIALIZED (
  SELECT c.*,r.data,e.paid_on,e.bank_id,e.operation_id,
   e.review_id=c.review_id AND c.review_id=(SELECT id FROM receipt_reviews WHERE account_id=c.account_id AND hash=c.hash ORDER BY revision DESC LIMIT 1)
   AND CASE WHEN e.bank_id IS NOT NULL THEN EXISTS(SELECT 1 FROM bank_feed_rows br JOIN bank_feeds bf ON bf.id=br.feed_id WHERE bf.account_id=c.account_id AND br.id=e.bank_id AND NOT br.pending AND br.cents=-(r.data->>'total_cents')::bigint)
    ELSE e.operation_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM manual_operations mo WHERE mo.reference_operation=e.operation_id) END
   AND NOT EXISTS(SELECT 1 FROM journal_transactions t JOIN active_owner_expenses l ON l.source_transaction=t.id WHERE t.manual_id=e.operation_id) valid
  FROM current_receipt_classifications c JOIN receipt_reviews r ON r.id=c.review_id
  LEFT JOIN personal_receipt_expenses e ON e.account_id=c.account_id AND e.hash=c.hash
  WHERE c.business_workspace=p_workspace AND c.business_account=p_account AND c.business_cents>0
   AND coalesce(e.paid_on,(r.data->>'date')::date) BETWEEN p_from AND p_to
 ) SELECT coalesce(jsonb_agg(jsonb_build_object('id',id,'source_workspace',workspace_id,'source_account',account_id,'hash',hash,'review_id',review_id,
   'paid_on',paid_on,'supplier',data->>'supplier','total_cents',business_cents::text,'allocations',allocations,
   'items',(SELECT jsonb_agg(value ORDER BY (value->>'index')::integer) FROM jsonb_array_elements(items) WHERE value->>'category' LIKE 'tax_%')) ORDER BY paid_on,id) FILTER(WHERE valid),'[]'::jsonb),
   count(*) FILTER(WHERE valid IS DISTINCT FROM true) INTO receipts,pending FROM candidates;
 IF jsonb_array_length(receipts)>0 OR pending>0 THEN
  result:=result||jsonb_build_object('version','statement-handoff-v3','receipt_expenses',receipts,'receipt_pending',pending::text);
 END IF;
 IF octet_length(result::text)>2097152 OR jsonb_array_length(receipts)>1000 THEN RAISE EXCEPTION 'report_too_large';END IF;
 RETURN jsonb_build_object('data',result,'hash',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION nestwise.report_input(text,uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.report_input(text,uuid,uuid,date,date) TO nestwise_api;

-- Personal expense screens keep the historical payment but read latest labels.
ALTER FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) RENAME TO personal_document_before_items;
REVOKE ALL ON FUNCTION nestwise.personal_document_before_items(text,uuid,uuid,text,text,jsonb) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.personal_document(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_action text,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result jsonb;
BEGIN
 result:=personal_document_before_items(p_subject,p_workspace,p_account,p_hash,p_action,p_data);
 IF p_action='expenses' THEN
  SELECT coalesce(jsonb_agg(value||jsonb_build_object('classification',(SELECT to_jsonb(c) FROM current_receipt_classifications c WHERE c.account_id=p_account AND c.hash=value->>'hash' AND c.review_id=(value->>'review_id')::uuid)) ORDER BY ordinal),'[]'::jsonb)
  INTO result FROM jsonb_array_elements(result) WITH ORDINALITY q(value,ordinal);
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) TO nestwise_api;
