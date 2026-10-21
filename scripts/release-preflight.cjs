/* global __dirname */
// Offline configuration evidence. Passing this check is NOT release approval.
const {readFileSync, readdirSync, mkdirSync, writeFileSync} = require('node:fs');
const {join, resolve} = require('node:path');
const {createHash} = require('node:crypto');
const {execFileSync} = require('node:child_process');

function validateConfiguration({worker, eas, nodeVersion, migrations}) {
  const errors = [];
  const requireCondition = (ok, message) => { if (!ok) errors.push(message); };
  const names = new Set();
  const buckets = new Map();
  for (const environment of ['development', 'staging', 'production']) {
    const config = worker.env?.[environment];
    const build = eas.build?.[environment];
    requireCondition(config?.vars?.ENVIRONMENT === environment, `${environment}: Worker environment mismatch`);
    requireCondition(typeof config?.name === 'string' && !names.has(config.name), `${environment}: missing or reused Worker name`);
    if (config?.name) names.add(config.name);
    requireCondition(build?.env?.APP_ENV === environment, `${environment}: APK environment mismatch`);
    requireCondition(build?.node === nodeVersion, `${environment}: Node version differs from .nvmrc`);
    for (const bucket of config?.r2_buckets ?? []) {
      requireCondition(typeof bucket.bucket_name === 'string' && !buckets.has(bucket.bucket_name), `${environment}: missing or reused R2 bucket`);
      buckets.set(bucket.bucket_name, environment);
    }
  }
  const stage = worker.env?.staging;
  const origin = stage?.vars?.AUTH_BASE_URL;
  requireCondition(typeof origin === 'string' && /^https:\/\/[^/]+$/.test(origin), 'staging: expected an HTTPS origin');
  requireCondition(origin === stage?.vars?.AUTH_WEB_ORIGIN && origin === eas.build?.staging?.env?.EXPO_PUBLIC_API_URL,
    'staging: browser, authentication and APK origins differ');
  requireCondition(eas.cli?.requireCommit === true, 'EAS must build a committed source revision');
  requireCondition(eas.build?.staging?.distribution === 'internal' && eas.build?.staging?.android?.buildType === 'apk',
    'staging: expected an internal APK');
  // Production is intentionally unprovisioned. Replace this guard only in the
  // explicitly approved production release change, with deployment evidence.
  const production = worker.env?.production;
  requireCondition(production?.workers_dev === false && !(production?.routes?.length) && !production?.route,
    'production: public routing requires a separate approved release');
  requireCondition(production?.vars?.AUTH_ENABLED !== 'true' && production?.vars?.FINANCIAL_INGESTION_ENABLED !== 'true',
    'production: activation requires a separate approved release');
  requireCondition(migrations.length > 0, 'No migrations found');
  migrations.forEach((name, index) => requireCondition(
    /^\d{4}_[a-z0-9_]+\.sql$/.test(name) && Number(name.slice(0, 4)) === index + 1,
    `Migration sequence is invalid at ${name}`));
  return errors;
}

function collect(root) {
  const read = name => readFileSync(join(root, name), 'utf8');
  const migrations = readdirSync(join(root, 'db/migrations')).filter(name => name.endsWith('.sql')).sort();
  const configuration = {worker: JSON.parse(read('wrangler.json')), eas: JSON.parse(read('eas.json')),
    nodeVersion: read('.nvmrc').trim(), migrations};
  const errors = validateConfiguration(configuration);
  return {schemaVersion: 1, scope: 'offline configuration only', productionApproved: false,
    commit: execFileSync('git', ['rev-parse', 'HEAD'], {cwd: root, encoding: 'utf8'}).trim(),
    dirty: execFileSync('git', ['status', '--porcelain', '--untracked-files=normal'], {cwd: root, encoding: 'utf8'}).trim().length > 0,
    application: JSON.parse(read('app.json')).expo.version,
    node: configuration.nodeVersion, errors,
    migrations: migrations.map(name => ({name, sha256: createHash('sha256').update(read(`db/migrations/${name}`).replace(/\r\n/g, '\n')).digest('hex')}))};
}

if (require.main === module) {
  const root = resolve(__dirname, '..');
  const evidence = collect(root);
  mkdirSync(join(root, '.local'), {recursive: true});
  writeFileSync(join(root, '.local/release-evidence.json'), JSON.stringify(evidence, null, 2) + '\n');
  if (evidence.errors.length) {
    console.error(evidence.errors.join('\n'));
    process.exitCode = 1;
  } else console.log(`Release configuration verified; ${evidence.migrations.length} migration hashes recorded. Production approval is not implied.`);
}
module.exports = {validateConfiguration, collect};
