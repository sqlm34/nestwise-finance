const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {parseJournal,journalMoney,journalDate}=require('../.test-build/src/domain/journal.js');
const row=()=>({id:randomUUID(),source_event_id:randomUUID(),source_order_id:randomUUID(),
  occurred_at:'2026-10-20T00:30:00+00:00',paid_at:null,posted_at:'2026-10-20T01:00:00Z',
  entries:[{code:'clearing',cents:'35000'},{code:'receipts',cents:'-35000'}]});
test('journal accepts balanced PostgreSQL payload and empty account without synthesizing data',()=>{
  assert.deepEqual(parseJournal({entries:[],limit:100}),{entries:[],limit:100});
  const item=row();assert.deepEqual(parseJournal({entries:[item],limit:100}).entries,[item]);
});
test('journal rejects malformed, unbalanced, duplicated and truncated-contract payloads',()=>{
  const original=row();
  for(const page of [
    {entries:[{...original,entries:[{code:'clearing',cents:35000},{code:'receipts',cents:'-35000'}]}],limit:100},
    {entries:[{...original,entries:[{code:'clearing',cents:'1'},{code:'receipts',cents:'-2'}]}],limit:100},
    {entries:[{...original,entries:[{code:'unknown',cents:'1'},{code:'receipts',cents:'-1'}]}],limit:100},
    {entries:[{...original,occurred_at:'not-a-date'}],limit:100},
    {entries:[original,original],limit:100},{entries:[],limit:50},
    {entries:[{...original,entries:[{code:'clearing',cents:'9223372036854775808'},{code:'receipts',cents:'-9223372036854775808'}]}],limit:100},
  ])assert.throws(()=>parseJournal(page),/invalid_journal/);
});
test('journal money preserves bigint cents beyond Number precision in both languages',()=>{
  assert.equal(journalMoney('9223372036854775807','en','USD'),'92,233,720,368,547,758.07 USD');
  assert.equal(journalMoney('-1','en','USD'),'−0.01 USD');
  assert.equal(journalMoney('35000','ru','USD'),'350,00 USD');
  assert.equal(journalMoney('0','en','USD'),'0.00 USD');
  assert.throws(()=>journalMoney('1.5','en','USD'),/invalid_journal/);
  assert.throws(()=>journalMoney('100','en','EUR'),/invalid_journal/);
});
test('timestamp details show Indianapolis time with explicit daylight offset',()=>{
  assert.match(journalDate('2026-10-20T00:30:00Z','en'),/Oct 19, 2026.*20:30:00 EDT/);
  assert.throws(()=>journalDate('2026-10-20T00:30:00','en'),/invalid_journal/);
});
