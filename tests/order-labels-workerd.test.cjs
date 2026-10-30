const {test}=require('node:test');
const assert=require('node:assert/strict');
const {build}=require('esbuild');
const {Miniflare,convertV4MiniflareOptions}=require('miniflare');
test('customer label transport works with actual Worker Request redirect semantics',async()=>{
 const bundle=await build({stdin:{resolveDir:process.cwd(),contents:`
 import {orderLabels} from './worker/order-labels.ts';
 export default {async fetch(){
 const now=Math.floor(Date.now()/1000),page={entries:[{source_order_id:'J-SYNTHETIC',source_event_id:'11111111-1111-4111-8111-111111111111'}]};
 const env={ENVIRONMENT:'production',FINANCIAL_INGESTION_ENABLED:'true',CRM_SERVICE_KEYS:JSON.stringify({test:{connectionId:'alex-crm-production',secret:'ab'.repeat(32),notBefore:now-60,expiresAt:now+600}}),CRM_LABEL_SOURCE:{async fetch(url,init){const req=new Request(url,init);if(req.redirect!=='manual')throw Error('Redirect followed');return Response.json({labels:[{order_id:'J-SYNTHETIC',customer_name:'Synthetic Customer'}]});}}};
 return Response.json(await orderLabels(page,[{id:'alex-crm-production',enabled:true}],env));
 }};`},bundle:true,write:false,format:'esm',platform:'browser'});
 const runtime=new Miniflare(convertV4MiniflareOptions({modules:true,compatibilityDate:'2026-10-20',script:bundle.outputFiles[0].text}));
 try{const response=await runtime.dispatchFetch('http://localhost');assert.equal((await response.json()).entries[0].customer_name,'Synthetic Customer');}finally{await runtime.dispose();}
});
