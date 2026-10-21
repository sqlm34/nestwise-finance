-- New snapshots are categorized information for handoff, not an approval workflow.
-- Existing v1 snapshots remain byte-for-byte immutable and readable.
ALTER TABLE nestwise.report_snapshots DROP CONSTRAINT report_snapshots_status_check;
ALTER TABLE nestwise.report_snapshots ADD CONSTRAINT report_snapshots_status_check CHECK(status IN ('Accountant Review','Prepared for handoff'));
ALTER TABLE nestwise.report_snapshots ALTER COLUMN status SET DEFAULT 'Prepared for handoff';
ALTER FUNCTION nestwise.report_input(text,uuid,uuid,date,date) RENAME TO report_input_v1;
REVOKE ALL ON FUNCTION nestwise.report_input_v1(text,uuid,uuid,date,date) FROM PUBLIC,nestwise_api;
CREATE FUNCTION nestwise.report_input(p_subject text,p_workspace uuid,p_account uuid,p_from date,p_to date) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path=nestwise,pg_temp AS $$
DECLARE result jsonb; stock jsonb;
BEGIN
 result:=report_input_v1(p_subject,p_workspace,p_account,p_from,p_to)->'data';
 stock:=read_parts(p_subject,p_workspace,p_account);
 result:=result||jsonb_build_object('version','statement-handoff-v2','status','Prepared for handoff','parts_evidence',stock);
 IF octet_length(result::text)>2097152 THEN RAISE EXCEPTION 'report_too_large';END IF;
 RETURN jsonb_build_object('data',result,'hash',encode(sha256(convert_to(result::text,'UTF8')),'hex'));
END $$;
REVOKE ALL ON FUNCTION nestwise.report_input(text,uuid,uuid,date,date) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION nestwise.report_input(text,uuid,uuid,date,date) TO nestwise_api;
