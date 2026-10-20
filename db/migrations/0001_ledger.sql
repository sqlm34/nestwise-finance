-- Management ledger only. Tax recognition and accountant mappings are separate.
-- Apply to a NEW Nestwise database with a migration owner, never the runtime role.
CREATE SCHEMA nestwise;
REVOKE ALL ON SCHEMA nestwise FROM PUBLIC;
CREATE ROLE nestwise_api NOLOGIN;
GRANT USAGE ON SCHEMA nestwise TO nestwise_api;

CREATE TABLE nestwise.workspaces (
  id uuid PRIMARY KEY, name text NOT NULL, kind text NOT NULL
    CHECK (kind IN ('family','personal','business'))
);
CREATE TABLE nestwise.users (id uuid PRIMARY KEY, subject text NOT NULL UNIQUE);
CREATE TABLE nestwise.memberships (
  workspace_id uuid REFERENCES nestwise.workspaces, user_id uuid REFERENCES nestwise.users,
  role text NOT NULL CHECK (role IN ('owner','member','accountant','reviewer')),
  all_accounts boolean NOT NULL DEFAULT false,
  PRIMARY KEY (workspace_id,user_id)
);
CREATE TABLE nestwise.financial_accounts (
  id uuid PRIMARY KEY, workspace_id uuid NOT NULL REFERENCES nestwise.workspaces,
  name text NOT NULL, currency text NOT NULL DEFAULT 'USD' CHECK (currency='USD'),
  UNIQUE (workspace_id,id)
);
CREATE TABLE nestwise.account_grants (
  workspace_id uuid NOT NULL, user_id uuid NOT NULL, account_id uuid NOT NULL,
  PRIMARY KEY (workspace_id,user_id,account_id),
  FOREIGN KEY (workspace_id,user_id) REFERENCES nestwise.memberships,
  FOREIGN KEY (workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id)
);
-- Raw session tokens never enter the database. Provisioning/login is a later step.
CREATE TABLE nestwise.sessions (
  token_hash text PRIMARY KEY CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  user_id uuid NOT NULL REFERENCES nestwise.users, expires_at timestamptz NOT NULL,
  revoked_at timestamptz
);
CREATE TABLE nestwise.source_connections (
  id text PRIMARY KEY CHECK (id ~ '^[a-z0-9-]{1,64}$'),
  workspace_id uuid NOT NULL, account_id uuid NOT NULL,
  enabled boolean NOT NULL DEFAULT false,
  FOREIGN KEY (workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id),
  UNIQUE (id,workspace_id,account_id)
);
CREATE TABLE nestwise.crm_orders_shadow (
  connection_id text REFERENCES nestwise.source_connections, source_order_id text,
  applied_revision integer NOT NULL DEFAULT 0,
  state text NOT NULL DEFAULT 'open' CHECK (state IN ('open','finalized','voided')),
  PRIMARY KEY (connection_id,source_order_id)
);
CREATE TABLE nestwise.source_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  connection_id text NOT NULL, workspace_id uuid NOT NULL, account_id uuid NOT NULL,
  source_event_id uuid NOT NULL, source_order_id text NOT NULL CHECK (length(source_order_id) BETWEEN 1 AND 128),
  order_revision integer NOT NULL CHECK (order_revision BETWEEN 1 AND 2147483646),
  source_fact_id text NOT NULL CHECK (length(source_fact_id) BETWEEN 1 AND 128),
  kind text NOT NULL, payload jsonb NOT NULL,
  payload_hash text NOT NULL CHECK (payload_hash ~ '^[0-9a-f]{64}$'),
  occurred_at timestamptz NOT NULL, paid_at timestamptz,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  status text NOT NULL DEFAULT 'waiting' CHECK (status IN ('waiting','posted','asserted','needs_review')),
  error_code text, effective_amount bigint,
  FOREIGN KEY (connection_id,workspace_id,account_id)
    REFERENCES nestwise.source_connections(id,workspace_id,account_id),
  UNIQUE (connection_id,source_event_id),
  UNIQUE (connection_id,source_order_id,order_revision),
  UNIQUE (connection_id,source_fact_id),
  UNIQUE (workspace_id,account_id,id)
);
CREATE TABLE nestwise.request_nonces (
  connection_id text REFERENCES nestwise.source_connections,
  nonce uuid, expires_at timestamptz NOT NULL,
  PRIMARY KEY (connection_id,nonce)
);
CREATE TABLE nestwise.journal_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL, account_id uuid NOT NULL, event_id uuid NOT NULL UNIQUE,
  occurred_at timestamptz NOT NULL, paid_at timestamptz,
  posted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  created_txid bigint NOT NULL DEFAULT txid_current(),
  FOREIGN KEY (workspace_id,account_id,event_id)
    REFERENCES nestwise.source_events(workspace_id,account_id,id),
  UNIQUE (workspace_id,id)
);
CREATE TABLE nestwise.journal_entries (
  transaction_id uuid NOT NULL, workspace_id uuid NOT NULL,
  line integer NOT NULL CHECK (line > 0),
  code text NOT NULL CHECK (code IN ('clearing','receipts','refunds','parts_cost','parts_payable','fees')),
  -- Positive = debit; negative = credit. No floating point amounts.
  cents bigint NOT NULL CHECK (cents BETWEEN -9007199254740991 AND 9007199254740991 AND cents <> 0),
  PRIMARY KEY (transaction_id,line),
  FOREIGN KEY (workspace_id,transaction_id) REFERENCES nestwise.journal_transactions(workspace_id,id)
);
CREATE TABLE nestwise.audit_logs (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  workspace_id uuid NOT NULL REFERENCES nestwise.workspaces,
  event_id uuid NOT NULL REFERENCES nestwise.source_events,
  action text NOT NULL, recorded_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX source_events_pending ON nestwise.source_events(connection_id,source_order_id,order_revision)
  WHERE status='waiting';
CREATE INDEX journal_by_account ON nestwise.journal_transactions(workspace_id,account_id,posted_at,id);
CREATE INDEX nonce_expiry ON nestwise.request_nonces(expires_at);

CREATE FUNCTION nestwise.immutable() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN RAISE EXCEPTION 'immutable_financial_history'; END $$;
CREATE TRIGGER immutable_transactions BEFORE UPDATE OR DELETE ON nestwise.journal_transactions
  FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER immutable_entries BEFORE UPDATE OR DELETE ON nestwise.journal_entries
  FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE TRIGGER immutable_audit BEFORE UPDATE OR DELETE ON nestwise.audit_logs
  FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
CREATE FUNCTION nestwise.seal_entries() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM nestwise.journal_transactions
    WHERE id=NEW.transaction_id AND created_txid=txid_current())
    THEN RAISE EXCEPTION 'journal_already_sealed'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER sealed_entries BEFORE INSERT ON nestwise.journal_entries
  FOR EACH ROW EXECUTE FUNCTION nestwise.seal_entries();
