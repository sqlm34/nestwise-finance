const {Buffer}=require('node:buffer');
const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
const {parseReceipt,receiptMime}=require('../.test-build/src/domain/receipt.js');
let fixture,cookie;const bytes=Buffer.from('%PDF-1.4\nSynthetic receipt only\n%%EOF'),hash=createHash('sha256').update(bytes).digest('hex');
const data=()=>({supplier:'Synthetic shop',date:'2026-10-18',currency:'USD',items:[{description:'Supplies',cents:'1000'}],tax_cents:'70',tip_cents:'0',shipping_cents:'0',discount_cents:'20',total_cents:'1050'});
const base=()=>`/v1/user/workspaces/${fixture.workspace}/accounts/${fixture.account}/receipts`;
function bucket(){const values=new Map();return {values,fail:false,async put(key,bytes){if(this.fail)throw new Error('storage unavailable');if(!values.has(key))values.set(key,Uint8Array.from(bytes));},async get(key){const b=values.get(key);return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;}};}
const request=(path,body,raw=false,headers={cookie,origin:'http://localhost:8081'})=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{'Content-Type':raw?'application/octet-stream':'application/json',...headers},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
before(async()=>{fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();fixture.env.STATEMENTS=bucket();fixture.env.STATEMENTS_BACKUP=bucket();
 const r=await fixture.fetch(request('/api/auth/sign-in/email',{email:fixture.email,password:fixture.password},false,{origin:'http://localhost:8081'}));cookie=r.headers.getSetCookie().map(s=>s.split(';')[0]).join('; ');});
after(async()=>{await fixture?.db.close();});
test('receipt review requires visible exact totals and never invents absent tax or tips',()=>{
 assert.equal(parseReceipt(data(),true).total_cents,'1050');assert.equal(parseReceipt({...data(),tax_cents:null}).tax_cents,null);
 for(const patch of [{total_cents:'1049'},{tax_cents:null},{date:'2026-02-30'},{currency:'EUR'},{items:[]}])assert.throws(()=>parseReceipt({...data(),...patch},true));
 assert.equal(receiptMime(bytes),'application/pdf');assert.throws(()=>receiptMime(Buffer.from('<html>not a receipt</html>')));
});
test('private originals require both copies; upload and review never book expenses',async()=>{
 assert.equal((await fixture.fetch(request(base()+`/${hash}/original`,bytes,true,{origin:'http://localhost:8081'}))).status,401);
 fixture.env.STATEMENTS_BACKUP.fail=true;assert.equal((await fixture.fetch(request(base()+`/${hash}/original`,bytes,true))).status,503);
 let list=await (await fixture.fetch(request(base()))).json();assert.equal(list[0].archived,false);
 fixture.env.STATEMENTS_BACKUP.fail=false;assert.equal((await fixture.fetch(request(base()+`/${hash}/original`,bytes,true))).status,200);
 const original=await fixture.fetch(request(base()+`/${hash}/original`));assert.equal(original.status,200);assert.deepEqual(Buffer.from(await original.arrayBuffer()),bytes);assert.equal(original.headers.get('cache-control'),'no-store');
 assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
});
test('receipt review versions reject stale changes and explicit posting is atomic and idempotent',async()=>{
 const review={id:randomUUID(),expected:0,data:data()};for(let i=0;i<2;i++)assert.equal((await fixture.fetch(request(base()+`/${hash}/review`,review))).status,200);
 assert.equal((await fixture.fetch(request(base()+`/${hash}/review`,{...review,id:randomUUID()}))).status,409);
 assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
 const post={review:review.id,operation:randomUUID(),paid_on:'2026-10-20'};
 for(let i=0;i<2;i++){const r=await fixture.fetch(request(base()+`/${hash}/post`,post));assert.equal(r.status,200,await r.clone().text());}
 assert.equal((await fixture.fetch(request(base()+`/${hash}/post`,{...post,operation:randomUUID()}))).status,409);
 assert.equal((await fixture.fetch(request(base()+`/${hash}/review`,{id:randomUUID(),expected:1,data:data()}))).status,409);
 assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1);
 const op=(await fixture.db.query('SELECT payload FROM nestwise.manual_operations WHERE id=$1',[post.operation])).rows[0].payload;
 assert.equal(op.paid_on,'2026-10-20','printed receipt date must not silently become the payment date');
 assert.equal(op.amount_cents,'1050');
 await assert.rejects(fixture.db.query('DELETE FROM nestwise.receipt_reviews'),/immutable/);
});
test('OCR requires explicit per-document consent, stays disabled without configuration and uses durable quotas',async()=>{
 assert.equal((await fixture.fetch(request(base()+`/${hash}/ocr`,{}))).status,400);
 assert.equal((await fixture.fetch(request(base()+`/${hash}/ocr`,{consent:true}))).status,503);
 for(let i=0;i<20;i++)await fixture.db.query('SELECT nestwise.claim_receipt_ocr($1,$2,$3,$4)',[`better-auth:${fixture.id}`,fixture.workspace,fixture.account,hash]);
 await assert.rejects(fixture.db.query('SELECT nestwise.claim_receipt_ocr($1,$2,$3,$4)',[`better-auth:${fixture.id}`,fixture.workspace,fixture.account,hash]),/ocr_rate_limited/);
});

test('receipt pagination retains older evidence across tied timestamps and rejects ambiguous cursors',async()=>{
 const user=(await fixture.db.query('SELECT actor FROM nestwise.receipt_originals LIMIT 1')).rows[0].actor;
 await fixture.db.query(`INSERT INTO nestwise.receipt_originals(workspace_id,account_id,hash,bytes,mime,actor,created_at)
   SELECT $1,$2,lpad(to_hex(n),64,'0'),32,'image/png',$3,'2026-01-01T00:00:00Z' FROM generate_series(1,105) n`,[fixture.workspace,fixture.account,user]);
 const page1=await (await fixture.fetch(request(base()))).json();assert.equal(page1.length,100);
 const page2=await (await fixture.fetch(request(base()+'?before='+page1.at(-1).hash))).json();assert.equal(page2.length,6);
 assert.equal(new Set([...page1,...page2].map(row=>row.hash)).size,106);
 for(const query of ['?before=bad','?before='+hash+'&before='+hash,'?extra=1','?before='+'f'.repeat(64)])
   assert.equal((await fixture.fetch(request(base()+query))).status,400);
});
