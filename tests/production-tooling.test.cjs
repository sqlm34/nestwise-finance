const {test}=require('node:test');
const assert=require('node:assert/strict');
const {mkdtempSync,rmdirSync}=require('node:fs');
const {tmpdir}=require('node:os');
const {join}=require('node:path');
const {migrate}=require('../scripts/migrate.cjs');
const {issueInvitation}=require('../scripts/issue-invitation.cjs');
const {validateTargets}=require('../scripts/verify-cloud-restore.cjs');
const {productionMode,validateAdminIdentity}=require('../scripts/admin-target.cjs');
const production={environment:'production',confirm:'apply-nestwise-production'};

function client(name='nestwise_production',role='nestwise_production_owner',crm=null){
  const calls=[];
  return {calls,query:async(sql)=>{
    calls.push(sql);
    if(sql==='SELECT current_database() name')return {rows:[{name}]};
    if(sql==='SELECT current_user role')return {rows:[{role}]};
    if(sql.includes("to_regclass('public.jobs')"))return {rows:[{name,crm,found:crm}]};
    return {rows:[]};
  }};
}

test('production admin mode requires exact action confirmation and dedicated database/role',()=>{
  assert.equal(productionMode({},'expected'),false);
  assert.throws(()=>productionMode({environment:'preview'},'expected'));
  assert.throws(()=>productionMode({environment:'production'},'expected'));
  assert.throws(()=>productionMode(production,'issue-nestwise-production-invitation'));
  assert.equal(productionMode(production,'apply-nestwise-production'),true);
  for(const db of ['nestwise_staging','nestwise_production_copy','crm'])assert.throws(()=>validateAdminIdentity(db,'nestwise_production_owner',true));
  for(const role of ['neondb_owner','nestwise_worker','nestwise_production_worker'])assert.throws(()=>validateAdminIdentity('nestwise_production',role,true));
  assert.throws(()=>validateAdminIdentity('nestwise_production','nestwise_production_owner',false));
});

test('migration refuses production by default and wrong identity before schema writes',async()=>{
  const dir=mkdtempSync(join(tmpdir(),'nestwise-production-guard-'));
  try{
    for(const [db,options] of [[client(),{}],[client(),{environment:'production',confirm:'wrong'}],[client('nestwise_staging'),production],[client(undefined,'nestwise_worker'),production],[client(undefined,undefined,'jobs'),production]]){
      await assert.rejects(migrate(db,dir,options));
      assert.equal(db.calls.some(sql=>/^(CREATE|INSERT|ALTER)/.test(sql)),false);
    }
    const valid=client();await migrate(valid,dir,production);
    assert.equal(valid.calls.at(-1),'COMMIT');
  }finally{rmdirSync(dir);}
});

test('production invitation rejects wrong confirmation, DB or role before creating users',async()=>{
  const input={email:'synthetic@example.test',name:'Synthetic',workspace:'00000000-0000-4000-8000-000000000001'};
  const options={environment:'production',confirm:'issue-nestwise-production-invitation'};
  for(const [db,mode] of [[client(),{}],[client(),production],[client('nestwise_staging'),options],[client(undefined,'nestwise_production_worker'),options],[client(undefined,undefined,'jobs'),options]]){
    await assert.rejects(issueInvitation(db,input,mode));
    assert.equal(db.calls.some(sql=>/^(BEGIN|INSERT)/.test(sql)),false);
  }
});

test('production recovery demands isolated copy, exact database, owner/runtime roles and TLS',()=>{
  const options={environment:'production',confirm:'verify-separate-production-copy'};
  const url=(host,role='nestwise_production_owner',db='nestwise_production')=>`postgresql://${role}:synthetic@ep-${host}.us-east-2.aws.neon.tech/${db}?sslmode=require`;
  const source=url('source'),copy=url('copy'),runtime=url('copy','nestwise_production_worker');
  assert.equal(validateTargets(source,copy,runtime,options).length,3);
  for(const values of [
    [source,copy,runtime,{}],
    [source,copy,runtime,{...options,confirm:'verify-separate-staging-copy'}],
    [source,url('source-pooler'),url('source','nestwise_production_worker'),options],
    [source,copy,url('third','nestwise_production_worker'),options],
    [url('source','nestwise_production_owner','nestwise_staging'),copy,runtime,options],
    [source,url('copy','owner'),runtime,options],
    [source,copy,url('copy','nestwise_worker'),options],
    [source.replace('sslmode=require','sslmode=disable'),copy,runtime,options],
  ])assert.throws(()=>validateTargets(...values));
});
