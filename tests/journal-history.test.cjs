const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {parseHistoryParams,historyParams,parseHistoryPage}=require('../.test-build/src/domain/journal-history.js');
const {defaultJournalFilters}=require('../.test-build/src/domain/journal-filters.js');
test('history query contract rejects duplicate, unknown, oversized and invalid values',()=>{
  for(const value of ['q=a&q=b','limit=1000','from=2026-02-30','from=2026-10-20&to=2026-10-19',
    'from=0000-01-01','code=salary','order=desc','cursor=','cursor=not-a-uuid','q=%00',`q=${'a'.repeat(129)}`])
    assert.throws(()=>parseHistoryParams(new URLSearchParams(value)),/invalid_filters/);
  const filters={...defaultJournalFilters,query:'job:126_A',from:'2026-10-01',to:'2026-10-20',code:'fees',order:'oldest'};
  const cursor=randomUUID();
  assert.deepEqual(parseHistoryParams(new URLSearchParams(historyParams(filters,cursor))),{filters,cursor});
});
test('history page requires a valid continuation and accepts CRM order identifiers',()=>{
  assert.deepEqual(parseHistoryPage({entries:[],limit:100,next_cursor:null}),{entries:[],limit:100,next_cursor:null});
  assert.throws(()=>parseHistoryPage({entries:[],limit:100}),/invalid_journal/);
  const entries=Array.from({length:100},()=>({id:randomUUID(),source_event_id:randomUUID(),source_order_id:'job-126',
    occurred_at:'2026-10-20T00:00:00.123456Z',paid_at:null,posted_at:'2026-10-20T01:00:00Z',
    entries:[{code:'clearing',cents:'100'},{code:'receipts',cents:'-100'}]}));
  assert.equal(parseHistoryPage({entries,limit:100,next_cursor:entries[99].id}).entries.length,100);
  assert.throws(()=>parseHistoryPage({entries,limit:100,next_cursor:entries[0].id}),/invalid_journal/);
  assert.throws(()=>parseHistoryPage({entries:entries.slice(0,1),limit:100,next_cursor:entries[0].id}),/invalid_journal/);
});
