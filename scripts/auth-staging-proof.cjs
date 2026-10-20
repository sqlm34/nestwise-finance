// Explicit staging-only verification; credentials are returned in memory, never logged.
const {randomUUID,randomBytes}=require('node:crypto');
const assert=require('node:assert/strict');
const origin='https://nestwise-staging.alexeasyrepair.workers.dev';
async function provision(client) {
  const target=(await client.query('SELECT current_database() name, to_regclass(\'public.jobs\') crm')).rows[0];
  assert.equal(target.name,'nestwise_staging');assert.equal(target.crm,null);
  const {hashPassword}=await import('better-auth/crypto');
  const user=randomUUID(),workspace=randomUUID(),account=randomUUID(),actor=randomUUID();
  const email=`proof-${user}@nestwise.test`,password=randomBytes(32).toString('hex');
  await client.query('BEGIN');
  try {
    await client.query('INSERT INTO nestwise_auth."user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)',
      [user,'Staging verification',email]);
    await client.query(`INSERT INTO nestwise_auth.account(id,"accountId","providerId","userId",password,"updatedAt")
      VALUES ($1,$2,'credential',$2,$3,now())`,[randomUUID(),user,await hashPassword(password)]);
    await client.query('INSERT INTO nestwise.users VALUES ($1,$2)',[actor,`better-auth:${user}`]);
    await client.query("INSERT INTO nestwise.workspaces VALUES ($1,'Staging verification — synthetic','business')",[workspace]);
    await client.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'Synthetic clearing')",[account,workspace]);
    await client.query("INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true)",[workspace,actor]);
    await client.query('COMMIT');
    return {user,workspace,account,email,password};
  } catch(error){await client.query('ROLLBACK');throw error;}
}
async function verify(identity) {
  async function request(path,{method='GET',body,cookie}={}) {
    return fetch(origin+path,{method,redirect:'error',
      headers:{origin,'Content-Type':'application/json',...(cookie?{cookie}:{})},
      ...(body?{body:JSON.stringify(body)}:{})});
  }
  assert.equal((await request('/v1/session')).status,401);
  assert.equal((await request('/api/auth/sign-up/email',{method:'POST',body:{}})).status,404);
  const login=await request('/api/auth/sign-in/email',{method:'POST',body:{email:identity.email,password:identity.password}});
  assert.equal(login.status,200,'Staging login must succeed');
  const cookies=login.headers.getSetCookie();
  assert.ok(cookies.some(c=>/HttpOnly/i.test(c)&&/Secure/i.test(c)));
  const cookie=cookies.map(c=>c.split(';')[0]).join('; ');
  try {
    const session=await request('/v1/session',{cookie});assert.equal(session.status,200);
    const data=await session.json();
    assert.equal(data.user.id,identity.user);
    assert.deepEqual(data.workspaces.map(w=>w.id),[identity.workspace]);
    assert.deepEqual(data.workspaces[0].accounts.map(a=>a.id),[identity.account]);
    const journal=await request(`/v1/user/workspaces/${identity.workspace}/accounts/${identity.account}/journal`,{cookie});
    assert.equal(journal.status,200);assert.deepEqual((await journal.json()).entries,[]);
    assert.equal((await request(`/v1/user/workspaces/${randomUUID()}/accounts/${identity.account}/journal`,{cookie})).status,404);
  } finally {
    assert.equal((await request('/api/auth/sign-out',{method:'POST',body:{},cookie})).status,200);
  }
  assert.equal((await request('/v1/session',{cookie})).status,401,'Old cookie must stop working');
  return {login:true,secureCookie:true,workspaceIsolation:true,journal:true,logoutRevoked:true};
}
async function retire(client,identity) {
  await client.query('BEGIN');
  try {
    // Only the exact temporary identity is deactivated; retain its synthetic workspace.
    const row=(await client.query('SELECT email FROM nestwise_auth."user" WHERE id=$1',[identity.user])).rows[0];
    assert.equal(row?.email,identity.email);assert.match(row.email,/^proof-[0-9a-f-]+@nestwise\.test$/);
    await client.query('UPDATE nestwise_auth.account SET password=NULL WHERE "userId"=$1',[identity.user]);
    await client.query('DELETE FROM nestwise_auth.session WHERE "userId"=$1',[identity.user]);
    await client.query('COMMIT');
  } catch(error){await client.query('ROLLBACK');throw error;}
}
async function activateInvitation(invitation,password) {
  const request=()=>fetch(`${origin}/v1/invitations/accept`,{method:'POST',redirect:'error',
    headers:{origin,'Content-Type':'application/json'},body:JSON.stringify({token:invitation.token,password})});
  assert.equal((await request()).status,200,'Cloud invitation activation must succeed');
  assert.equal((await request()).status,400,'Cloud invitation cannot be replayed');
  return {activated:true,replayRejected:true};
}
module.exports={provision,verify,retire,activateInvitation};
