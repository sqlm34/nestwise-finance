const {test}=require('node:test');const assert=require('node:assert/strict');
const {deliverQueuedReceipt,validateQueuedReceipt}=require('../.test-build/src/domain/receipt-queue.js');
const {parseReceipt}=require('../.test-build/src/domain/receipt.js');
const scope={origin:'https://synthetic.invalid',user:'user-a',workspace:'space-a',account:'bank-a'};
const row=()=>({scope,hash:'a'.repeat(64),name:'synthetic.pdf',bytes:new TextEncoder().encode('%PDF-1.4 synthetic only'),created:'2026-11-04T12:00:00Z'});
test('receipt outbox keeps original after timeout, refusal or unconfirmed archive; retry uses same content ID',async()=>{
 let deleted=0;const store={remove:async(s,h)=>{assert.deepEqual(s,scope);assert.equal(h,'a'.repeat(64));deleted++;}};
 await assert.rejects(deliverQueuedReceipt(row(),async()=>{throw Error('timeout');},store));
 for(const result of [{hash:'a'.repeat(64),archived:false},{hash:'b'.repeat(64),archived:true},{}])await assert.rejects(deliverQueuedReceipt(row(),async()=>result,store));
 assert.equal(deleted,0);
 await deliverQueuedReceipt(row(),async r=>({hash:r.hash,archived:true}),store);assert.equal(deleted,1);
});
test('receipt outbox rejects cross-user, bank and environment recovery and corrupt original',()=>{
 for(const key of ['origin','user','workspace','account'])assert.throws(()=>validateQueuedReceipt(row(),{...scope,[key]:'different'}));
 assert.throws(()=>validateQueuedReceipt({...row(),bytes:new Uint8Array([1,2])},scope));
 assert.throws(()=>validateQueuedReceipt({...row(),hash:'../../outside'},scope));
});
test('card extraction remains compatible with old receipts and rejects full numbers and ambiguous digits',()=>{
 const data={supplier:'Synthetic',date:'',currency:'USD',items:[],tax_cents:null,tip_cents:null,shipping_cents:null,discount_cents:null,total_cents:null};
 assert.deepEqual(parseReceipt(data),data);
 for(const card_last4 of [null,'1111','2222','3333','4444','5555'])assert.equal(parseReceipt({...data,card_last4}).card_last4,card_last4);
 for(const card_last4 of ['1234567890121111','27','1111 / 2222',1111,''])assert.throws(()=>parseReceipt({...data,card_last4}));
 assert.throws(()=>parseReceipt({...data,unrecognized:'value'}));
});
