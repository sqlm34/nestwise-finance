-- Personal bank data is isolated from the CRM ledger and tax reports.
CREATE TABLE nestwise.bank_feeds (
 id uuid PRIMARY KEY, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
 institution text NOT NULL, label text NOT NULL, mask text NOT NULL,
 enabled boolean NOT NULL DEFAULT true, cursor text NOT NULL DEFAULT '',
 checked_at timestamptz, changed_at timestamptz, error text,
 lease uuid, lease_until timestamptz,
 FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id),
 UNIQUE(workspace_id,account_id)
);
CREATE TABLE nestwise.bank_feed_rows (
 feed_id uuid REFERENCES nestwise.bank_feeds, id text, paid_on date NOT NULL,
 name text NOT NULL, cents bigint NOT NULL, pending boolean NOT NULL,
 category text NOT NULL, currency text NOT NULL CHECK(currency='USD'),
 PRIMARY KEY(feed_id,id)
);
REVOKE ALL ON nestwise.bank_feeds,nestwise.bank_feed_rows FROM PUBLIC,nestwise_api;

CREATE FUNCTION nestwise.read_bank_feed(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE f bank_feeds;
BEGIN
 IF NOT EXISTS(SELECT 1 FROM users u JOIN memberships m ON m.user_id=u.id JOIN workspaces w ON w.id=m.workspace_id
   JOIN financial_accounts a ON a.workspace_id=w.id WHERE u.subject=p_subject AND w.id=p_workspace AND w.kind='personal'
   AND a.id=p_account AND (m.all_accounts OR EXISTS(SELECT 1 FROM account_grants g WHERE g.workspace_id=w.id AND g.user_id=u.id AND g.account_id=a.id))) THEN
   RAISE EXCEPTION 'forbidden'; END IF;
 IF p_from IS NULL OR p_to IS NULL OR p_from>p_to OR p_to-p_from>366 THEN RAISE EXCEPTION 'invalid_filters'; END IF;
 SELECT * INTO f FROM bank_feeds WHERE workspace_id=p_workspace AND account_id=p_account;
 IF NOT FOUND THEN RETURN jsonb_build_object('connection',NULL,'rows','[]'::jsonb); END IF;
 RETURN jsonb_build_object('connection',jsonb_build_object('institution',f.institution,'name',f.label,'mask',f.mask,'enabled',f.enabled,
   'checked_at',f.checked_at,'changed_at',f.changed_at,'error',f.error),
 'rows',coalesce((SELECT jsonb_agg(to_jsonb(r) ORDER BY r.paid_on DESC,r.id) FROM (
  SELECT id,paid_on,name,cents::text,pending,category,currency FROM bank_feed_rows WHERE feed_id=f.id AND paid_on BETWEEN p_from AND p_to
  ORDER BY paid_on DESC,id LIMIT 500) r),'[]'::jsonb),
 'count',(SELECT count(*) FROM bank_feed_rows WHERE feed_id=f.id AND paid_on BETWEEN p_from AND p_to));
END $$;

CREATE FUNCTION nestwise.claim_bank_feed(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE f bank_feeds;
BEGIN
 SELECT b.* INTO f FROM bank_feeds b JOIN workspaces w ON w.id=b.workspace_id AND w.kind='personal'
 WHERE b.id=p_id AND b.enabled AND (b.lease_until IS NULL OR b.lease_until<now())
 AND (b.checked_at IS NULL OR b.checked_at<now()-interval '15 minutes') FOR UPDATE OF b SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE bank_feeds SET lease=p_lease,lease_until=now()+interval '5 minutes' WHERE id=p_id;
 RETURN jsonb_build_object('cursor',f.cursor);
END $$;

CREATE FUNCTION nestwise.apply_bank_feed(p_id uuid,p_lease uuid,p_cursor text,p_next text,p_rows jsonb,p_removed jsonb,p_error text)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE f bank_feeds; r jsonb; changes integer:=0; n integer;
BEGIN
 SELECT b.* INTO f FROM bank_feeds b JOIN workspaces w ON w.id=b.workspace_id AND w.kind='personal'
 WHERE b.id=p_id AND b.enabled FOR UPDATE OF b;
 IF NOT FOUND OR f.lease IS DISTINCT FROM p_lease OR f.cursor<>p_cursor THEN RAISE EXCEPTION 'bank_sync_conflict'; END IF;
 IF p_error IS NOT NULL THEN
   UPDATE bank_feeds SET error=CASE WHEN p_error='ITEM_LOGIN_REQUIRED' THEN 'login_required' ELSE 'temporarily_unavailable' END,
    lease=NULL,lease_until=NULL,checked_at=now() WHERE id=p_id; RETURN;
 END IF;
 IF p_next IS NULL OR jsonb_typeof(p_rows)<>'array' OR jsonb_typeof(p_removed)<>'array' THEN RAISE EXCEPTION 'invalid_bank_feed'; END IF;
 FOR r IN SELECT value FROM jsonb_array_elements(p_removed) LOOP
  DELETE FROM bank_feed_rows WHERE feed_id=p_id AND id=r#>>'{}'; GET DIAGNOSTICS n=ROW_COUNT; changes:=changes+n;
 END LOOP;
 FOR r IN SELECT value FROM jsonb_array_elements(p_rows) LOOP
  INSERT INTO bank_feed_rows VALUES(p_id,r->>'id',(r->>'paid_on')::date,left(r->>'name',300),(r->>'cents')::bigint,
    (r->>'pending')::boolean,left(r->>'category',100),r->>'currency')
  ON CONFLICT(feed_id,id) DO UPDATE SET paid_on=excluded.paid_on,name=excluded.name,cents=excluded.cents,
    pending=excluded.pending,category=excluded.category,currency=excluded.currency
  WHERE (bank_feed_rows.paid_on,bank_feed_rows.name,bank_feed_rows.cents,bank_feed_rows.pending,bank_feed_rows.category,bank_feed_rows.currency)
   IS DISTINCT FROM (excluded.paid_on,excluded.name,excluded.cents,excluded.pending,excluded.category,excluded.currency);
  GET DIAGNOSTICS n=ROW_COUNT;changes:=changes+n;
 END LOOP;
 UPDATE bank_feeds SET cursor=p_next,checked_at=now(),changed_at=CASE WHEN changes>0 THEN now() ELSE changed_at END,
  error=NULL,lease=NULL,lease_until=NULL WHERE id=p_id;
END $$;
REVOKE ALL ON FUNCTION nestwise.read_bank_feed(text,uuid,uuid,date,date),nestwise.claim_bank_feed(uuid,uuid),
 nestwise.apply_bank_feed(uuid,uuid,text,text,jsonb,jsonb,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.read_bank_feed(text,uuid,uuid,date,date),nestwise.claim_bank_feed(uuid,uuid),
 nestwise.apply_bank_feed(uuid,uuid,text,text,jsonb,jsonb,text) TO nestwise_api;
