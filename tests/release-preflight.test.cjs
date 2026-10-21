const {test} = require('node:test');
const assert = require('node:assert/strict');
const {readFileSync, readdirSync} = require('node:fs');
const {validateConfiguration} = require('../scripts/release-preflight.cjs');
function fixture() {
  return {worker: JSON.parse(readFileSync('wrangler.json')), eas: JSON.parse(readFileSync('eas.json')),
    nodeVersion: readFileSync('.nvmrc', 'utf8').trim(), migrations: readdirSync('db/migrations').filter(n => n.endsWith('.sql')).sort()};
}
test('release preflight accepts isolated current configuration', () => {
  assert.deepEqual(validateConfiguration(fixture()), []);
});
test('release preflight catches mobile login origin drift', () => {
  const config = fixture(); config.eas.build.staging.env.EXPO_PUBLIC_API_URL = 'https://wrong.example';
  assert.ok(validateConfiguration(config).some(e => e.includes('origins differ')));
});
test('release preflight catches shared original and backup storage', () => {
  const config = fixture(); config.worker.env.staging.r2_buckets[1].bucket_name = config.worker.env.staging.r2_buckets[0].bucket_name;
  assert.ok(validateConfiguration(config).some(e => e.includes('reused R2')));
});
test('release preflight rejects duplicate and missing migration ordinals', () => {
  for (const migrations of [['0001_a.sql', '0001_b.sql'], ['0001_a.sql', '0003_c.sql'], []]) {
    assert.ok(validateConfiguration({...fixture(), migrations}).length > 0);
  }
});
test('release preflight catches accidental production routing', () => {
  const config = fixture(); config.worker.env.production.routes = ['example.com/*'];
  assert.ok(validateConfiguration(config).some(e => e.includes('public routing')));
});
test('release preflight catches native runtime and environment drift', () => {
  const config = fixture(); config.eas.build.staging.node = '18.12.1'; config.eas.build.staging.env.APP_ENV = 'production';
  const errors = validateConfiguration(config);
  assert.ok(errors.some(e => e.includes('Node version')));
  assert.ok(errors.some(e => e.includes('APK environment')));
});
