-- Allow scheduler jitter at the quarter-hour boundary without skipping a full cycle.
CREATE OR REPLACE FUNCTION nestwise.claim_bank_feed(p_id uuid,p_lease uuid) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE f bank_feeds;
BEGIN
 SELECT b.* INTO f FROM bank_feeds b JOIN workspaces w ON w.id=b.workspace_id AND w.kind='personal'
 WHERE b.id=p_id AND b.enabled AND (b.lease_until IS NULL OR b.lease_until<now())
 AND (b.checked_at IS NULL OR b.checked_at<now()-interval '14 minutes') FOR UPDATE OF b SKIP LOCKED;
 IF NOT FOUND THEN RETURN NULL; END IF;
 UPDATE bank_feeds SET lease=p_lease,lease_until=now()+interval '5 minutes' WHERE id=p_id;
 RETURN jsonb_build_object('cursor',f.cursor);
END $$;

