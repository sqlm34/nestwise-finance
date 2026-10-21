// Synthetic evidence only. Never accepts a CRM or production database.
const assert = require('node:assert/strict');
const { randomUUID, randomBytes, createHash } = require('node:crypto');
async function verifyStaging(owner, runtime) {
  const identity = (await owner.query('SELECT current_database() db, to_regclass(\'public.jobs\') crm')).rows[0];
  assert.equal(identity.db, 'nestwise_staging');
  assert.equal(identity.crm, null);
  const runtimeIdentity = (await runtime.query('SELECT current_database() db, current_user role')).rows[0];
  assert.equal(runtimeIdentity.db, 'nestwise_staging');
  assert.equal(runtimeIdentity.role, 'nestwise_worker');
  const role = (await owner.query(`SELECT rolsuper,rolcreatedb,rolcreaterole,rolreplication,rolbypassrls
    FROM pg_roles WHERE rolname='nestwise_worker'`)).rows[0];
  assert.ok(Object.values(role).every(value => value === false));
  const privileges = (await runtime.query(`SELECT
    has_schema_privilege(current_user,'nestwise','CREATE') schema_create,
    has_schema_privilege(current_user,'public','CREATE') public_create,
    has_database_privilege(current_user,current_database(),'CREATE') database_create,
    has_table_privilege(current_user,'nestwise.journal_entries','SELECT') direct_read,
    has_table_privilege(current_user,'nestwise.journal_entries','INSERT') direct_write`)).rows[0];
  assert.ok(Object.values(privileges).every(value => value === false));
  const workspace=randomUUID(), account=randomUUID(), user=randomUUID();
  const connection=`smoke-${randomUUID()}`, order=`SYNTHETIC-${randomUUID()}`;
  const tokenHash=createHash('sha256').update(randomBytes(32)).digest('hex');
  await owner.query('BEGIN');
  try {
    await owner.query("INSERT INTO nestwise.workspaces VALUES ($1,'SYNTHETIC staging verification','business')",[workspace]);
    await owner.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'SYNTHETIC clearing')",[account,workspace]);
    await owner.query('INSERT INTO nestwise.users VALUES ($1,$2)',[user,`synthetic:${user}`]);
    await owner.query("INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true)",[workspace,user]);
    await owner.query("INSERT INTO nestwise.sessions VALUES ($1,$2,now()+interval '10 minutes',NULL)",[tokenHash,user]);
    await owner.query('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)',[connection,workspace,account]);
    await owner.query('COMMIT');
  } catch(error) { await owner.query('ROLLBACK'); throw error; }
  try {
    const time=new Date().toISOString();
    const payment={schema_version:1,source_event_id:randomUUID(),source_order_id:order,
      source_fact_id:randomUUID(),order_revision:1,type:'job.payment_recorded',currency:'USD',
      occurred_at:time,paid_at:time,amount_cents:35000};
    const part={...payment,source_event_id:randomUUID(),source_fact_id:randomUUID(),
      order_revision:2,type:'job.part_cost_recorded',amount_cents:9500,settlement:'paid'};
    const refund={...payment,source_event_id:randomUUID(),source_fact_id:randomUUID(),
      order_revision:3,type:'job.customer_refund_issued',reference_event_id:payment.source_event_id};
    const accept=async event=>(await runtime.query('SELECT nestwise.accept_event($1,$2,$3,$4) result',
      [connection,randomUUID(),Math.floor(Date.now()/1000),JSON.stringify(event)])).rows[0].result;
    assert.equal((await accept(refund)).status,'waiting');
    assert.equal((await accept(payment)).status,'posted');
    assert.equal((await accept(part)).status,'posted');
    assert.equal((await accept(refund)).duplicate,true);
    const journal=(await runtime.query('SELECT nestwise.read_journal($1,$2,$3) result',[tokenHash,workspace,account])).rows[0].result;
    assert.equal(journal.length,3);
    await assert.rejects(runtime.query('SELECT * FROM nestwise.journal_entries'),/permission denied/);
    await assert.rejects(runtime.query('SELECT nestwise.read_journal($1,$2,$3)',[tokenHash,randomUUID(),account]),/forbidden/);
    const totals=(await owner.query(`SELECT code,sum(cents)::text cents FROM nestwise.journal_entries
      WHERE workspace_id=$1 GROUP BY code ORDER BY code`,[workspace])).rows;
    assert.deepEqual(totals,[
      {code:'clearing',cents:'-9500'},{code:'parts_cost',cents:'9500'},
      {code:'receipts',cents:'-35000'},{code:'refunds',cents:'35000'},
    ]);
    return {synthetic:true,workspace,account,connection,transactions:3,deliveries:4,
      totals,restrictedRole:true,duplicateRejected:true,outOfOrderResolved:true};
  } finally {
    // Preserve financial evidence; revoke the disposable session and sender.
    await owner.query('UPDATE nestwise.sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash]);
    await owner.query('UPDATE nestwise.source_connections SET enabled=false WHERE id=$1',[connection]);
  }
}
module.exports={verifyStaging};
if(require.main===module) {
  const {Client}=require('pg');
  const owner=new Client({connectionString:process.env.NESTWISE_MIGRATION_URL});
  const runtime=new Client({connectionString:process.env.NESTWISE_RUNTIME_URL});
  (async()=>{
    if(process.env.NESTWISE_SMOKE_CONFIRM!=='synthetic-staging-only' ||
      !process.env.NESTWISE_MIGRATION_URL || !process.env.NESTWISE_RUNTIME_URL)
      throw new Error('Explicit staging credentials and confirmation required');
    const ownerUrl=new URL(process.env.NESTWISE_MIGRATION_URL);
    const runtimeUrl=new URL(process.env.NESTWISE_RUNTIME_URL);
    assert.equal(ownerUrl.hostname,runtimeUrl.hostname);
    assert.equal(ownerUrl.pathname,'/nestwise_staging');
    assert.equal(runtimeUrl.pathname,'/nestwise_staging');
    await owner.connect(); await runtime.connect();
    console.log(JSON.stringify(await verifyStaging(owner,runtime),null,2));
  })().catch(()=>{console.error('Staging verification failed; no credentials logged.');process.exitCode=1;})
    .finally(async()=>{await owner.end();await runtime.end();});
}
