const {test}=require('node:test');const assert=require('node:assert/strict');
const {periodPreset,previousPeriod,parsePeriodParams,parsePeriodInsights,periodMetrics,insightMoney}=require('../.test-build/src/domain/period-insights.js');
const totals={clearing:'0',receipts:'0',refunds:'0',parts_cost:'0',parts_payable:'0',fees:'0',expenses:'0',transfers:'0'};
const summary=(from,to)=>({from,to,transaction_count:'0',missing_paid_date:'0',totals:{...totals}});
test('period presets use the Indianapolis calendar and comparisons handle leap years and year changes',()=>{
  assert.deepEqual(periodPreset('month',new Date('2024-02-29T23:30:00Z')),{from:'2024-02-01',to:'2024-02-29'});
  assert.deepEqual(periodPreset('quarter',new Date('2026-12-31T23:00:00Z')),{from:'2026-10-01',to:'2026-12-31'});
  assert.deepEqual(periodPreset('year',new Date('2024-01-01T00:00:00Z')),{from:'2023-01-01',to:'2023-12-31'});
  assert.deepEqual(previousPeriod({from:'2026-01-01',to:'2026-01-31'}),{from:'2025-12-01',to:'2025-12-31'});
  assert.deepEqual(previousPeriod({from:'2024-03-01',to:'2024-03-01'}),{from:'2024-02-29',to:'2024-02-29'});
});
test('period API rejects missing, duplicate, reversed, invalid and excessively long dates',()=>{
  for(const q of ['', 'from=2026-01-01','from=2026-02-30&to=2026-03-01','from=2026-03-02&to=2026-03-01',
    'from=2024-01-01&to=2025-01-01','from=2026-01-01&to=2026-01-01&extra=1','from=0000-01-01&to=0000-01-02'])
    assert.throws(()=>parsePeriodParams(new URLSearchParams(q)));
  assert.deepEqual(parsePeriodParams(new URLSearchParams('from=2024-01-01&to=2024-12-31')),{from:'2024-01-01',to:'2024-12-31'});
});
test('summary parser validates balance, period identity and complete monthly reconciliation',()=>{
  const expected={from:'2026-01-15',to:'2026-02-02'};
  const page={currency:'USD',generated_at:'2026-10-20T12:00:00Z',current:summary(expected.from,expected.to),
    previous:summary('2025-12-27','2026-01-14'),months:[summary('2026-01-15','2026-01-31'),summary('2026-02-01','2026-02-02')],attention:{waiting:'0',needs_review:'0'}};
  assert.deepEqual(parsePeriodInsights(page,expected),page);
  for(const bad of [{...page,currency:'EUR'},{...page,months:page.months.slice(0,1)},
    {...page,current:{...page.current,transaction_count:'1'}},
    {...page,current:{...page.current,totals:{...totals,fees:'1'}}},
    {...page,previous:{...page.previous,to:'2026-01-13'}},
    {...page,attention:{waiting:0,needs_review:'0'}},
    {...page,current:{...page.current,missing_paid_date:'1'}}])assert.throws(()=>parsePeriodInsights(bad,expected));
});
test('operational metrics distinguish refunds, supplier credits, accruals and clearing without precision loss',()=>{
  const p=summary('2026-01-01','2026-01-31');p.totals={clearing:'20500',receipts:'-35000',refunds:'10000',parts_cost:'7500',parts_payable:'-3000',fees:'0',expenses:'0',transfers:'0'};
  const m=periodMetrics(p);assert.equal(m.net_receipts,25000n);assert.equal(m.recorded_difference,17500n);assert.equal(m.parts_payable,3000n);assert.equal(m.clearing,20500n);
  assert.equal(insightMoney(900719925474099123n,'en'),'9,007,199,254,740,991.23 USD');
  assert.equal(insightMoney(-1n,'ru'),'−0,01 USD');
});
