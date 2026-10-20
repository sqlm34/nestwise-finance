const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { randomUUID, createHash } = require('node:crypto');
const { readFileSync } = require('node:fs');
const { validateEvent } = require('../.test-build/worker/contract.js');
let db;
const workspace = randomUUID(), otherWorkspace = randomUUID(), account = randomUUID(), otherAccount = randomUUID();
const periodAccount=randomUUID();
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
    await db.exec(readFileSync('db/migrations/0005_journal_history.sql','utf8'));
    await db.exec(readFileSync('db/migrations/0006_journal_provenance.sql','utf8'));
    await db.exec(readFileSync('db/migrations/0007_account_events.sql','utf8'));
    await db.exec(readFileSync('db/migrations/0008_event_details.sql','utf8'));
    await db.exec(readFileSync('db/migrations/0009_account_period_insights.sql','utf8'));
    await db.exec(readFileSync('db/migrations/0010_reconciliation_candidates.sql','utf8'));
  }
  else {
    const { migrate }=require('../scripts/migrate.cjs');
    await migrate(db); await migrate(db);
    assert.equal((await sql('SELECT count(*)::int n FROM public.nestwise_schema_migrations'))[0].n,10);
  }
  await sql('INSERT INTO nestwise.workspaces VALUES ($1,$2,$3),($4,$5,$6)', [workspace,'LLC test','business',otherWorkspace,'Family test','family']);
  await sql('INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,$3),($4,$5,$6)', [account,workspace,'Clearing test',otherAccount,otherWorkspace,'Private test']);
  await sql('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)', ['crm-test',workspace,account]);
  await sql('INSERT INTO nestwise.users VALUES ($1,$2),($3,$4)', [user,'test-owner',accountant,'test-accountant']);
  await sql(`INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true),($1,$3,'accountant',false)`, [workspace,user,accountant]);
  await sql(`INSERT INTO nestwise.sessions VALUES ($1,$2,now()+interval '1 hour',NULL),($3,$4,now()+interval '1 hour',NULL)`, [tokenHash,user,accountantHash,accountant]);
});
after(async () => { if (db?.close) await db.close(); else if (db) await db.end(); });

