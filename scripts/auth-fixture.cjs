// Loopback-only synthetic user. Never provision this identity in a cloud database.
const {readFileSync}=require('node:fs');
const {randomUUID,randomBytes}=require('node:crypto');
async function createAuthFixture() {
  const {db,pool}=await require('./auth-test-db.cjs').authTestDatabase();
  for(const name of ['0001_ledger.sql','0002_auth.sql','0003_user_access.sql','0004_invitations.sql','0005_journal_history.sql','0006_journal_provenance.sql','0007_account_events.sql','0008_event_details.sql','0009_account_period_insights.sql','0010_reconciliation_candidates.sql','0011_saved_reconciliation.sql','0012_statement_archive.sql','0013_statement_evidence.sql','0014_manual_operations.sql','0015_workspace_admin.sql','0016_receipt_evidence.sql','0017_bank_booking.sql','0018_statement_periods.sql','0019_cash_basis_reads.sql','0020_accountant_reports.sql','0021_parts_register.sql','0022_statement_handoff.sql','0023_purchase_search.sql','0024_receipt_statement_categories.sql','0025_crm_status.sql'])
    await db.exec(readFileSync(`db/migrations/${name}`,'utf8'));
  const {hashPassword}=await import('better-auth/crypto');
  const id=randomUUID(),workspace=randomUUID(),account=randomUUID(),localUser=randomUUID();
  const password='Synthetic-only-2468!',email='demo@nestwise.test';
  await db.query('INSERT INTO nestwise_auth."user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)',[id,'Demo owner',email]);
  await db.query(`INSERT INTO nestwise_auth.account(id,"accountId","providerId","userId",password,"updatedAt")
    VALUES ($1,$2,'credential',$2,$3,now())`,[randomUUID(),id,await hashPassword(password)]);
  await db.query("INSERT INTO nestwise.users VALUES ($1,$2)",[localUser,`better-auth:${id}`]);
  await db.query("INSERT INTO nestwise.workspaces VALUES ($1,'Demo business','business')",[workspace]);
  await db.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'Demo clearing')",[account,workspace]);
  await db.query("INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true)",[workspace,localUser]);
  const env={ENVIRONMENT:'development',AUTH_ENABLED:'true',AUTH_DATABASE_URL:'memory-only',
    NESTWISE_DATABASE_URL:'memory-only',AUTH_SECRET:randomBytes(32).toString('hex'),
    AUTH_BASE_URL:'http://localhost:8083',AUTH_WEB_ORIGIN:'http://localhost:8081'};
  const {createAuth}=require('../.test-build/worker/auth.js');
  const {authConfiguration,userApi}=require('../.test-build/worker/user-api.js');
  const auth=await createAuth(authConfiguration(env),pool);
  const ledger=()=>({
    purchaseCandidates:async(...args)=>(await db.query('SELECT nestwise.purchase_candidates($1,$2,$3,$4,$5,$6,$7) result',args)).rows[0].result,
    readParts:async(...args)=>(await db.query('SELECT nestwise.read_parts($1,$2,$3) result',args)).rows[0].result,
    partsCommand:async(subject,workspace,account,data)=>(await db.query('SELECT nestwise.parts_command($1,$2,$3,$4) result',[subject,workspace,account,JSON.stringify(data)])).rows[0].result,
    cancelOwnerExpense:async(subject,workspace,account,data)=>(await db.query('SELECT nestwise.cancel_owner_expense($1,$2,$3,$4) result',[subject,workspace,account,JSON.stringify(data)])).rows[0].result,
    ownerExpense:async(subject,workspace,account,data,settle)=>(await db.query(settle?'SELECT nestwise.settle_owner_expense($1,$2,$3,$4) result':'SELECT nestwise.link_owner_expense($1,$2,$3,$4) result',[subject,workspace,account,JSON.stringify(data)])).rows[0].result,
    reportInput:async(...args)=>(await db.query('SELECT nestwise.report_input($1,$2,$3,$4,$5) result',args)).rows[0].result,
    proposeReportMapping:async(subject,workspace,account,data)=>(await db.query('SELECT nestwise.propose_report_mapping($1,$2,$3,$4) result',[subject,workspace,account,JSON.stringify(data)])).rows[0].result,
    saveReportSnapshot:async(...args)=>(await db.query('SELECT nestwise.save_report_snapshot($1,$2,$3,$4,$5,$6,$7) result',args)).rows[0].result,
    readReportSnapshots:async(...args)=>(await db.query('SELECT nestwise.read_report_snapshots($1,$2,$3,$4) result',args)).rows[0].result,
    saveStatementPeriod:async(subject,workspace,account,hash,id,expected,data,checks)=>(await db.query('SELECT nestwise.save_statement_period($1,$2,$3,$4,$5,$6,$7,$8) result',[subject,workspace,account,hash,id,expected,JSON.stringify(data),JSON.stringify(checks)])).rows[0].result,
    readStatementPeriods:async(...args)=>(await db.query('SELECT nestwise.read_statement_periods($1,$2,$3,$4) result',args)).rows[0].result,
    postBankRow:async(subject,workspace,account,id,hash,row,operation)=>(await db.query('SELECT nestwise.post_bank_row($1,$2,$3,$4,$5,$6,$7) result',[subject,workspace,account,id,hash,JSON.stringify(row),JSON.stringify(operation)])).rows[0].result,
    claimReceiptOcr:async(...args)=>(await db.query('SELECT nestwise.claim_receipt_ocr($1,$2,$3,$4) result',args)).rows[0].result,
    prepareReceipt:async(...args)=>(await db.query('SELECT nestwise.prepare_receipt($1,$2,$3,$4,$5,$6) result',args)).rows[0].result,
    completeReceipt:async(...args)=>(await db.query('SELECT nestwise.complete_receipt($1,$2,$3,$4) result',args)).rows[0].result,
    readReceipts:async(subject,workspace,account,hash,before=null)=>(await db.query('SELECT nestwise.read_receipts($1,$2,$3,$4,$5) result',[subject,workspace,account,hash,before])).rows[0].result,
    reviewReceipt:async(subject,workspace,account,hash,id,expected,data)=>(await db.query('SELECT nestwise.review_receipt($1,$2,$3,$4,$5,$6,$7) result',[subject,workspace,account,hash,id,expected,JSON.stringify(data)])).rows[0].result,
    postReceipt:async(...args)=>{const allocations=args.pop();return (await db.query(allocations?'SELECT nestwise.post_receipt_categorized($1,$2,$3,$4,$5,$6,$7,$8) result':'SELECT nestwise.post_receipt($1,$2,$3,$4,$5,$6,$7) result',allocations?[...args,JSON.stringify(allocations)]:args)).rows[0].result;},
    workspaceCommand:async(subject,workspace,payload)=>(await db.query('SELECT nestwise.workspace_command($1,$2,$3) result',[subject,workspace,JSON.stringify(payload)])).rows[0].result,
    workspaceAdministration:async(...args)=>(await db.query('SELECT nestwise.workspace_administration($1,$2) result',args)).rows[0].result,
    postManualOperation:async(subject,workspace,account,payload)=>(await db.query('SELECT nestwise.post_manual_operation($1,$2,$3,$4) result',[subject,workspace,account,JSON.stringify(payload)])).rows[0].result,
    documentEvidence:async(subject,workspace,account,hash,fingerprints)=>(await db.query('SELECT nestwise.document_evidence($1,$2,$3,$4,$5) result',[subject,workspace,account,hash,JSON.stringify(fingerprints)])).rows[0].result,
    documentAccess:async(...args)=>(await db.query('SELECT nestwise.document_access($1,$2,$3,$4) result',args)).rows[0].result,
    prepareDocument:async(...args)=>(await db.query('SELECT nestwise.prepare_document($1,$2,$3,$4,$5) result',args)).rows[0].result,
    completeDocument:async(...args)=>(await db.query('SELECT nestwise.complete_document($1,$2,$3,$4) result',args)).rows[0].result,
    readDocuments:async(...args)=>(await db.query('SELECT nestwise.read_documents($1,$2,$3) result',args)).rows[0].result,
    readReconciliations:async(...args)=>(await db.query('SELECT nestwise.read_reconciliations($1,$2,$3,$4) result',args)).rows[0].result,
    saveReconciliation:async(...args)=>(await db.query('SELECT nestwise.save_reconciliation($1,$2,$3,$4) result',args)).rows[0].result,
    cancelReconciliation:async(...args)=>(await db.query('SELECT nestwise.cancel_reconciliation($1,$2,$3,$4,$5) result',args)).rows[0].result,
    userReconciliationCandidates:async(...args)=>(await db.query('SELECT nestwise.user_reconciliation_candidates($1,$2,$3,$4,$5,$6) result',args)).rows[0].result,
    userCashInsights:async(...args)=>(await db.query('SELECT nestwise.user_cash_insights($1,$2,$3,$4,$5) result',args)).rows[0].result,
    userPeriodInsights:async(...args)=>(await db.query('SELECT nestwise.user_period_insights($1,$2,$3,$4,$5) result',args)).rows[0].result,
    userEventDetail:async(...args)=>(await db.query('SELECT nestwise.user_event_detail($1,$2,$3,$4,$5) result',args)).rows[0].result,
    userAccountEvents:async(...args)=>(await db.query('SELECT nestwise.user_account_events($1,$2,$3,$4,$5,$6) result',args)).rows[0].result,
    userCrmStatus:async(...args)=>(await db.query('SELECT nestwise.user_crm_status($1,$2,$3) result',args)).rows[0].result,
    userAccess:async subject=>(await db.query('SELECT nestwise.user_access($1) result',[subject])).rows[0].result,
    userJournal:async(...args)=>(await db.query('SELECT nestwise.user_journal($1,$2,$3) result',args)).rows[0].result,
    userJournalDetail:async(...args)=>(await db.query('SELECT nestwise.user_journal_detail($1,$2,$3,$4,$5) result',args)).rows[0].result,
    userJournalPage:async(subject,workspace,account,filters,cursor)=>(await db.query(
      filters.basis==='paid'?'SELECT nestwise.user_cash_journal_page($1,$2,$3,$4,$5,$6,$7,$8,$9) result':'SELECT nestwise.user_journal_page($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
      [subject,workspace,account,filters.query,filters.from||null,filters.to||null,filters.code,filters.order,cursor])).rows[0].result,
  });
  const invitationStore=()=>({
    check:async(...args)=>(await db.query('SELECT nestwise_auth.check_invitation($1,$2) valid',args)).rows[0].valid,
    accept:async(...args)=>(await db.query('SELECT nestwise_auth.accept_invitation($1,$2) email',args)).rows[0].email,
  });
  return {db,auth,env,id,workspace,account,email,password,
    fetch:(request,override=env)=>userApi(request,override,async()=>({auth,close:async()=>{}}),ledger,invitationStore)};
}
module.exports={createAuthFixture};
