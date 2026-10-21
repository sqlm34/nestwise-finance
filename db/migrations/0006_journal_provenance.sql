-- Explicit metadata projection: never expose raw payloads, internal errors or connection credentials.
CREATE VIEW nestwise.event_provenance AS
SELECT se.id internal_id,se.workspace_id,se.account_id,se.connection_id,se.source_order_id,se.order_revision,
  jsonb_build_object('id',se.source_event_id,'order_id',se.source_order_id,'revision',se.order_revision,
    'kind',se.kind,'status',se.status,'occurred_at',se.occurred_at,'paid_at',se.paid_at,
    'received_at',se.received_at,'posted_at',jt.posted_at,'journal_id',jt.id,
    'reference_id',se.payload->>'reference_event_id') summary
FROM nestwise.source_events se LEFT JOIN nestwise.journal_transactions jt ON jt.event_id=se.id;
REVOKE ALL ON nestwise.event_provenance FROM PUBLIC,nestwise_api;

CREATE FUNCTION nestwise.user_journal_detail(p_subject text,p_workspace uuid,p_account uuid,p_transaction uuid,p_before integer DEFAULT NULL)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; event source_events; transaction_data jsonb; history_data jsonb; next_revision integer;
BEGIN
  SELECT id INTO actor FROM users WHERE subject=p_subject;
  IF actor IS NULL OR NOT EXISTS (
    SELECT 1 FROM memberships m JOIN financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE m.user_id=actor AND m.workspace_id=p_workspace AND a.id=p_account
      AND (m.all_accounts OR EXISTS (SELECT 1 FROM account_grants g WHERE g.workspace_id=m.workspace_id
        AND g.user_id=actor AND g.account_id=p_account))) THEN RAISE EXCEPTION 'forbidden'; END IF;
  SELECT se.* INTO event FROM journal_transactions jt JOIN source_events se ON se.id=jt.event_id
    WHERE jt.id=p_transaction AND jt.workspace_id=p_workspace AND jt.account_id=p_account;
  IF NOT FOUND THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF p_before IS NOT NULL AND p_before<1 THEN RAISE EXCEPTION 'invalid_filters'; END IF;
  SELECT jsonb_build_object('id',jt.id,'occurred_at',jt.occurred_at,'paid_at',jt.paid_at,'posted_at',jt.posted_at,
    'source_event_id',event.source_event_id,'source_order_id',event.source_order_id,
    'entries',(SELECT jsonb_agg(jsonb_build_object('code',code,'cents',cents::text) ORDER BY line)
      FROM journal_entries WHERE transaction_id=jt.id)) INTO transaction_data
    FROM journal_transactions jt WHERE jt.id=p_transaction;
  WITH candidates AS (
    SELECT summary,order_revision FROM event_provenance
    WHERE workspace_id=p_workspace AND account_id=p_account AND connection_id=event.connection_id
      AND source_order_id=event.source_order_id AND (p_before IS NULL OR order_revision<p_before)
    ORDER BY order_revision DESC LIMIT 101
  ), numbered AS (SELECT *,row_number() OVER(ORDER BY order_revision DESC) n FROM candidates)
  SELECT coalesce(jsonb_agg(summary ORDER BY order_revision DESC) FILTER(WHERE n<=100),'[]'::jsonb),
    CASE WHEN count(*)>100 THEN max(order_revision) FILTER(WHERE n=100) ELSE NULL END
    INTO history_data,next_revision FROM numbered;
  RETURN jsonb_build_object('transaction',transaction_data,
    'source',(SELECT summary FROM event_provenance WHERE internal_id=event.id),
    'reference',(SELECT summary FROM event_provenance WHERE workspace_id=p_workspace AND account_id=p_account
      AND connection_id=event.connection_id AND source_order_id=event.source_order_id
      AND lower(summary->>'id')=lower(event.payload->>'reference_event_id')),
    'history',history_data,'next_revision',next_revision,
    'audit',coalesce((SELECT jsonb_agg(to_jsonb(a) ORDER BY recorded_at) FROM (
      SELECT action,recorded_at FROM audit_logs WHERE workspace_id=p_workspace AND event_id=event.id
      ORDER BY recorded_at DESC,id DESC LIMIT 50) a),'[]'::jsonb),
    'audit_truncated',(SELECT count(*)>50 FROM audit_logs WHERE workspace_id=p_workspace AND event_id=event.id));
END $$;
REVOKE ALL ON FUNCTION nestwise.user_journal_detail(text,uuid,uuid,uuid,integer) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.user_journal_detail(text,uuid,uuid,uuid,integer) TO nestwise_api;