test('period insights aggregate the full ledger, reconcile months, isolate accounts and keep operational meanings',async()=>{
  const {parsePeriodInsights,periodMetrics}=require('../.test-build/src/domain/period-insights.js');
  const target=periodAccount;await sql("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'Period proof')",[target,workspace]);
  await sql('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)',['period-proof',workspace,target]);
  const send=async event=>{validateEvent(event);return sql('SELECT nestwise.accept_event($1,$2,$3,$4)',['period-proof',randomUUID(),Math.floor(Date.now()/1000),JSON.stringify(event)]);};
  const read=async(from='2026-10-01',to='2026-10-31',subject='test-owner',accountId=target)=>parsePeriodInsights((await sql('SELECT nestwise.user_period_insights($1,$2,$3,$4,$5) result',[subject,workspace,accountId,from,to]))[0].result,{from,to});
  const payment=money('period-order',1,'job.payment_recorded',35000,{occurred_at:'2026-10-01T00:00:00Z'});
  const part=money('period-order',2,'job.part_cost_recorded',9500,{settlement:'paid'});
  const correction=money('period-order',3,'job.cost_corrected',7500,{reference_event_id:part.source_event_id});
  await send(payment);await send(part);await send(correction);
  await send(money('period-order',4,'job.supplier_credit_received',2500,{reference_event_id:correction.source_event_id}));
  await send(money('period-order',5,'job.customer_refund_issued',10000,{reference_event_id:payment.source_event_id}));
  await send(money('period-accrual',1,'job.part_cost_recorded',3000,{settlement:'accrued',paid_at:null}));
  const fee=money('period-fee',1,'job.processor_fee_recorded',500);await send(fee);
  await send(money('period-fee',2,'job.processor_fee_refunded',100,{reference_event_id:fee.source_event_id}));
  for(let i=0;i<205;i++)await send(money(`period-bulk-${i}`,1,'job.payment_recorded',100));
  await send(money('period-previous',1,'job.payment_recorded',50000,{occurred_at:'2026-09-30T23:59:59Z'}));
  await send(money('period-outside',1,'job.payment_recorded',999,{occurred_at:'2026-11-01T00:00:00Z'}));
  await send(money('period-wait',2,'job.payment_recorded',999999,{occurred_at:'2026-09-01T00:00:00Z'}));
  await send(money('period-order',6,'job.customer_refund_issued',999999,{reference_event_id:payment.source_event_id}));
  const overview=await read(),m=periodMetrics(overview.current);
  assert.equal(overview.current.transaction_count,'213');assert.equal(overview.previous.transaction_count,'1');
  assert.equal(overview.current.missing_paid_date,'1');assert.deepEqual(overview.attention,{waiting:'1',needs_review:'1'});
  assert.equal(m.receipts,55500n);assert.equal(m.refunds,10000n);assert.equal(m.parts_cost,8000n);assert.equal(m.fees,400n);
  assert.equal(m.recorded_difference,37100n);assert.equal(m.parts_payable,3000n);assert.equal(m.clearing,40100n);
  assert.equal(periodMetrics(overview.previous).receipts,50000n);assert.deepEqual(overview.months[0],overview.current);
  const quarterly=await read('2026-10-01','2026-12-31');assert.equal(quarterly.months.length,3);
  assert.equal(quarterly.months[1].transaction_count,'1');assert.equal(quarterly.months[2].transaction_count,'0');
  const empty=await read('2025-01-01','2025-01-31');assert.equal(empty.current.transaction_count,'0');assert.equal(empty.attention.waiting,'1');
  const correctionDay=await read('2026-10-19','2026-10-19');
  assert.equal(periodMetrics(correctionDay.current).receipts,20500n);
  assert.equal(correctionDay.previous.transaction_count,'0');
  assert.equal((await read('2026-01-15','2027-01-14')).months.length,13);
  for(let i=0;i<2;i++)await send(money(`period-large-${i}`,1,'job.payment_recorded',9007199254740991,{occurred_at:'2026-07-01T12:00:00Z'}));
  assert.equal(periodMetrics((await read('2026-07-01','2026-07-31')).current).receipts,18014398509481982n);
  await assert.rejects(read('2026-10-01','2026-10-31','test-accountant'),/forbidden/);
  await assert.rejects(read('2026-10-01','2026-10-31','test-owner',otherAccount),/forbidden/);
  await assert.rejects(read('2024-01-01','2025-01-01'),/invalid_filters/);
  await sql('INSERT INTO nestwise.account_grants VALUES ($1,$2,$3)',[workspace,accountant,target]);
  assert.equal((await read('2026-10-01','2026-10-31','test-accountant')).current.transaction_count,'213');
  await sql('DELETE FROM nestwise.account_grants WHERE user_id=$1',[accountant]);
  await assert.rejects(read('2026-10-01','2026-10-31','test-accountant'),/forbidden/);
  await sql('BEGIN');try{await sql('SET LOCAL ROLE nestwise_api');assert.equal((await read()).current.transaction_count,'213');}finally{await sql('ROLLBACK');}
});

