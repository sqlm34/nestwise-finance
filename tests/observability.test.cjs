const {test}=require('node:test');
const assert=require('node:assert/strict');
const {observeRequest}=require('../.test-build/worker/observability.js');
test('operational failures produce an incident without logging exceptions or request data',async()=>{
  const events=[];
  const response=await observeRequest(async()=>{throw Error('postgresql://private:secret@host/customer');},'production',event=>events.push(event));
  assert.equal(response.status,503);assert.deepEqual(await response.json(),{error:'temporarily_unavailable'});
  assert.equal(events.length,1);assert.deepEqual(Object.keys(events[0]).sort(),['environment','event','incident','status']);
  assert.equal(events[0].environment,'production');assert.equal(events[0].incident,response.headers.get('X-Nestwise-Incident'));
  assert.equal(JSON.stringify(events).includes('secret'),false);assert.equal(response.headers.get('Cache-Control'),'no-store');
});
test('ordinary errors and successes are not logged; known server errors preserve their response',async()=>{
  const events=[];
  for(const status of [200,401,403,404,429]){
    const response=await observeRequest(async()=>new Response('body',{status}),'staging',event=>events.push(event));
    assert.equal(response.status,status);assert.equal(await response.text(),'body');
  }
  assert.equal(events.length,0);
  const response=await observeRequest(async()=>new Response('busy',{status:503}),'untrusted-environment-text',event=>events.push(event));
  assert.equal(await response.text(),'busy');assert.equal(events[0].environment,'unknown');
});
