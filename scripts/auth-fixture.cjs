// Loopback-only synthetic user. Never provision this identity in a cloud database.
const {readFileSync}=require('node:fs');
const {randomUUID,randomBytes}=require('node:crypto');
async function createAuthFixture() {
  const {db,pool}=await require('./auth-test-db.cjs').authTestDatabase();
  for(const name of ['0001_ledger.sql','0002_auth.sql','0003_user_access.sql','0004_invitations.sql'])
    await db.exec(readFileSync(`db/migrations/${name}`,'utf8'));
  const {hashPassword}=await import('better-auth/crypto');
  const id=randomUUID(),workspace=randomUUID(),account=randomUUID(),localUser=randomUUID();
  const password='Synthetic-only-2468!',email='demo@nestwise.test';
  await db.query('INSERT INTO nestwise_auth."user"(id,name,email,"emailVerified") VALUES ($1,$2,$3,true)',[id,'Demo owner',email]);
  await db.query(`INSERT INTO nestwise_auth.account(id,"accountId","providerId","userId",password,"updatedAt")
    VALUES ($1,$2,'credential',$2,$3,now())`,[randomUUID(),id,await hashPassword(password)]);
  await db.query("INSERT INTO nestwise.users VALUES ($1,$2)",[localUser,`better-auth:${id}`]);
  await db.query("INSERT INTO nestwise.workspaces VALUES ($1,'Demo business','business')",[workspace]);
  await db.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'Demo clearing')",[account,workspace]);
  await db.query("INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true)",[workspace,localUser]);
  const env={ENVIRONMENT:'development',AUTH_ENABLED:'true',AUTH_DATABASE_URL:'memory-only',
    NESTWISE_DATABASE_URL:'memory-only',AUTH_SECRET:randomBytes(32).toString('hex'),
    AUTH_BASE_URL:'http://localhost:8083',AUTH_WEB_ORIGIN:'http://localhost:8081'};
  const {createAuth}=require('../.test-build/worker/auth.js');
  const {authConfiguration,userApi}=require('../.test-build/worker/user-api.js');
  const auth=await createAuth(authConfiguration(env),pool);
  const ledger=()=>({
    userAccess:async subject=>(await db.query('SELECT nestwise.user_access($1) result',[subject])).rows[0].result,
    userJournal:async(...args)=>(await db.query('SELECT nestwise.user_journal($1,$2,$3) result',args)).rows[0].result,
  });
  const invitationStore=()=>({
    check:async(...args)=>(await db.query('SELECT nestwise_auth.check_invitation($1,$2) valid',args)).rows[0].valid,
    accept:async(...args)=>(await db.query('SELECT nestwise_auth.accept_invitation($1,$2) email',args)).rows[0].email,
  });
  return {db,auth,env,id,workspace,account,email,password,
    fetch:(request,override=env)=>userApi(request,override,async()=>({auth,close:async()=>{}}),ledger,invitationStore)};
}
module.exports={createAuthFixture};
