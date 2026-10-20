const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { validateEvent } = require('../.test-build/worker/contract.js');
let db;
const workspace = randomUUID(), otherWorkspace = randomUUID(), account = randomUUID(), otherAccount = randomUUID();
const user = randomUUID(), accountant = randomUUID();
const tokenHash = createHash('sha256').update('synthetic-session').digest('hex');
const accountantHash = createHash('sha256').update('synthetic-accountant').digest('hex');
const sql = async (q, p = []) => (await db.query(q, p)).rows;
const money = (order, revision, type, amount = 35000, extra = {}) => ({
  schema_version: 1, source_event_id: randomUUID(), source_order_id: order,
  source_fact_id: randomUUID(), order_revision: revision, type, currency: 'USD',
  occurred_at: '2026-10-19T12:00:00Z', paid_at: '2026-10-19T12:00:00Z',
  amount_cents: amount, ...extra,
});
const assertion = (order, revision, type, extra = {}) => {
  const e = money(order, revision, type, 0, { paid_at: null, ...extra });
  delete e.amount_cents; return e;
};
async function accept(e, nonce = randomUUID()) {
  validateEvent(e);
  return (await sql('SELECT nestwise.accept_event($1,$2,$3,$4) result',
    ['crm-test', nonce, Math.floor(Date.now() / 1000), JSON.stringify(e)]))[0].result;
}
async function totals(order) {
  return Object.fromEntries((await sql(`SELECT je.code,sum(je.cents)::text amount FROM nestwise.journal_entries je
    JOIN nestwise.journal_transactions jt ON jt.id=je.transaction_id
    JOIN nestwise.source_events se ON se.id=jt.event_id WHERE se.source_order_id=$1 GROUP BY je.code`, [order]))
    .map(r => [r.code, Number(r.amount)]));
}
before(async () => {
  if (process.env.TEST_DATABASE_URL) {
    const url = new URL(process.env.TEST_DATABASE_URL);
    assert.ok(['localhost','127.0.0.1'].includes(url.hostname) && url.pathname === '/nestwise_test',
      'Database tests only target a disposable local nestwise_test database');
    const { Client } = require('pg');
    db = new Client({ connectionString: url.href }); await db.connect();
  } else {
    const { PGlite } = require('@electric-sql/pglite');
    db = new PGlite(); await db.waitReady;
  }
  const migration = readFileSync('db/migrations/0001_ledger.sql', 'utf8');
  if (db.exec) {
    await db.exec(migration);
    await db.exec(readFileSync('db/migrations/0003_user_access.sql','utf8'));
  }
  else {
    const { migrate }=require('../scripts/migrate.cjs');
    await migrate(db); await migrate(db);
    assert.equal((await sql('SELECT count(*)::int n FROM public.nestwise_schema_migrations'))[0].n,4);
  }
  await sql('INSERT INTO nestwise.workspaces VALUES ($1,$2,$3),($4,$5,$6)', [workspace,'LLC test','business',otherWorkspace,'Family test','family']);
  await sql('INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,$3),($4,$5,$6)', [account,workspace,'Clearing test',otherAccount,otherWorkspace,'Private test']);
  await sql('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)', ['crm-test',workspace,account]);
  await sql('INSERT INTO nestwise.users VALUES ($1,$2),($3,$4)', [user,'test-owner',accountant,'test-accountant']);
  await sql(`INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true),($1,$3,'accountant',false)`, [workspace,user,accountant]);
  await sql(`INSERT INTO nestwise.sessions VALUES ($1,$2,now()+interval '1 hour',NULL),($3,$4,now()+interval '1 hour',NULL)`, [tokenHash,user,accountantHash,accountant]);
});
after(async () => { if (db?.close) await db.close(); else if (db) await db.end(); });

