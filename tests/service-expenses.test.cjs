const {test}=require('node:test');const assert=require('node:assert/strict');
const {serviceExpenses,monthPeriod,shiftExpenseMonth,pieSlices,loadExpenseMonth}=require('../.test-build/src/domain/service-expenses.js');
const row=(id,date,name,cents,pending=false)=>({id,paid_on:date,name,cents,pending,currency:'USD'});
test('service expenses isolate months, exclude pending and retail, preserve refunds separately',()=>{
 const rows=[row('a','2026-09-01','OPENAI *CHATGPT SUBSCR','-2000'),row('b','2026-10-01','OpenAI','-3000'),row('c','2026-11-02','CLOUDFLARE','-500'),row('d','2026-11-03','RETELL AI','-1000'),row('e','2026-11-03','Retail store','-9000'),row('f','2026-11-03','OPENAI','-2000',true),row('g','2026-11-03','Retell AI refund','200')];
 assert.equal(serviceExpenses(rows,'2026-09').total,2000n);assert.equal(serviceExpenses(rows,'2026-10').total,3000n);
 const november=serviceExpenses([...rows,rows[2]],'2026-11');assert.equal(november.total,1500n);assert.equal(november.refunds,200n);assert.equal(november.pending,1);assert.equal(november.groups[2].spent,1000n);
 assert.throws(()=>serviceExpenses([rows[0],{...rows[0],cents:'-1'}],'2026-09'));
 assert.throws(()=>serviceExpenses([{...rows[0],cents:'NaN'}],'2026-09'));
});
test('month boundaries and full single-slice geometry work without rounded money',()=>{
 assert.equal(monthPeriod('2024-02').to,'2024-02-29');assert.equal(shiftExpenseMonth('2026-12',1),'2027-01');
 assert.deepEqual(pieSlices([0n,0n]),['','']);assert.match(pieSlices([2000n,0n])[0],/A 100 100 0 1 1/);
});
test('over-500 month is fetched by day, never silently truncated',async()=>{
 const calls=[];const feed=await loadExpenseMonth('2026-11',async p=>{calls.push(p);return p.from!==p.to?{connection:{},rows:[],count:501}:{connection:{},rows:[row(p.from,p.from,'OpenAI','-100')],count:1};});
 assert.equal(calls.length,31);assert.equal(feed.rows.length,30);
 await assert.rejects(()=>loadExpenseMonth('2026-11',async()=>({connection:{},rows:[],count:501})),/incomplete/);
});
