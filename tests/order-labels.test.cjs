const {test}=require('node:test');
const assert=require('node:assert/strict');
const {createHmac,createHash}=require('node:crypto');
const {Buffer}=require('node:buffer');
const {orderLabels}=require('../.test-build/worker/order-labels.js');
const {transactionLabel,transactionAmount}=require('../.test-build/src/domain/transaction-label.js');
const secret='ab'.repeat(32),now=Math.floor(Date.now()/1000);
const env={ENVIRONMENT:'production',FINANCIAL_INGESTION_ENABLED:'true',CRM_SERVICE_KEYS:JSON.stringify({test:{connectionId:'alex-crm-production',secret,notBefore:now-60,expiresAt:now+600}})};
const connections=[{id:'alex-crm-production',enabled:true}];
const row={source_order_id:'J-SYNTHETIC',source_event_id:'11111111-1111-4111-8111-111111111111',entries:[{code:'clearing',cents:'-16500'},{code:'refunds',cents:'16500'}]};
test('names are requested only for the authorized account connection and posted page',async()=>{
 const page={entries:[row],limit:100};let calls=0;
 const fetcher=async(url,init)=>{calls++;assert.equal(url,'https://alex-crm-api.alexeasyrepair.workers.dev/api/nestwise/order-labels');assert.deepEqual(JSON.parse(init.body),[{order_id:row.source_order_id,event_id:row.source_event_id}]);
 const expected=createHmac('sha256',Buffer.from(secret,'hex')).update(['nestwise-order-labels-v1','POST','/api/nestwise/order-labels','alex-crm-production','test',init.headers['x-nw-timestamp'],createHash('sha256').update(init.body).digest('hex')].join('\n')).digest('hex');assert.equal(init.headers['x-nw-signature'],expected);
 return Response.json({labels:[{order_id:row.source_order_id,customer_name:'Synthetic Customer'}]});};
 assert.strictEqual(await orderLabels(page,[],env,fetcher),page);assert.equal(calls,0);
 const enriched=await orderLabels(page,connections,env,fetcher);assert.equal(enriched.entries[0].customer_name,'Synthetic Customer');assert.deepEqual(enriched.entries[0].entries,row.entries);assert.equal(page.entries[0].customer_name,undefined);
 assert.strictEqual(await orderLabels(page,connections,env,async()=>{throw Error('offline');}),page);
 const bound={fetch:async function(url,init){assert.strictEqual(this,bound);return fetcher(url,init);}};
 const viaBinding=await orderLabels(page,connections,{...env,CRM_LABEL_SOURCE:bound},async()=>{throw Error('public fetch must not be called');});
 assert.equal(viaBinding.entries[0].customer_name,'Synthetic Customer');
});
test('simple operation labels preserve signs and distinguish income, refunds, parts and expenses',()=>{
 assert.equal(transactionLabel(row,'ru'),'Возврат клиенту');assert.equal(transactionAmount(row),-16500n);
 const cases=[['receipts','-16500','Поступление от клиента'],['parts_cost','4309','Покупка запчасти'],['parts_cost','-4309','Возврат за запчасть'],['expenses','300','Расход'],['fees','300','Комиссия за оплату']];
 for(const [code,cents,label] of cases)assert.equal(transactionLabel({...row,entries:[{code,cents},{code:'clearing',cents:String(-BigInt(cents))}]},'ru'),label);
});
