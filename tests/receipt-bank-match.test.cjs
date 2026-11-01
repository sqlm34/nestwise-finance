const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');const {readFileSync}=require('node:fs');
const {parseReceipt}=require('../.test-build/src/domain/receipt.js');
const receipt={supplier:'Synthetic Fuel Market',date:'2026-10-29',currency:'USD',items:[{description:'UNL87',cents:'3516'}],tax_cents:'0',tip_cents:'0',shipping_cents:'0',discount_cents:'0',total_cents:'3516'};
test('only last four card digits are accepted, legacy receipt shape remains valid',()=>{
 assert.deepEqual(parseReceipt(receipt,true),receipt);assert.equal(parseReceipt({...receipt,card_last4:'8280'},true).card_last4,'8280');
 assert.throws(()=>parseReceipt({...receipt,card_last4:'1234567890128280'},true));
});
test('cross-bank receipt waits, auto-matches once, verifies PDF and bank changes, and remembers the card',async()=>{
 const f=await require('../scripts/auth-fixture.cjs').createAuthFixture(),db=f.db;
 try{
  for(const name of ['0026_personal_bank_feed.sql','0027_bank_sync_cadence.sql','0028_personal_documents.sql','0029_receipt_item_classifications.sql','0030_receipt_bank_reconciliation.sql'])await db.exec(readFileSync('db/migrations/'+name,'utf8'));
  const subject=`better-auth:${f.id}`,workspace=randomUUID(),source=randomUUID(),bank=randomUUID(),feed=randomUUID(),user=(await db.query('SELECT id FROM nestwise.users WHERE subject=$1',[subject])).rows[0].id;
  await db.query("INSERT INTO nestwise.workspaces VALUES($1,'Personal','personal')",[workspace]);await db.query("INSERT INTO nestwise.memberships VALUES($1,$2,'owner',true)",[workspace,user]);
  for(const [id,name] of [[source,'Wrong upload account'],[bank,'Actual payment bank']])await db.query('INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES($1,$2,$3)',[id,workspace,name]);
  await db.query("INSERT INTO nestwise.bank_feeds(id,workspace_id,account_id,institution,label,mask) VALUES($1,$2,$3,'Synthetic bank','Checking','0190')",[feed,workspace,bank]);
  const make=async(hash,data=receipt)=>{const id=randomUUID();await db.query("SELECT nestwise.prepare_receipt($1,$2,$3,$4,100,'image/jpeg')",[subject,workspace,source,hash]);await db.query('SELECT nestwise.complete_receipt($1,$2,$3,$4)',[subject,workspace,source,hash]);await db.query('SELECT nestwise.review_receipt($1,$2,$3,$4,$5,0,$6)',[subject,workspace,source,hash,id,JSON.stringify(data)]);return id;};
  const hash='a'.repeat(64),review=await make(hash),body={bank_account:bank,card_mask:'8280',review};
  const payment=async(body=null)=>(await db.query('SELECT nestwise.receipt_payment($1,$2,$3,$4,$5) result',[subject,workspace,source,hash,body&&JSON.stringify(body)])).rows[0].result;
  const report=async()=>(await db.query("SELECT nestwise.report_input($1,$2,$3,'2026-10-01','2026-10-31') result",[subject,f.workspace,f.account])).rows[0].result.data;
  await db.query('SELECT nestwise.classify_receipt($1,$2,$3,$4,$5)',[subject,workspace,source,hash,JSON.stringify({id:randomUUID(),expected:0,review,categories:['tax_06'],business_workspace:f.workspace,business_account:f.account})]);
  assert.equal((await payment(body)).match.status,'waiting');assert.equal((await payment(body)).cards[0].mask,'8280');
  const receipts=async(acc,h=null)=>(await db.query('SELECT nestwise.read_receipts($1,$2,$3,$4,NULL) result',[subject,workspace,acc,h])).rows[0].result;
  assert.equal((await receipts(bank))[0].source_account,source);assert.equal((await receipts(source)).length,0);
  assert.equal((await receipts(source,hash))[0].hash,hash);
  assert.equal((await report()).receipt_pending,'1');
  const sync=async(rows)=>{const lease=randomUUID();await db.query("UPDATE nestwise.bank_feeds SET checked_at=NULL WHERE id=$1",[feed]);const claim=(await db.query('SELECT nestwise.claim_bank_feed($1,$2) result',[feed,lease])).rows[0].result;
   await db.query('SELECT nestwise.apply_bank_feed($1,$2,$3,$4,$5,$6,NULL)',[feed,lease,claim.cursor,randomUUID(),JSON.stringify(rows),'[]']);};
  const row={id:'bank-withdrawal',paid_on:'2026-10-30',name:'SYNTHETIC FUEL MARKET #123',cents:'-3516',pending:true,category:'OTHER',currency:'USD'};
  await sync([row]);assert.equal((await payment()).match.status,'needs_review');
  await sync([{...row,pending:false}]);assert.equal((await payment()).match.status,'matched');assert.equal((await payment()).match.paid_on,'2026-10-30');
  for(let n=0;n<2;n++)assert.equal((await payment(body)).match.status,'matched');
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.personal_receipt_expenses')).rows[0].n,1);assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
  assert.equal((await report()).receipt_expenses[0].total_cents,'3516');
  const expenses=async acc=>(await db.query("SELECT nestwise.personal_document($1,$2,$3,NULL,'expenses','{}') result",[subject,workspace,acc])).rows[0].result;
  assert.equal((await expenses(bank)).length,1);assert.equal((await expenses(source)).length,0);
  await sync([{...row,pending:false,cents:'-3500'}]);assert.equal((await payment()).match.status,'bank_changed');assert.equal((await report()).receipt_pending,'1');
  await sync([{...row,pending:false}]);
  const statement={bank:'Synthetic',mask:'0190',from:'2026-10-01',to:'2026-10-31',currency:'USD',opening_cents:'10000',closing_cents:'6484',complete:true,rows:[{date:'2026-10-30',description:'Synthetic Fuel Market',cents:'-3516'}]};
  await db.query("INSERT INTO nestwise.personal_statements(workspace_id,account_id,hash,bytes,archived,actor,data,revision) VALUES($1,$2,$3,100,true,$4,$5,1)",[workspace,bank,'d'.repeat(64),user,JSON.stringify(statement)]);
  assert.equal((await payment()).match.pdf_status,'matched');
  await db.query('UPDATE nestwise.personal_statements SET data=$1 WHERE account_id=$2',[JSON.stringify({...statement,rows:[]}),bank]);assert.equal((await payment()).match.status,'statement_mismatch');assert.equal((await report()).receipt_pending,'1');
  await db.query('UPDATE nestwise.personal_statements SET data=$1 WHERE account_id=$2',[JSON.stringify(statement),bank]);
  // Future masked-card OCR selects the remembered bank, independently of upload account.
  await make('b'.repeat(64),{...receipt,date:'2026-11-01',card_last4:'8280'});
  const auto=(await db.query('SELECT bank_account FROM nestwise.receipt_bank_intents WHERE hash=$1',['b'.repeat(64)])).rows[0];assert.equal(auto.bank_account,bank);
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.personal_receipt_expenses')).rows[0].n,1);
  await make('c'.repeat(64),{...receipt,date:'',total_cents:null,card_last4:'8280'});
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.receipt_bank_intents WHERE hash=$1',['c'.repeat(64)])).rows[0].n,0);
  // Two same-amount withdrawals must not be selected by arbitrary order.
  await sync([{...row,id:'ambiguous-1',paid_on:'2026-11-01',pending:false},{...row,id:'ambiguous-2',paid_on:'2026-11-01',pending:false}]);
  assert.equal((await db.query('SELECT nestwise.receipt_payment($1,$2,$3,$4,NULL) result',[subject,workspace,source,'b'.repeat(64)])).rows[0].result.match.status,'needs_review');
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.personal_receipt_expenses')).rows[0].n,1);
  const login=await f.fetch(new Request('http://localhost:8083/api/auth/sign-in/email',{method:'POST',headers:{origin:'http://localhost:8081','Content-Type':'application/json'},body:JSON.stringify({email:f.email,password:f.password})}));
  const cookie=login.headers.getSetCookie().map(s=>s.split(';')[0]).join('; '),url=`http://localhost:8083/v1/user/workspaces/${workspace}/accounts/${source}/receipts/${hash}/payment`;
  const req=body=>new Request(url,{method:body?'POST':'GET',headers:{cookie,origin:'http://localhost:8081','Content-Type':'application/json'},body:body?JSON.stringify(body):undefined});
  assert.equal((await f.fetch(req())).status,200);assert.equal((await f.fetch(req({...body,card_mask:'123456'}))).status,400);
  assert.equal((await f.fetch(req(body))).status,200);
  await db.query("UPDATE nestwise.memberships SET role='reviewer' WHERE workspace_id=$1",[workspace]);await assert.rejects(payment(body),/forbidden/);
  await assert.rejects(db.query('UPDATE nestwise.personal_receipt_expenses SET paid_on=paid_on'),/immutable/);
 }finally{await db.close();}
});
