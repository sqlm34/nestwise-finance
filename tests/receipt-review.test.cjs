const {test}=require('node:test');const assert=require('node:assert/strict');
const {receiptReviewChecks,possibleReceiptDuplicates,sameReceiptData}=require('../.test-build/src/domain/receipt-review.js');
const data={supplier:'Synthetic shop',date:'2026-10-21',currency:'USD',items:[{description:'Part',cents:'1000'}],tax_cents:'70',tip_cents:'0',shipping_cents:'0',discount_cents:'20',total_cents:'1050'};
test('saved JSONB property ordering does not make an unchanged receipt dirty',()=>{
 const stored=Object.fromEntries(Object.entries(data).reverse());stored.items=[{cents:'1000',description:'Part'}];
 assert.equal(sameReceiptData(data,stored),true);
 assert.equal(sameReceiptData({...data,total_cents:'1051'},stored),false);
});
test('receipt review diagnostics distinguish unknown from zero and exact inconsistent totals',()=>{
 assert.deepEqual(receiptReviewChecks(data),{missing:[],totalsMatch:true});
 const missing=receiptReviewChecks({...data,tax_cents:null,date:''});assert.deepEqual(missing.missing,['date','tax_cents']);assert.equal(missing.totalsMatch,null);
 assert.equal(receiptReviewChecks({...data,total_cents:'1051'}).totalsMatch,false);
 assert.equal(data.total_cents,'1050');
});
test('duplicate review hints require seller, date and amount and exclude the same original',()=>{
 const rows=[{hash:'self',review:{data}},{hash:'candidate',review:{data:{...data,supplier:' SYNTHETIC SHOP '}}},{hash:'other',review:{data:{...data,total_cents:'1000'}}},{hash:'pending',review:null}];
 assert.deepEqual(possibleReceiptDuplicates(data,'self',rows),['candidate']);
 assert.deepEqual(possibleReceiptDuplicates({...data,date:''},'self',rows),[]);
 assert.deepEqual(possibleReceiptDuplicates({...data,total_cents:null},'self',rows),[]);
});
