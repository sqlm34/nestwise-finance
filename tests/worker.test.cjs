const { test } = require('node:test');
const assert = require('node:assert/strict');
const worker = require('../.test-build/worker/index.js').default;
test('staging health probe explicitly reports no financial ingestion', async () => {
  const response = await worker.fetch(new Request('https://example.test/health'), { ENVIRONMENT: 'staging' });
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { service: 'nestwise', environment: 'staging', status: 'ok', financialIngestion: false });
});
test('all financial routes remain unavailable, including attempted writes', async () => {
  for (const path of ['/api/events', '/api/journal', '/health']) {
    const response = await worker.fetch(new Request('https://example.test' + path, { method: 'POST', body: '{}' }), { ENVIRONMENT: 'staging' });
    assert.equal(response.status, 404);
  }
});
