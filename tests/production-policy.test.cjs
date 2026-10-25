const {test}=require('node:test');
const assert=require('node:assert/strict');
const {productionReady}=require('../.test-build/worker/production-policy.js');
const {authConfiguration}=require('../.test-build/worker/user-api.js');
const {createWorker}=require('../.test-build/worker/index.js');
function configuration(){return {ENVIRONMENT:'production',PRODUCTION_RELEASE_APPROVED:'nestwise-production-v1',
  AUTH_ENABLED:'true',AUTH_SECRET:'synthetic-test-secret-'.repeat(3),
  AUTH_BASE_URL:'https://nestwise.universestitch.com',AUTH_WEB_ORIGIN:'https://nestwise.universestitch.com',
  NESTWISE_DATABASE_URL:'postgresql://nestwise_production_worker:synthetic@ep-test-pooler.us-east-2.aws.neon.tech/nestwise_production?sslmode=require',
  AUTH_DATABASE_URL:'postgresql://nestwise_production_auth:synthetic@ep-test.us-east-2.aws.neon.tech/nestwise_production?sslmode=require'};}
test('production auth needs explicit release approval, matching isolated database identities and exact HTTPS origin',()=>{
  const env=configuration();assert.equal(productionReady(env),true);assert.equal(authConfiguration(env).development,false);
  assert.deepEqual(new Set(authConfiguration(env).origins),new Set(['https://nestwise.universestitch.com','nestwise://']));
  for(const patch of [{PRODUCTION_RELEASE_APPROVED:undefined},{AUTH_ENABLED:'false'},
    {AUTH_BASE_URL:'https://nestwise-staging.alexeasyrepair.workers.dev'},
    {AUTH_WEB_ORIGIN:'https://other.example'}, {AUTH_SECRET:'short'},
    {NESTWISE_DATABASE_URL:env.NESTWISE_DATABASE_URL.replace('_worker','_owner')},
    {AUTH_DATABASE_URL:env.AUTH_DATABASE_URL.replace('ep-test.','ep-other.')},
    {AUTH_DATABASE_URL:env.AUTH_DATABASE_URL.replace('/nestwise_production','/nestwise_staging')},
    {AUTH_DATABASE_URL:env.AUTH_DATABASE_URL+'&host=attacker.example'},
    {AUTH_DATABASE_URL:env.AUTH_DATABASE_URL+'&sslmode=disable'},
    {AUTH_DATABASE_URL:env.AUTH_DATABASE_URL.replace('synthetic@','@')}
  ])assert.equal(authConfiguration({...env,...patch}),null);
});
test('production CRM stays disabled until a separate account-mapping approval and ingestion switch',async()=>{
  const worker=createWorker(()=>{throw Error('Health probes must not connect');});
  const env={...configuration(),FINANCIAL_INGESTION_ENABLED:'true',CRM_SERVICE_KEYS:'synthetic'};
  const health=async value=>(await (await worker.fetch(new Request('https://nestwise.universestitch.com/health'),value)).json()).financialIngestion;
  assert.equal(await health(env),false);
  assert.equal(await health({...env,PRODUCTION_CRM_APPROVED:'confirmed-account-mapping-v1'}),true);
  assert.equal(await health({...env,PRODUCTION_CRM_APPROVED:'confirmed-account-mapping-v1',PRODUCTION_RELEASE_APPROVED:undefined}),false);
  assert.equal(await health({...env,PRODUCTION_CRM_APPROVED:'confirmed-account-mapping-v1',FINANCIAL_INGESTION_ENABLED:'false'}),false);
});