test('full payment and matching finalized snapshot do not post revenue twice', async () => {
  const order = randomUUID();
  assert.equal((await accept(money(order,1,'job.payment_recorded'))).status,'posted');
  const close = assertion(order,2,'job.financials_finalized',{totals:{payments_cents:35000,refunds_cents:0,parts_net_cents:0,fees_net_cents:0}});
  assert.equal((await accept(close)).status,'asserted');
  assert.deepEqual(await totals(order),{clearing:35000,receipts:-35000});
});
test('partial payments preserve separate paid_at dates', async () => {
  const order = randomUUID();
  await accept(money(order,1,'job.payment_recorded',10000,{paid_at:'2026-10-17T12:00:00Z'}));
  await accept(money(order,2,'job.payment_recorded',25000));
  const dates = await sql(`SELECT count(DISTINCT jt.paid_at)::int n FROM nestwise.journal_transactions jt
    JOIN nestwise.source_events e ON e.id=jt.event_id WHERE e.source_order_id=$1`,[order]);
  assert.equal(dates[0].n,2); assert.equal((await totals(order)).receipts,-35000);
});
test('full customer refund retains nonreturnable parts cost', async () => {
  const order = randomUUID(), payment = money(order,1,'job.payment_recorded');
  await accept(payment); await accept(money(order,2,'job.part_cost_recorded',9500,{settlement:'paid'}));
  await accept(money(order,3,'job.customer_refund_issued',35000,{reference_event_id:payment.source_event_id}));
  assert.deepEqual(await totals(order),{clearing:-9500,receipts:-35000,refunds:35000,parts_cost:9500});
});
test('partial refunds are limited by the original payment', async () => {
  const order=randomUUID(), payment=money(order,1,'job.payment_recorded'); await accept(payment);
  await accept(money(order,2,'job.customer_refund_issued',10000,{reference_event_id:payment.source_event_id}));
  assert.equal((await accept(money(order,3,'job.customer_refund_issued',25001,{reference_event_id:payment.source_event_id.toUpperCase()}))).status,'needs_review');
  assert.equal((await totals(order)).refunds,10000);
});
test('supplier credit reverses parts cost, never customer refund or revenue', async () => {
  const order=randomUUID(), part=money(order,1,'job.part_cost_recorded',9500,{settlement:'paid'}); await accept(part);
  await accept(money(order,2,'job.supplier_credit_received',9500,{reference_event_id:part.source_event_id}));
  assert.deepEqual(await totals(order),{clearing:0,parts_cost:0});
});
test('processor fee refund remains separate from customer receipts', async () => {
  const order=randomUUID(), fee=money(order,1,'job.processor_fee_recorded',1250); await accept(fee);
  await accept(money(order,2,'job.processor_fee_refunded',1250,{reference_event_id:fee.source_event_id}));
  assert.deepEqual(await totals(order),{clearing:0,fees:0});
});
test('reopen and reclose append assertions without additional financial entries', async () => {
  const order=randomUUID(), totals={payments_cents:35000,refunds_cents:0,parts_net_cents:0,fees_net_cents:0};
  await accept(money(order,1,'job.payment_recorded'));
  await accept(assertion(order,2,'job.financials_finalized',{totals}));
  await accept(assertion(order,3,'job.reopened'));
  await accept(assertion(order,4,'job.financials_finalized',{totals}));
  assert.equal((await sql('SELECT applied_revision FROM nestwise.crm_orders_shadow WHERE source_order_id=$1',[order]))[0].applied_revision,4);
  assert.equal((await sql(`SELECT count(*)::int n FROM nestwise.journal_transactions jt
    JOIN nestwise.source_events e ON e.id=jt.event_id WHERE e.source_order_id=$1`,[order]))[0].n,1);
});
test('out-of-order delivery retains unseen earlier payments and drains in order', async () => {
  const order=randomUUID(), first=money(order,1,'job.payment_recorded',100), second=money(order,2,'job.payment_recorded',200);
  assert.equal((await accept(second)).status,'waiting');
  assert.equal((await accept(first)).status,'posted');
  assert.equal((await accept(second)).status,'posted'); assert.equal((await totals(order)).receipts,-300);
});
test('duplicate event IDs, fact IDs, revisions and nonce replay cannot post twice', async () => {
  const event=money(randomUUID(),1,'job.payment_recorded'), nonce=randomUUID();
  await accept(event,nonce);
  await assert.rejects(accept(event,nonce),/replayed_request/);
  assert.equal((await accept(event)).duplicate,true);
  await assert.rejects(accept({...event,amount_cents:999}),/event_payload_conflict/);
  await assert.rejects(accept({...event,source_event_id:randomUUID()}),/unique constraint/);
  await assert.rejects(accept({...event,source_event_id:randomUUID(),order_revision:2}),/unique constraint/);
  assert.equal((await totals(event.source_order_id)).receipts,-35000);
});
test('late bank deposit evidence remains preview-only with no ledger write route', async () => {
  const { previewStatement } = require('../.test-build/src/domain/statement.js');
  const order=randomUUID(); await accept(money(order,1,'job.payment_recorded',10000)); await accept(money(order,2,'job.payment_recorded',20000));
  const before=await totals(order);
  const preview=previewStatement('Date,Description,Amount\n2026-10-20,STRIPE BATCH,300.00\n','chase','Test 1234');
  assert.equal(preview.creditsCents,30000); assert.deepEqual(await totals(order),before);
});
test('cost corrections append deltas, preserve original entries, and prevent branching', async () => {
  const order=randomUUID(), part=money(order,1,'job.part_cost_recorded',9500,{settlement:'paid'}); await accept(part);
  const correction=money(order,2,'job.cost_corrected',7500,{reference_event_id:part.source_event_id,paid_at:null});
  await accept(correction); assert.equal((await totals(order)).parts_cost,7500);
  await accept(money(order,3,'job.cost_corrected',0,{reference_event_id:correction.source_event_id,paid_at:null}));
  assert.equal((await totals(order)).parts_cost,0);
  await assert.rejects(sql('UPDATE nestwise.journal_entries SET cents=1'),/immutable_financial_history/);
  await assert.rejects(sql('DELETE FROM nestwise.journal_transactions'),/immutable_financial_history/);
  await assert.rejects(sql(`UPDATE nestwise.source_events SET payload='{}'`),/immutable_source_event/);
  const transaction=(await sql('SELECT id FROM nestwise.journal_transactions LIMIT 1'))[0].id;
  await assert.rejects(sql(`INSERT INTO nestwise.journal_entries VALUES
    ($1,$2,10,'clearing',100),($1,$2,11,'receipts',-100)`,[transaction,workspace]),/journal_already_sealed/);
});
test('accrued part costs are separate from paid cash movement', async () => {
  const order=randomUUID(), part=money(order,1,'job.part_cost_recorded',12345,{settlement:'accrued',paid_at:null});
  await accept(part);
  assert.deepEqual(await totals(order),{parts_cost:12345,parts_payable:-12345});
  await accept(money(order,2,'job.supplier_credit_received',12345,{reference_event_id:part.source_event_id,paid_at:null}));
  assert.deepEqual(await totals(order),{parts_cost:0,parts_payable:0});
});
test('mismatched snapshot blocks later revisions and preserves accepted evidence', async () => {
  const order=randomUUID(); await accept(money(order,1,'job.payment_recorded',100));
  const close=assertion(order,2,'job.financials_finalized',{totals:{payments_cents:101,refunds_cents:0,parts_net_cents:0,fees_net_cents:0}});
  assert.equal((await accept(close)).status,'needs_review');
  assert.equal((await accept(money(order,3,'job.payment_recorded',200))).status,'waiting');
  await sql('SELECT nestwise.process_pending()');
  assert.equal((await totals(order)).receipts,-100);
});
test('database requires every journal transaction to balance', async () => {
  const order=randomUUID(); await accept(money(order,2,'job.payment_recorded'));
  const event=(await sql('SELECT id FROM nestwise.source_events WHERE source_order_id=$1',[order]))[0].id;
  await assert.rejects(sql(`INSERT INTO nestwise.journal_transactions(workspace_id,account_id,event_id,occurred_at)
    VALUES ($1,$2,$3,now())`,[workspace,account,event]),/unbalanced_journal/);
});
test('session identity, workspace and account grants are enforced by SQL functions', async () => {
  await sql('SET ROLE nestwise_api');
  try {
    assert.equal((await accept(money(randomUUID(),1,'job.payment_recorded',101))).status,'posted');
    const result=(await sql('SELECT nestwise.read_journal($1,$2,$3) data',[tokenHash,workspace,account]))[0].data;
    assert.ok(result.length>0);
    assert.equal(require('../.test-build/src/domain/journal.js').parseJournal({entries:result,limit:100}).entries.length,result.length);
    await assert.rejects(sql('SELECT * FROM nestwise.journal_entries'),/permission denied/);
    await assert.rejects(sql('SELECT nestwise.read_journal($1,$2,$3)',[tokenHash,otherWorkspace,otherAccount]),/forbidden/);
    await assert.rejects(sql('SELECT nestwise.read_journal($1,$2,$3)',[accountantHash,workspace,account]),/forbidden/);
    await assert.rejects(sql('SELECT nestwise.read_journal($1,$2,$3)',['0'.repeat(64),workspace,account]),/unauthorized/);
  } finally { await sql('RESET ROLE'); }
  await sql('INSERT INTO nestwise.account_grants VALUES ($1,$2,$3)',[workspace,accountant,account]);
  assert.ok((await sql('SELECT nestwise.read_journal($1,$2,$3) data',[accountantHash,workspace,account]))[0].data.length>0);
  await sql('UPDATE nestwise.sessions SET revoked_at=now() WHERE token_hash=$1',[accountantHash]);
  await assert.rejects(sql('SELECT nestwise.read_journal($1,$2,$3)',[accountantHash,workspace,account]),/unauthorized/);
});
test('real PostgreSQL serializes simultaneous duplicate deliveries', {skip:!process.env.TEST_DATABASE_URL}, async () => {
  const { Client }=require('pg'), clients=[new Client({connectionString:process.env.TEST_DATABASE_URL}),new Client({connectionString:process.env.TEST_DATABASE_URL})];
  const event=money(randomUUID(),1,'job.payment_recorded',7500);
  await Promise.all(clients.map(c=>c.connect()));
  try {
    const results=await Promise.all(clients.map(c=>c.query('SELECT nestwise.accept_event($1,$2,$3,$4) result',
      ['crm-test',randomUUID(),Math.floor(Date.now()/1000),JSON.stringify(event)])));
    assert.deepEqual(results.map(r=>r.rows[0].result.duplicate).sort(),[false,true]);
    assert.equal((await totals(event.source_order_id)).receipts,-7500);
  } finally { await Promise.all(clients.map(c=>c.end())); }
});
test('authenticated subjects receive only assigned workspaces and accounts',async()=>{
  await sql('SET ROLE nestwise_api');
  try {
    assert.deepEqual((await sql('SELECT nestwise.user_access($1) result',['unknown']))[0].result,[]);
    const access=(await sql('SELECT nestwise.user_access($1) result',['test-owner']))[0].result;
    assert.equal(access.length,1); assert.equal(access[0].id,workspace);
    assert.equal(access[0].accounts.length,1); assert.equal(access[0].accounts[0].id,account);
    assert.ok((await sql('SELECT nestwise.user_journal($1,$2,$3) result',['test-owner',workspace,account]))[0].result.length>0);
    await assert.rejects(sql('SELECT nestwise.user_journal($1,$2,$3)',['test-owner',otherWorkspace,otherAccount]),/forbidden/);
    await assert.rejects(sql('SELECT * FROM nestwise_auth.account'),/permission denied|does not exist/);
  } finally {await sql('RESET ROLE');}
});
test('PostgreSQL invitations are single-use under concurrent restricted-role activation', {skip:!process.env.TEST_DATABASE_URL},async()=>{
  const {issueInvitation}=require('../scripts/issue-invitation.cjs');
  const invitation=await issueInvitation(db,{email:`${randomUUID()}@nestwise.test`,name:'CI invited user',workspace});
  const hash=createHash('sha256').update(invitation.token).digest('hex');
  const {hashPassword}=await import('better-auth/crypto');
  const passwordHash=await hashPassword('Synthetic CI activation 42!');
  const {Client}=require('pg');
  const clients=[new Client({connectionString:process.env.TEST_DATABASE_URL}),new Client({connectionString:process.env.TEST_DATABASE_URL})];
  await Promise.all(clients.map(c=>c.connect()));
  try {
    await Promise.all(clients.map(c=>c.query('SET ROLE nestwise_auth_api')));
    const results=await Promise.allSettled(clients.map(c=>c.query('SELECT nestwise_auth.accept_invitation($1,$2)',[hash,passwordHash])));
    assert.equal(results.filter(r=>r.status==='fulfilled').length,1);
    assert.match(results.find(r=>r.status==='rejected').reason.message,/invalid_invitation/);
    await assert.rejects(clients[0].query('SELECT * FROM nestwise_auth.invitations'),/permission denied/);
    const access=(await sql('SELECT nestwise.user_access($1) result',[`better-auth:${invitation.user}`]))[0].result;
    assert.equal(access[0].role,'member');assert.deepEqual(access[0].accounts,[]);
  } finally {await Promise.all(clients.map(c=>c.end()));}
});
