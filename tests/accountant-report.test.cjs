const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {parseReport,reportTotals,reportHTML,reportCSV}=require('../.test-build/src/domain/accountant-report.js');
let f,cookie;const root=()=>`/v1/user/workspaces/${f.workspace}/accounts/${f.account}/reports`;
const request=(path,body,headers={cookie,origin:'http://localhost:8081'})=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':'application/json',...headers},...(body===undefined?{}:{body:JSON.stringify(body)})});
const read=async()=>{const r=await f.fetch(request(root()+'?from=2026-10-01&to=2026-10-31'));assert.equal(r.status,200);return parseReport(await r.json());};
before(async()=>{f=await require('../scripts/auth-fixture.cjs').createAuthFixture();const login=await f.fetch(request('/api/auth/sign-in/email',{email:f.email,password:f.password},{origin:'http://localhost:8081'}));cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 const op={id:randomUUID(),kind:'expense',paid_on:'2026-10-19',amount_cents:'10000',note:'Synthetic paper',destination_account:null,reference_operation:null,allocations:[{category:'supplies',cents:'10000'}]};await f.db.query('SELECT nestwise.post_manual_operation($1,$2,$3,$4)',[`better-auth:${f.id}`,f.workspace,f.account,JSON.stringify(op)]);
});after(async()=>{await f?.db.close();});
test('business working paper preserves source categories, zero rows and exact unallocated totals',async()=>{const r=await read();assert.equal(r.data.entity,'Aksenov LLC');assert.equal(r.data.lines.length,1);assert.equal(r.data.lines[0].operational_allocations[0].category,'supplies');assert.equal(reportTotals(r).unmappedExpense,10000n);assert.equal(Object.keys(reportTotals(r).totals).length,44);assert.match(reportHTML(r),/Business Meal/);assert.match(reportHTML(r),/NOT FINALIZED/);assert.match(reportCSV(r),/UNMAPPED/);});
test('proposal splits, optimistic conflict and frozen retry remain immutable across later changes',async()=>{
 let r=await read();const l=r.data.lines[0];const command={id:randomUUID(),transaction:l.transaction_id,line:l.line,expected_revision:0,allocations:[{category:'tax_23',cents:'4000'},{category:'tax_38',cents:'6000'}]};
 assert.equal((await f.fetch(request(root()+'/mappings',command))).status,200);assert.equal((await f.fetch(request(root()+'/mappings',command))).status,200);
 assert.equal((await f.fetch(request(root()+'/mappings',{...command,id:randomUUID()}))).status,409);
 const stale={id:randomUUID(),from:r.data.from,to:r.data.to,hash:r.hash};assert.equal((await f.fetch(request(root()+'/snapshots',stale))).status,409);
 r=await read();assert.equal(reportTotals(r).totals.tax_23,4000n);const save={...stale,hash:r.hash};const frozen=await (await f.fetch(request(root()+'/snapshots',save))).json();assert.equal(frozen.hash,r.hash);
 assert.equal((await f.fetch(request(root()+'/mappings',{...command,id:randomUUID(),expected_revision:1,allocations:[{category:'tax_23',cents:'10000'}]}))).status,200);
 const replay=await (await f.fetch(request(root()+'/snapshots',save))).json();assert.deepEqual(replay,frozen);assert.deepEqual(await (await f.fetch(request(root()+'/snapshots/'+save.id))).json(),frozen);assert.notEqual((await read()).hash,frozen.hash);
 await assert.rejects(f.db.query('UPDATE nestwise.report_snapshots SET status=$1 WHERE id=$2',['Finalized',save.id]),/immutable/);
 await assert.rejects(f.db.query('DELETE FROM nestwise.report_mappings WHERE id=$1',[command.id]),/immutable/);
});
test('personal/family scope, revoked rights, invalid sums and forged origins fail closed',async()=>{
 const r=await read(),l=r.data.lines[0],command={id:randomUUID(),transaction:l.transaction_id,line:l.line,expected_revision:2,allocations:[{category:'tax_23',cents:'9999'}]};assert.equal((await f.fetch(request(root()+'/mappings',command))).status,400);
 assert.equal((await f.fetch(request(root()+'/mappings',command,{cookie,origin:'https://evil.invalid'}))).status,403);
 for(const kind of ['personal','family']){await f.db.query('UPDATE nestwise.workspaces SET kind=$1 WHERE id=$2',[kind,f.workspace]);assert.equal((await f.fetch(request(root()+'?from=2026-10-01&to=2026-10-31'))).status,404);assert.equal((await f.fetch(request(root()+'/snapshots'))).status,404);assert.equal((await f.fetch(request(root()+'/mappings',command))).status,404);}
 await f.db.query("UPDATE nestwise.workspaces SET kind='business' WHERE id=$1",[f.workspace]);await f.db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[f.workspace]);assert.equal((await f.fetch(request(root()+'/mappings',command))).status,404);assert.equal((await read()).data.lines.length,1);
});

