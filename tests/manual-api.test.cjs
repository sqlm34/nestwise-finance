const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {parseManualDetail}=require('../.test-build/src/domain/manual-operation.js');
const {parseCandidates}=require('../.test-build/src/domain/reconciliation.js');
let fixture,cookie;
const req=(path,body,headers={cookie,origin:'http://localhost:8081'})=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},body:body===undefined?undefined:JSON.stringify(body)});
const base=()=>`/v1/user/workspaces/${fixture.workspace}/accounts/${fixture.account}`;
before(async()=>{
  fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();
  const login=await fixture.fetch(req('/api/auth/sign-in/email',{email:fixture.email,password:fixture.password},{origin:'http://localhost:8081'}));
  cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
});
after(async()=>{await fixture?.db.close();});
test('workspace administration uses live owner access, rejects forged origins and returns audited changes',async()=>{
  const path=`/v1/user/workspaces/${fixture.workspace}/administration`;
  assert.equal((await fixture.fetch(req(path,undefined,{}))).status,401);
  const payload={id:randomUUID(),action:'rename_account',target:fixture.account,name:'Reviewed synthetic account'};
  assert.equal((await fixture.fetch(req(path,payload,{cookie,origin:'https://untrusted.test'}))).status,403);
  assert.equal((await fixture.fetch(req(path,payload))).status,200);
  const response=await fixture.fetch(req(path));assert.equal(response.status,200,await response.clone().text());
  const admin=await response.json();assert.equal(admin.accounts[0].name,payload.name);assert.equal(admin.audit[0].id,payload.id);assert.equal(admin.members[0].name,'Demo owner');
  await fixture.db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[fixture.workspace]);
  assert.equal((await fixture.fetch(req(path))).status,404);assert.equal((await fixture.fetch(req(path,{...payload,id:randomUUID()}))).status,404);
  await fixture.db.query("UPDATE nestwise.memberships SET role='owner' WHERE workspace_id=$1",[fixture.workspace]);
});
test('authenticated manual operation flows through journal detail and bank reconciliation without duplicate posting',async()=>{
  const op={id:randomUUID(),kind:'income',paid_on:'2026-10-20',amount_cents:'1000',note:'Synthetic',destination_account:null,reference_operation:null,allocations:[{category:'other_income',cents:'1000'}]};
  for(let i=0;i<2;i++){const r=await fixture.fetch(req(base()+'/operations',op));assert.equal(r.status,200,await r.clone().text());}
  const journal=await (await fixture.fetch(req(base()+'/journal'))).json();assert.equal(journal.entries.length,1);
  const id=journal.entries[0].id,detail=await (await fixture.fetch(req(base()+'/journal/'+id))).json();
  assert.equal(parseManualDetail(detail,id).manual.id,op.id);
  const candidates=parseCandidates(await (await fixture.fetch(req(base()+'/reconciliation-candidates?from=2026-10-20&to=2026-10-20'))).json(),{from:'2026-10-20',to:'2026-10-20'});
  assert.equal(candidates.entries[0].kind,'manual.income');
  const hash=text=>createHash('sha256').update(text).digest('hex');
  const reconciliation={id:randomUUID(),file_hash:hash('manual-proof'),rows:[{line:2,date:'2026-10-20',cents:'1000',text_hash:hash('synthetic')}],transactions:[id]};
  const saved=await fixture.fetch(req(base()+'/reconciliations',reconciliation));assert.equal(saved.status,200,await saved.clone().text());
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1);
});
test('manual route rejects unauthenticated, foreign origin, unknown fields and changed idempotency body',async()=>{
  const op={id:randomUUID(),kind:'expense',paid_on:'2026-10-20',amount_cents:'100',note:'Synthetic',destination_account:null,reference_operation:null,allocations:[{category:'other_expense',cents:'100'}]};
  assert.equal((await fixture.fetch(req(base()+'/operations',op,{origin:'http://localhost:8081'}))).status,401);
  assert.equal((await fixture.fetch(req(base()+'/operations',op,{cookie}))).status,403);
  assert.equal((await fixture.fetch(req(base()+'/operations',op,{cookie,origin:'https://attacker.test'}))).status,403);
  assert.equal((await fixture.fetch(req(base()+'/operations',{...op,actor:randomUUID()}))).status,400);
  assert.equal((await fixture.fetch(req(base()+'/operations',op))).status,200);
  assert.equal((await fixture.fetch(req(base()+'/operations',{...op,note:'Changed'}))).status,409);
  assert.equal((await fixture.fetch(req(base()+'/operations?unexpected=1',op))).status,404);
});
