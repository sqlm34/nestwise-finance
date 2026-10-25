// Public liveness only; this does not claim database or financial correctness.
const assert=require('node:assert/strict');
(async()=>{
  const response=await fetch('https://nestwise.universestitch.com/health',{
    redirect:'error',signal:AbortSignal.timeout(20000),headers:{Accept:'application/json'}});
  assert.equal(response.status,200);
  assert.ok(response.headers.get('content-type')?.startsWith('application/json'));
  const body=await response.text();assert.ok(body.length<4096);
  const status=JSON.parse(body);
  assert.equal(status.service,'nestwise');assert.equal(status.environment,'production');assert.equal(status.status,'ok');
  assert.equal(status.financialIngestion,process.env.EXPECT_CRM_ENABLED==='true');
  console.log('Production HTTPS liveness and ingestion switch match the release configuration. Database correctness is checked separately.');
})().catch(()=>{console.error('Production liveness failed. Inspect HTTPS, Worker availability and the configured ingestion switch.');process.exitCode=1;});
