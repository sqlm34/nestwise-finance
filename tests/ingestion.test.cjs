const {test}=require('node:test');
const {Buffer}=require('node:buffer');
const assert=require('node:assert/strict');
const {randomUUID,createHmac,createHash}=require('node:crypto');
const {createWorker}=require('../.test-build/worker/index.js');
const {validateEvent}=require('../.test-build/worker/contract.js');
const secret='ab'.repeat(32), now=()=>Math.floor(Date.now()/1000);
const env={ENVIRONMENT:'development',FINANCIAL_INGESTION_ENABLED:'true',NESTWISE_DATABASE_URL:'test-only',
  CRM_SERVICE_KEYS:JSON.stringify({test:{connectionId:'crm-test',secret,notBefore:0,expiresAt:4102444800}})};
const event=()=>({schema_version:1,source_event_id:randomUUID(),source_order_id:'order-1',source_fact_id:randomUUID(),
  order_revision:1,type:'job.payment_recorded',currency:'USD',occurred_at:'2026-10-19T12:00:00Z',paid_at:'2026-10-19T12:00:00Z',amount_cents:35000});
function signed(body=event(),options={}) {
  const raw=typeof body==='string'?body:JSON.stringify(body), timestamp=String(options.timestamp??now()), nonce=randomUUID();
  const path=options.path??'/v1/crm/events', connection=options.connection??'crm-test';
  const canonical=['v1','POST',path,connection,'test',timestamp,nonce,createHash('sha256').update(raw).digest('hex')].join('\n');
  const signature=createHmac('sha256',Buffer.from(secret,'hex')).update(canonical).digest('hex');
  return new Request('https://nestwise.test'+path,{method:'POST',headers:{'content-type':'application/json',
    'x-nw-connection':connection,'x-nw-key-id':'test','x-nw-timestamp':timestamp,'x-nw-nonce':nonce,
    'x-nw-signature':options.signature??signature},body:options.tampered??raw});
}
const unavailable=()=>{throw new Error('database must not be reached');};
test('signed ingestion waits for durable ACK, does not ACK failed persistence',async()=>{
  let persisted=false;
  const worker=createWorker(()=>({accept:async()=>{await Promise.resolve();persisted=true;return {accepted:true,status:'waiting'};}}));
  const response=await worker.fetch(signed(),env); assert.equal(response.status,202); assert.equal(persisted,true);
  const failed=await createWorker(()=>({accept:async()=>{throw new Error('connection failed with private details');}})).fetch(signed(),env);
  assert.equal(failed.status,503); assert.doesNotMatch(await failed.text(),/private/);
});
test('tampered bodies, bad signatures, stale/future requests and cross-connection keys rejected',async()=>{
  const worker=createWorker(unavailable);
  for(const options of [{signature:'0'.repeat(64)},{timestamp:now()-301},{timestamp:now()+301},
    {connection:'another-crm'},{tampered:JSON.stringify({...event(),amount_cents:1})}]) {
    assert.equal((await worker.fetch(signed(event(),options),env)).status,401);
  }
});
test('expired key and unconfigured/production ingestion fail closed',async()=>{
  const worker=createWorker(unavailable);
  const expired={...env,CRM_SERVICE_KEYS:JSON.stringify({test:{connectionId:'crm-test',secret,notBefore:0,expiresAt:1}})};
  assert.equal((await worker.fetch(signed(),expired)).status,401);
  for(const disabled of [{...env,FINANCIAL_INGESTION_ENABLED:'false'},{...env,NESTWISE_DATABASE_URL:undefined},{...env,ENVIRONMENT:'production'}])
    assert.equal((await worker.fetch(signed(),disabled)).status,404);
});
test('contract excludes personal data, floats, invalid dates, unsafe integers and absent facts',()=>{
  for(const delta of [{amount_cents:0.1},{amount_cents:Number.MAX_SAFE_INTEGER+1},{customer_name:'private'},
    {paid_at:null},{occurred_at:'2026-02-30T00:00:00Z'},{currency:'EUR'},{source_fact_id:''},
    {amount_cents:-1},{order_revision:1.1},{reference_event_id:randomUUID()}])
    assert.throws(()=>validateEvent({...event(),...delta}));
  assert.equal(validateEvent(event()).amount_cents,35000);
});
test('invalid signed event and oversized streamed body never reach database',async()=>{
  const worker=createWorker(unavailable);
  assert.equal((await worker.fetch(signed({...event(),customer_name:'private'}),env)).status,400);
  assert.equal((await worker.fetch(signed(' '.repeat(16385)),env)).status,413);
});
test('database conflicts map to 409 and scheduled processing observes the feature flag',async()=>{
  let processed=0;
  const worker=createWorker(()=>({accept:async()=>{throw new Error('event_payload_conflict');},processPending:async()=>{processed++;}}));
  assert.equal((await worker.fetch(signed(),env)).status,409);
  await worker.scheduled({}, {...env,FINANCIAL_INGESTION_ENABLED:'false'}); assert.equal(processed,0);
  await worker.scheduled({},env); assert.equal(processed,1);
});
test('journal route hashes session token and hides forbidden resources',async()=>{
  const w=randomUUID(),a=randomUUID(),token='a'.repeat(43); let actual;
  const worker=createWorker(()=>({journal:async(hash,workspace,account)=>{actual={hash,workspace,account};return [];}}));
  const response=await worker.fetch(new Request(`https://nestwise.test/v1/workspaces/${w}/accounts/${a}/journal`,{headers:{authorization:`Bearer ${token}`}}),env);
  assert.equal(response.status,200); assert.deepEqual(actual,{hash:createHash('sha256').update(token).digest('hex'),workspace:w,account:a});
  const denied=createWorker(()=>({journal:async()=>{throw new Error('forbidden');}}));
  assert.equal((await denied.fetch(new Request(`https://nestwise.test/v1/workspaces/${w}/accounts/${a}/journal`,{headers:{authorization:`Bearer ${token}`}}),env)).status,404);
});
