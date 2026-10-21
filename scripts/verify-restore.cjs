const { Client } = require('pg');
const { createHash } = require('node:crypto');
const assert=require('node:assert/strict');
async function fingerprint(client) {
  const tables=(await client.query("SELECT schemaname,tablename FROM pg_tables WHERE schemaname IN ('nestwise','nestwise_auth') ORDER BY schemaname,tablename")).rows;
  const output={};
  for(const {schemaname,tablename} of tables) {
    if(!/^[a-zA-Z_]+$/.test(tablename)) throw new Error('Unexpected identifier');
    const rows=(await client.query(`SELECT to_jsonb(t)::text row FROM "${schemaname}"."${tablename}" t ORDER BY to_jsonb(t)::text`)).rows;
    output[schemaname==='nestwise'?tablename:`${schemaname}.${tablename}`]={count:rows.length,sha256:createHash('sha256').update(JSON.stringify(rows)).digest('hex')};
  }
  return output;
}
async function verifyRestore(source,restored,runtime=restored) {
  const expected=await fingerprint(source);
  assert.ok(expected.journal_entries?.count>0,'Recovery proof requires populated financial evidence');
  assert.deepEqual(await fingerprint(restored),expected);
  const migrations='SELECT version,sha256,applied_at FROM public.nestwise_schema_migrations ORDER BY version';
  assert.deepEqual((await restored.query(migrations)).rows,(await source.query(migrations)).rows);
  // A canceled matching decision must not erase the permanent bank posting origin.
  const bankProof=expected.bank_bookings?.count?(await restored.query(`SELECT b.*,u.subject FROM nestwise.bank_bookings b
    JOIN nestwise.users u ON u.id=b.actor JOIN nestwise.reconciliation_cancellations c ON c.group_id=b.reconciliation_id LIMIT 1`)).rows[0]:null;
  if(bankProof){
    await runtime.query('BEGIN');
    try{
      if(runtime===restored)await runtime.query('SET LOCAL ROLE nestwise_api');
      const retry=(await runtime.query('SELECT nestwise.post_bank_row($1,$2,$3,$4,$5,$6,$7) id',
        [bankProof.subject,bankProof.workspace_id,bankProof.account_id,bankProof.id,bankProof.file_hash,bankProof.row_data,bankProof.operation_data])).rows[0];
      assert.equal(retry.id,bankProof.id);
    }finally{await runtime.query('ROLLBACK');}
  }
  // Every permission probe is rolled back even if a broken control permits it.
  async function rejected(query,pattern,role) {
    const client=role?runtime:restored;
    await client.query('BEGIN');
    try {
      if(role && runtime===restored) await client.query('SET LOCAL ROLE nestwise_api');
      await assert.rejects(client.query(query),pattern);
    } finally {await client.query('ROLLBACK');}
  }
  await rejected('SELECT * FROM nestwise.journal_entries',/permission denied/,true);
  await rejected('DELETE FROM nestwise.journal_entries',/immutable_financial_history/);
  await rejected('UPDATE nestwise.journal_transactions SET posted_at=now()',/immutable_financial_history/);
  await rejected('DELETE FROM nestwise.audit_logs',/immutable_financial_history/);
  if(expected.manual_operations?.count){
    await rejected('DELETE FROM nestwise.manual_operations',/immutable_financial_history/);
    await rejected('SELECT * FROM nestwise.manual_operations',/permission denied/,true);
  }
  if(expected.workspace_admin_audit?.count){
    await rejected('DELETE FROM nestwise.workspace_admin_audit',/immutable_financial_history/);
    await rejected('SELECT * FROM nestwise.workspace_admin_audit',/permission denied/,true);
  }
  for(const table of ['receipt_originals','receipt_archived','receipt_reviews','receipt_postings','bank_bookings','statement_periods','report_mappings','report_snapshots','owner_expense_links','owner_expense_settlements','owner_expense_cancellations']){
    if(expected[table]?.count){
      await rejected(`DELETE FROM nestwise.${table}`,/immutable_financial_history/);
      await rejected(`SELECT * FROM nestwise.${table}`,/permission denied/,true);
    }
  }
  if(expected.reconciliation_groups?.count){
    await rejected('DELETE FROM nestwise.reconciliation_groups',/immutable_financial_history/);
    await rejected('SELECT * FROM nestwise.reconciliation_groups',/permission denied/,true);
  }
  if(expected.reconciliation_cancellations?.count)await rejected('DELETE FROM nestwise.reconciliation_cancellations',/immutable_financial_history/);
  if(expected.statement_documents?.count){
    await rejected('DELETE FROM nestwise.statement_documents',/immutable_financial_history/);
    await rejected('SELECT * FROM nestwise.statement_documents',/permission denied/,true);
  }
  if(expected.statement_archived?.count)await rejected('DELETE FROM nestwise.statement_archived',/immutable_financial_history/);
  await rejected('DELETE FROM nestwise.source_events',/immutable_source_event/);
  const revoked=(await restored.query(`SELECT s.token_hash,m.workspace_id,a.id account_id
    FROM nestwise.sessions s JOIN nestwise.memberships m ON m.user_id=s.user_id
    JOIN nestwise.financial_accounts a ON a.workspace_id=m.workspace_id
    WHERE s.revoked_at IS NOT NULL LIMIT 1`)).rows[0];
  if(revoked) {
    await runtime.query('BEGIN');
    try {
      if(runtime===restored) await runtime.query('SET LOCAL ROLE nestwise_api');
      await assert.rejects(runtime.query('SELECT nestwise.read_journal($1,$2,$3)',
        [revoked.token_hash,revoked.workspace_id,revoked.account_id]),/unauthorized/);
    } finally {await runtime.query('ROLLBACK');}
  }
  assert.deepEqual(await fingerprint(restored),expected,'Verification must not change restored data');
  return {tables:Object.keys(expected).length,rows:Object.fromEntries(Object.entries(expected).map(([name,value])=>[name,value.count])),
    fingerprintsMatch:true,migrationsMatch:true,permissionsPreserved:true,immutableHistory:true,
    revokedSessionRejected:!!revoked};
}
module.exports={fingerprint,verifyRestore};
if(require.main===module) (async()=>{
  const source=new Client({connectionString:process.env.TEST_DATABASE_URL});
  const restoredUrl=new URL(process.env.TEST_DATABASE_URL);
  if(!['localhost','127.0.0.1'].includes(restoredUrl.hostname)||restoredUrl.pathname!=='/nestwise_test') throw new Error('Restore verification must be local and disposable');
  restoredUrl.pathname='/nestwise_restore';
  const restored=new Client({connectionString:restoredUrl.href});
  try {
    await source.connect(); await restored.connect();
    await verifyRestore(source,restored);
    console.log('Restore verified: every Nestwise table matches; privileges and immutable-history triggers preserved.');
  } finally {await source.end(); await restored.end();}
})().catch(()=>{console.error('Restore verification failed.');process.exitCode=1;});
