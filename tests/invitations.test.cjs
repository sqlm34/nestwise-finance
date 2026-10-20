const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,randomBytes,createHash}=require('node:crypto');
let fixture;
before(async()=>{fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();});
after(async()=>{await fixture?.db.close();});
const password='Synthetic activation password 42!';
async function invite() {
  const user=randomUUID(),token=randomBytes(32).toString('hex'),email=`${randomUUID()}@nestwise.test`;
  const hash=createHash('sha256').update(token).digest('hex');
  await fixture.db.query('INSERT INTO nestwise_auth."user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,false)',[user,'Invitation test',email]);
  await fixture.db.query(`INSERT INTO nestwise_auth.account(id,"accountId","providerId","userId","updatedAt") VALUES ($1,$2,'credential',$2,now())`,[randomUUID(),user]);
  await fixture.db.query("INSERT INTO nestwise_auth.invitations(token_hash,user_id,expires_at) VALUES ($1,$2,now()+interval '24 hours')",[hash,user]);
  return {user,token,email,hash};
}
function request(path,body,ip='127.0.0.99') {
  return new Request(`http://localhost:8083${path}`,{method:'POST',headers:{
    origin:'http://localhost:8081','content-type':'application/json','x-test-ip':ip},body:JSON.stringify(body)});
}
const activate=(token,pw=password,ip)=>fixture.fetch(request('/v1/invitations/accept',{token,password:pw},ip));
test('invitation sets a library-compatible password once, without granting new workspaces',async()=>{
  const item=await invite();
  assert.equal((await activate(item.token,'short')).status,400);
  assert.equal((await activate(item.token)).status,200);
  assert.equal((await activate(item.token)).status,400);
  const login=await fixture.fetch(request('/api/auth/sign-in/email',{email:item.email,password}));
  assert.equal(login.status,200);
  const cookie=login.headers.getSetCookie().map(c=>c.split(';')[0]).join('; ');
  const session=await fixture.fetch(new Request('http://localhost:8083/v1/session',{headers:{cookie}}));
  assert.deepEqual((await session.json()).workspaces,[]);
  const stored=(await fixture.db.query('SELECT password FROM nestwise_auth.account WHERE "userId"=$1',[item.user])).rows[0].password;
  assert.notEqual(stored,password);assert.ok(stored.length>64);
});
test('expired, revoked and unknown invitations cannot establish credentials',async()=>{
  const expired=await invite(),revoked=await invite();
  await fixture.db.query("UPDATE nestwise_auth.invitations SET created_at=now()-interval '2 days',expires_at=now()-interval '1 day' WHERE token_hash=$1",[expired.hash]);
  await fixture.db.query('UPDATE nestwise_auth.invitations SET revoked_at=now() WHERE token_hash=$1',[revoked.hash]);
  for(const token of [expired.token,revoked.token,randomBytes(32).toString('hex')]) assert.equal((await activate(token)).status,400);
});
test('simultaneous activation allows one winner and cannot overwrite its password',async()=>{
  const item=await invite();
  const results=await Promise.all([activate(item.token),activate(item.token,'A different synthetic password!')]);
  assert.deepEqual(results.map(r=>r.status).sort(),[200,400]);
});
test('activation attempts are bounded and runtime cannot issue or inspect invitation tokens',async()=>{
  const item=await invite(),ip='127.0.0.100';
  for(let i=0;i<20;i++)assert.equal((await activate(randomBytes(32).toString('hex'),password,ip)).status,400);
  assert.equal((await activate(item.token,password,ip)).status,400);
  await fixture.db.exec('BEGIN; SET LOCAL ROLE nestwise_auth_api');
  try {await assert.rejects(fixture.db.query('SELECT * FROM nestwise_auth.invitations'),/permission denied/);}
  finally {await fixture.db.exec('ROLLBACK');}
});
