const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
let fixture;
before(async()=>{fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();});
after(async()=>{await fixture?.db.close();});
const request=(path,{method='GET',body,cookie,origin='http://localhost:8081',ip='127.0.0.1'}={})=>
  new Request(`http://localhost:8083${path}`,{method,body:body===undefined?undefined:JSON.stringify(body),
    headers:{origin,'content-type':'application/json','x-test-ip':ip,...(cookie?{cookie}:{})}});
async function login() {
  const response=await fixture.fetch(request('/api/auth/sign-in/email',{method:'POST',body:{email:fixture.email,password:fixture.password}}));
  assert.equal(response.status,200,await response.clone().text());
  const cookies=response.headers.getSetCookie();
  assert.ok(cookies.some(value=>/HttpOnly/i.test(value)));
  return cookies.map(value=>value.split(';')[0]).join('; ');
}
test('real Better Auth login, workspace authorization, logout and stale cookie rejection',async()=>{
  assert.equal((await fixture.fetch(request('/v1/session'))).status,401);
  const cookie=await login();
  const response=await fixture.fetch(request('/v1/session',{cookie}));
  assert.equal(response.status,200);
  assert.equal(response.headers.get('access-control-allow-origin'),'http://localhost:8081');
  const result=await response.json();
  assert.equal(result.workspaces.length,1);assert.equal(result.workspaces[0].id,fixture.workspace);
  assert.equal(result.workspaces[0].accounts[0].id,fixture.account);
  assert.equal((await fixture.fetch(request(`/v1/user/workspaces/${randomUUID()}/accounts/${fixture.account}/journal`,{cookie}))).status,404);
  assert.equal((await fixture.fetch(request('/api/auth/sign-out',{method:'POST',body:{},cookie}))).status,200);
  assert.equal((await fixture.fetch(request('/v1/session',{cookie}))).status,401);
});
test('wrong password, tampered cookies and expired sessions fail closed',async()=>{
  assert.equal((await fixture.fetch(request('/api/auth/sign-in/email',{method:'POST',body:{email:fixture.email,password:'incorrect-password'}}))).status,401);
  const cookie=await login();
  assert.equal((await fixture.fetch(request('/v1/session',{cookie:cookie+'x'}))).status,401);
  await fixture.db.query('UPDATE nestwise_auth.session SET "expiresAt"=now()-interval \'1 minute\'');
  assert.equal((await fixture.fetch(request('/v1/session',{cookie}))).status,401);
});
test('public signup, untrusted origins, oversized bodies and production auth are blocked',async()=>{
  assert.equal((await fixture.fetch(request('/api/auth/sign-up/email',{method:'POST',body:{}}))).status,404);
  assert.equal((await fixture.fetch(request('/api/auth/sign-in/email',{method:'POST',body:{},origin:'https://attacker.test'}))).status,403);
  assert.equal((await fixture.fetch(request('/api/auth/sign-in/email',{method:'POST',body:{password:'a'.repeat(5000)}}))).status,413);
  assert.equal((await fixture.fetch(request('/v1/session'),{...fixture.env,ENVIRONMENT:'production'})).status,404);
});
test('login rate limiting persists across requests',async()=>{
  let last;
  for(let index=0;index<7;index++) last=await fixture.fetch(request('/api/auth/sign-in/email',
    {method:'POST',body:{email:fixture.email,password:'incorrect-password'},ip:'127.0.0.42'}));
  assert.equal(last.status,429);
});
test('auth role cannot read financial data and recovery fingerprints cover auth tables',async()=>{
  const {fingerprint}=require('../scripts/verify-restore.cjs');
  const before=await fingerprint(fixture.db);
  assert.equal(before['nestwise_auth.user'].count,1);
  assert.ok(before['nestwise_auth.rateLimit'].count>0);
  await fixture.db.exec('BEGIN; SET LOCAL ROLE nestwise_auth_api');
  try {
    assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise_auth."user"')).rows[0].n,1);
    await assert.rejects(fixture.db.query('SELECT * FROM nestwise.journal_entries'),/permission denied/);
  } finally {await fixture.db.exec('ROLLBACK');}
  assert.deepEqual(await fingerprint(fixture.db),before);
});
