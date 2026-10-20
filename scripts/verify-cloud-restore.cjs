const {Client}=require('pg');
const assert=require('node:assert/strict');
const {verifyRestore}=require('./verify-restore.cjs');
function validateTargets(source,restored,runtime) {
  const urls=[source,restored,runtime].map(value=>new URL(value));
  for(const url of urls) {
    assert.equal(url.protocol,'postgresql:');
    assert.equal(url.pathname,'/nestwise_staging');
    assert.ok(/^ep-[a-z0-9-]+(?:\.[a-z0-9-]+)+\.neon\.tech$/.test(url.hostname));
    assert.equal(url.searchParams.get('sslmode'),'require');
  }
  const endpoint=url=>url.hostname.replace('-pooler.','.');
  assert.notEqual(endpoint(urls[0]),endpoint(urls[1]),'Never run recovery probes against the source');
  assert.equal(endpoint(urls[1]),endpoint(urls[2]));
  assert.equal(urls[2].username,'nestwise_worker');
  return urls;
}
module.exports={validateTargets};
if(require.main===module) (async()=>{
  assert.equal(process.env.NESTWISE_RECOVERY_CONFIRM,'verify-separate-staging-copy');
  const urls=validateTargets(process.env.NESTWISE_RECOVERY_SOURCE_URL,
    process.env.NESTWISE_RECOVERY_COPY_URL,process.env.NESTWISE_RECOVERY_RUNTIME_URL);
  const clients=urls.map(url=>new Client({connectionString:url.href}));
  try {
    await Promise.all(clients.map(client=>client.connect()));
    for(const client of clients.slice(0,2)) {
      const identity=(await client.query("SELECT current_database() db,to_regclass('public.jobs') crm")).rows[0];
      assert.equal(identity.db,'nestwise_staging'); assert.equal(identity.crm,null);
    }
    assert.equal((await clients[2].query('SELECT current_user role')).rows[0].role,'nestwise_worker');
    console.log(JSON.stringify(await verifyRestore(...clients),null,2));
  } finally {await Promise.all(clients.map(client=>client.end()));}
})().catch(()=>{console.error('Cloud recovery verification failed; no credentials logged.');process.exitCode=1;});
