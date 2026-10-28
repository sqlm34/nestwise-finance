const test = require('node:test');
const assert = require('node:assert/strict');
const {getConfig} = require('@expo/config');
const eas = require('../eas.json');

test('OTA config isolates environments and keeps launch recovery enabled', () => {
  const previous = process.env.APP_ENV;
  try {
    const packages = new Set();
    for (const environment of ['development', 'staging', 'production']) {
      process.env.APP_ENV = environment;
      const {exp} = getConfig(process.cwd(), {skipSDKVersionRequirement: true});
      assert.equal(eas.build[environment].channel, environment);
      assert.equal(exp.extra.environment, environment);
      assert.equal(exp.updates.enabled, environment !== 'development');
      assert.equal(exp.updates.url, `https://u.expo.dev/${exp.extra.eas.projectId}`);
      assert.equal(exp.runtimeVersion.policy, 'fingerprint');
      assert.equal(exp.updates.checkAutomatically, 'ON_LOAD');
      assert.equal(exp.updates.fallbackToCacheTimeout, 0);
      assert.equal(exp.updates.useEmbeddedUpdate, true);
      assert.equal(exp.updates.disableAntiBrickingMeasures, false);
      packages.add(exp.android.package);
    }
    assert.equal(packages.size, 3);
    process.env.APP_ENV = 'unknown';
    assert.throws(() => getConfig(process.cwd()), /Invalid APP_ENV/);
  } finally {
    if (previous === undefined) delete process.env.APP_ENV;
    else process.env.APP_ENV = previous;
  }
});
