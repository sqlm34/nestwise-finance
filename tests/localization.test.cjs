const { test } = require('node:test');
const assert = require('node:assert/strict');
const { en, ru } = require('../.test-build/src/i18n.js');
const categories = require('../src/data/accountant-categories.json');
const { demoTransactions, workspaceIds } = require('../.test-build/src/data/demo.js');
test('all English keys have nonempty Russian translations and vice versa', () => {
  assert.deepEqual(Object.keys(en).sort(), Object.keys(ru).sort());
  for (const key of Object.keys(en)) { assert.ok(en[key].trim()); assert.ok(ru[key].trim()); }
});
test('accountant taxonomy preserves 44 stable unique identifiers and exact source spelling', () => {
  assert.equal(categories.categories.length, 44);
  assert.equal(new Set(categories.categories.map(row => row.id)).size, 44);
  assert.equal(categories.categories.find(row => row.id === 'tax_08').en, 'Business Meal');
  assert.equal(categories.categories.find(row => row.id === 'tax_02').en, 'Labor (1099-NEC forms)');
});
test('demo records have explicit workspace ownership and integer cents', () => {
  for (const row of demoTransactions) {
    assert.ok(workspaceIds.includes(row.workspace)); assert.ok(Number.isSafeInteger(row.cents));
    assert.ok(row.id.startsWith('demo-')); assert.ok(row.label.en); assert.ok(row.label.ru);
  }
  assert.equal(demoTransactions.filter(row => row.workspace === 'family').some(row => row.source.startsWith('CRM')), false);
});