test('account event center covers unposted orders, keyset pages, safe guidance and revoked grants',async()=>{
  const {parseEventsPage}=require('../.test-build/src/domain/account-events.js');
  const read=async(status='all',query='inbox-proof',cursor=null,subject='test-owner',target=account)=>
    parseEventsPage((await sql('SELECT nestwise.user_account_events($1,$2,$3,$4,$5,$6) result',[subject,workspace,target,status,query,cursor]))[0].result);
  for(let i=0;i<103;i++)await accept(money(`inbox-proof-${i}`,2,'job.payment_recorded',100));
  const first=await read();assert.equal(first.events.length,100);assert.equal(first.counts.waiting,'103');
  assert.ok(first.events.every(e=>e.journal_id===null&&e.guidance==='earlier_revision'));
  const {parseEventDetail}=require('../.test-build/src/domain/journal-detail.js');
  const detail=async(id,subject='test-owner',target=account)=>parseEventDetail((await sql('SELECT nestwise.user_event_detail($1,$2,$3,$4) result',[subject,workspace,target,id]))[0].result,id);
  const waiting=await detail(first.events[0].cursor);assert.equal(waiting.transaction,null);assert.equal(waiting.source.status,'waiting');
  assert.equal(waiting.history.length,1);assert.equal(waiting.audit.length,0);
  await assert.rejects(detail(first.events[0].cursor,'test-accountant'),/forbidden/);
  await assert.rejects(detail(first.events[0].cursor,'test-owner',otherAccount),/forbidden/);
  await assert.rejects(detail(randomUUID()),/forbidden/);
  await accept(money('inbox-proof-new',2,'job.payment_recorded',100));
  const tail=await read('all','inbox-proof',first.next_cursor);assert.equal(tail.events.length,3);assert.equal(tail.next_cursor,null);
  assert.equal(new Set([...first.events,...tail.events].map(e=>e.cursor)).size,103);
  assert.equal((await read()).counts.waiting,'104');
  assert.equal((await read('posted')).events.length,0);
  assert.equal((await read('all','%')).events.length,0);
  assert.equal((await read('all',first.events[0].id)).events.length,1);
  await accept(money('inbox-proof-0',1,'job.payment_recorded',100));
  const resolved=await read('all','inbox-proof-0');assert.equal(resolved.counts.waiting,'0');assert.equal(resolved.counts.posted,'2');
  await assert.rejects(read('all','inbox-proof',randomUUID()),/invalid_cursor/);
  await assert.rejects(read('invalid'),/invalid_filters/);
  await assert.rejects(read('all','inbox-proof',null,'test-accountant'),/forbidden/);
  await assert.rejects(read('all','inbox-proof',first.next_cursor,'test-owner',otherAccount),/forbidden/);
  await sql('INSERT INTO nestwise.account_grants VALUES ($1,$2,$3)',[workspace,accountant,account]);
  assert.equal((await read('waiting','inbox-proof',null,'test-accountant')).events.length,100);
  await sql('DELETE FROM nestwise.account_grants WHERE user_id=$1',[accountant]);
  await assert.rejects(read('waiting','inbox-proof',first.next_cursor,'test-accountant'),/forbidden/);
  const payment=money('inbox-reasons',1,'job.payment_recorded',100);await accept(payment);
  await accept(money('inbox-reasons',2,'job.customer_refund_issued',200,{reference_event_id:payment.source_event_id}));
  const review=await read('needs_review','inbox-reasons');assert.equal(review.events[0].guidance,'excess_refund');
  const reviewDetail=await detail(review.events[0].cursor);assert.equal(reviewDetail.transaction,null);
  assert.equal(reviewDetail.reference.id,payment.source_event_id);assert.equal(reviewDetail.audit[0].action,'needs_review');
  assert.deepEqual(review.counts,{waiting:'0',needs_review:'1',posted:'1',asserted:'0'});
  assert.equal(JSON.stringify(review).includes('error_code'),false);assert.equal(JSON.stringify(review).includes('payload'),false);
  await sql('BEGIN');try{await sql('SET LOCAL ROLE nestwise_api');assert.equal((await read()).events.length,100);
    assert.equal((await detail(review.events[0].cursor)).source.status,'needs_review');
    await assert.rejects(sql('SELECT * FROM nestwise.source_events'),/permission denied/);
  }finally{await sql('ROLLBACK');}
});

