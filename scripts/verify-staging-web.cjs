const assert=require('node:assert/strict');
const origin='https://nestwise-staging.alexeasyrepair.workers.dev';
(async()=>{
  const health=await fetch(`${origin}/health`);
  assert.equal(health.status,200);
  assert.deepEqual(await health.json(),{service:'nestwise',environment:'staging',status:'ok',financialIngestion:false});
  for(const path of ['/','/account']) {
    const page=await fetch(origin+path,{headers:{accept:'text/html','sec-fetch-mode':'navigate'}});
    assert.equal(page.status,200);assert.match(page.headers.get('content-type'),/text\/html/);
    assert.match(await page.text(),/_expo\/static\/js\/web/);
  }
  // Navigation must not turn API errors into a successful SPA HTML response.
  for(const [path,status] of [['/v1/session',401],['/api/not-found',404],['/v1/crm/events',404]]) {
    const result=await fetch(origin+path,{headers:{accept:'text/html','sec-fetch-mode':'navigate'}});
    assert.equal(result.status,status);assert.match(result.headers.get('content-type'),/application\/json/);
  }
  const untrusted=await fetch(`${origin}/v1/session`,{headers:{origin:'https://untrusted.invalid'}});
  assert.equal(untrusted.status,403);
  console.log('Staging HTTPS pages, auth boundary, API routing and ingestion-disabled health verified.');
})().catch(()=>{console.error('Staging web/auth boundary verification failed.');process.exitCode=1;});
