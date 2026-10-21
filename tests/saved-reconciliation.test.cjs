const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {parseSave,parseSavedPage,parseCancellation,savedCursor}=require('../.test-build/src/domain/saved-reconciliation.js');
let fixture,cookie,transaction,secondTransaction;
const hash=text=>createHash('sha256').update(text).digest('hex');
const request=(path,body,withCookie=true,origin='http://localhost:8081')=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...(withCookie?{cookie}:{}),...(origin?{origin}:{})},body:body===undefined?undefined:JSON.stringify(body)});
const path=()=>`/v1/user/workspaces/${fixture.workspace}/accounts/${fixture.account}/reconciliations`;
const payload=(overrides={})=>({id:randomUUID(),file_hash:hash('synthetic.csv'),rows:[{line:2,date:'2026-10-20',cents:'100',text_hash:hash('synthetic payment')}],transactions:[transaction],...overrides});
before(async()=>{
  fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();
  const login=await fixture.fetch(request('/api/auth/sign-in/email',{email:fixture.email,password:fixture.password},false));
  cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
  await fixture.db.query('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)',['save-proof',fixture.workspace,fixture.account]);
  for(let index=0;index<2;index++)await fixture.db.query('SELECT nestwise.accept_event($1,$2,$3,$4)',['save-proof',randomUUID(),Math.floor(Date.now()/1000),JSON.stringify({schema_version:1,source_event_id:randomUUID(),source_order_id:`saved-${index}`,source_fact_id:randomUUID(),order_revision:1,type:'job.payment_recorded',currency:'USD',occurred_at:'2026-10-01T12:00:00Z',paid_at:'2026-10-20T12:00:00Z',amount_cents:100})]);
  [transaction,secondTransaction]=(await fixture.db.query('SELECT id FROM nestwise.journal_transactions ORDER BY id')).rows.map(row=>row.id);
});
after(async()=>{await fixture?.db.close();});
test('saved reconciliation rejects extra metadata, invalid cents, zero sums and duplicate IDs before persistence',()=>{
  for(const value of [payload({description:'private raw text'}),payload({rows:[{...payload().rows[0],cents:'1.1'}]}),payload({transactions:[transaction,transaction]}),payload({rows:[{...payload().rows[0],date:'2026-02-30'}]})])assert.throws(()=>parseSave(value));
  assert.throws(()=>parseCancellation({reason:'delete'}));assert.throws(()=>savedCursor(new URLSearchParams('cursor=no')));
});
test('authenticated durable save is idempotent, exact, scoped, conflict-safe and reverses through immutable audit',async()=>{
  assert.equal((await fixture.fetch(request(path(),undefined,false))).status,401);
  assert.equal((await fixture.fetch(request(path(),payload(),true,null))).status,403);
  assert.equal((await fixture.fetch(request(path(),payload(),true,'https://attacker.test'))).status,403);
  assert.equal((await fixture.fetch(request(path(),payload({rows:[{...payload().rows[0],cents:'101'}]})))).status,409);
  assert.equal((await fixture.fetch(request(path(),payload({rows:[{...payload().rows[0],date:'2026-11-20'}]})))).status,409);
  const input=parseSave(payload());
  for(let i=0;i<2;i++){const saved=await fixture.fetch(request(path(),input));assert.equal(saved.status,200,await saved.clone().text());assert.deepEqual(await saved.json(),{id:input.id});}
  let history=parseSavedPage(await (await fixture.fetch(request(path()))).json());assert.equal(history.groups.length,1);assert.equal(history.can_write,true);assert.equal(history.groups[0].amount,'100');
  assert.equal((await fixture.fetch(request(path(),payload()))).status,409,'same journal cannot be used again');
  assert.equal((await fixture.fetch(request(path(),payload({file_hash:hash('other.csv'),transactions:[secondTransaction]})))).status,409,'overlapping row fingerprint across files');
  assert.equal((await fixture.fetch(request(path(),{...input,file_hash:hash('changed')}))).status,409,'idempotency ID cannot change payload');
  assert.equal((await fixture.fetch(request(path()+`/${input.id}/cancel`,{reason:'recheck'}))).status,200);
  assert.equal((await fixture.fetch(request(path()+`/${input.id}/cancel`,{reason:'mistake'}))).status,200);
  history=parseSavedPage(await (await fixture.fetch(request(path()))).json());assert.equal(history.groups[0].reason,'recheck');assert.ok(history.groups[0].canceled_at);
  assert.equal((await fixture.fetch(request(path(),input))).status,200,'late retry does not resurrect a canceled save');
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.reconciliation_claims')).rows[0].n,0);
  await assert.rejects(fixture.db.query('DELETE FROM nestwise.reconciliation_groups'),/immutable_financial_history/);
  await assert.rejects(fixture.db.query('UPDATE nestwise.reconciliation_cancellations SET reason=\'mistake\''),/immutable_financial_history/);
  const replacement=payload();assert.equal((await fixture.fetch(request(path(),replacement))).status,200,'released claims can be reconciled again');
  await fixture.db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[fixture.workspace]);
  assert.equal(parseSavedPage(await (await fixture.fetch(request(path()))).json()).can_write,false);
  assert.equal((await fixture.fetch(request(path()+`/${replacement.id}/cancel`,{reason:'mistake'}))).status,404);
  await fixture.db.query('UPDATE nestwise.memberships SET all_accounts=false WHERE workspace_id=$1',[fixture.workspace]);
  assert.equal((await fixture.fetch(request(path()))).status,404);
  await fixture.db.query("UPDATE nestwise.memberships SET role='owner',all_accounts=true WHERE workspace_id=$1",[fixture.workspace]);
  assert.equal((await fixture.fetch(request(path()+`/${replacement.id}/cancel`,{reason:'mistake'}))).status,200);
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,2,'reconciliation never posts money');
});
test('saved history paginates without hiding canceled assertions and runtime cannot read tables directly',async()=>{
  for(let i=0;i<51;i++){
    const input=payload();assert.equal((await fixture.fetch(request(path(),input))).status,200);
    assert.equal((await fixture.fetch(request(path()+`/${input.id}/cancel`,{reason:'recheck'}))).status,200);
  }
  const first=parseSavedPage(await (await fixture.fetch(request(path()))).json());assert.equal(first.groups.length,50);assert.ok(first.next_cursor);
  const next=parseSavedPage(await (await fixture.fetch(request(path()+'?cursor='+first.next_cursor))).json());assert.equal(next.groups.length,3);assert.equal(next.next_cursor,null);
  assert.equal(new Set([...first.groups,...next.groups].map(row=>row.id)).size,53);
  await fixture.db.exec('BEGIN; SET LOCAL ROLE nestwise_api');try{
    const rows=(await fixture.db.query('SELECT nestwise.read_reconciliations($1,$2,$3,NULL) result',[`better-auth:${fixture.id}`,fixture.workspace,fixture.account])).rows[0].result;
    assert.equal(rows.groups.length,50);await assert.rejects(fixture.db.query('SELECT * FROM nestwise.reconciliation_groups'),/permission denied/);
  }finally{await fixture.db.exec('ROLLBACK');}
});
