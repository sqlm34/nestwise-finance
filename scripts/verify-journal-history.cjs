// Isolated synthetic proof inside a transaction that always rolls back.
// Caller supplies an owner connection to the authorized non-production database.
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
async function verifyJournalHistory(client) {
  const name=(await client.query('SELECT current_database() name')).rows[0].name;
  if(!/^nestwise_(staging|test|development)$/.test(name))throw new Error('Non-production Nestwise database required');
  const workspace=randomUUID(),account=randomUUID(),user=randomUUID(),subject=`history-proof:${randomUUID()}`;
  const connection=`history-${randomUUID()}`;
  await client.query('BEGIN');
  try {
    await client.query("INSERT INTO nestwise.workspaces VALUES ($1,'Synthetic history proof','business')",[workspace]);
    await client.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'Synthetic proof only')",[account,workspace]);
    await client.query('INSERT INTO nestwise.users VALUES ($1,$2)',[user,subject]);
    await client.query("INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true)",[workspace,user]);
    await client.query('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)',[connection,workspace,account]);
    for(let i=0;i<205;i++) {
      const event={schema_version:1,source_event_id:randomUUID(),source_order_id:`proof-order-${i}`,
        source_fact_id:randomUUID(),order_revision:1,type:'job.payment_recorded',currency:'USD',
        occurred_at:i===0?'2026-10-01T00:00:00Z':'2026-10-20T12:00:00.123Z',
        paid_at:'2026-10-20T12:00:00Z',amount_cents:100};
      const result=(await client.query('SELECT nestwise.accept_event($1,$2,$3,$4) result',
        [connection,randomUUID(),Math.floor(Date.now()/1000),JSON.stringify(event)])).rows[0].result;
      assert.equal(result.status,'posted');
    }
    const read=async(query='',cursor=null)=>(await client.query(
      "SELECT nestwise.user_journal_page($1,$2,$3,$4,NULL,NULL,'all','newest',$5) result",
      [subject,workspace,account,query,cursor])).rows[0].result;
    const a=await read(),b=await read('',a.next_cursor),c=await read('',b.next_cursor);
    assert.deepEqual([a.entries.length,b.entries.length,c.entries.length],[100,100,5]);
    assert.equal(c.next_cursor,null);
    assert.equal(new Set([...a.entries,...b.entries,...c.entries].map(row=>row.id)).size,205);
    const filtered=await read('proof-order-0');
    assert.equal(filtered.entries.length,1);
    assert.equal(filtered.entries[0].entries.length,2);
    return {pages:[100,100,5],uniqueTransactions:205,searchBeyondFirstPage:true,rolledBack:true};
  } finally {await client.query('ROLLBACK');}
}
module.exports={verifyJournalHistory};
