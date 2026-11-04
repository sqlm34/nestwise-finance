const {test}=require('node:test');const assert=require('node:assert/strict');
const {receiptCardTarget}=require('../.test-build/src/domain/receipt-routing.js');
const {receiptApi}=require('../.test-build/worker/receipts.js');
const workspace='11111111-1111-4111-8111-111111111111',account='22222222-2222-4222-8222-222222222222';
const spaces=[{id:workspace,name:'Synthetic',kind:'personal',role:'owner',accounts:[{id:account,name:'Synthetic bank',currency:'USD'}]}];
const raw=JSON.stringify(['1111','2222','3333','4444','5555'].map(last4=>({last4,workspace,account})));
test('card routing requires an exact unique configured card and current write access; never guesses bank names',()=>{
 for(const last4 of ['1111','2222','3333','4444','5555'])assert.equal(receiptCardTarget(raw,last4,spaces).account,account);
 for(const last4 of [null,undefined,'9999','27'])assert.equal(receiptCardTarget(raw,last4,spaces),null);
 assert.equal(receiptCardTarget(raw,'2222',[]),null);
 assert.equal(receiptCardTarget(raw,'2222',[{...spaces[0],role:'reviewer'}]),null);
 assert.equal(receiptCardTarget(JSON.stringify([...JSON.parse(raw),JSON.parse(raw)[1]]),'2222',spaces),null);
 assert.throws(()=>receiptCardTarget('[{"last4":"2222"}]','2222',spaces));
});
test('old native receipt clients keep their exact schema while current clients receive only card suffix',async()=>{
 const row={hash:'a'.repeat(64),review:{data:{supplier:'Synthetic',card_last4:'2222'}}};
 const db={documentAccess:async()=>{},readReceipts:async()=>[row]};
 const url=`https://synthetic.invalid/v1/user/workspaces/${workspace}/accounts/${account}/receipts`;
 const old=await receiptApi(new Request(url),{},db,'synthetic',workspace,account);
 assert.deepEqual(await old.json(),[{hash:row.hash,review:{data:{supplier:'Synthetic'}}}]);
 const current=await receiptApi(new Request(url,{headers:{Accept:'application/vnd.nestwise.receipt-v2+json'}}),{},db,'synthetic',workspace,account);
 assert.deepEqual(await current.json(),[row]);assert.equal(row.review.data.card_last4,'2222');
});
test('wrong-account posting is refused before any ledger write',async()=>{
 let posts=0;const db={documentAccess:async()=>{},readReceipts:async()=>[{review:{data:{card_last4:'2222'}}}],userAccess:async()=>spaces,postReceipt:async()=>{posts++;}};
 const response=await receiptApi(new Request('https://synthetic.invalid/',{method:'POST',body:'{}'}),{NESTWISE_RECEIPT_CARD_ROUTES:raw},db,'synthetic',workspace,'33333333-3333-4333-8333-333333333333','a'.repeat(64),'post');
 assert.equal(response.status,409);assert.equal((await response.json()).error,'receipt_wrong_account');assert.equal(posts,0);
});
test('authenticated transfer retries preserve one original and review per account and never book money',async()=>{
 const {randomUUID,createHash}=require('node:crypto');
 const fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();
 try{
  const bucket=()=>{const entries=new Map();return {fail:false,async put(key,bytes){if(this.fail)throw Error('synthetic storage outage');if(!entries.has(key))entries.set(key,Uint8Array.from(bytes));},async get(key){const bytes=entries.get(key);return bytes?{size:bytes.length,arrayBuffer:async()=>bytes.buffer}:null;}};};
  fixture.env.STATEMENTS=bucket();fixture.env.STATEMENTS_BACKUP=bucket();
  const target=randomUUID();await fixture.db.query('INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,$3)',[target,fixture.workspace,'Synthetic target']);
  fixture.env.NESTWISE_RECEIPT_CARD_ROUTES=JSON.stringify([{last4:'2222',workspace:fixture.workspace,account:target}]);
  const login=await fixture.fetch(new Request('http://localhost:8083/api/auth/sign-in/email',{method:'POST',headers:{origin:'http://localhost:8081','Content-Type':'application/json'},body:JSON.stringify({email:fixture.email,password:fixture.password})}));
  const cookie=login.headers.get('set-cookie').split(';')[0];
  const bytes=new TextEncoder().encode('%PDF-1.4 synthetic routing receipt only'),hash=createHash('sha256').update(bytes).digest('hex');
  const root=`/v1/user/workspaces/${fixture.workspace}/accounts/${fixture.account}/receipts/${hash}`;
  const request=(path,body,raw=false)=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:'http://localhost:8081','Content-Type':raw?'application/octet-stream':'application/json',Accept:'application/vnd.nestwise.receipt-v2+json'},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
  assert.equal((await fixture.fetch(request(root+'/original',bytes,true))).status,200);
  const review=randomUUID(),data={supplier:'Synthetic',date:'2026-11-04',currency:'USD',card_last4:'2222',items:[{description:'Synthetic part',cents:'100'}],tax_cents:'0',tip_cents:'0',shipping_cents:'0',discount_cents:'0',total_cents:'100'};
  assert.equal((await fixture.fetch(request(root+'/review',{id:review,expected:0,data}))).status,200);
  fixture.env.STATEMENTS_BACKUP.fail=true;
  assert.equal((await fixture.fetch(request(root+'/route',{review}))).status,503);
  fixture.env.STATEMENTS_BACKUP.fail=false;
  for(let i=0;i<2;i++){const r=await fixture.fetch(request(root+'/route',{review}));assert.equal(r.status,200,await r.clone().text());assert.equal((await r.json()).target.account,target);}
  const saved=await fixture.fetch(request(root.replace(fixture.account,target)));assert.equal((await saved.json())[0].review.data.card_last4,'2222');
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.receipt_reviews WHERE account_id=$1',[target])).rows[0].n,1);
  assert.equal((await fixture.db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
 }finally{await fixture.db.close();}
});