test('provenance links corrections and refunds, paginates assertions and isolates source connections',async()=>{
  const {parseJournalDetail}=require('../.test-build/src/domain/journal-detail.js');
  const order='provenance-proof',payment=money(order,1,'job.payment_recorded',10000),part=money(order,2,'job.part_cost_recorded',2000,{settlement:'paid'});
  const correction=money(order,3,'job.cost_corrected',3000,{reference_event_id:part.source_event_id});
  await accept(payment);await accept(part);await accept(correction);
  await accept(money(order,4,'job.supplier_credit_received',1000,{reference_event_id:correction.source_event_id}));
  await accept(money(order,5,'job.customer_refund_issued',2500,{reference_event_id:payment.source_event_id}));
  const expected={payments_cents:10000,refunds_cents:2500,parts_net_cents:2000,fees_net_cents:0};
  for(let i=6;i<=108;i++)await accept(assertion(order,i,'job.financials_finalized',{totals:expected}));
  await accept(money(order,109,'job.customer_refund_issued',99999,{reference_event_id:payment.source_event_id}));
  await accept(money(order,111,'job.payment_recorded',100));
  const tx=(await sql('SELECT jt.id FROM nestwise.journal_transactions jt JOIN nestwise.source_events se ON se.id=jt.event_id WHERE se.source_event_id=$1',[correction.source_event_id]))[0].id;
  const read=async(before=null,subject='test-owner',target=account)=>parseJournalDetail((await sql('SELECT nestwise.user_journal_detail($1,$2,$3,$4,$5) result',[subject,workspace,target,tx,before]))[0].result,tx);
  await sql('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)',['other-provenance',workspace,account]);
  await sql('SELECT nestwise.accept_event($1,$2,$3,$4)',['other-provenance',randomUUID(),Math.floor(Date.now()/1000),JSON.stringify({...payment,source_event_id:randomUUID(),source_fact_id:randomUUID()})]);
  const detail=await read();assert.equal(detail.source.kind,'job.cost_corrected');assert.equal(detail.reference.id,part.source_event_id);
  assert.equal(detail.transaction.entries[0].cents,'1000');assert.equal(detail.audit[0].action,'applied');
  assert.equal(detail.history.length,100);assert.equal(detail.history[0].status,'waiting');assert.equal(detail.history[1].status,'needs_review');
  assert.equal(detail.history[2].status,'asserted');assert.equal(detail.history[2].journal_id,null);
  const tail=await read(detail.next_revision);assert.equal(tail.history.length,10);assert.equal(tail.next_revision,null);
  const waitingId=(await sql('SELECT id FROM nestwise.source_events WHERE connection_id=$1 AND source_order_id=$2 AND order_revision=111',['crm-test',order]))[0].id;
  const {parseEventDetail}=require('../.test-build/src/domain/journal-detail.js');
  const eventPage=async before=>parseEventDetail((await sql('SELECT nestwise.user_event_detail($1,$2,$3,$4,$5) result',['test-owner',workspace,account,waitingId,before]))[0].result,waitingId);
  const eventFirst=await eventPage(null),eventLast=await eventPage(eventFirst.next_revision);
  assert.equal(eventFirst.transaction,null);assert.equal(eventFirst.history.length,100);assert.equal(eventLast.history.length,10);
  assert.equal(new Set([...eventFirst.history,...eventLast.history].map(e=>e.id)).size,110);
  assert.equal(new Set([...detail.history,...tail.history].map(event=>event.id)).size,110);
  assert.equal(JSON.stringify(detail).includes('payload'),false);assert.equal(JSON.stringify(detail).includes('error_code'),false);
  await assert.rejects(read(null,'nonexistent'),/forbidden/);await assert.rejects(read(null,'test-owner',otherAccount),/forbidden/);
  await sql('BEGIN');try{await sql('SET LOCAL ROLE nestwise_api');assert.equal((await read()).source.id,correction.source_event_id);
    await assert.rejects(sql('SELECT * FROM nestwise.event_provenance'),/permission denied/);
  }finally{await sql('ROLLBACK');}
});

