const {test}=require('node:test');
const assert=require('node:assert/strict');
const {filterJournal,defaultJournalFilters}=require('../.test-build/src/domain/journal-filters.js');
const payment={id:'aaaaaaaa-0000-0000-0000-000000000001',source_order_id:'order-a',source_event_id:'event-a',
  occurred_at:'2026-10-20T00:30:00+02:00',paid_at:null,posted_at:'2026-10-21T00:00:00Z',
  entries:[{code:'clearing',cents:'35000'},{code:'receipts',cents:'-35000'}]};
const refund={...payment,id:'bbbbbbbb-0000-0000-0000-000000000002',source_order_id:'order-b',source_event_id:'event-b',
  occurred_at:'2026-10-20T23:59:59.999Z',entries:[{code:'refunds',cents:'1000'},{code:'clearing',cents:'-1000'}]};
const rows=[payment,refund];
const select=patch=>filterJournal(rows,{...defaultJournalFilters,...patch});

test('payment-date filtering excludes unknown dates and sorts by actual payment rather than arrival',()=>{
  const a={...payment,paid_at:'2026-09-01T00:00:00Z'},b={...refund,paid_at:'2026-08-31T23:59:59Z'};
  const source=[payment,a,b];
  assert.deepEqual(filterJournal(source,{...defaultJournalFilters,basis:'paid',from:'2026-09-01',to:'2026-09-01'}).entries,[a]);
  assert.deepEqual(filterJournal(source,{...defaultJournalFilters,basis:'paid',order:'oldest'}).entries,[b,a]);
  assert.deepEqual(source,[payment,a,b]);
});
test('journal dates filter inclusive UTC event days rather than payment or posting dates',()=>{
  assert.deepEqual(select({from:'2026-10-19',to:'2026-10-19'}).entries,[payment]);
  assert.deepEqual(select({from:'2026-10-20',to:'2026-10-20'}).entries,[refund]);
  assert.deepEqual(select({from:'2026-10-21'}).entries,[]);
  assert.deepEqual(select({to:'2026-10-19'}).entries,[payment]);
});
test('invalid and reversed ranges never show misleading unfiltered results',()=>{
  for(const from of ['2026-02-29','2026-13-01','2026-04-31','10/20/2026','2026-1-01','2026-10-']){
    assert.deepEqual(select({from}),{entries:[],error:'invalidDate'});
  }
  assert.equal(select({to:'2024-02-29'}).error,null);
  assert.equal(select({from:'2026-10-20',to:'2026-10-19'}).error,'reversedRange');
});
test('combined ID and code filters preserve all lines of each balanced transaction',()=>{
  for(const query of [' ORDER-A ','EVENT-A','AAAAAAAA'])
    assert.deepEqual(select({query,code:'receipts'}).entries,[payment]);
  assert.deepEqual(select({query:'event-a',code:'refunds'}).entries,[]);
  assert.deepEqual(select({code:'refunds'}).entries[0].entries,refund.entries);
  assert.deepEqual(select({query:'no-match'}).entries,[]);
});
test('sort does not mutate the authorized page and breaks equal timestamps deterministically',()=>{
  const before=structuredClone(rows);
  assert.deepEqual(select({}).entries,[refund,payment]);
  assert.deepEqual(select({order:'oldest'}).entries,rows);
  assert.deepEqual(rows,before);
  const tied={...refund,occurred_at:payment.occurred_at};
  assert.deepEqual(filterJournal([tied,payment],{...defaultJournalFilters,order:'oldest'}).entries,[payment,tied]);
  assert.deepEqual(filterJournal([],defaultJournalFilters),{entries:[],error:null});
});
