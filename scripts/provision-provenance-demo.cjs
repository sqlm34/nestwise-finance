// Opt-in staging fixture, isolated from all existing accounts. Financial records are retained.
const {randomUUID}=require('node:crypto');
const assert=require('node:assert/strict');
async function provisionProvenanceDemo(client,subject){
  if((await client.query('SELECT current_database() name')).rows[0].name!=='nestwise_staging')throw new Error('Staging only');
  await client.query('BEGIN');
  try{
    await client.query('SELECT pg_advisory_xact_lock(726498313)');
    const user=(await client.query('SELECT id FROM nestwise.users WHERE subject=$1',[subject])).rows[0];
    if(!user)throw new Error('Existing invited user required');
    const existing=(await client.query(`SELECT w.id workspace,a.id account FROM nestwise.workspaces w
      JOIN nestwise.memberships m ON m.workspace_id=w.id JOIN nestwise.financial_accounts a ON a.workspace_id=w.id
      WHERE w.name='DEMO — история и корректировки' AND m.user_id=$1`,[user.id])).rows[0];
    if(existing){await client.query('COMMIT');return {...existing,reused:true};}
    const workspace=randomUUID(),account=randomUUID(),connection=`demo-${randomUUID()}`,order='DEMO-126';
    await client.query("INSERT INTO nestwise.workspaces VALUES ($1,'DEMO — история и корректировки','business')",[workspace]);
    await client.query("INSERT INTO nestwise.financial_accounts(id,workspace_id,name) VALUES ($1,$2,'DEMO — не реальные деньги')",[account,workspace]);
    await client.query("INSERT INTO nestwise.memberships VALUES ($1,$2,'owner',true)",[workspace,user.id]);
    await client.query('INSERT INTO nestwise.source_connections VALUES ($1,$2,$3,true)',[connection,workspace,account]);
    const event=(revision,type,amount,extra={})=>({schema_version:1,source_event_id:randomUUID(),source_fact_id:randomUUID(),
      source_order_id:order,order_revision:revision,type,currency:'USD',occurred_at:`2026-10-${String(10+revision).padStart(2,'0')}T12:00:00Z`,
      paid_at:`2026-10-${String(10+revision).padStart(2,'0')}T12:00:00Z`,amount_cents:amount,...extra});
    const payment=event(1,'job.payment_recorded',35000),part=event(2,'job.part_cost_recorded',9500,{settlement:'paid'});
    const correction=event(3,'job.cost_corrected',7500,{reference_event_id:part.source_event_id});
    const refund=event(4,'job.customer_refund_issued',10000,{reference_event_id:payment.source_event_id});
    const credit=event(5,'job.supplier_credit_received',2500,{reference_event_id:correction.source_event_id});
    const snapshot=event(6,'job.financials_finalized',0,{paid_at:null,totals:{payments_cents:35000,refunds_cents:10000,parts_net_cents:5000,fees_net_cents:0}});delete snapshot.amount_cents;
    const invalid=event(7,'job.customer_refund_issued',99999,{reference_event_id:payment.source_event_id});
    const waiting=event(9,'job.payment_recorded',100);
    for(const [index,item] of [payment,part,correction,refund,credit,snapshot,invalid,waiting].entries()){
      const result=(await client.query('SELECT nestwise.accept_event($1,$2,$3,$4) result',[connection,randomUUID(),Math.floor(Date.now()/1000),JSON.stringify(item)])).rows[0].result;
      assert.equal(result.status,index<5?'posted':index===5?'asserted':index===6?'needs_review':'waiting');
    }
    await client.query('UPDATE nestwise.source_connections SET enabled=false WHERE id=$1',[connection]);
    await client.query('COMMIT');return {workspace,account,reused:false,synthetic:true};
  }catch(error){await client.query('ROLLBACK');throw error;}
}
module.exports={provisionProvenanceDemo};
