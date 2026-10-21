const {test}=require('node:test');
const assert=require('node:assert/strict');
const {insightMoney}=require('../.test-build/src/domain/period-insights.js');
const {journalMoney}=require('../.test-build/src/domain/journal.js');
test('Android-compatible money formatting retains exact cents without Intl BigInt support',()=>{
  const original=Intl.NumberFormat;
  Intl.NumberFormat=function(){throw new TypeError('Cannot convert BigInt to number');};
  try {
    for(const [value,en,ru] of [
      ['0','0.00 USD','0,00 USD'],['1','0.01 USD','0,01 USD'],
      ['-123456','−1,234.56 USD','−1\u00a0234,56 USD'],
      ['9223372036854775807','92,233,720,368,547,758.07 USD','92\u00a0233\u00a0720\u00a0368\u00a0547\u00a0758,07 USD']
    ]) for(const [locale,expected] of [['en',en],['ru',ru]]) {
      assert.equal(insightMoney(BigInt(value),locale),expected);
      assert.equal(journalMoney(value,locale,'USD'),expected);
    }
  } finally {Intl.NumberFormat=original;}
});
