const {test}=require('node:test');
const assert=require('node:assert/strict');
const {parseOrderResult,orderAfterParts}=require('../.test-build/src/domain/order-result.js');
test('old stock reduces job result once without reducing recorded cash',()=>{
 const value=parseOrderResult({received_cents:'35500',refunds_cents:'0',purchased_parts_cents:'0',stock_parts_cents:'1935'});
 assert.equal(orderAfterParts(value),33565n);assert.equal(value.received_cents,'35500');
 assert.equal(orderAfterParts({...value,refunds_cents:'5000',purchased_parts_cents:'9991'}),18574n);
 assert.equal(parseOrderResult({...value,stock_parts_cents:'19.35'}),undefined);
 assert.equal(parseOrderResult({...value,stock_parts_cents:'-1'}),undefined);
 assert.equal(parseOrderResult({}),undefined);
});
