const {test}=require('node:test');const assert=require('node:assert/strict');
const {Buffer}=require('node:buffer');const {readFileSync}=require('node:fs');const {randomUUID,createHash}=require('node:crypto');
const {parsePdfStatement,statementChecks,receiptCategoryTotals}=require('../.test-build/src/domain/personal-documents.js');
const {recognizeStatement}=require('../.test-build/worker/statement-ocr.js');
const receipt={supplier:'Synthetic groceries',date:'2026-10-30',currency:'USD',items:[{description:'Food',cents:'1000'},{description:'Soap',cents:'500'}],tax_cents:'35',tip_cents:'0',shipping_cents:'0',discount_cents:'0',total_cents:'1535'};
const statement={bank:'Synthetic',mask:'5599',from:'2026-10-01',to:'2026-10-31',currency:'USD',opening_cents:'20000',closing_cents:'18465',complete:true,rows:[{date:'2026-10-30',description:'Synthetic groceries',cents:'-1535'}]};
test('statement recognition validates signs, actual dates, nullable amounts and reconciliation',async()=>{
 assert.deepEqual(statementChecks(statement,'5599'),{complete:true,balanced:true,wrongAccount:false});
 assert.equal(statementChecks({...statement,closing_cents:'1'}).balanced,false);
 assert.equal(statementChecks(statement,'0190').wrongAccount,true);
 assert.equal(statementChecks({...statement,complete:false}).complete,false);
 assert.throws(()=>parsePdfStatement({...statement,rows:[{date:'2026-02-30',description:'x',cents:'1'}]}));
 assert.deepEqual(receiptCategoryTotals(receipt,['groceries','household'],'household'),[{category:'groceries',cents:'1000'},{category:'household',cents:'535'}]);
 assert.throws(()=>receiptCategoryTotals(receipt,['groceries'],'household'));
 const out=await recognizeStatement(Buffer.from('%PDF-1.4\nsynthetic\n%%EOF'),'test','model',async(url,init)=>{const body=JSON.parse(init.body);assert.equal(init.redirect,'manual');assert.equal(body.store,false);assert.equal(body.text.format.name,'statement_review');return Response.json({status:'completed',output:[{content:[{type:'output_text',text:JSON.stringify(statement)}]}]});});assert.deepEqual(out,statement);
 await assert.rejects(recognizeStatement(Buffer.from('%PDF-1.4\nsynthetic\n%%EOF'),'test','model',async()=>Response.json({status:'incomplete',output:[]})),/ocr_incomplete/);
});
test('personal PDFs and categorized receipts remain scoped, recoverable, idempotent and separate from business',async()=>{
 const f=await require('../scripts/auth-fixture.cjs').createAuthFixture();const db=f.db;
 try{
  for(const file of ['0026_personal_bank_feed.sql','0027_bank_sync_cadence.sql','0028_personal_documents.sql'])await db.exec(readFileSync('db/migrations/'+file,'utf8'));
  const bucket=()=>{const m=new Map();return {m,fail:false,async put(k,v){if(this.fail)throw Error();if(!m.has(k))m.set(k,v);},async get(k){const v=m.get(k);return v?{size:v.length,arrayBuffer:async()=>Uint8Array.from(v).buffer}:null;}};};
  f.env.STATEMENTS=bucket();f.env.STATEMENTS_BACKUP=bucket();
  const login=await f.fetch(new Request('http://localhost:8083/api/auth/sign-in/email',{method:'POST',headers:{origin:'http://localhost:8081','Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password})}));
  const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),subject=`better-auth:${f.id}`;
  const base=`/v1/user/workspaces/${f.workspace}/accounts/${f.account}`;
  const req=(path,body,raw=false)=>new Request('http://localhost:8083'+path,{method:body===undefined?'GET':'POST',headers:{cookie,origin:'http://localhost:8081','Content-Type':raw?'application/pdf':'application/json'},body:body===undefined?undefined:raw?body:JSON.stringify(body)});
  assert.equal((await f.fetch(req(base+'/personal-statements'))).status,404);
  await db.query("UPDATE nestwise.workspaces SET kind='personal' WHERE id=$1",[f.workspace]);
  const pdf=Buffer.from('%PDF-1.4\nSynthetic statement only\n%%EOF'),hash=createHash('sha256').update(pdf).digest('hex'),path=base+'/personal-statements/'+hash;
  f.env.STATEMENTS_BACKUP.fail=true;assert.equal((await f.fetch(req(path+'/original',pdf,true))).status,503);
  assert.equal((await f.fetch(req(path+'/original'))).status,404);f.env.STATEMENTS_BACKUP.fail=false;
  for(let i=0;i<2;i++)assert.equal((await f.fetch(req(path+'/original',pdf,true))).status,200);
  assert.equal((await (await f.fetch(req(base+'/personal-statements'))).json()).documents.length,1);
  f.env.STATEMENTS.m.clear();assert.deepEqual(Buffer.from(await (await f.fetch(req(path+'/original'))).arrayBuffer()),pdf);
  const feed=randomUUID();await db.query("INSERT INTO nestwise.bank_feeds(id,workspace_id,account_id,institution,label,mask) VALUES($1,$2,$3,'Synthetic','Checking','5599')",[feed,f.workspace,f.account]);
  const review={id:randomUUID(),expected:0,data:statement};
  for(let i=0;i<2;i++){const r=await f.fetch(req(path+'/review',review));assert.equal(r.status,200,await r.clone().text());}
  assert.equal((await f.fetch(req(path+'/review',{...review,id:randomUUID()}))).status,409);
  assert.equal((await f.fetch(req(path+'/review',{id:randomUUID(),expected:1,data:{...statement,mask:'0190'}}))).status,400);
  assert.equal((await f.fetch(req(path+'/review',{id:randomUUID(),expected:1,data:{...statement,closing_cents:'1'}}))).status,400);
  const rh='a'.repeat(64);await db.query("SELECT nestwise.prepare_receipt($1,$2,$3,$4,100,'image/jpeg')",[subject,f.workspace,f.account,rh]);await db.query('SELECT nestwise.complete_receipt($1,$2,$3,$4)',[subject,f.workspace,f.account,rh]);
  const rid=randomUUID();await db.query('SELECT nestwise.review_receipt($1,$2,$3,$4,$5,0,$6)',[subject,f.workspace,f.account,rh,rid,JSON.stringify(receipt)]);
  await db.query("INSERT INTO nestwise.bank_feed_rows VALUES($1,'bank-one','2026-10-30','Synthetic',-1535,false,'OTHER','USD')",[feed]);
  const exp={id:randomUUID(),review:rid,paid_on:'2026-10-30',bank_id:'bank-one',categories:['groceries','household'],extra:'household'};
  for(let i=0;i<2;i++){const r=await f.fetch(req(base+'/personal-expenses/'+rh,exp));assert.equal(r.status,200,await r.clone().text());}
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
  await db.query('SELECT nestwise.personal_document($1,$2,$3,NULL,\'expenses\',\'{}\')',[subject,f.workspace,f.account]);const expensesResponse=await f.fetch(req(base+'/personal-expenses'));assert.equal(expensesResponse.status,200,await expensesResponse.clone().text());assert.equal((await expensesResponse.json()).length,1);
  await assert.rejects(db.query('SELECT nestwise.post_receipt($1,$2,$3,$4,$5,$6,$7)',[subject,f.workspace,f.account,rh,rid,randomUUID(),'2026-10-30']),/receipt_already_posted/);
  await assert.rejects(db.query('SELECT nestwise.review_receipt($1,$2,$3,$4,$5,1,$6)',[subject,f.workspace,f.account,rh,randomUUID(),JSON.stringify(receipt)]),/receipt_already_posted/);
  const rh2='b'.repeat(64),rid2=randomUUID();await db.query("SELECT nestwise.prepare_receipt($1,$2,$3,$4,100,'image/jpeg')",[subject,f.workspace,f.account,rh2]);await db.query('SELECT nestwise.complete_receipt($1,$2,$3,$4)',[subject,f.workspace,f.account,rh2]);await db.query('SELECT nestwise.review_receipt($1,$2,$3,$4,$5,0,$6)',[subject,f.workspace,f.account,rh2,rid2,JSON.stringify(receipt)]);
  const duplicate=await f.fetch(req(base+'/personal-expenses/'+rh2,{...exp,id:randomUUID(),review:rid2}));assert.notEqual(duplicate.status,200);
  const cash={...exp,id:randomUUID(),review:rid2,bank_id:null};for(let i=0;i<2;i++){const r=await f.fetch(req(base+'/personal-expenses/'+rh2,cash));assert.equal(r.status,200,await r.clone().text());}
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,1);
  const other=randomUUID();await db.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES($1,$2,'Other bank')",[other,f.workspace]);
  assert.equal((await f.fetch(req(path.replace(f.account,other)+'/original'))).status,404);
  await db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[f.workspace]);
  assert.equal((await f.fetch(req(path+'/review',review))).status,404);
 }finally{await db.close();}
});
