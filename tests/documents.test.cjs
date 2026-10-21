const {Buffer}=require('node:buffer');
const {test,before,after}=require('node:test');
const assert=require('node:assert/strict');
const {createHash,randomUUID}=require('node:crypto');
const {parseDocuments}=require('../.test-build/src/domain/documents.js');
const hash=bytes=>createHash('sha256').update(bytes).digest('hex');
class Bucket{
  objects=new Map();fail=false;writes=0;
  async put(key,bytes,options){this.writes++;if(this.fail)throw new Error('simulated outage');assert.equal(options.onlyIf.etagDoesNotMatch,'*');if(!this.objects.has(key))this.objects.set(key,Uint8Array.from(bytes));}
  async get(key){if(this.fail)throw new Error('simulated outage');const bytes=this.objects.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>Uint8Array.from(bytes).buffer}:null;}
}
let fixture,cookie;const primary=new Bucket(),backup=new Bucket();
const bytes=Buffer.from('\uFEFFPosting Date,Description,Amount\r\n10/20/2026,"Synthetic, only",12.34\r\n');
const digest=hash(bytes);
const path=()=>`/v1/user/workspaces/${fixture.workspace}/accounts/${fixture.account}/documents`;
const request=(suffix='',body,options={})=>new Request('http://localhost:8083'+path()+suffix,{method:body===undefined?'GET':'POST',headers:{...(options.noCookie?{}:{cookie}),...(options.noOrigin?{}:{origin:options.origin||fixture.env.AUTH_WEB_ORIGIN}),'Content-Type':'text/csv'},body});
before(async()=>{fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();fixture.env.STATEMENTS=primary;fixture.env.STATEMENTS_BACKUP=backup;
  const login=await fixture.fetch(new Request('http://localhost:8083/api/auth/sign-in/email',{method:'POST',headers:{'Content-Type':'application/json',origin:fixture.env.AUTH_WEB_ORIGIN},body:JSON.stringify({email:fixture.email,password:fixture.password})}));
  cookie=login.headers.getSetCookie().map(value=>value.split(';')[0]).join('; ');
});
after(async()=>{await fixture?.db.close();});
test('archive authenticates and checks origin before reading or writing objects',async()=>{
  assert.equal((await fixture.fetch(request('/'+digest,bytes,{noCookie:true}))).status,401);
  assert.equal((await fixture.fetch(request('/'+digest,bytes,{noOrigin:true}))).status,403);
  assert.equal((await fixture.fetch(request('/'+digest,bytes,{origin:'https://attacker.test'}))).status,403);
  assert.equal(primary.writes,0);
  const wrong=new Request(request('/'+digest,bytes).url.replace(fixture.account,randomUUID()),request('/'+digest,bytes));
  assert.equal((await fixture.fetch(wrong)).status,404);assert.equal(primary.writes,0);
});
test('archive rejects mismatched hash, invalid encoding, malformed CSV and oversized streams',async()=>{
  for(const bad of [Buffer.from('bad csv'),Buffer.from([255,254,0,10]),Buffer.from('Date,Description,Amount\n02/30/2026,bad,1.00')])
    assert.equal((await fixture.fetch(request('/'+hash(bad),bad))).status,400);
  assert.equal((await fixture.fetch(request('/'+'a'.repeat(64),bytes))).status,400);
  assert.equal((await fixture.fetch(request('/'+digest,Buffer.alloc(2_000_001,97)))).status,413);
  assert.deepEqual(await (await fixture.fetch(request())).json(),[]);
});
test('partial copy failure is pending; retry is immutable and preserves exact BOM/CRLF bytes',async()=>{
  backup.fail=true;assert.equal((await fixture.fetch(request('/'+digest,bytes))).status,503);
  let docs=parseDocuments(await (await fixture.fetch(request())).json());assert.equal(docs.length,1);assert.equal(docs[0].archived,false);
  assert.equal((await fixture.fetch(request('/'+digest))).status,404);
  backup.fail=false;
  for(let i=0;i<2;i++){const response=await fixture.fetch(request('/'+digest,bytes));assert.equal(response.status,200,await response.clone().text());}
  docs=parseDocuments(await (await fixture.fetch(request())).json());assert.equal(docs.length,1);assert.equal(docs[0].archived,true);
  const retrieved=await fixture.fetch(request('/'+digest));assert.equal(retrieved.status,200);assert.equal(retrieved.headers.get('Cache-Control'),'no-store');assert.equal(retrieved.headers.get('X-Content-Type-Options'),'nosniff');assert.match(retrieved.headers.get('Content-Disposition'),/^attachment;/);
  assert.deepEqual(Buffer.from(await retrieved.arrayBuffer()),bytes);
  assert.deepEqual(await (await fixture.fetch(request('/'+digest+'/verify'))).json(),{hash:digest,primary:true,backup:true});
});
test('corrupt primary falls back to verified backup; corrupt copies are never served',async()=>{
  const key=[...primary.objects.keys()][0];primary.objects.set(key,new Uint8Array(bytes.length));
  const fallback=await fixture.fetch(request('/'+digest));assert.equal(fallback.status,200);assert.equal(fallback.headers.get('X-Archive-Copy'),'backup');assert.deepEqual(Buffer.from(await fallback.arrayBuffer()),bytes);
  assert.deepEqual(await (await fixture.fetch(request('/'+digest+'/verify'))).json(),{hash:digest,primary:false,backup:true});
  backup.fail=true;assert.equal((await fixture.fetch(request('/'+digest))).status,503);backup.fail=false;
  primary.objects.set(key,Uint8Array.from(bytes));
});
test('read-only/revoked access, immutable metadata and runtime grants protect the archive',async()=>{
  await fixture.db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[fixture.workspace]);
  assert.equal((await fixture.fetch(request('/'+digest))).status,200);assert.equal((await fixture.fetch(request('/'+digest,bytes))).status,404);
  await fixture.db.query('UPDATE nestwise.memberships SET all_accounts=false WHERE workspace_id=$1',[fixture.workspace]);
  assert.equal((await fixture.fetch(request())).status,404);assert.equal((await fixture.fetch(request('/'+digest))).status,404);
  await fixture.db.query("UPDATE nestwise.memberships SET role='owner',all_accounts=true WHERE workspace_id=$1",[fixture.workspace]);
  await assert.rejects(fixture.db.query('DELETE FROM nestwise.statement_documents'),/immutable_financial_history/);
  await assert.rejects(fixture.db.query('DELETE FROM nestwise.statement_archived'),/immutable_financial_history/);
  await fixture.db.exec('BEGIN; SET LOCAL ROLE nestwise_api');try{await assert.rejects(fixture.db.query('SELECT * FROM nestwise.statement_documents'),/permission denied/);}finally{await fixture.db.exec('ROLLBACK');}
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
});
test('quota counts pending reservations, permits same-file retry, and cannot be bypassed by other hashes',async()=>{
  const subject=`better-auth:${fixture.id}`;
  for(let i=0;i<99;i++)await fixture.db.query('SELECT nestwise.prepare_document($1,$2,$3,$4,10)',[subject,fixture.workspace,fixture.account,hash('reservation'+i)]);
  assert.equal(parseDocuments(await (await fixture.fetch(request())).json()).length,100);
  assert.equal((await fixture.fetch(request('/'+digest,bytes))).status,200);
  const another=Buffer.from(bytes.toString().replace('12.34','12.35'));
  assert.equal((await fixture.fetch(request('/'+hash(another),another))).status,409);
  await assert.rejects(fixture.db.query('SELECT nestwise.prepare_document($1,$2,$3,$4,1)',[subject,fixture.workspace,fixture.account,digest]),/invalid_document/);
});

