const {test,before,after}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {parsePartsCommand,parseParts}=require('../.test-build/src/domain/parts.js');
const {parseReport,reportTotals,reportHTML}=require('../.test-build/src/domain/accountant-report.js');
let f,cookie;const lot=randomUUID();let revision=0;
const command=(kind,extra={})=>({id:randomUUID(),lot,expected_revision:revision,kind,...extra});
const root=()=>`/v1/user/workspaces/${f.workspace}/accounts/${f.account}`;
const req=(path,body)=>new Request('http://localhost:8787'+path,{method:body?'POST':'GET',headers:{cookie,origin:'http://localhost:8081','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{})});
const post=async c=>f.fetch(req(root()+'/parts',c));
const read=async()=>parseParts(await(await f.fetch(req(root()+'/parts'))).json());
before(async()=>{f=await require('../scripts/auth-fixture.cjs').createAuthFixture();const r=await f.fetch(new Request('http://localhost:8787/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',origin:'http://localhost:8081'},body:JSON.stringify({email:f.email,password:f.password})}));cookie=r.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');});after(async()=>{await f?.db.close();});
test('old stock retains unknown payment date; job use never posts another cash expense',async()=>{
 const c=command('create',{name:'Synthetic pump',quantity:3,unit_cents:'2500',paid_on:null,note:'Old stock'});
 assert.equal((await post(c)).status,200);assert.equal((await post(c)).status,200);revision++;
 assert.equal((await post({...c,id:randomUUID()})).status,409);
 let p=(await read())[0];assert.equal(p.state.paid_on,null);assert.equal(p.state.transaction,null);
 const usage=command('consume',{quantity:2,job:'SYNTHETIC-1',used_on:'2026-10-21'});assert.equal((await post(usage)).status,200);assert.equal((await post(usage)).status,200);revision++;
 assert.equal((await post(command('consume',{quantity:2,job:'SYNTHETIC-1',used_on:'2026-10-21'}))).status,409);
 assert.equal((await post(command('return',{quantity:1,job:'OTHER-JOB',used_on:'2026-10-21'}))).status,409);
 assert.equal((await post(command('return',{quantity:1,job:'SYNTHETIC-1',used_on:'2026-10-21'}))).status,200);revision++;
 p=(await read())[0];assert.equal(p.state.used,1);assert.equal(p.state.paid_on,null);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
 const r=parseReport(await(await f.fetch(req(root()+'/reports?from=2026-10-01&to=2026-10-31'))).json());assert.equal(r.data.status,'Prepared for handoff');assert.equal(reportTotals(r).expense,0n);assert.match(reportHTML(r),/UNKNOWN DATE/);
});
test('existing payment can cover multiple lots without double cash or over-allocation',async()=>{
 const op={id:randomUUID(),kind:'expense',paid_on:'2025-04-10',amount_cents:'10000',note:'Synthetic parts seller',destination_account:null,reference_operation:null,allocations:[{category:'parts',cents:'10000'}]};
 // Use a supported operational category; category and tax treatment remain distinct.
 op.allocations[0].category='supplies';
 await f.db.query('SELECT nestwise.post_manual_operation($1,$2,$3,$4)',[`better-auth:${f.id}`,f.workspace,f.account,JSON.stringify(op)]);
 const tx=(await f.db.query('SELECT id FROM nestwise.journal_transactions WHERE manual_id=$1',[op.id])).rows[0].id;
 assert.equal((await post(command('evidence',{transaction:tx,paid_on:'2026-10-21',note:''}))).status,400);
 const evidence=command('evidence',{transaction:tx,paid_on:'2025-04-10',note:'Found in old statement'});assert.equal((await post(evidence)).status,200);assert.equal((await post(evidence)).status,200);revision++;
 const l2=randomUUID(),create={...command('create',{name:'Second part',quantity:1,unit_cents:'2500',paid_on:null,note:''}),lot:l2,expected_revision:0};assert.equal((await post(create)).status,200);
 assert.equal((await post({...command('evidence',{transaction:tx,paid_on:'2025-04-10',note:''}),lot:l2,expected_revision:1})).status,200);
 const l3=randomUUID();assert.equal((await post({...create,id:randomUUID(),lot:l3})).status,200);
 assert.equal((await post({...command('evidence',{transaction:tx,paid_on:'2025-04-10',note:''}),lot:l3,expected_revision:1})).status,409);
 assert.equal((await f.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1);
 assert.equal((await read()).find(p=>p.id===lot).state.paid_on,'2025-04-10');
});
test('stock ACL, validation and append-only evidence reject unsafe changes',async()=>{
 await assert.rejects(f.db.query('DELETE FROM nestwise.parts_commands'),/immutable/);
 for(const kind of ['personal','family']){await f.db.query('UPDATE nestwise.workspaces SET kind=$1 WHERE id=$2',[kind,f.workspace]);assert.equal((await f.fetch(req(root()+'/parts'))).status,404);assert.equal((await post(command('archive'))).status,404);}
 await f.db.query("UPDATE nestwise.workspaces SET kind='business' WHERE id=$1",[f.workspace]);
 await f.db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[f.workspace]);assert.equal((await post(command('archive'))).status,404);assert.ok((await read()).length>0);
 const base=command('create',{name:'Part',quantity:1,unit_cents:'100',paid_on:null,note:''});
 for(const change of [{quantity:null},{quantity:1.5},{unit_cents:'1.5'},{paid_on:'2026-02-30'},{extra:true}])assert.throws(()=>parsePartsCommand({...base,...change}));
});

test('purchase search filters actual paid dates, merchant and minimum without creating money',async()=>{
 await f.db.query("UPDATE nestwise.memberships SET role='owner' WHERE workspace_id=$1",[f.workspace]);
 const r=await f.fetch(req(root()+'/purchase-candidates?query=parts%20seller&from=2025-01-01&to=2025-12-31&min=7500'));assert.equal(r.status,200);const rows=await r.json();assert.equal(rows.length,1);assert.equal(rows[0].paid_on,'2025-04-10');assert.equal(rows[0].amount_cents,'10000');
 assert.equal((await(await f.fetch(req(root()+'/purchase-candidates?query=absent'))).json()).length,0);
 for(const query of ['from=2026-02-30','min=-1','query=x&query=y','from=2026-02-01&to=2026-01-01'])assert.equal((await f.fetch(req(root()+'/purchase-candidates?'+query))).status,400);
 const missing=randomUUID();assert.equal((await f.fetch(req(`/v1/user/workspaces/${f.workspace}/accounts/${missing}/purchase-candidates`))).status,404);
});
test('handoff snapshots freeze parts evidence while historical v1 snapshots stay readable',async()=>{
 const subject=`better-auth:${f.id}`,from='2026-10-01',to='2026-10-31';
 const legacy=(await f.db.query('SELECT nestwise.report_input_v1($1,$2,$3,$4,$5) result',[subject,f.workspace,f.account,from,to])).rows[0].result;
 const oldId=randomUUID();await f.db.query("INSERT INTO nestwise.report_snapshots(id,workspace_id,account_id,actor,date_from,date_to,data,hash,status) SELECT $1,$2,$3,id,$4,$5,$6,$7,'Accountant Review' FROM nestwise.users WHERE subject=$8",[oldId,f.workspace,f.account,from,to,JSON.stringify(legacy.data),legacy.hash,subject]);
 const old=parseReport(await(await f.fetch(req(root()+'/reports/snapshots/'+oldId))).json());assert.equal(old.hash,legacy.hash);assert.equal(old.data.version,'accountant-working-paper-v1');assert.match(reportHTML(old),/NOT FINALIZED/);
 const preview=parseReport(await(await f.fetch(req(root()+'/reports?from='+from+'&to='+to))).json());
 const save={id:randomUUID(),from,to,hash:preview.hash};const sr=await f.fetch(req(root()+'/reports/snapshots',save));const snap=await sr.json();assert.equal(sr.status,200,JSON.stringify(snap));assert.equal(snap.data.parts_evidence.find(x=>x.id===lot).state.used,1);
 const c=command('consume',{quantity:1,job:'SYNTHETIC-2',used_on:'2026-10-21'});assert.equal((await post(c)).status,200);revision++;
 assert.deepEqual(await(await f.fetch(req(root()+'/reports/snapshots/'+save.id))).json(),snap);
 assert.equal((await f.fetch(req(root()+'/reports/snapshots',{...save,id:randomUUID()}))).status,409);
});



test('parts writes enforce web/native origin and retain account scope',async()=>{
 const c=command('archive');
 for(const headers of [{cookie,'Content-Type':'application/json'},{cookie,'Content-Type':'application/json',origin:'https://evil.invalid'}])assert.equal((await f.fetch(new Request('http://localhost:8787'+root()+'/parts',{method:'POST',headers,body:JSON.stringify(c)}))).status,403);
 const other=randomUUID();assert.equal((await f.fetch(req(`/v1/user/workspaces/${other}/accounts/${f.account}/parts`))).status,404);
});
