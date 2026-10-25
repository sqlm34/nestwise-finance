const {Client}=require('pg');
const assert=require('node:assert/strict');
const {verifyRestore}=require('./verify-restore.cjs');
function recoveryPolicy(options={}){
  const environment=options.environment??'staging';
  assert.ok(['staging','production'].includes(environment),'Unknown recovery environment');
  if(environment==='production')assert.equal(options.confirm,'verify-separate-production-copy','Explicit production recovery confirmation required');
  return {database:`nestwise_${environment}`,runtime:environment==='production'?'nestwise_production_worker':'nestwise_worker',owner:environment==='production'?'nestwise_production_owner':null};
}
function validateTargets(source,restored,runtime,options={}) {
  const policy=recoveryPolicy(options);
  const urls=[source,restored,runtime].map(value=>new URL(value));
  for(const url of urls) {
    assert.equal(url.protocol,'postgresql:');
    assert.equal(url.pathname,`/${policy.database}`);
    assert.ok(/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(url.hostname));
    assert.equal(url.searchParams.get('sslmode'),'require');
  }
  const endpoint=url=>url.hostname.replace('-pooler.','.');
  assert.notEqual(endpoint(urls[0]),endpoint(urls[1]),'Never run recovery probes against the source');
  assert.equal(endpoint(urls[1]),endpoint(urls[2]));
  assert.equal(urls[2].username,policy.runtime);
  if(policy.owner)for(const url of urls.slice(0,2))assert.equal(url.username,policy.owner);
  return urls;
}
module.exports={validateTargets,recoveryPolicy};
if(require.main===module) (async()=>{
  const options={environment:process.env.NESTWISE_RECOVERY_ENVIRONMENT??'staging',confirm:process.env.NESTWISE_RECOVERY_CONFIRM};
  const policy=recoveryPolicy(options);
  assert.equal(options.confirm,`verify-separate-${options.environment}-copy`);
  const urls=validateTargets(process.env.NESTWISE_RECOVERY_SOURCE_URL,
    process.env.NESTWISE_RECOVERY_COPY_URL,process.env.NESTWISE_RECOVERY_RUNTIME_URL,options);
  const clients=urls.map(url=>new Client({connectionString:url.href}));
  try {
    await Promise.all(clients.map(client=>client.connect()));
    for(const client of clients.slice(0,2)) {
      const identity=(await client.query("SELECT current_database() db,to_regclass('public.jobs') crm")).rows[0];
      assert.equal(identity.db,policy.database); assert.equal(identity.crm,null);
      if(policy.owner)assert.equal((await client.query('SELECT current_user role')).rows[0].role,policy.owner);
    }
    assert.equal((await clients[2].query('SELECT current_user role')).rows[0].role,policy.runtime);
    console.log(JSON.stringify(await verifyRestore(...clients),null,2));
  } finally {await Promise.all(clients.map(client=>client.end()));}
})().catch(()=>{console.error('Cloud recovery verification failed; no credentials logged.');process.exitCode=1;});
