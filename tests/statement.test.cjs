const { test } = require('node:test');
const assert = require('node:assert/strict');
const { cents, sumCents } = require('../.test-build/src/domain/money.js');
const { parseCsv, previewStatement, isoDate, sampleStatement } = require('../.test-build/src/domain/statement.js');
const preview = text => previewStatement(text, 'chase', 'Checking · 1234');

test('money parsing is exact, including decimal and comma boundaries', () => {
  assert.equal(cents('1,234.56'), 123456); assert.equal(cents('-0.01'), -1);
  assert.equal(sumCents([cents('0.1'), cents('0.2')]), 30);
  for (const value of ['NaN', '1e3', '1.001', '12,34.56', 'Infinity', '', '9007199254740992']) assert.throws(() => cents(value));
  assert.throws(() => sumCents([Number.MAX_SAFE_INTEGER, 1]));
});
test('quoted commas, newline, escaped quote and BOM are parsed without field shifts', () => {
  assert.deepEqual(parseCsv('\uFEFFDate,Description,Amount\r\n10/01/2026,"A, ""B""\nC",-2.50\r\n'), [
    ['Date', 'Description', 'Amount'], ['10/01/2026', 'A, "B"\nC', '-2.50'],
  ]);
  for (const value of ['a,"b', 'a,"b"x', 'a,b"c', 'a,\0']) assert.throws(() => parseCsv(value), /invalidCsv/);
});
test('invalid dates are rejected, leap day is validated', () => {
  assert.equal(isoDate('2/29/2024'), '2024-02-29');
  for (const value of ['2/29/2026', '2026-13-01', '2026-04-31', '10/1/26']) assert.throws(() => isoDate(value));
});
test('Chase preview preserves signs and sums cents without posting any journal', () => {
  const data = preview(sampleStatement);
  assert.equal(data.adapter, 'chase-csv'); assert.equal(data.rows.length, 4);
  assert.equal(data.creditsCents, 60625); assert.equal(data.debitsCents, 22800);
  assert.equal(data.errors.length, 0);
  assert.equal('journal' in data, false);
  assert.deepEqual(preview(sampleStatement), data);
});
test('duplicate rows are retained and flagged for human review', () => {
  const data = preview('Date,Description,Amount\n10/1/2026,Fuel,-45\n10/1/2026,Fuel,-45');
  assert.equal(data.rows.length, 2); assert.deepEqual(data.rows[1].issues, ['duplicateRow']);
});
test('mixed debit/credit fields and contrary direction never silently normalize', () => {
  const data = preview('Date,Description,Debit,Credit\n10/1/2026,Fuel,45,\n10/2/2026,Deposit,,600\n10/3/2026,Unknown,20,30');
  assert.deepEqual(data.rows.map(row => row.amountCents), [-4500, 60000]);
  assert.equal(data.errors[0].code, 'ambiguousDirection');
  assert.deepEqual(preview('Details,Posting Date,Description,Amount\nDEBIT,10/1/2026,Fuel,45').rows[0].issues, ['ambiguousDirection']);
});
test('malformed rows remain visible as errors, never silently disappear', () => {
  const data = preview('Date,Description,Amount\n02/30/2026,Invalid,50\n10/1/2026,Extra,45,unexpected\n10/1/2026,Price,1.001\n10/1/2026,Valid,10');
  assert.equal(data.errors.length, 3); assert.equal(data.rows.length, 1);
  assert.deepEqual(data.errors.map(row => row.line), [2, 3, 4]);
});
test('unknown schema and full account numbers fail closed', () => {
  assert.throws(() => preview('Date,Amount\n10/1/2026,45'), /unsupportedColumns/);
  assert.throws(() => preview('Date,Description,Amount,Amount\n10/1/2026,X,1,2'), /unsupportedColumns/);
  assert.throws(() => previewStatement(sampleStatement, 'chase', '123456789'), /invalidAlias/);
  assert.throws(() => preview('Date,Description,Amount'), /emptyFile/);
  assert.throws(() => parseCsv('x'.repeat(2_000_001)), /fileTooLarge/);
});
test('Old National retains its legacy identifier and uses generic mapping, not an unverified bank adapter', () => {
  const data = previewStatement('Date,Description,Debit,Credit\n10/1/2026,Fee,5,', 'south-national', 'Business');
  assert.equal(data.adapter, 'mapped-csv'); assert.equal(data.debitsCents, 500);
  assert.equal(data.bank, 'south-national');
  assert.equal(previewStatement(sampleStatement, 'south-national', 'Personal').adapter, 'mapped-csv');
});
