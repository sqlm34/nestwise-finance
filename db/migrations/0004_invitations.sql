-- Owner-issued invitations only; runtime cannot create invitations or memberships.
CREATE TABLE nestwise_auth.invitations (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id text NOT NULL REFERENCES nestwise_auth."user"(id),
  created_at timestamptz NOT NULL DEFAULT now(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE UNIQUE INDEX invitations_one_pending ON nestwise_auth.invitations(user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;
CREATE TABLE nestwise_auth.invitation_attempts (
  key_hash text PRIMARY KEY CHECK (key_hash ~ '^[0-9a-f]{64}$'),
  started_at timestamptz NOT NULL,
  attempts integer NOT NULL
);
CREATE INDEX invitation_attempts_started ON nestwise_auth.invitation_attempts(started_at);
REVOKE ALL ON nestwise_auth.invitations,nestwise_auth.invitation_attempts FROM PUBLIC,nestwise_auth_api;

CREATE FUNCTION nestwise_auth.check_invitation(p_hash text,p_key text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise_auth,pg_temp AS $$
DECLARE attempts_now integer;
BEGIN
  DELETE FROM invitation_attempts WHERE started_at < now()-interval '1 day';
  INSERT INTO invitation_attempts(key_hash,started_at,attempts) VALUES (p_key,now(),1)
    ON CONFLICT (key_hash) DO UPDATE SET
      attempts=CASE WHEN invitation_attempts.started_at < now()-interval '1 hour' THEN 1 ELSE invitation_attempts.attempts+1 END,
      started_at=CASE WHEN invitation_attempts.started_at < now()-interval '1 hour' THEN now() ELSE invitation_attempts.started_at END
    RETURNING attempts INTO attempts_now;
  IF attempts_now>20 THEN RETURN false; END IF;
  RETURN EXISTS(SELECT 1 FROM invitations WHERE token_hash=p_hash AND expires_at>now()
    AND consumed_at IS NULL AND revoked_at IS NULL);
END $$;

CREATE FUNCTION nestwise_auth.accept_invitation(p_hash text,p_password text) RETURNS text
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise_auth,pg_temp AS $$
DECLARE invitation invitations%ROWTYPE; credential_id text; result_email text;
BEGIN
  SELECT * INTO invitation FROM invitations WHERE token_hash=p_hash FOR UPDATE;
  IF NOT FOUND OR invitation.expires_at<=now() OR invitation.consumed_at IS NOT NULL
    OR invitation.revoked_at IS NOT NULL THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
  IF p_password IS NULL OR length(p_password)<32 OR length(p_password)>512 THEN RAISE EXCEPTION 'invalid_password_hash'; END IF;
  SELECT id INTO credential_id FROM account WHERE "userId"=invitation.user_id AND "providerId"='credential'
    AND password IS NULL FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'invalid_invitation'; END IF;
  UPDATE account SET password=p_password,"updatedAt"=now() WHERE id=credential_id;
  UPDATE invitations SET consumed_at=now() WHERE token_hash=p_hash;
  DELETE FROM session WHERE "userId"=invitation.user_id;
  SELECT email INTO result_email FROM "user" WHERE id=invitation.user_id;
  RETURN result_email;
END $$;
REVOKE ALL ON FUNCTION nestwise_auth.check_invitation(text,text),nestwise_auth.accept_invitation(text,text) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise_auth.check_invitation(text,text),nestwise_auth.accept_invitation(text,text) TO nestwise_auth_api;
