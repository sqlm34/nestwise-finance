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
