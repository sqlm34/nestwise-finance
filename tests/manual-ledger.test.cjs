const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync,readdirSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
let db;const workspace=randomUUID(),account=randomUUID(),destination=randomUUID(),user=randomUUID();
const query=async(sql,params=[]) => (await db.query(sql,params)).rows;
const operation=(kind='expense',amount='1000')=>({id:randomUUID(),kind,paid_on:'2026-10-20',amount_cents:amount,note:'Synthetic test',destination_account:null,reference_operation:null,allocations:[{category:'supplies',cents:amount}]});
const post=async(payload,a=account,subject='manual-owner')=>(await query('SELECT nestwise.post_manual_operation($1,$2,$3,$4) id',[subject,workspace,a,JSON.stringify(payload)]))[0].id;
before(async()=>{
  db=new PGlite();await db.waitReady;
  for(const file of readdirSync('db/migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())await db.exec(readFileSync('db/migrations/'+file,'utf8'));
  await query("INSERT INTO nestwise.workspaces VALUES($1,'Synthetic','business')",[workspace]);
  await query("INSERT INTO nestwise.users VALUES($1,'manual-owner')",[user]);
  await query("INSERT INTO nestwise.memberships VALUES($1,$2,'owner',true)",[workspace,user]);
  for(const id of [account,destination])await query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES($1,$2,'Synthetic')",[id,workspace]);
});
after(async()=>{await db?.close();});
test('manual postings are immutable, balanced, retry-safe and visible to history/insights/candidates',async()=>{
  const p=operation();assert.equal(await post(p),p.id);assert.equal(await post(p),p.id);
  assert.equal((await query('SELECT count(*)::int n FROM nestwise.journal_transactions WHERE manual_id=$1',[p.id]))[0].n,1);
  await assert.rejects(post({...p,note:'changed'}),/manual_operation_conflict/);
  const history=(await query('SELECT nestwise.user_journal_page($1,$2,$3) result',['manual-owner',workspace,account]))[0].result;
  const row=history.entries.find(x=>x.source_event_id===p.id);assert.ok(row);assert.equal(row.entries.reduce((n,e)=>n+BigInt(e.cents),0n),0n);
  const tokenHash='a'.repeat(64);
  await query("INSERT INTO nestwise.sessions(token_hash,user_id,expires_at) VALUES($1,$2,now()+interval '1 hour')",[tokenHash,user]);
  const legacy=(await query('SELECT nestwise.read_journal($1,$2,$3) result',[tokenHash,workspace,account]))[0].result;
  assert.ok(legacy.some(x=>x.source_event_id===p.id),'Token-based journal includes manual postings');
  await query('UPDATE nestwise.sessions SET revoked_at=now() WHERE token_hash=$1',[tokenHash]);
  await assert.rejects(query('SELECT nestwise.read_journal($1,$2,$3)',[tokenHash,workspace,account]),/unauthorized/);
  const detail=(await query('SELECT nestwise.user_journal_detail($1,$2,$3,$4) result',['manual-owner',workspace,account,row.id]))[0].result;
  assert.equal(detail.manual.id,p.id);assert.equal(detail.refunded_cents,'0');
  const candidates=(await query('SELECT nestwise.user_reconciliation_candidates($1,$2,$3,$4,$5) result',['manual-owner',workspace,account,'2026-10-20','2026-10-20']))[0].result;
  assert.ok(candidates.entries.some(x=>x.kind==='manual.expense'));
  const insights=(await query('SELECT nestwise.user_period_insights($1,$2,$3,$4,$5) result',['manual-owner',workspace,account,'2026-10-20','2026-10-20']))[0].result;
  assert.equal(insights.current.totals.expenses,'1000');
  await assert.rejects(query('UPDATE nestwise.manual_operations SET amount_cents=1 WHERE id=$1',[p.id]),/immutable/);
  await query('SET ROLE nestwise_api');
  try{await assert.rejects(query('SELECT * FROM nestwise.manual_operations'),/permission denied/);}finally{await query('RESET ROLE');}
});
test('atomic transfers move cash without revenue, retries never create an extra leg',async()=>{
  const p={...operation('transfer','500'),destination_account:destination,allocations:[]};
  await post(p);await post(p);
  const legs=await query('SELECT jt.account_id,je.code,je.cents::text FROM nestwise.journal_transactions jt JOIN nestwise.journal_entries je ON je.transaction_id=jt.id WHERE jt.manual_id=$1',[p.id]);
  assert.equal(legs.length,4);assert.equal(legs.reduce((n,r)=>n+BigInt(r.cents),0n),0n);
  assert.equal(legs.filter(r=>r.code==='receipts').length,0);
  assert.equal(legs.find(r=>r.account_id===destination&&r.code==='clearing').cents,'500');
  await assert.rejects(post({...p,id:randomUUID(),destination_account:account}),/invalid_manual_operation/);
});
test('refunds are cumulative, linked, date-checked and reject refunds of refunds',async()=>{
  const original=operation('income','1000');await post(original);
  const refund={...operation('refund','600'),reference_operation:original.id,allocations:[]};await post(refund);await post(refund);
  await assert.rejects(post({...refund,id:randomUUID(),amount_cents:'401'}),/manual_refund_exceeded/);
  await post({...refund,id:randomUUID(),amount_cents:'400'});
  await assert.rejects(post({...refund,id:randomUUID(),amount_cents:'1'}),/manual_refund_exceeded/);
  await assert.rejects(post({...refund,id:randomUUID(),reference_operation:refund.id}),/invalid_manual_operation/);
  await assert.rejects(post({...refund,id:randomUUID(),paid_on:'2026-10-19'}),/invalid_manual_operation/);
});
test('live role/account grants protect both transfer endpoints and malformed direct SQL is rejected',async()=>{
  const restricted=randomUUID();await query("INSERT INTO nestwise.users VALUES($1,'restricted')",[restricted]);
  await query("INSERT INTO nestwise.memberships VALUES($1,$2,'accountant',false)",[workspace,restricted]);
  await query('INSERT INTO nestwise.account_grants VALUES($1,$2,$3)',[workspace,restricted,account]);
  const p={...operation('transfer'),destination_account:destination,allocations:[]};
  await assert.rejects(post(p,account,'restricted'),/forbidden/);
  assert.equal((await query('SELECT count(*)::int n FROM nestwise.manual_operations WHERE id=$1',[p.id]))[0].n,0);
  await query("UPDATE nestwise.memberships SET role='reviewer' WHERE user_id=$1",[restricted]);
  await assert.rejects(post(operation(),account,'restricted'),/forbidden/);
  for(const patch of [{amount_cents:'1.1'},{allocations:[]},{kind:null},{paid_on:'2026-02-30'},{allocations:[{category:'x',cents:'999'}]}])await assert.rejects(post({...operation(),...patch}),/invalid_manual_operation/);
});
