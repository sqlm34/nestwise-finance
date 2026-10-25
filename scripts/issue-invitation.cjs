// Administrative API: returns the invitation only in memory. No mail or secret files.
const {randomUUID,randomBytes,createHash}=require('node:crypto');
const assert=require('node:assert/strict');
const {productionMode,validateAdminIdentity}=require('./admin-target.cjs');
async function issueInvitation(client,{email,name,workspace,role='member',allAccounts=false},options={}) {
  const production=productionMode(options,'issue-nestwise-production-invitation');
  assert.match(email,/^[^\s@]+@[^\s@]+\.[^\s@]+$/);
  assert.ok(name.trim().length>0 && name.length<=100);
  assert.ok(['owner','member','accountant','reviewer'].includes(role));
  assert.equal(typeof allAccounts,'boolean');
  const target=(await client.query("SELECT current_database() name,to_regclass('public.jobs') crm")).rows[0];
  const adminRole=production?(await client.query('SELECT current_user role')).rows[0].role:null;
  validateAdminIdentity(target.name,adminRole,production);assert.equal(target.crm,null);
  const token=randomBytes(32).toString('hex'),hash=createHash('sha256').update(token).digest('hex');
  const id=randomUUID(),actor=randomUUID();
  await client.query('BEGIN');
  try {
    assert.equal((await client.query('SELECT id FROM nestwise.workspaces WHERE id=$1',[workspace])).rows.length,1);
    assert.equal((await client.query('SELECT id FROM nestwise_auth."user" WHERE lower(email)=lower($1)',[email])).rows.length,0,
      'Existing users require a separate reviewed recovery flow');
    await client.query('INSERT INTO nestwise_auth."user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,false)',
      [id,name.trim(),email.trim().toLowerCase()]);
    await client.query(`INSERT INTO nestwise_auth.account(id,"accountId","providerId","userId",password,"updatedAt")
      VALUES ($1,$2,'credential',$2,NULL,now())`,[randomUUID(),id]);
    await client.query('INSERT INTO nestwise.users VALUES ($1,$2)',[actor,`better-auth:${id}`]);
    await client.query('INSERT INTO nestwise.memberships VALUES ($1,$2,$3,$4)',[workspace,actor,role,allAccounts]);
    const expires=(await client.query(`INSERT INTO nestwise_auth.invitations(token_hash,user_id,expires_at)
      VALUES ($1,$2,now()+interval '24 hours') RETURNING expires_at`,[hash,id])).rows[0].expires_at;
    await client.query('COMMIT');
    return {token,user:id,email:email.trim().toLowerCase(),workspace,expires};
  } catch(error){await client.query('ROLLBACK');throw error;}
}
module.exports={issueInvitation};