test('full history paginates tied timestamps, searches beyond page one and rechecks grants',async()=>{
  const {parseHistoryPage}=require('../.test-build/src/domain/journal-history.js');
  for(let index=0;index<205;index++)await accept(money(`history-proof-${index}`,1,'job.payment_recorded',100,{
    occurred_at:index===0?'2026-10-19T01:30:00Z':'2026-10-19T12:00:00.123Z',
  }));
  const page=async({query='history-proof-',from=null,to=null,code='all',order='newest',cursor=null,subject='test-owner',target=account}={})=>
    parseHistoryPage((await sql('SELECT nestwise.user_journal_page($1,$2,$3,$4,$5,$6,$7,$8,$9) result',
      [subject,workspace,target,query,from,to,code,order,cursor]))[0].result);
  const first=await page();assert.equal(first.entries.length,100);assert.ok(first.next_cursor);
  const second=await page({cursor:first.next_cursor});assert.equal(second.entries.length,100);
  const third=await page({cursor:second.next_cursor});assert.equal(third.entries.length,5);assert.equal(third.next_cursor,null);
  const all=[...first.entries,...second.entries,...third.entries];
  assert.equal(new Set(all.map(row=>row.id)).size,205);
  const asc1=await page({order:'oldest'}),asc2=await page({order:'oldest',cursor:asc1.next_cursor}),
    asc3=await page({order:'oldest',cursor:asc2.next_cursor});
  assert.deepEqual([...asc1.entries,...asc2.entries,...asc3.entries].map(row=>row.id),all.map(row=>row.id).reverse());
  const old=third.entries.at(-1);
  assert.deepEqual((await page({query:old.source_order_id})).entries.map(row=>row.id),[old.id]);
  assert.equal((await page({query:'HISTORY-PROOF-',from:'2026-10-19',to:'2026-10-19',code:'receipts'})).entries.length,100);
  assert.equal((await page({from:'2026-10-18',to:'2026-10-18'})).entries.length,0);
  assert.equal((await page({code:'refunds'})).entries.length,0);
  assert.equal((await page({query:'%'})).entries.length,0,'Search is literal, not a wildcard');
  await accept(money('history-proof-new',1,'job.payment_recorded',100,{occurred_at:'2026-10-21T00:00:00Z'}));
  assert.deepEqual((await page({cursor:first.next_cursor})).entries,second.entries,'New rows must not shift the continuation');
  assert.equal((await page()).entries[0].source_order_id,'history-proof-new');
  await assert.rejects(page({cursor:randomUUID()}),/invalid_cursor/);
  await assert.rejects(page({subject:'nonexistent'}),/forbidden/);
  await assert.rejects(page({target:otherAccount}),/forbidden/);
  await sql('BEGIN');
  try {
    await sql('UPDATE nestwise.memberships SET all_accounts=false WHERE workspace_id=$1 AND user_id=$2',[workspace,user]);
    await sql('SET LOCAL ROLE nestwise_api');
    await assert.rejects(page({cursor:first.next_cursor}),/forbidden/);
  } finally {await sql('ROLLBACK');}
  await sql('BEGIN');
  try {
    await sql('SET LOCAL ROLE nestwise_api');
    assert.equal((await page()).entries.length,100);
  } finally {await sql('ROLLBACK');}
});

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
    assert.deepEqual(access[0].accounts.map(row=>row.id).sort(),[account,periodAccount].sort());
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

test('paid reconciliation candidates exclude corrections, accruals and unresolved events with scoped cursor access',async()=>{
  const {parseCandidates}=require('../.test-build/src/domain/reconciliation.js');
  const period={from:'2026-10-19',to:'2026-10-19'};
  const read=async(subject='test-owner',target=periodAccount,cursor=null)=>(await sql('SELECT nestwise.user_reconciliation_candidates($1,$2,$3,$4,$5,$6) result',[subject,workspace,target,period.from,period.to,cursor]))[0].result;
  const rows=[];let cursor=null;
  do{const page=parseCandidates(await read('test-owner',periodAccount,cursor),period);rows.push(...page.entries);cursor=page.next_cursor;}while(cursor);
  assert.equal(rows.length,215);assert.equal(new Set(rows.map(row=>row.id)).size,215);
  assert.ok(rows.every(row=>row.kind!=='job.cost_corrected'&&row.paid_at));
  assert.ok(rows.some(row=>row.source_order_id==='period-previous'));
  assert.ok(!rows.some(row=>['period-wait','period-accrual'].includes(row.source_order_id)));
  await assert.rejects(read('unknown'),/forbidden/);
  await assert.rejects(read('test-accountant'),/forbidden/);
  await assert.rejects(read('test-owner',otherAccount),/forbidden/);
  await assert.rejects(read('test-owner',account,rows[0].id),/invalid_cursor/);
  await sql('BEGIN');try{await sql('SET LOCAL ROLE nestwise_api');assert.equal((await read()).entries.length,100);}finally{await sql('ROLLBACK');}
});
