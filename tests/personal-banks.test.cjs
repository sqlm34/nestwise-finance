const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {readFileSync}=require('node:fs');
const {bankRow,collectBankChanges}=require('../.test-build/worker/personal-banks.js');
const transaction=(id,patch={})=>({transaction_id:id,account_id:'personal',date:'2026-10-29',name:'Grocery',amount:46.77,pending:false,iso_currency_code:'USD',...patch});
test('bank money direction and unsupported currencies fail safely',()=>{
 assert.equal(bankRow(transaction('a')).cents,'-4677');
 assert.equal(bankRow(transaction('b',{amount:-165})).cents,'16500');
 assert.throws(()=>bankRow(transaction('c',{iso_currency_code:'CAD'})));
 assert.throws(()=>bankRow(transaction('d',{amount:NaN})));
});
test('sync filters unselected accounts, replaces pending entries and restarts all pages after mutation',async()=>{
 const cursors=[];let calls=0;
 const result=await collectBankChanges('original','personal',async cursor=>{
  cursors.push(cursor);calls++;
  if(calls===2)throw Error('TRANSACTIONS_SYNC_MUTATION_DURING_PAGINATION');
  if(calls===1)return {added:[transaction('discard-me')],modified:[],removed:[],next_cursor:'old-page',has_more:true};
  if(calls===3)return {added:[transaction('pending',{pending:true}),transaction('business',{account_id:'business'})],modified:[],removed:[],next_cursor:'page2',has_more:true};
  return {added:[transaction('settled')],modified:[],removed:[{transaction_id:'pending'}],next_cursor:'done',has_more:false};
 });
 assert.deepEqual(cursors,['original','old-page','original','page2']);
 assert.deepEqual(result.rows.map(r=>r.id),['settled']);assert.deepEqual(result.removed,['pending']);assert.equal(result.cursor,'done');
});
test('personal bank store blocks business access, applies atomically, and ignores stale workers',async()=>{
 const fixture=await require('../scripts/auth-fixture.cjs').createAuthFixture();const db=fixture.db;
 try{
  await db.exec(readFileSync('db/migrations/0026_personal_bank_feed.sql','utf8'));
  const feed=randomUUID(),lease=randomUUID(),subject=`better-auth:${fixture.id}`;
  await db.query('INSERT INTO nestwise.bank_feeds(id,workspace_id,account_id,institution,label,mask) VALUES($1,$2,$3,$4,$5,$6)',[feed,fixture.workspace,fixture.account,'Synthetic bank','Checking','0000']);
  assert.equal((await db.query('SELECT nestwise.claim_bank_feed($1,$2) r',[feed,lease])).rows[0].r,null);
  await assert.rejects(db.query('SELECT nestwise.read_bank_feed($1,$2,$3,$4,$5)',[subject,fixture.workspace,fixture.account,'2026-10-01','2026-10-31']),/forbidden/);
  await db.query("UPDATE nestwise.workspaces SET kind='personal' WHERE id=$1",[fixture.workspace]);
  assert.deepEqual((await db.query('SELECT nestwise.claim_bank_feed($1,$2) r',[feed,lease])).rows[0].r,{cursor:''});
  assert.equal((await db.query('SELECT nestwise.claim_bank_feed($1,$2) r',[feed,randomUUID()])).rows[0].r,null);
  await assert.rejects(db.query('SELECT nestwise.apply_bank_feed($1,$2,$3,$4,$5,$6,NULL)',[feed,randomUUID(),'','next','[]','[]']),/bank_sync_conflict/);
  await db.query('SELECT nestwise.apply_bank_feed($1,$2,$3,$4,$5,$6,NULL)',[feed,lease,'','next',JSON.stringify([bankRow(transaction('a'))]),'[]']);
  const result=(await db.query('SELECT nestwise.read_bank_feed($1,$2,$3,$4,$5) r',[subject,fixture.workspace,fixture.account,'2026-10-01','2026-10-31'])).rows[0].r;
  assert.equal(result.rows[0].cents,'-4677');assert.equal(result.count,1);assert.ok(result.connection.changed_at);
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.journal_transactions')).rows[0].n,0);
  await assert.rejects(db.query('SELECT nestwise.read_bank_feed($1,$2,$3,$4,$5)',['other-user',fixture.workspace,fixture.account,'2026-10-01','2026-10-31']),/forbidden/);
  assert.equal((await db.query('SELECT nestwise.claim_bank_feed($1,$2) r',[feed,randomUUID()])).rows[0].r,null,'rate limit persists across invocations');
  await db.query("UPDATE nestwise.bank_feeds SET checked_at=now()-interval '16 minutes' WHERE id=$1",[feed]);
  const nextLease=randomUUID();await db.query('SELECT nestwise.claim_bank_feed($1,$2)',[feed,nextLease]);
  await assert.rejects(db.query('SELECT nestwise.apply_bank_feed($1,$2,$3,$4,$5,$6,NULL)',[feed,nextLease,'next','bad',JSON.stringify([{...bankRow(transaction('a')),currency:'CAD'}]),JSON.stringify(['a'])]));
  assert.equal((await db.query('SELECT cursor FROM nestwise.bank_feeds WHERE id=$1',[feed])).rows[0].cursor,'next');
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.bank_feed_rows')).rows[0].n,1,'failed page rolls back removals and cursor');
  await db.query('SELECT nestwise.apply_bank_feed($1,$2,$3,$4,$5,$6,NULL)',[feed,nextLease,'next','final','[]',JSON.stringify(['a'])]);
  assert.equal((await db.query('SELECT count(*)::int n FROM nestwise.bank_feed_rows')).rows[0].n,0);
 }finally{await db.close();}
});
