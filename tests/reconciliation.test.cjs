const {test}=require('node:test');
const assert=require('node:assert/strict');
const {randomUUID}=require('node:crypto');
const {candidateParams,parseCandidates,bankWindow,createDraft,suggestGroups,eligibleBankRows,cashAmount}=require('../.test-build/src/domain/reconciliation.js');
const row=(line,amountCents,date='2026-10-20',description=`Bank row ${line}`)=>({line,amountCents,date,description,issues:[]});
const candidate=(amount,kind='job.payment_recorded',paid_at='2026-10-20T12:00:00Z')=>({id:randomUUID(),kind,paid_at,occurred_at:'2026-09-01T00:00:00Z',posted_at:'2026-10-20T12:00:00Z',source_event_id:randomUUID(),source_order_id:'test-order',entries:[{code:'clearing',cents:String(amount)},{code:amount<0?'fees':'receipts',cents:String(-amount)}]});
test('reconciliation supports a net processor payout and split bank deposits without creating ledger entries',()=>{
  const payment=candidate(10000),fee=candidate(-325,'job.processor_fee_recorded'),bank=[row(2,9675)];
  const suggestions=suggestGroups(bank,[payment,fee],new Set());assert.deepEqual(suggestions.groups,[[payment.id,fee.id]]);
  const draft=createDraft(bank,[2],[payment,fee],[payment.id,fee.id],[]);assert.equal(draft.cents,'9675');
  assert.throws(()=>createDraft(bank,[2],[payment,fee],[payment.id,fee.id],[draft]));
  assert.throws(()=>createDraft([row(3,9675)],[3],[payment,fee],[payment.id,fee.id],[draft]));
  const split=[row(2,4000),row(3,6000)];assert.equal(createDraft(split,[2,3],[payment],[payment.id],[]).cents,'10000');
  assert.throws(()=>createDraft(split,[2],[payment],[payment.id],[]),/amount_mismatch/);
  assert.equal(cashAmount(payment),10000n);
});
test('reconciliation blocks all duplicate copies, issue rows, zero-net groups and incorrect dates or kinds',()=>{
  const duplicate=[row(2,100,'2026-10-20','same'),row(3,100,'2026-10-20','SAME')];assert.equal(eligibleBankRows(duplicate).size,0);
  const payment=candidate(100);assert.throws(()=>createDraft(duplicate,[2],[payment],[payment.id],[]));
  assert.equal(eligibleBankRows([{...row(2,100),issues:['ambiguousDirection']}]).size,0);
  const opposite=candidate(-100);assert.throws(()=>createDraft([row(2,100),row(3,-100)],[2,3],[payment,opposite],[payment.id,opposite.id],[]),/amount_mismatch/);
  for(const entry of [candidate(100,'job.cost_corrected'),candidate(100,'job.payment_recorded',null),candidate(100,'job.payment_recorded','2026-10-28T00:00:00Z')])
    assert.throws(()=>createDraft([row(2,100)],[2],[entry],[entry.id],[]),/invalid_candidate/);
  assert.throws(()=>createDraft([row(2,100)],[2,2],[payment],[payment.id],[]));
});
test('reconciliation dates are paid-date UTC, bounded and reject ambiguous filters',()=>{
  assert.deepEqual(bankWindow([row(2,100)]),{from:'2026-10-13',to:'2026-10-27'});
  const period={from:'2026-10-20',to:'2026-10-20'},entry=candidate(100);
  assert.equal(parseCandidates({entries:[entry],limit:100,next_cursor:null},period).entries.length,1);
  assert.throws(()=>parseCandidates({entries:[{...entry,paid_at:'2026-10-20T23:00:00-04:00'}],limit:100,next_cursor:null},period));
  assert.throws(()=>parseCandidates({entries:[{...entry,kind:'job.cost_corrected'}],limit:100,next_cursor:null},period));
  for(const query of ['from=2026-02-30&to=2026-03-01','from=2026-10-20&to=2026-10-20&from=2026-10-20','from=2026-10-20&to=2026-10-20&cursor=no','from=2025-01-01&to=2026-10-20','from=2026-10-20&to=2026-10-20&amount=100'])assert.throws(()=>candidateParams(new URLSearchParams(query)));
});
test('reconciliation preserves integer precision, bounds suggestions and ignores already-used candidates',()=>{
  const bank=[row(2,Number.MAX_SAFE_INTEGER),row(3,100)],a=candidate(Number.MAX_SAFE_INTEGER),b=candidate(100);
  assert.equal(createDraft(bank,[2,3],[a,b],[a.id,b.id],[]).cents,(BigInt(Number.MAX_SAFE_INTEGER)+100n).toString());
  assert.deepEqual(suggestGroups([row(2,100)],[b],new Set([b.id])).groups,[]);
  const suggestions=suggestGroups([row(2,100)],Array.from({length:61},()=>candidate(100)),new Set());
  assert.equal(suggestions.limited,true);assert.equal(suggestions.groups.length,10);
});
