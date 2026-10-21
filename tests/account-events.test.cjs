const {test}=require('node:test');const assert=require('node:assert/strict');const {randomUUID}=require('node:crypto');
const {parseEventParams,parseEventsPage}=require('../.test-build/src/domain/account-events.js');
test('event filters reject duplicate parameters, control characters and malformed cursors',()=>{
  assert.deepEqual(parseEventParams(new URLSearchParams()),{status:'attention',query:'',cursor:null});
  assert.equal(parseEventParams(new URLSearchParams('status=all&q=%25')).query,'%');
  for(const query of ['status=bad','status=all&status=waiting','q=%00','cursor=no','cursor=','x=1','q='+ 'a'.repeat(129)])
    assert.throws(()=>parseEventParams(new URLSearchParams(query)),/invalid_filters/);
});
test('event pages reject malformed counts, invalid guidance, duplicate cursors and false pagination',()=>{
  const event={cursor:randomUUID(),id:randomUUID(),order_id:'no-journal',revision:2,kind:'job.payment_recorded',status:'waiting',
    occurred_at:'2026-10-20T12:00:00Z',paid_at:null,received_at:'2026-10-20T12:00:00Z',posted_at:null,journal_id:null,reference_id:null,guidance:'earlier_revision'};
  const page={events:[event],next_cursor:null,counts:{waiting:'1',needs_review:'0',posted:'0',asserted:'0'}};
  assert.deepEqual(parseEventsPage(page),page);
  for(const bad of [{...page,next_cursor:event.cursor},{...page,events:[event,event]},
    {...page,counts:{...page.counts,waiting:-1}},{...page,events:[{...event,guidance:'none'}]},
    {...page,events:[{...event,status:'posted'}]}])assert.throws(()=>parseEventsPage(bad));
});
