const {test}=require('node:test'),assert=require('node:assert/strict');
const {parseStatementScan,scanCsv}=require('../.test-build/src/domain/statement-scan.js');
const {previewStatement}=require('../.test-build/src/domain/statement.js');
const {recognizeReceipt}=require('../.test-build/worker/receipt-ocr.js');
const sample=()=>({currency:'USD',bank:'Chase',from:'2026-09-01',to:'2026-09-30',opening_cents:'10000',closing_cents:'12500',rows:[{date:'2026-09-02',description:'Deposit',amount_cents:'5000'},{date:'2026-09-03',description:'Shop, supplies',amount_cents:'-2500'}]});
test('bank scan preserves signed cents, quoted descriptions and source provenance',()=>{const csv=scanCsv(sample(),'a'.repeat(64));const p=previewStatement(csv,'chase','Chase');assert.equal(p.rows.length,2);assert.equal(p.rows[1].amountCents,-2500);assert.equal(p.rows[1].description,'Shop, supplies');assert(csv.includes('a'.repeat(64)));assert.equal(scanCsv(sample()),scanCsv(sample()));});
test('missing amounts, invalid dates, wrong currency, incomplete pages and unbalanced totals cannot import',()=>{
 for(const s of [{...sample(),opening_cents:null},{...sample(),closing_cents:'12501'},{...sample(),currency:'unknown'},{...sample(),from:'2026-09-31'},{...sample(),rows:[sample().rows[0]]},{...sample(),rows:[{...sample().rows[0],amount_cents:null},sample().rows[1]]}])assert.throws(()=>scanCsv(s));
 assert.equal(parseStatementScan({...sample(),opening_cents:null}).opening_cents,null);
});
test('raw manual typing survives in drafts but only valid dollar values convert to cents',()=>{assert.equal(scanCsv({...sample(),opening_cents:'d:100.00',closing_cents:'d:125.00'}),scanCsv(sample()));assert.throws(()=>scanCsv({...sample(),opening_cents:'d:-'}));});
test('bank OCR uses explicit statement schema, no storage, fixed provider, and does not post',async()=>{let calls=0;const result=await recognizeReceipt(Buffer.from('%PDF-1.4\nSynthetic\n%%EOF'),'test','model',async(url,request)=>{calls++;const body=JSON.parse(request.body);assert.equal(body.store,false);assert(body.text.format.schema.required.includes('opening_cents'));assert(body.instructions.includes('posted transaction rows'));return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(sample())}]}]});},true);assert.deepEqual(result,sample());assert.equal(calls,1);});