CREATE FUNCTION nestwise.protect_event() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'immutable_source_event'; END IF;
  IF (to_jsonb(NEW)-ARRAY['status','error_code','effective_amount']) IS DISTINCT FROM
     (to_jsonb(OLD)-ARRAY['status','error_code','effective_amount'])
  THEN RAISE EXCEPTION 'immutable_source_event'; END IF;
  RETURN NEW;
END $$;
CREATE TRIGGER immutable_event BEFORE UPDATE OR DELETE ON nestwise.source_events
  FOR EACH ROW EXECUTE FUNCTION nestwise.protect_event();

-- Deferred triggers run after the API function returns to the restricted role.
CREATE FUNCTION nestwise.balanced() RETURNS trigger LANGUAGE plpgsql
SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE target uuid; total numeric; lines integer;
BEGIN
  IF TG_TABLE_NAME='journal_transactions' THEN target:=NEW.id;
  ELSE target:=NEW.transaction_id; END IF;
  SELECT sum(cents),count(*) INTO total,lines FROM nestwise.journal_entries WHERE transaction_id=target;
  IF lines<2 OR total<>0 THEN RAISE EXCEPTION 'unbalanced_journal'; END IF;
  RETURN NULL;
END $$;
CREATE CONSTRAINT TRIGGER transaction_balanced AFTER INSERT ON nestwise.journal_transactions
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nestwise.balanced();
CREATE CONSTRAINT TRIGGER entries_balanced AFTER INSERT ON nestwise.journal_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW EXECUTE FUNCTION nestwise.balanced();

