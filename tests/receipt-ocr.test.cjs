const {Buffer}=require('node:buffer');
const {test}=require('node:test');const assert=require('node:assert/strict');
const {recognizeReceipt}=require('../.test-build/worker/receipt-ocr.js');
const bytes=Buffer.from('%PDF-1.4\nSynthetic only\n%%EOF');
const draft={supplier:'Synthetic',date:'',currency:'USD',items:[],tax_cents:null,tip_cents:null,shipping_cents:null,discount_cents:null,total_cents:null};
test('OCR sends only explicit document bytes to the fixed provider and returns unbooked, nullable review data',async()=>{
 let calls=0;const result=await recognizeReceipt(bytes,'synthetic-not-a-key','configured-model',async(url,request)=>{
  calls++;assert.equal(url,'https://api.openai.com/v1/responses');const payload=JSON.parse(request.body);
  assert.equal(payload.store,false);assert.equal(payload.text.format.strict,true);assert.equal(payload.input[0].content[0].type,'input_file');
  assert.ok(payload.input[0].content[0].file_data.startsWith('data:application/pdf;base64,'));
  return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(draft)}]}]});
 });assert.deepEqual(result,draft);assert.equal(calls,1);
});
test('OCR refuses incomplete, refusal, fabricated schema and rate limited results without automatic spending retries',async()=>{
 for(const response of [{status:'incomplete',output:[]},{status:'completed',output:[{content:[{type:'refusal'}]}]},
  {status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify({...draft,total_cents:123})}]}]}]){
  let calls=0;await assert.rejects(recognizeReceipt(bytes,'test','model',async()=>{calls++;return Response.json(response);}),/ocr_incomplete/);assert.equal(calls,1);
 }
 await assert.rejects(recognizeReceipt(bytes,'test','model',async()=>new Response('',{status:429})),/ocr_rate_limited/);
 await assert.rejects(recognizeReceipt(bytes,'','model',async()=>{throw new Error('must not send');}),/ocr_not_configured/);
});
