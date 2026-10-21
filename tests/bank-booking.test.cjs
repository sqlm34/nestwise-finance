const {test,before,after}=require('node:test');const assert=require('node:assert/strict');
const {randomUUID,createHash}=require('node:crypto');
let fixture,cookie;const text='Posting Date,Description,Amount\n10/20/2026,Synthetic bank fee,-3.00\n',hash=createHash('sha256').update(text).digest('hex');
const root=()=>`/v1/user/workspaces/${fixture.workspace}/accounts/${fixture.account}`;
const request=(path,body,type='application/json')=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:'http://localhost:8081','Content-Type':type},body:body===undefined?undefined:type==='text/csv'?body:JSON.stringify(body)});
const bucket=()=>{const objects=new Map();return {async put(key,bytes){if(!objects.has(key))objects.set(key,Uint8Array.from(bytes));},async get(key){const b=objects.get(key);return b?{size:b.length,arrayBuffer:async()=>Uint8Array.from(b).buffer}:null;}};};
before(async()=>{fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();fixture.env.STATEMENTS=bucket();fixture.env.STATEMENTS_BACKUP=bucket();
 const login=await fixture.fetch(request('/api/auth/sign-in/email',{email:fixture.email,password:fixture.password}));cookie=login.headers.getSetCookie().map(x=>x.split(';')[0]).join('; ');
 assert.equal((await fixture.fetch(request(root()+`/documents/${hash}`,text,'text/csv'))).status,200);
});
after(async()=>{await fixture?.db.close();});
test('explicit bank booking uses verified original values and atomic reconciliation with retry safety',async()=>{
 const p={id:randomUUID(),line:2,category:'fees',confirm_no_existing_entry:true},path=root()+`/documents/${hash}/book`;
 assert.equal((await fixture.fetch(request(path,{...p,confirm_no_existing_entry:false}))).status,400);
 assert.equal((await fixture.fetch(request(path,{...p,amount_cents:'9999'}))).status,400);
 for(let i=0;i<2;i++){const r=await fixture.fetch(request(path,p));assert.equal(r.status,200,await r.clone().text());}
 const operation=(await fixture.db.query('SELECT payload FROM nestwise.manual_operations WHERE id=$1',[p.id])).rows[0].payload;
 assert.equal(operation.amount_cents,'300');assert.equal(operation.kind,'expense');assert.equal(operation.paid_on,'2026-10-20');
 assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1);
 assert.equal((await fixture.fetch(request(path,{...p,id:randomUUID()}))).status,409);
 assert.equal((await fixture.fetch(request(root()+`/reconciliations/${p.id}/cancel`,{reason:'recheck'}))).status,200);
 assert.equal((await fixture.fetch(request(path,{...p,id:randomUUID()}))).status,409,'canceling a match must not erase bank posting origin');
 assert.equal((await fixture.fetch(request(path,p))).status,200,'old retry does not recreate canceled reconciliation');
 assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.reconciliation_claims')).rows[0].n,0);
 const review=await (await fixture.fetch(request(root()+`/documents/${hash}/review`))).json();
 assert.equal(review.rows[0].status,'posted');assert.equal(review.totals.posted.debits,'300');assert.equal(review.canceled,1);
});
test('overlapping statement versions cannot book the same bank fact again',async()=>{
 const other=text.replace('Posting Date','Date'),otherHash=createHash('sha256').update(other).digest('hex');
 assert.equal((await fixture.fetch(request(root()+`/documents/${otherHash}`,other,'text/csv'))).status,200);
 assert.equal((await fixture.fetch(request(root()+`/documents/${otherHash}/book`,{id:randomUUID(),line:2,category:'fees',confirm_no_existing_entry:true}))).status,409);
 assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1);
 const review=await (await fixture.fetch(request(root()+`/documents/${otherHash}/review`))).json();
 assert.equal(review.rows[0].status,'posted');assert.equal(review.totals.posted.debits,'300');
});