-- One ordered stream per CRM order. The row lock serializes concurrent deliveries.
CREATE FUNCTION nestwise.drain_order(p_connection text,p_order text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE o crm_orders_shadow; e source_events; ref source_events;
  amount bigint; delta bigint; debit text; credit text; tx uuid; totals jsonb; reason text;
BEGIN
  SELECT * INTO o FROM crm_orders_shadow
    WHERE connection_id=p_connection AND source_order_id=p_order FOR UPDATE;
  FOR e IN SELECT * FROM source_events WHERE connection_id=p_connection
    AND source_order_id=p_order AND status='waiting' ORDER BY order_revision LIMIT 100
  LOOP
    EXIT WHEN e.order_revision <> o.applied_revision+1;
    BEGIN
      amount := (e.payload->>'amount_cents')::bigint;
      delta := amount; debit := NULL; credit := NULL;
      IF o.state='voided' THEN RAISE EXCEPTION 'voided_order'; END IF;
      CASE e.kind
        WHEN 'job.payment_recorded' THEN debit:='clearing'; credit:='receipts';
        WHEN 'job.part_cost_recorded' THEN
          debit:='parts_cost';
          credit:=CASE e.payload->>'settlement' WHEN 'paid' THEN 'clearing' WHEN 'accrued' THEN 'parts_payable' END;
          IF credit IS NULL THEN RAISE EXCEPTION 'invalid_settlement'; END IF;
        WHEN 'job.processor_fee_recorded' THEN debit:='fees'; credit:='clearing';
        WHEN 'job.customer_refund_issued','job.supplier_credit_received','job.processor_fee_refunded','job.cost_corrected' THEN
          SELECT * INTO ref FROM source_events WHERE connection_id=e.connection_id
            AND source_order_id=e.source_order_id
            AND source_event_id=(e.payload->>'reference_event_id')::uuid
            AND status='posted' AND order_revision<e.order_revision;
          IF NOT FOUND THEN RAISE EXCEPTION 'reference_not_posted'; END IF;
          IF e.kind='job.cost_corrected' THEN
            IF ref.kind NOT IN ('job.part_cost_recorded','job.cost_corrected')
              THEN RAISE EXCEPTION 'invalid_cost_reference'; END IF;
            -- A linear correction chain prevents two corrections using the same base.
            IF EXISTS (SELECT 1 FROM source_events WHERE connection_id=e.connection_id
              AND status='posted' AND (payload->>'reference_event_id')::uuid=ref.source_event_id)
              THEN RAISE EXCEPTION 'reference_already_adjusted'; END IF;
            debit:='parts_cost';
            SELECT je.code INTO credit FROM journal_transactions jt JOIN journal_entries je
              ON je.transaction_id=jt.id WHERE jt.event_id=ref.id AND je.line=2;
            delta:=amount-ref.effective_amount;
          ELSE
            IF (e.kind='job.customer_refund_issued' AND ref.kind<>'job.payment_recorded')
              OR (e.kind='job.supplier_credit_received' AND ref.kind NOT IN ('job.part_cost_recorded','job.cost_corrected'))
              OR (e.kind='job.processor_fee_refunded' AND ref.kind<>'job.processor_fee_recorded')
              THEN RAISE EXCEPTION 'invalid_reference_type'; END IF;
            IF EXISTS (SELECT 1 FROM source_events WHERE connection_id=e.connection_id
              AND status='posted' AND kind='job.cost_corrected'
              AND (payload->>'reference_event_id')::uuid=ref.source_event_id)
              THEN RAISE EXCEPTION 'use_latest_cost_revision'; END IF;
            IF amount + coalesce((SELECT sum(effective_amount) FROM source_events
              WHERE connection_id=e.connection_id AND status='posted' AND kind=e.kind
                AND (payload->>'reference_event_id')::uuid=ref.source_event_id),0) > ref.effective_amount
              THEN RAISE EXCEPTION 'refund_exceeds_source'; END IF;
            IF e.kind='job.customer_refund_issued' THEN debit:='refunds'; credit:='clearing';
            ELSIF e.kind='job.processor_fee_refunded' THEN debit:='clearing'; credit:='fees';
            ELSE
              SELECT je.code INTO debit FROM journal_transactions jt JOIN journal_entries je
                ON je.transaction_id=jt.id WHERE jt.event_id=ref.id AND je.line=2;
              credit:='parts_cost';
              IF (debit='clearing' AND e.paid_at IS NULL) OR (debit='parts_payable' AND e.paid_at IS NOT NULL)
                THEN RAISE EXCEPTION 'invalid_credit_payment_date'; END IF;
            END IF;
          END IF;
        WHEN 'job.financials_finalized' THEN
          SELECT jsonb_build_object(
            'payments_cents',coalesce(-sum(je.cents) FILTER (WHERE code='receipts'),0),
            'refunds_cents',coalesce(sum(je.cents) FILTER (WHERE code='refunds'),0),
            'parts_net_cents',coalesce(sum(je.cents) FILTER (WHERE code='parts_cost'),0),
            'fees_net_cents',coalesce(sum(je.cents) FILTER (WHERE code='fees'),0))
          INTO totals FROM journal_entries je JOIN journal_transactions jt ON jt.id=je.transaction_id
            JOIN source_events se ON se.id=jt.event_id
            WHERE se.connection_id=e.connection_id AND se.source_order_id=e.source_order_id;
          IF totals IS DISTINCT FROM e.payload->'totals' THEN RAISE EXCEPTION 'snapshot_mismatch'; END IF;
          o.state:='finalized';
        WHEN 'job.reopened' THEN o.state:='open';
        WHEN 'job.voided' THEN
          IF EXISTS (SELECT je.code FROM journal_entries je
            JOIN journal_transactions jt ON jt.id=je.transaction_id JOIN source_events se ON se.id=jt.event_id
            WHERE se.connection_id=e.connection_id AND se.source_order_id=e.source_order_id
            GROUP BY je.code HAVING sum(je.cents)<>0) THEN RAISE EXCEPTION 'void_has_financial_history'; END IF;
          o.state:='voided';
        ELSE RAISE EXCEPTION 'unsupported_event';
      END CASE;
      IF debit IS NOT NULL THEN
        IF amount IS NULL OR amount<0 OR amount>9007199254740991
          OR (amount=0 AND e.kind<>'job.cost_corrected') THEN RAISE EXCEPTION 'invalid_amount'; END IF;
        IF delta=0 THEN RAISE EXCEPTION 'no_change_correction'; END IF;
        INSERT INTO journal_transactions(workspace_id,account_id,event_id,occurred_at,paid_at)
          VALUES(e.workspace_id,e.account_id,e.id,e.occurred_at,e.paid_at) RETURNING id INTO tx;
        INSERT INTO journal_entries VALUES(tx,e.workspace_id,1,debit,delta),(tx,e.workspace_id,2,credit,-delta);
      END IF;
      UPDATE source_events SET status=CASE WHEN debit IS NULL THEN 'asserted' ELSE 'posted' END,
        effective_amount=amount,error_code=NULL WHERE id=e.id;
      INSERT INTO audit_logs(workspace_id,event_id,action) VALUES(e.workspace_id,e.id,'applied');
      o.applied_revision:=e.order_revision;
      UPDATE crm_orders_shadow SET applied_revision=o.applied_revision,state=o.state
        WHERE connection_id=p_connection AND source_order_id=p_order;
    EXCEPTION WHEN raise_exception OR invalid_text_representation OR numeric_value_out_of_range THEN
      GET STACKED DIAGNOSTICS reason=MESSAGE_TEXT;
      -- Internal exception text never leaves the database as an HTTP response.
      UPDATE source_events SET status='needs_review',error_code=left(reason,100) WHERE id=e.id;
      INSERT INTO audit_logs(workspace_id,event_id,action) VALUES(e.workspace_id,e.id,'needs_review');
      EXIT;
    END;
  END LOOP;
END $$;

CREATE FUNCTION nestwise.accept_event(p_connection text,p_nonce uuid,p_timestamp bigint,p_raw text)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE c source_connections; body jsonb; existing source_events; saved source_events; hash text;
BEGIN
  IF abs(extract(epoch FROM clock_timestamp())-p_timestamp)>300 THEN RAISE EXCEPTION 'expired_request'; END IF;
  IF octet_length(p_raw)>16384 THEN RAISE EXCEPTION 'body_too_large'; END IF;
  SELECT * INTO c FROM source_connections WHERE id=p_connection AND enabled;
  IF NOT FOUND THEN RAISE EXCEPTION 'connection_disabled'; END IF;
  body:=p_raw::jsonb;
  IF body->>'schema_version'<>'1' OR body->>'currency'<>'USD' OR
    jsonb_typeof(body->'order_revision')<>'number' OR
    (body->>'order_revision') !~ '^[1-9][0-9]{0,9}$' THEN RAISE EXCEPTION 'invalid_contract'; END IF;
  IF body ? 'amount_cents' AND (jsonb_typeof(body->'amount_cents')<>'number'
    OR (body->>'amount_cents') !~ '^[0-9]{1,16}$') THEN RAISE EXCEPTION 'invalid_amount'; END IF;
  INSERT INTO request_nonces VALUES(p_connection,p_nonce,clock_timestamp()+interval '10 minutes')
    ON CONFLICT DO NOTHING;
  IF NOT FOUND THEN RAISE EXCEPTION 'replayed_request'; END IF;
  INSERT INTO crm_orders_shadow(connection_id,source_order_id)
    VALUES(p_connection,body->>'source_order_id') ON CONFLICT DO NOTHING;
  PERFORM 1 FROM crm_orders_shadow WHERE connection_id=p_connection
    AND source_order_id=body->>'source_order_id' FOR UPDATE;
  hash:=encode(sha256(convert_to(p_raw,'UTF8')),'hex');
  SELECT * INTO existing FROM source_events WHERE connection_id=p_connection
    AND source_event_id=(body->>'source_event_id')::uuid;
  IF FOUND THEN
    IF existing.payload_hash<>hash THEN RAISE EXCEPTION 'event_payload_conflict'; END IF;
    RETURN jsonb_build_object('accepted',true,'duplicate',true,'event_id',existing.source_event_id,'status',existing.status);
  END IF;
  INSERT INTO source_events(connection_id,workspace_id,account_id,source_event_id,source_order_id,
    order_revision,source_fact_id,kind,payload,payload_hash,occurred_at,paid_at)
  VALUES(c.id,c.workspace_id,c.account_id,(body->>'source_event_id')::uuid,body->>'source_order_id',
    (body->>'order_revision')::integer,body->>'source_fact_id',body->>'type',body,hash,
    (body->>'occurred_at')::timestamptz,(body->>'paid_at')::timestamptz)
  RETURNING * INTO saved;
  PERFORM drain_order(p_connection,saved.source_order_id);
  SELECT * INTO saved FROM source_events WHERE id=saved.id;
  RETURN jsonb_build_object('accepted',true,'duplicate',false,'event_id',saved.source_event_id,'status',saved.status);
END $$;

-- Narrow, parameterized read API: identity is obtained from a hashed, live session.
CREATE FUNCTION nestwise.read_journal(p_hash text,p_workspace uuid,p_account uuid)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid;
BEGIN
  SELECT user_id INTO actor FROM sessions WHERE token_hash=p_hash
    AND expires_at>clock_timestamp() AND revoked_at IS NULL;
  IF actor IS NULL THEN RAISE EXCEPTION 'unauthorized'; END IF;
  IF NOT EXISTS (SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  RETURN coalesce((SELECT jsonb_agg(to_jsonb(j) ORDER BY j.posted_at DESC,j.id DESC) FROM (
    SELECT jt.id,jt.occurred_at,jt.paid_at,jt.posted_at,se.source_event_id,se.source_order_id,
      (SELECT jsonb_agg(jsonb_build_object('code',code,'cents',cents::text) ORDER BY line)
        FROM journal_entries WHERE transaction_id=jt.id) entries
    FROM journal_transactions jt JOIN source_events se ON se.id=jt.event_id
    WHERE jt.workspace_id=p_workspace AND jt.account_id=p_account
    ORDER BY jt.posted_at DESC,jt.id DESC LIMIT 100
  ) j),'[]'::jsonb);
END $$;

-- Bounded catch-up for >100 contiguous events; invalid facts require review, not infinite retries.
CREATE FUNCTION nestwise.process_pending() RETURNS void LANGUAGE plpgsql SECURITY DEFINER
SET search_path=nestwise,pg_temp AS $$
DECLARE item record;
BEGIN
  FOR item IN SELECT DISTINCT e.connection_id,e.source_order_id FROM source_events e
    JOIN source_connections c ON c.id=e.connection_id
    JOIN crm_orders_shadow o ON o.connection_id=e.connection_id AND o.source_order_id=e.source_order_id
    WHERE c.enabled AND e.status='waiting' AND e.order_revision=o.applied_revision+1 LIMIT 20
  LOOP PERFORM drain_order(item.connection_id,item.source_order_id); END LOOP;
  DELETE FROM request_nonces WHERE expires_at<clock_timestamp();
END $$;

REVOKE ALL ON ALL TABLES IN SCHEMA nestwise FROM PUBLIC,nestwise_api;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA nestwise FROM PUBLIC,nestwise_api;
GRANT EXECUTE ON FUNCTION nestwise.accept_event(text,uuid,bigint,text),
  nestwise.read_journal(text,uuid,uuid),nestwise.process_pending() TO nestwise_api;
-- Runtime has no table privileges and cannot select another workspace by setting a session variable.
-- A separately provisioned LOGIN role must inherit ONLY nestwise_api, never migration-owner privileges.
