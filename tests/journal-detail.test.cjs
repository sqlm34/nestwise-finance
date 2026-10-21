const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {parseJournalDetail,parseEventDetail,detailBefore}=require('../.test-build/src/domain/journal-detail.js');
function fixture(){
  const id=randomUUID(),event=randomUUID(),date='2026-10-20T12:00:00Z';
  const source={id:event,order_id:'job-126',revision:1,kind:'job.payment_recorded',status:'posted',occurred_at:date,
    paid_at:date,received_at:date,posted_at:date,journal_id:id,reference_id:null};
  return {transaction:{id,source_event_id:event,source_order_id:'job-126',occurred_at:date,paid_at:date,posted_at:date,
    entries:[{code:'clearing',cents:'100'},{code:'receipts',cents:'-100'}]},source,reference:null,history:[source],
    next_revision:null,audit:[{action:'applied',recorded_at:date}],audit_truncated:false};
}
test('provenance parser validates identity, statuses, balanced amounts and chronological revision pages',()=>{
  const data=fixture();assert.deepEqual(parseJournalDetail(data,data.transaction.id),data);
  for(const bad of [{...data,source:{...data.source,journal_id:randomUUID()}},
    {...data,source:{...data.source,status:'waiting'}},{...data,history:[data.source,data.source]},
    {...data,reference:{...data.source,order_id:'foreign-order'}},{...data,next_revision:1},
    {...data,audit:[{action:'internal_error',recorded_at:data.source.received_at}]},
    {...data,source:{...data.source,received_at:'invalid'}}])assert.throws(()=>parseJournalDetail(bad,data.transaction.id));
  assert.throws(()=>parseJournalDetail(data,randomUUID()));
});
test('detail cursor validates range and rejects duplicate or unrelated query parameters',()=>{
  assert.equal(detailBefore(new URLSearchParams()),null);assert.equal(detailBefore(new URLSearchParams('before=101')),101);
  for(const query of ['before=0','before=-1','before=2147483647','before=1&before=2','q=abc','before=1.2','before=1e3'])
    assert.throws(()=>detailBefore(new URLSearchParams(query)),/invalid_filters/);
});

test('unposted event details preserve history without inventing journal lines',()=>{
  const original=fixture(),cursor=randomUUID();
  const data={...original,event_cursor:cursor,transaction:null,source:{...original.source,status:'waiting',journal_id:null,posted_at:null},audit:[]};
  data.history=[data.source];
  assert.equal(parseEventDetail(data,cursor).transaction,null);
  assert.throws(()=>parseEventDetail(data,randomUUID()));
  assert.throws(()=>parseEventDetail({...data,source:original.source},cursor));
  assert.throws(()=>parseEventDetail({...data,transaction:original.transaction},cursor));
  assert.equal(parseEventDetail({...original,event_cursor:cursor},cursor).transaction.id,original.transaction.id);
});
