const {test}=require('node:test'),assert=require('node:assert/strict');
const {crmStatus}=require('../.test-build/worker/crm-status.js');
const rows=[{id:'crm-a',enabled:true,last_received_at:'2026-10-28T10:00:00Z'}];
const key={connectionId:'crm-a',secret:'aa'.repeat(32),notBefore:10,expiresAt:100};
const env={ENVIRONMENT:'staging',FINANCIAL_INGESTION_ENABLED:'true',CRM_SERVICE_KEYS:JSON.stringify({a:key})};
test('CRM indicator requires enabled account mapping, receiver and unexpired matching key',()=>{
 assert.equal(crmStatus(rows,env,50).connected,true);
 for(const [r,e,n] of [[rows,env,100],[rows,env,9],[[{...rows[0],enabled:false}],env,50],[[],env,50],[rows,{...env,FINANCIAL_INGESTION_ENABLED:'false'},50],[rows,{...env,CRM_SERVICE_KEYS:'bad'},50],[rows,{...env,CRM_SERVICE_KEYS:JSON.stringify({a:{...key,connectionId:'other'}})},50]])assert.equal(crmStatus(r,e,n).connected,false);
 const result=crmStatus(rows,env,50);assert.equal(result.last_received_at,rows[0].last_received_at);assert(!JSON.stringify(result).includes(key.secret));assert(!JSON.stringify(result).includes('crm-a'));
});
