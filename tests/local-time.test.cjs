const {test}=require('node:test');
const assert=require('node:assert/strict');
const {localDateTime,localToday}=require('../.test-build/src/domain/local-time.js');
const {recordJournalChange,subscribeJournalChanges}=require('../.test-build/src/domain/journal-change.js');
test('Indianapolis timestamps use the right DST offset across both clock changes',()=>{
 assert.match(localDateTime('2026-03-08T06:59:00Z','en'),/01:59:00 EST/);
 assert.match(localDateTime('2026-03-08T07:00:00Z','en'),/03:00:00 EDT/);
 assert.match(localDateTime('2026-11-01T05:30:00Z','en'),/01:30:00 EDT/);
 assert.match(localDateTime('2026-11-01T06:30:00Z','en'),/01:30:00 EST/);
 assert.equal(localToday(new Date('2026-11-01T03:59:00Z')),'2026-10-31');
 assert.equal(localToday(new Date('2026-11-01T04:00:00Z')),'2026-11-01');
});
test('unchanged financial polling does not notify the banner; a new payment/refund notifies only its account',()=>{
 let a=0,b=0;const stopA=subscribeJournalChanges('test','a',()=>a++),stopB=subscribeJournalChanges('test','b',()=>b++);
 recordJournalChange('test','a','payment-1');recordJournalChange('test','a','payment-1');assert.equal(a,0);
 recordJournalChange('test','a','refund-2|payment-1');assert.equal(a,1);assert.equal(b,0);
 recordJournalChange('test','a','refund-2|payment-1');assert.equal(a,1);
 stopA();stopB();recordJournalChange('test','a','payment-3|refund-2|payment-1');assert.equal(a,1);
});
