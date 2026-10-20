-- Explicit user approval is required by the HTTP contract. Upload remains evidence-only.
CREATE TABLE nestwise.bank_bookings (
  id uuid PRIMARY KEY REFERENCES nestwise.manual_operations,
  workspace_id uuid NOT NULL,account_id uuid NOT NULL,actor uuid NOT NULL REFERENCES nestwise.users,
  file_hash text NOT NULL,row_data jsonb NOT NULL,operation_data jsonb NOT NULL,
  reconciliation_id uuid NOT NULL UNIQUE REFERENCES nestwise.reconciliation_groups,
  recorded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(workspace_id,account_id) REFERENCES nestwise.financial_accounts(workspace_id,id),
  FOREIGN KEY(account_id,file_hash) REFERENCES nestwise.statement_archived(account_id,file_hash)
);
CREATE TRIGGER bank_bookings_immutable BEFORE UPDATE OR DELETE ON nestwise.bank_bookings FOR EACH ROW EXECUTE FUNCTION nestwise.immutable();
REVOKE ALL ON nestwise.bank_bookings FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.post_bank_row(p_subject text,p_workspace uuid,p_account uuid,p_id uuid,p_hash text,p_row jsonb,p_operation jsonb) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE actor uuid; old bank_bookings; tx uuid; amount numeric;
BEGIN
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  PERFORM id FROM financial_accounts WHERE id=p_account FOR UPDATE;
  actor:=reconciliation_actor(p_subject,p_workspace,p_account,true);
  SELECT * INTO old FROM bank_bookings WHERE id=p_id;
  IF FOUND THEN
    IF old.workspace_id<>p_workspace OR old.account_id<>p_account OR old.actor<>actor OR old.file_hash<>p_hash OR old.row_data<>p_row OR old.operation_data<>p_operation THEN RAISE EXCEPTION 'bank_booking_conflict'; END IF;
    RETURN p_id;
  END IF;
  IF NOT EXISTS(SELECT 1 FROM statement_archived WHERE account_id=p_account AND file_hash=p_hash) THEN RAISE EXCEPTION 'forbidden'; END IF;
  IF EXISTS(SELECT 1 FROM manual_operations WHERE id=p_id) THEN RAISE EXCEPTION 'bank_booking_conflict'; END IF;
  amount:=(p_row->>'cents')::numeric;
  IF amount IS NULL OR amount=0 OR abs(amount)>9007199254740991 OR p_operation->>'id' IS DISTINCT FROM p_id::text
    OR p_operation->>'paid_on' IS DISTINCT FROM p_row->>'date' OR (p_operation->>'amount_cents')::numeric IS DISTINCT FROM abs(amount)
    OR p_operation->>'kind' IS DISTINCT FROM (CASE WHEN amount>0 THEN 'income' ELSE 'expense' END) THEN RAISE EXCEPTION 'invalid_bank_booking'; END IF;
  -- Permanent origin reservation survives cancellation of reconciliation decisions.
  IF EXISTS(SELECT 1 FROM bank_bookings WHERE account_id=p_account AND
    (file_hash=p_hash AND row_data->>'line'=p_row->>'line' OR row_data->>'date'=p_row->>'date' AND row_data->>'cents'=p_row->>'cents' AND row_data->>'text_hash'=p_row->>'text_hash'))
    THEN RAISE EXCEPTION 'bank_booking_conflict'; END IF;
  PERFORM post_manual_operation(p_subject,p_workspace,p_account,p_operation);
  SELECT id INTO tx FROM journal_transactions WHERE manual_id=p_id AND account_id=p_account;
  PERFORM save_reconciliation(p_subject,p_workspace,p_account,jsonb_build_object('id',p_id,'file_hash',p_hash,'rows',jsonb_build_array(p_row),'transactions',jsonb_build_array(tx)));
  INSERT INTO bank_bookings VALUES(p_id,p_workspace,p_account,actor,p_hash,p_row,p_operation,p_id,clock_timestamp());
  RETURN p_id;
END $$;
REVOKE ALL ON FUNCTION nestwise.post_bank_row(text,uuid,uuid,uuid,text,jsonb,jsonb) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.post_bank_row(text,uuid,uuid,uuid,text,jsonb,jsonb) TO nestwise_api;
