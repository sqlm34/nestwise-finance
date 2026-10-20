const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync,readdirSync}=require('node:fs');
const {PGlite}=require('@electric-sql/pglite');
const {parseWorkspaceCommand}=require('../.test-build/src/domain/workspace-admin.js');
let db;const owner=randomUUID(),member=randomUUID(),workspace=randomUUID(),account=randomUUID();
const q=async(sql,args=[])=>(await db.query(sql,args)).rows;
const command=async(payload,subject='owner',space=workspace)=>(await q('SELECT nestwise.workspace_command($1,$2,$3) result',[subject,space,JSON.stringify(parseWorkspaceCommand(payload))]))[0].result;
before(async()=>{db=new PGlite();await db.waitReady;for(const file of readdirSync('db/migrations').filter(x=>/^\d+.*\.sql$/.test(x)).sort())await db.exec(readFileSync('db/migrations/'+file,'utf8'));
  await q("INSERT INTO nestwise.users VALUES($1,'owner'),($2,'member')",[owner,member]);});
after(async()=>{await db?.close();});
test('workspace/account creation is atomic and retries preserve one audit record',async()=>{
  const p={id:randomUUID(),action:'create_workspace',target:workspace,name:'Family',kind:'family'};await command(p);await command(p);
  await command({id:randomUUID(),action:'create_account',target:account,name:'Checking'});
  assert.equal((await q('SELECT count(*)::int n FROM nestwise.workspace_admin_audit'))[0].n,2);
  const access=(await q("SELECT nestwise.user_access('owner') result"))[0].result;assert.equal(access[0].accounts[0].id,account);
  await assert.rejects(command({...p,name:'Different'}),/workspace_command_conflict/);
});
test('last owner cannot be demoted, non-owners cannot manage access and old state is audited',async()=>{
  await q("INSERT INTO nestwise.memberships VALUES($1,$2,'member',false)",[workspace,member]);
  await assert.rejects(command({id:randomUUID(),action:'set_member',target:owner,role:'member',all_accounts:true}),/last_workspace_owner/);
  await assert.rejects(command({id:randomUUID(),action:'set_member',target:member,role:'owner',all_accounts:true},'member'),/forbidden/);
  const id=randomUUID();await command({id,action:'set_member',target:member,role:'reviewer',all_accounts:false});
  assert.equal((await q('SELECT before_state FROM nestwise.workspace_admin_audit WHERE id=$1',[id]))[0].before_state.role,'member');
  await command({id:randomUUID(),action:'set_account_grant',target:member,account,allowed:true});
  assert.equal((await q("SELECT nestwise.user_access('member') result"))[0].result[0].accounts.length,1);
  await command({id:randomUUID(),action:'set_account_grant',target:member,account,allowed:false});
  assert.equal((await q("SELECT nestwise.user_access('member') result"))[0].result[0].accounts.length,0);
  await assert.rejects(q('DELETE FROM nestwise.workspace_admin_audit'),/immutable/);
});
test('workspace isolation, unknown identity and non-member promotion fail closed',async()=>{
  await assert.rejects(command({id:randomUUID(),action:'rename_account',target:randomUUID(),name:'Bad'}),/forbidden/);
  await assert.rejects(command({id:randomUUID(),action:'set_member',target:randomUUID(),role:'owner',all_accounts:true}),/forbidden/);
  const w=randomUUID();await assert.rejects(command({id:randomUUID(),action:'create_workspace',target:w,name:'Bad',kind:'business'},'unknown',w),/forbidden/);
  await q('SET ROLE nestwise_api');try{await assert.rejects(q('SELECT * FROM nestwise.workspace_admin_audit'),/permission denied/);}finally{await q('RESET ROLE');}
});
test('command parser rejects extra fields, control characters and ambiguous boolean values',()=>{
  const base={id:randomUUID(),action:'rename_workspace',target:workspace,name:'Name'};
  for(const p of [{...base,actor:owner},{...base,name:'  '},{...base,name:'bad\nname'},{id:randomUUID(),action:'set_member',target:member,role:'owner',all_accounts:'true'}])assert.throws(()=>parseWorkspaceCommand(p));
});
