-- Receipt storage and payment account are independent. Never duplicate a withdrawal.
ALTER TABLE nestwise.personal_receipt_expenses ADD COLUMN bank_account uuid REFERENCES nestwise.financial_accounts;
CREATE UNIQUE INDEX receipt_bank_payment_unique ON nestwise.personal_receipt_expenses(coalesce(bank_account,account_id),bank_id) WHERE bank_id IS NOT NULL;
CREATE TABLE nestwise.receipt_cards(
 workspace_id uuid NOT NULL REFERENCES nestwise.workspaces, mask text NOT NULL CHECK(mask~'^[0-9]{4}$'),
 account_id uuid NOT NULL,actor uuid NOT NULL REFERENCES nestwise.users,
 PRIMARY KEY(workspace_id,mask),FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
CREATE TABLE nestwise.receipt_bank_intents(
 account_id uuid NOT NULL,hash text NOT NULL,workspace_id uuid NOT NULL,review_id uuid NOT NULL REFERENCES nestwise.receipt_reviews,
 bank_account uuid NOT NULL,card_mask text CHECK(card_mask~'^[0-9]{4}$'),actor uuid NOT NULL REFERENCES nestwise.users,
 created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 PRIMARY KEY(account_id,hash),FOREIGN KEY(account_id,hash) REFERENCES nestwise.receipt_archived(account_id,hash),
 FOREIGN KEY(workspace_id,bank_account) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
REVOKE ALL ON nestwise.receipt_cards,nestwise.receipt_bank_intents FROM PUBLIC,nestwise_api;

CREATE FUNCTION nestwise.receipt_merchant_match(a text,b text) RETURNS boolean LANGUAGE sql IMMUTABLE AS $$
 SELECT length(x)>=5 AND length(y)>=5 AND (x=y OR position(x in y)>0 OR position(y in x)>0)
 FROM (SELECT regexp_replace(lower(a),'[^a-z0-9]','','g') x,regexp_replace(lower(b),'[^a-z0-9]','','g') y) q
$$;

-- Read-only live verification: changed bank data or a conflicting reviewed PDF is visible.
CREATE FUNCTION nestwise.receipt_bank_state(p_account uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE i receipt_bank_intents;e personal_receipt_expenses;r receipt_reviews;f bank_feeds;b bank_feed_rows;
 n integer; exacts integer; covered integer; pdf_matches integer; status text; pdf_status text; total bigint;
BEGIN
 SELECT * INTO i FROM receipt_bank_intents WHERE account_id=p_account AND hash=p_hash;
 IF NOT FOUND THEN RETURN NULL;END IF;
 SELECT * INTO r FROM receipt_reviews WHERE id=i.review_id;
 SELECT * INTO f FROM bank_feeds WHERE account_id=i.bank_account AND workspace_id=i.workspace_id;
 SELECT * INTO e FROM personal_receipt_expenses WHERE account_id=p_account AND hash=p_hash;
 total:=(r.data->>'total_cents')::bigint;
 IF r.id IS DISTINCT FROM (SELECT id FROM receipt_reviews WHERE account_id=p_account AND hash=p_hash ORDER BY revision DESC LIMIT 1) THEN status:='review_changed';
 ELSIF e.bank_id IS NOT NULL THEN
  SELECT * INTO b FROM bank_feed_rows WHERE feed_id=f.id AND id=e.bank_id;
  status:=CASE WHEN b.id IS NOT NULL AND NOT b.pending AND b.cents=-total AND b.paid_on=e.paid_on
   AND b.name=e.bank_snapshot->>'name' AND coalesce(e.bank_account,e.account_id)=i.bank_account THEN 'matched' ELSE 'bank_changed' END;
 ELSIF e.operation_id IS NOT NULL THEN status:='already_paid';
 ELSE
  SELECT count(*),count(*) FILTER(WHERE NOT pending AND receipt_merchant_match(r.data->>'supplier',name)) INTO n,exacts
   FROM bank_feed_rows WHERE feed_id=f.id AND cents=-total AND abs(paid_on-(r.data->>'date')::date)<=7;
  status:=CASE WHEN n=0 THEN 'waiting' WHEN n=1 AND exacts=1 THEN 'ready' ELSE 'needs_review' END;
  IF status='ready' AND EXISTS(SELECT 1 FROM personal_receipt_expenses e2 JOIN bank_feed_rows br ON br.id=e2.bank_id AND br.feed_id=f.id
   WHERE coalesce(e2.bank_account,e2.account_id)=i.bank_account AND br.cents=-total AND abs(br.paid_on-(r.data->>'date')::date)<=7)
  THEN status:='already_linked';END IF;
 END IF;
 SELECT count(*),coalesce(sum((SELECT count(*) FROM jsonb_array_elements(s.data->'rows') row
   WHERE (row->>'cents')::bigint=-total AND abs((row->>'date')::date-coalesce(e.paid_on,(r.data->>'date')::date))<=7
    AND receipt_merchant_match(r.data->>'supplier',row->>'description'))),0)
 INTO covered,pdf_matches FROM personal_statements s WHERE s.account_id=i.bank_account AND s.revision>0
  AND s.data->>'mask'=f.mask AND s.data->>'complete'='true'
  AND coalesce(e.paid_on,(r.data->>'date')::date) BETWEEN (s.data->>'from')::date AND (s.data->>'to')::date;
 pdf_status:=CASE WHEN covered=0 THEN 'not_loaded' WHEN pdf_matches=covered THEN 'matched' ELSE 'needs_review' END;
 IF pdf_status='needs_review' AND status IN('matched','ready') THEN status:='statement_mismatch';END IF;
 RETURN jsonb_build_object('status',status,'pdf_status',pdf_status,'bank_account',i.bank_account,'bank_name',f.institution,
  'bank_mask',f.mask,'card_mask',i.card_mask,'paid_on',e.paid_on,'bank_id',e.bank_id,'bank_name_on_payment',e.bank_snapshot->>'name',
  'total_cents',total::text,'review',i.review_id);
END $$;

CREATE FUNCTION nestwise.reconcile_receipt_bank(p_subject text,p_workspace uuid,p_account uuid,p_hash text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE i receipt_bank_intents;r receipt_reviews;b bank_feed_rows;who uuid;state jsonb;sum_items numeric;fields numeric;
BEGIN
 who:=reconciliation_actor(p_subject,p_workspace,p_account,true);
 SELECT * INTO i FROM receipt_bank_intents WHERE account_id=p_account AND hash=p_hash;
 IF NOT FOUND THEN RETURN NULL;END IF;
 PERFORM reconciliation_actor(p_subject,p_workspace,i.bank_account,true);
 PERFORM id FROM financial_accounts WHERE id IN(p_account,i.bank_account) ORDER BY id FOR UPDATE;
 SELECT * INTO i FROM receipt_bank_intents WHERE account_id=p_account AND hash=p_hash;
 state:=receipt_bank_state(p_account,p_hash);
 IF state->>'status'<>'ready' THEN RETURN state;END IF;
 SELECT * INTO r FROM receipt_reviews WHERE id=i.review_id;
 -- Complete line amounts and charges must reconcile to the printed total.
 IF jsonb_array_length(r.data->'items') NOT BETWEEN 1 AND 100 OR r.data->>'currency'<>'USD'
  OR EXISTS(SELECT 1 FROM jsonb_array_elements(r.data->'items') x WHERE coalesce(x->>'cents','')!~'^(0|[1-9][0-9]{0,15})$' OR coalesce(length(btrim(x->>'description')),0)=0)
  OR EXISTS(SELECT 1 FROM unnest(ARRAY['tax_cents','tip_cents','shipping_cents','discount_cents','total_cents']) k WHERE coalesce(r.data->>k,'')!~'^(0|[1-9][0-9]{0,15})$')
 THEN RAISE EXCEPTION 'invalid_receipt';END IF;
 SELECT sum((x->>'cents')::numeric) INTO sum_items FROM jsonb_array_elements(r.data->'items') x;
 fields:=(r.data->>'tax_cents')::numeric+(r.data->>'tip_cents')::numeric+(r.data->>'shipping_cents')::numeric-(r.data->>'discount_cents')::numeric;
 IF sum_items+fields<>(r.data->>'total_cents')::numeric OR (r.data->>'total_cents')::numeric<=0 THEN RAISE EXCEPTION 'invalid_receipt';END IF;
 SELECT br.* INTO b FROM bank_feed_rows br JOIN bank_feeds f ON f.id=br.feed_id WHERE f.account_id=i.bank_account
  AND br.cents=-(r.data->>'total_cents')::bigint AND abs(br.paid_on-(r.data->>'date')::date)<=7
  AND NOT br.pending AND receipt_merchant_match(r.data->>'supplier',br.name) FOR SHARE OF br;
 IF NOT FOUND THEN RETURN receipt_bank_state(p_account,p_hash);END IF;
 IF EXISTS(SELECT 1 FROM personal_receipt_expenses WHERE coalesce(bank_account,account_id)=i.bank_account AND bank_id=b.id)
  OR EXISTS(SELECT 1 FROM personal_receipt_expenses WHERE hash=p_hash)
  OR EXISTS(SELECT 1 FROM receipt_postings WHERE hash=p_hash) THEN RETURN state||jsonb_build_object('status','already_linked');END IF;
 INSERT INTO personal_receipt_expenses(account_id,hash,review_id,command,actor,paid_on,bank_id,bank_snapshot,operation_id,item_categories,extra_category,bank_account)
 VALUES(p_account,p_hash,r.id,gen_random_uuid(),who,b.paid_on,b.id,to_jsonb(b),NULL,
  (SELECT jsonb_agg('other'::text) FROM jsonb_array_elements(r.data->'items')),'other',i.bank_account);
 RETURN receipt_bank_state(p_account,p_hash);
END $$;

CREATE FUNCTION nestwise.receipt_payment(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_data jsonb DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid;target uuid;v_mask text;r receipt_reviews;old receipt_bank_intents;cards jsonb;targets jsonb;state jsonb;
BEGIN
 who:=reconciliation_actor(p_subject,p_workspace,p_account,p_data IS NOT NULL);
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=p_workspace AND kind='personal') OR NOT EXISTS(SELECT 1 FROM receipt_archived WHERE account_id=p_account AND hash=p_hash) THEN RAISE EXCEPTION 'forbidden';END IF;
 IF p_data IS NOT NULL THEN
  IF (SELECT count(*) FROM jsonb_object_keys(p_data))<>3 OR NOT p_data ?& ARRAY['bank_account','card_mask','review'] THEN RAISE EXCEPTION 'invalid_receipt';END IF;
  target:=(p_data->>'bank_account')::uuid;v_mask:=p_data->>'card_mask';
  IF target IS NULL OR v_mask IS NOT NULL AND v_mask!~'^[0-9]{4}$' THEN RAISE EXCEPTION 'invalid_receipt';END IF;
  PERFORM reconciliation_actor(p_subject,p_workspace,target,true);
  IF NOT EXISTS(SELECT 1 FROM bank_feeds WHERE workspace_id=p_workspace AND account_id=target) THEN RAISE EXCEPTION 'forbidden';END IF;
  PERFORM id FROM financial_accounts WHERE id IN(p_account,target) ORDER BY id FOR UPDATE;
  SELECT * INTO r FROM receipt_reviews WHERE account_id=p_account AND hash=p_hash ORDER BY revision DESC LIMIT 1;
  IF r.id IS DISTINCT FROM (p_data->>'review')::uuid THEN RAISE EXCEPTION 'receipt_conflict';END IF;
  IF coalesce(r.data->>'date','')!~'^[0-9]{4}-[0-9]{2}-[0-9]{2}$'
   OR coalesce(r.data->>'total_cents','')!~'^[1-9][0-9]{0,15}$' THEN RAISE EXCEPTION 'invalid_receipt';END IF;
  SELECT * INTO old FROM receipt_bank_intents WHERE account_id=p_account AND hash=p_hash;
  IF EXISTS(SELECT 1 FROM personal_receipt_expenses WHERE account_id=p_account AND hash=p_hash)
   AND (old.bank_account IS DISTINCT FROM target OR old.review_id IS DISTINCT FROM r.id OR old.card_mask IS DISTINCT FROM v_mask) THEN RAISE EXCEPTION 'receipt_already_posted';END IF;
  IF v_mask IS NOT NULL THEN
   INSERT INTO receipt_cards VALUES(p_workspace,v_mask,target,who) ON CONFLICT DO NOTHING;
   IF NOT EXISTS(SELECT 1 FROM receipt_cards WHERE workspace_id=p_workspace AND receipt_cards.mask=v_mask AND account_id=target) THEN RAISE EXCEPTION 'bank_match_conflict';END IF;
  END IF;
  INSERT INTO receipt_bank_intents VALUES(p_account,p_hash,p_workspace,r.id,target,v_mask,who,clock_timestamp())
   ON CONFLICT(account_id,hash) DO UPDATE SET review_id=excluded.review_id,bank_account=excluded.bank_account,card_mask=excluded.card_mask,actor=excluded.actor;
  state:=reconcile_receipt_bank(p_subject,p_workspace,p_account,p_hash);
 ELSE
  SELECT * INTO old FROM receipt_bank_intents WHERE account_id=p_account AND hash=p_hash;
  IF old.bank_account IS NOT NULL THEN PERFORM reconciliation_actor(p_subject,p_workspace,old.bank_account,false);END IF;
  state:=receipt_bank_state(p_account,p_hash);
 END IF;
 SELECT coalesce(jsonb_agg(jsonb_build_object('account',f.account_id,'name',f.institution||' · '||f.mask,'mask',f.mask)),'[]'::jsonb) INTO targets
 FROM bank_feeds f JOIN memberships m ON m.workspace_id=f.workspace_id AND m.user_id=who
 WHERE f.workspace_id=p_workspace AND m.role IN('owner','accountant') AND (m.all_accounts OR EXISTS(SELECT 1 FROM account_grants g WHERE g.user_id=who AND g.workspace_id=p_workspace AND g.account_id=f.account_id));
 SELECT coalesce(jsonb_agg(jsonb_build_object('mask',c.mask,'account',c.account_id)),'[]'::jsonb) INTO cards FROM receipt_cards c WHERE c.workspace_id=p_workspace AND EXISTS(SELECT 1 FROM jsonb_array_elements(targets) t WHERE t->>'account'=c.account_id::text);
 RETURN jsonb_build_object('match',state,'targets',targets,'cards',cards);
END $$;

-- Sync retries pending receipts even when the app is closed. Revoked access cannot auto-post.
ALTER FUNCTION nestwise.apply_bank_feed(uuid,uuid,text,text,jsonb,jsonb,text) RENAME TO apply_bank_feed_before_receipts;
REVOKE ALL ON FUNCTION nestwise.apply_bank_feed_before_receipts(uuid,uuid,text,text,jsonb,jsonb,text) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.apply_bank_feed(p_id uuid,p_lease uuid,p_cursor text,p_next text,p_rows jsonb,p_removed jsonb,p_error text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE i record;
BEGIN
 PERFORM apply_bank_feed_before_receipts(p_id,p_lease,p_cursor,p_next,p_rows,p_removed,p_error);
 IF p_error IS NULL THEN
  FOR i IN SELECT x.*,u.subject FROM receipt_bank_intents x JOIN users u ON u.id=x.actor JOIN bank_feeds f ON f.account_id=x.bank_account WHERE f.id=p_id
   AND NOT EXISTS(SELECT 1 FROM personal_receipt_expenses e WHERE e.account_id=x.account_id AND e.hash=x.hash)
  LOOP
   BEGIN PERFORM reconcile_receipt_bank(i.subject,i.workspace_id,i.account_id,i.hash);
   EXCEPTION WHEN raise_exception THEN NULL; END;
  END LOOP;
 END IF;
END $$;
REVOKE ALL ON FUNCTION nestwise.receipt_merchant_match(text,text),nestwise.receipt_bank_state(uuid,text),nestwise.reconcile_receipt_bank(text,uuid,uuid,text),nestwise.receipt_payment(text,uuid,uuid,text,jsonb),nestwise.apply_bank_feed(uuid,uuid,text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.receipt_payment(text,uuid,uuid,text,jsonb),nestwise.apply_bank_feed(uuid,uuid,text,text,jsonb,jsonb,text) TO nestwise_api;

ALTER FUNCTION nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb) RENAME TO review_receipt_before_matching;
REVOKE ALL ON FUNCTION nestwise.review_receipt_before_matching(text,uuid,uuid,text,uuid,integer,jsonb) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.review_receipt(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_id uuid,p_expected integer,p_data jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result uuid;target uuid;
BEGIN
 PERFORM reconciliation_actor(p_subject,p_workspace,p_account,true);
 SELECT account_id INTO target FROM receipt_cards WHERE workspace_id=p_workspace AND mask=p_data->>'card_last4';
 PERFORM id FROM financial_accounts WHERE id IN(p_account,target) ORDER BY id FOR UPDATE;
 result:=review_receipt_before_matching(p_subject,p_workspace,p_account,p_hash,p_id,p_expected,p_data);
 IF target IS NOT NULL THEN
  BEGIN PERFORM receipt_payment(p_subject,p_workspace,p_account,p_hash,jsonb_build_object('bank_account',target,'card_mask',p_data->>'card_last4','review',result));
  EXCEPTION WHEN raise_exception OR data_exception THEN NULL;END;
 END IF;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.review_receipt(text,uuid,uuid,text,uuid,integer,jsonb) TO nestwise_api;

CREATE FUNCTION nestwise.receipt_statement_recheck() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE i record;
BEGIN
 FOR i IN SELECT x.*,u.subject FROM receipt_bank_intents x JOIN users u ON u.id=x.actor WHERE x.bank_account=NEW.account_id
  AND NOT EXISTS(SELECT 1 FROM personal_receipt_expenses e WHERE e.account_id=x.account_id AND e.hash=x.hash)
 LOOP
  BEGIN PERFORM reconcile_receipt_bank(i.subject,i.workspace_id,i.account_id,i.hash);
  EXCEPTION WHEN raise_exception THEN NULL;END;
 END LOOP;
 RETURN NEW;
END $$;
-- The current statement is updated after its immutable review row; use the current row.
CREATE TRIGGER receipt_statement_recheck AFTER UPDATE OF data ON nestwise.personal_statements FOR EACH ROW EXECUTE FUNCTION nestwise.receipt_statement_recheck();
REVOKE ALL ON FUNCTION nestwise.receipt_statement_recheck() FROM PUBLIC;

ALTER FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) RENAME TO personal_document_before_matching;
REVOKE ALL ON FUNCTION nestwise.personal_document_before_matching(text,uuid,uuid,text,text,jsonb) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.personal_document(p_subject text,p_workspace uuid,p_account uuid,p_hash text,p_action text,p_data jsonb DEFAULT '{}'::jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE who uuid;result jsonb;
BEGIN
 IF p_action<>'expenses' THEN RETURN personal_document_before_matching(p_subject,p_workspace,p_account,p_hash,p_action,p_data);END IF;
 who:=reconciliation_actor(p_subject,p_workspace,p_account,false);
 IF NOT EXISTS(SELECT 1 FROM workspaces WHERE id=p_workspace AND kind='personal') THEN RAISE EXCEPTION 'forbidden';END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(q) ORDER BY q.paid_on DESC,q.created_at DESC),'[]'::jsonb) INTO result FROM (
  SELECT e.*,r.data,to_jsonb(c) classification,receipt_bank_state(e.account_id,e.hash) bank_match
  FROM personal_receipt_expenses e JOIN receipt_reviews r ON r.id=e.review_id
  LEFT JOIN current_receipt_classifications c ON c.account_id=e.account_id AND c.hash=e.hash AND c.review_id=e.review_id
  JOIN memberships m ON m.workspace_id=p_workspace AND m.user_id=who
  WHERE coalesce(e.bank_account,e.account_id)=p_account AND (m.all_accounts OR EXISTS(SELECT 1 FROM account_grants g WHERE g.workspace_id=p_workspace AND g.user_id=who AND g.account_id=e.account_id))
  ORDER BY e.paid_on DESC,e.created_at DESC LIMIT 500
 ) q;
 RETURN result;
END $$;
REVOKE ALL ON FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.personal_document(text,uuid,uuid,text,text,jsonb) TO nestwise_api;

-- The archive follows the payment account without copying or deleting the original.
CREATE OR REPLACE FUNCTION nestwise.read_receipts(p_subject text,p_workspace uuid,p_account uuid,p_hash text DEFAULT NULL,p_before text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE boundary timestamptz;who uuid;
BEGIN
 who:=reconciliation_actor(p_subject,p_workspace,p_account,false);
 IF p_before IS NOT NULL THEN
  IF p_hash IS NOT NULL THEN RAISE EXCEPTION 'invalid_receipt';END IF;
  SELECT max(o.created_at) INTO boundary FROM receipt_originals o LEFT JOIN receipt_bank_intents i ON i.account_id=o.account_id AND i.hash=o.hash
   WHERE o.workspace_id=p_workspace AND coalesce(i.bank_account,o.account_id)=p_account AND o.hash=p_before;
  IF boundary IS NULL THEN RAISE EXCEPTION 'invalid_receipt';END IF;
 END IF;
 RETURN coalesce((SELECT jsonb_agg(to_jsonb(q) ORDER BY q.created_at DESC,q.hash) FROM (SELECT * FROM (
  SELECT DISTINCT ON(o.hash) o.account_id source_account,o.hash,o.bytes,o.mime,o.created_at,
   EXISTS(SELECT 1 FROM receipt_archived a WHERE a.account_id=o.account_id AND a.hash=o.hash) archived,
   (SELECT jsonb_build_object('id',r.id,'revision',r.revision,'data',r.data,'recorded_at',r.recorded_at) FROM receipt_reviews r WHERE r.account_id=o.account_id AND r.hash=o.hash ORDER BY revision DESC LIMIT 1) review,
   (SELECT p.operation_id FROM receipt_postings p WHERE p.account_id=o.account_id AND p.hash=o.hash) operation_id
  FROM receipt_originals o LEFT JOIN receipt_bank_intents i ON i.account_id=o.account_id AND i.hash=o.hash
  JOIN memberships m ON m.workspace_id=o.workspace_id AND m.user_id=who
  WHERE o.workspace_id=p_workspace AND ((p_hash IS NOT NULL AND o.account_id=p_account AND o.hash=p_hash) OR (p_hash IS NULL AND coalesce(i.bank_account,o.account_id)=p_account))
   AND (m.all_accounts OR EXISTS(SELECT 1 FROM account_grants g WHERE g.workspace_id=p_workspace AND g.user_id=who AND g.account_id=o.account_id))
   AND (p_before IS NULL OR o.created_at<boundary OR (o.created_at=boundary AND o.hash>p_before))
  ORDER BY o.hash,o.created_at DESC
 ) dedup ORDER BY created_at DESC,hash LIMIT 100) q),'[]'::jsonb);
END $$;

CREATE OR REPLACE FUNCTION nestwise.report_input(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result jsonb; receipts jsonb; pending bigint;
BEGIN
 result:=report_input_before_receipt_items(p_subject,p_workspace,p_account,p_from,p_to)->'data';
 WITH candidates AS MATERIALIZED (
  SELECT c.*,r.data,e.paid_on,e.bank_id,e.operation_id,
   e.review_id=c.review_id AND c.review_id=(SELECT id FROM receipt_reviews WHERE account_id=c.account_id AND hash=c.hash ORDER BY revision DESC LIMIT 1)
   AND CASE WHEN e.bank_id IS NOT NULL THEN EXISTS(SELECT 1 FROM bank_feed_rows br JOIN bank_feeds bf ON bf.id=br.feed_id WHERE bf.account_id=coalesce(e.bank_account,c.account_id) AND br.id=e.bank_id AND NOT br.pending AND (e.bank_account IS NULL OR receipt_bank_state(c.account_id,c.hash)->>'status'='matched') AND br.cents=-(r.data->>'total_cents')::bigint)
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