test('explicit personal business share and partial reimbursement do not duplicate reported expense',async()=>{
 await f.db.query("UPDATE nestwise.memberships SET role='owner' WHERE workspace_id=$1",[f.workspace]);
 const personal=randomUUID(),pa=randomUUID();await f.db.query("INSERT INTO nestwise.workspaces VALUES($1,'Synthetic personal','personal')",[personal]);await f.db.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES($1,$2,'Personal card')",[pa,personal]);await f.db.query("INSERT INTO nestwise.memberships SELECT $1,id,'owner',true FROM nestwise.users WHERE subject=$2",[personal,`better-auth:${f.id}`]);
 async function expense(w,a,amount,kind='expense',ref=null){const op={id:randomUUID(),kind,paid_on:'2026-10-20',amount_cents:amount,note:'Synthetic owner-paid purchase',destination_account:null,reference_operation:ref,allocations:kind==='expense'?[{category:'supplies',cents:amount}]:[]};await f.db.query('SELECT nestwise.post_manual_operation($1,$2,$3,$4)',[`better-auth:${f.id}`,w,a,JSON.stringify(op)]);return {operation:op.id,transaction:(await f.db.query('SELECT id FROM nestwise.journal_transactions WHERE manual_id=$1',[op.id])).rows[0].id};}
 const origin=await expense(personal,pa,'10000'),claim={id:randomUUID(),transaction:origin.transaction,business_cents:'6000'};
 assert.equal((await f.fetch(request(root()+'/owner-expenses',claim))).status,200);assert.equal((await f.fetch(request(root()+'/owner-expenses',claim))).status,200);
 assert.equal((await f.fetch(request(root()+'/owner-expenses',{...claim,id:randomUUID()}))).status,409);
 let r=await read(),l=r.data.lines.find(x=>x.transaction_id===origin.transaction);assert.equal(l.cents,'10000');assert.equal(l.report_cents,'6000');assert.equal(l.source_workspace,personal);assert.equal(reportTotals(r).expense,16000n);
 const map={id:randomUUID(),transaction:origin.transaction,line:l.line,expected_revision:0,allocations:[{category:'tax_23',cents:'6000'}]};assert.equal((await f.fetch(request(root()+'/mappings',map))).status,200);
 const paid=await expense(f.workspace,f.account,'3000'),settle={id:randomUUID(),link:claim.id,transaction:paid.transaction};assert.equal(reportTotals(await read()).expense,19000n);
 assert.equal((await f.fetch(request(root()+'/reimbursements',settle))).status,200);assert.equal((await f.fetch(request(root()+'/reimbursements',settle))).status,200);r=await read();assert.equal(reportTotals(r).expense,16000n);assert.equal(r.data.owner_expenses[0].reimbursed_cents,'3000');
 const over=await expense(f.workspace,f.account,'4000');assert.equal((await f.fetch(request(root()+'/reimbursements',{id:randomUUID(),link:claim.id,transaction:over.transaction}))).status,400);
 await expense(personal,pa,'5000','refund',origin.operation);r=await read();assert.equal(r.data.owner_expenses[0].source_refunds,'5000');assert.match(reportHTML(r),/source refunds requiring review: 1/);
 // Returned reimbursements are excluded from expenses and reduce only the reimbursement balance.
 await expense(f.workspace,f.account,'1000','refund',paid.operation);
 r=await read();assert.equal(r.data.owner_expenses[0].reimbursed_cents,'2000');assert.equal(reportTotals(r).expense,20000n);
 assert.equal((await f.fetch(request(root()+'/mappings',{id:randomUUID(),transaction:paid.transaction,line:2,expected_revision:0,allocations:[{category:'tax_23',cents:'3000'}]}))).status,400);
 const cancelPurchase={id:randomUUID(),target:claim.id,kind:'purchase',reason:'Synthetic correction'};
 assert.equal((await f.fetch(request(root()+'/cancellations',cancelPurchase))).status,409);
 const undo={id:randomUUID(),target:settle.id,kind:'reimbursement',reason:'Synthetic correction'};
 assert.equal((await f.fetch(request(root()+'/cancellations',undo))).status,200);assert.equal((await f.fetch(request(root()+'/cancellations',undo))).status,200);
 assert.equal(reportTotals(await read()).expense,22000n);
 assert.equal((await f.fetch(request(root()+'/cancellations',cancelPurchase))).status,200);
 assert.equal(reportTotals(await read()).expense,16000n);
 // Re-link with the corrected amount; the former mapping cannot silently carry over.
 assert.equal((await f.fetch(request(root()+'/owner-expenses',{id:randomUUID(),transaction:origin.transaction,business_cents:'4000'}))).status,200);
 r=await read();l=r.data.lines.find(x=>x.transaction_id===origin.transaction);assert.equal(l.mapping,null);assert.equal(l.mapping_revision,1);assert.equal(l.report_cents,'4000');
 const revised={...map,id:randomUUID(),expected_revision:1,allocations:[{category:'tax_23',cents:'4000'}]};assert.equal((await f.fetch(request(root()+'/mappings',revised))).status,200);
 assert.equal((await f.fetch(request(root()+'/mappings',{...revised,id:randomUUID(),expected_revision:2,allocations:[]}))).status,200);
 l=(await read()).data.lines.find(x=>x.transaction_id===origin.transaction);assert.equal(l.mapping,null);assert.equal(l.mapping_revision,3);
 await assert.rejects(f.db.query('DELETE FROM nestwise.owner_expense_cancellations WHERE id=$1',[undo.id]),/immutable/);
 await assert.rejects(f.db.query("UPDATE nestwise.financial_accounts SET currency='EUR' WHERE id=$1",[pa]),/financial_accounts_currency_check/);
 const other=await expense(personal,pa,'900');await f.db.query('DELETE FROM nestwise.memberships WHERE workspace_id=$1',[personal]);assert.equal((await f.fetch(request(root()+'/owner-expenses',{id:randomUUID(),transaction:other.transaction,business_cents:'900'}))).status,404);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions WHERE manual_id=$1',[origin.operation])).rows[0].n,1);
});


test('malformed commands return a client error and exports escape untrusted strings',async()=>{
 for(const body of [{id:'not-a-uuid',transaction:randomUUID(),line:2,expected_revision:0,allocations:[]},{id:randomUUID(),transaction:randomUUID(),line:'NaN',expected_revision:0,allocations:[]}])assert.equal((await f.fetch(request(root()+'/mappings',body))).status,400);
 const r=await read();r.data.workspace_name='<script>alert(1)</script>';r.data.lines[0].source_order='=HYPERLINK("https://evil.invalid")';
 assert.doesNotMatch(reportHTML(r),/<script>/);assert.match(reportHTML(r),/&lt;script&gt;/);assert.match(reportCSV(r),/"'=HYPERLINK/);
 const invalid=structuredClone(r);invalid.data.owner_expenses[0].reimbursed_cents='NaN';assert.throws(()=>parseReport(invalid));
 const lone=structuredClone(r);lone.data.lines=[{...lone.data.lines[0],cents:'-9007199254740991',report_cents:'9007199254740991',code:'receipts',owner_link:null,business_cents:null,mapping:null,mapping_revision:0}];
 assert.equal(reportTotals(parseReport(lone)).income,9007199254740991n);
});
