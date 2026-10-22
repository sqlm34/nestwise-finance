const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {parseReceiptAllocations,prepareReceiptPosting}=require('../.test-build/src/domain/receipt-posting.js');
const {parseReport,reportTotals,reportCSV}=require('../.test-build/src/domain/accountant-report.js');
const data={supplier:'Synthetic split shop',date:'2026-10-01',currency:'USD',items:[{description:'Paper and filter',cents:'3000'}],tax_cents:'210',tip_cents:'0',shipping_cents:'0',discount_cents:'0',total_cents:'3210'};
const allocations=[{category:'tax_22',cents:'1070'},{category:'tax_01',cents:'2140'}];
let f,cookie;
const base=()=>`/v1/user/workspaces/${f.workspace}/accounts/${f.account}`;
const request=(path,body)=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:'http://localhost:8081','Content-Type':'application/json'},...(body===undefined?{}:{body:JSON.stringify(body)})});
const send=(hash,body)=>f.fetch(request(base()+`/receipts/${hash}/post`,body));
async function receipt(){
 const hash=createHash('sha256').update(randomUUID()).digest('hex'),review=randomUUID(),subject=`better-auth:${f.id}`;
 await f.db.query('SELECT nestwise.prepare_receipt($1,$2,$3,$4,32,$5)',[subject,f.workspace,f.account,hash,'image/png']);
 await f.db.query('SELECT nestwise.complete_receipt($1,$2,$3,$4)',[subject,f.workspace,f.account,hash]);
 await f.db.query('SELECT nestwise.review_receipt($1,$2,$3,$4,$5,0,$6)',[subject,f.workspace,f.account,hash,review,JSON.stringify(data)]);
 return {hash,body:{review,operation:randomUUID(),paid_on:'2026-10-21',allocations}};
}
before(async()=>{f=await require('../scripts/auth-fixture.cjs').createAuthFixture();const r=await f.fetch(request('/api/auth/sign-in/email',{email:f.email,password:f.password}));cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');});
after(async()=>{await f?.db.close();});

test('receipt allocation rejects guessed dates, category injection, duplicate and imprecise money',()=>{
 assert.deepEqual(parseReceiptAllocations(allocations),[allocations[1],allocations[0]]);
 for(const invalid of [[],null,[{category:'tax_00',cents:'3210'}],[{category:'supplies',cents:'3210'}],[{category:'tax_22',cents:'0'}],[{category:'tax_22',cents:'3.21'}],[{category:'tax_22',cents:3210}], [...allocations,allocations[0]]])assert.throws(()=>parseReceiptAllocations(invalid));
 assert.throws(()=>prepareReceiptPosting(data,randomUUID(),randomUUID(),'',allocations));
 assert.throws(()=>prepareReceiptPosting(data,randomUUID(),randomUUID(),'2026-10-21',[{category:'tax_22',cents:'3209'}]));
 assert.equal(prepareReceiptPosting(data,randomUUID(),randomUUID(),'2026-10-21').allocations,undefined,'legacy/manual allocation remains available');
});

test('receipt posting and Statement categories commit once, including reversed-order retry',async()=>{
 const {hash,body}=await receipt();
 for(const split of [allocations,[...allocations].reverse()]){const r=await send(hash,{...body,allocations:split});assert.equal(r.status,200,await r.clone().text());}
 const response=await f.fetch(request(base()+'/reports?from=2026-10-21&to=2026-10-21'));assert.equal(response.status,200);
 const report=parseReport(await response.json()),totals=reportTotals(report);
 assert.equal(totals.expense,3210n);assert.equal(totals.totals.tax_22,1070n);assert.equal(totals.totals.tax_01,2140n);assert.equal(totals.unmappedExpense,0n);
 const line=report.data.lines[0];assert.ok(line.evidence.includes(hash));assert.match(reportCSV(report),/tax_22/);
 const early=parseReport(await (await f.fetch(request(base()+'/reports?from=2026-10-01&to=2026-10-01'))).json());assert.equal(reportTotals(early).expense,0n);
 assert.equal((await send(hash,{...body,allocations:[{category:'tax_22',cents:'3210'}]})).status,409);
 assert.equal((await send(hash,{...body,operation:randomUUID()})).status,409);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.manual_operations WHERE id=$1',[body.operation])).rows[0].n,1);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.report_mappings WHERE id=$1',[body.operation])).rows[0].n,1);
 const replacement={id:randomUUID(),transaction:line.transaction_id,line:2,expected_revision:1,allocations:[{category:'tax_33',cents:'3210'}]};
 assert.equal((await f.fetch(request(base()+'/reports/mappings',replacement))).status,200);
 assert.equal((await send(hash,body)).status,200,'a lost response retry must not overwrite a later Statement revision');
 const updated=parseReport(await (await f.fetch(request(base()+'/reports?from=2026-10-21&to=2026-10-21'))).json());
 assert.equal(reportTotals(updated).totals.tax_33,3210n);
});

test('simultaneous receipt retries create exactly one cash transaction and mapping',async()=>{
 const {hash,body}=await receipt();
 const responses=await Promise.all([send(hash,body),send(hash,body)]);
 assert.deepEqual(responses.map(r=>r.status),[200,200]);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions WHERE manual_id=$1',[body.operation])).rows[0].n,1);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.report_mappings WHERE id=$1',[body.operation])).rows[0].n,1);
});

test('invalid allocation rolls back the entire cash posting and can be corrected without duplicate',async()=>{
 const {hash,body}=await receipt();
 assert.equal((await send(hash,{...body,allocations:[{category:'tax_22',cents:'3209'}]})).status,400);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.manual_operations WHERE id=$1',[body.operation])).rows[0].n,0);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.receipt_postings WHERE hash=$1',[hash])).rows[0].n,0);
 assert.equal((await send(hash,body)).status,200);
});

test('business categories are unavailable to personal/family scopes and revoked writers',async()=>{
 const {hash,body}=await receipt();
 for(const kind of ['personal','family']){
  await f.db.query('UPDATE nestwise.workspaces SET kind=$1 WHERE id=$2',[kind,f.workspace]);
  assert.equal((await send(hash,body)).status,404);
 }
 await f.db.query("UPDATE nestwise.workspaces SET kind='business' WHERE id=$1",[f.workspace]);
 await f.db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[f.workspace]);assert.equal((await send(hash,body)).status,404);
 await f.db.query("UPDATE nestwise.memberships SET role='owner' WHERE workspace_id=$1",[f.workspace]);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.manual_operations WHERE id=$1',[body.operation])).rows[0].n,0);
});

test('database entry point rejects malformed allocations and public execution',async()=>{
 const {hash,body}=await receipt();
 for(const split of [null,[],[{category:'tax_00',cents:'3210'}],[{category:'tax_22',cents:'3210',extra:true}]]){
  await assert.rejects(f.db.query('SELECT nestwise.post_receipt_categorized($1,$2,$3,$4,$5,$6,$7,$8)',[`better-auth:${f.id}`,f.workspace,f.account,hash,body.review,body.operation,body.paid_on,JSON.stringify(split)]),/invalid_report/);
 }
 assert.equal((await f.db.query("SELECT has_function_privilege('public','nestwise.post_receipt_categorized(text,uuid,uuid,text,uuid,uuid,date,jsonb)','EXECUTE') allowed")).rows[0].allowed,false);
});