test('live evidence review detects forged descriptions, releases canceled claims and identifies cross-file reservations',async()=>{
  const {parseEvidenceReview}=require('../.test-build/src/domain/statement-evidence.js');
  await fixture.db.query('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)',['document-evidence',fixture.workspace,fixture.account]);
  await fixture.db.query('SELECT nestwise.accept_event($1,$2,$3,$4)',['document-evidence',randomUUID(),Math.floor(Date.now()/1000),JSON.stringify({schema_version:1,source_event_id:randomUUID(),source_order_id:'evidence-only',source_fact_id:randomUUID(),order_revision:1,type:'job.payment_recorded',currency:'USD',occurred_at:'2026-10-20T12:00:00Z',paid_at:'2026-10-20T12:00:00Z',amount_cents:1234})]);
  const tx=(await fixture.db.query('SELECT id FROM nestwise.journal_transactions')).rows[0].id;
  const subject=`better-auth:${fixture.id}`,base={file_hash:digest,rows:[{line:2,date:'2026-10-20',cents:'1234',text_hash:hash('synthetic, only')}],transactions:[tx]};
  const save=async body=>{await fixture.db.query('SELECT nestwise.save_reconciliation($1,$2,$3,$4)',[subject,fixture.workspace,fixture.account,JSON.stringify(body)]);return body.id;};
  const cancel=async id=>fixture.db.query('SELECT nestwise.cancel_reconciliation($1,$2,$3,$4,$5)',[subject,fixture.workspace,fixture.account,id,'recheck']);
  const review=async()=>{const result=await fixture.fetch(request('/'+digest+'/review'));assert.equal(result.status,200,await result.clone().text());return parseEvidenceReview(await result.json(),digest);};
  const correct=await save({...base,id:randomUUID()});assert.equal((await review()).totals.matched.count,1);
  await cancel(correct);let report=await review();assert.equal(report.totals.unmatched.count,1);assert.equal(report.canceled,1);
  const forged=await save({...base,id:randomUUID(),rows:[{...base.rows[0],text_hash:hash('invented description')}]});
  report=await review();assert.equal(report.totals.mismatch.count,1);assert.equal(report.groups[0].valid,false);await cancel(forged);
  const external=await save({...base,id:randomUUID(),file_hash:'e'.repeat(64)});report=await review();assert.equal(report.totals.reserved.count,1);assert.equal(report.totals.matched.count,0);await cancel(external);
  assert.equal((await fixture.fetch(request('/'+digest+'/review',undefined,{noCookie:true}))).status,401);
  await fixture.db.query('UPDATE nestwise.memberships SET all_accounts=false WHERE workspace_id=$1',[fixture.workspace]);
  assert.equal((await fixture.fetch(request('/'+digest+'/review'))).status,404);
  await fixture.db.query('UPDATE nestwise.memberships SET all_accounts=true WHERE workspace_id=$1',[fixture.workspace]);
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1,'review never posts additional money');
});
