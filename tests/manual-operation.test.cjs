const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {parseManualOperation,canonicalManualOperation}=require('../.test-build/src/domain/manual-operation.js');
const input=()=>({id:randomUUID(),kind:'expense',paid_on:'2026-10-20',amount_cents:'1000',note:'Supplies',destination_account:null,reference_operation:null,allocations:[{category:'supplies',cents:'700'},{category:'fees',cents:'300'}]});
test('manual split totals are exact, canonical and independent of input ordering',()=>{
  const a=input(),b={...a,allocations:[...a.allocations].reverse()};
  assert.equal(canonicalManualOperation(a),canonicalManualOperation(b));
  assert.equal(parseManualOperation(a).allocations[0].category,'fees');
  assert.throws(()=>parseManualOperation({...a,amount_cents:'1001'}));
  assert.throws(()=>parseManualOperation({...a,allocations:[{category:'fees',cents:'500'},{category:'fees',cents:'500'}]}));
});
test('transfers require destination and prohibit income/expense allocations',()=>{
  const a={...input(),kind:'transfer',destination_account:randomUUID(),allocations:[]};
  assert.equal(parseManualOperation(a).kind,'transfer');
  assert.throws(()=>parseManualOperation({...a,destination_account:null}));
  assert.throws(()=>parseManualOperation({...a,reference_operation:randomUUID()}));
  assert.throws(()=>parseManualOperation({...a,allocations:input().allocations}));
});
test('refunds require an original operation and cannot reclassify its categories',()=>{
  const a={...input(),kind:'refund',reference_operation:randomUUID(),allocations:[]};
  assert.equal(parseManualOperation(a).kind,'refund');
  assert.throws(()=>parseManualOperation({...a,reference_operation:a.id}));
  assert.throws(()=>parseManualOperation({...a,allocations:input().allocations}));
});
test('reject rounding, overflow, invalid calendar dates, injected fields and malformed splits',()=>{
  for(const value of [0,1000,'0','-1','01','1.5','9007199254740992','1e3']) assert.throws(()=>parseManualOperation({...input(),amount_cents:value}));
  for(const value of ['2026-02-29','2026-04-31','2026-1-01','2026-10-20T00:00:00Z']) assert.throws(()=>parseManualOperation({...input(),paid_on:value}));
  assert.throws(()=>parseManualOperation({...input(),workspace_id:randomUUID()}));
  assert.throws(()=>parseManualOperation({...input(),note:'bad\0note'}));
  assert.throws(()=>parseManualOperation({...input(),allocations:[{category:'supplies',cents:'1000',tax_approved:true}]}));
  const a=input();a.amount_cents='9007199254740991';a.allocations=[{category:'supplies',cents:a.amount_cents}];
  assert.equal(parseManualOperation(a).amount_cents,'9007199254740991');
});
