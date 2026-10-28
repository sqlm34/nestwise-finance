const {test} = require('node:test');
const assert = require('node:assert/strict');
const {inspectAudit} = require('../scripts/dependency-audit.cjs');
const {inspectSourceMap, verifyDirectory} = require('../scripts/verify-mobile-bundle.cjs');
const {mkdtempSync, mkdirSync, writeFileSync, rmSync} = require('node:fs');
const {tmpdir} = require('node:os');
const {join, dirname, resolve} = require('node:path');
function audit() {
  return {auditReportVersion: 2, vulnerabilities: {braces: {severity:'high', via:[{name:'braces',severity:'high',url:'https://github.com/advisories/GHSA-vfj7-8cjw-p6xm'}]}}, metadata:{vulnerabilities:{total:1}}};
}
test('reviewed staging finding is visible and never grants production approval', () => {
  const result = inspectAudit(audit());
  assert.deepEqual(result.errors, []); assert.equal(result.auditClean, false); assert.equal(result.productionApproved, false);
  assert.equal(result.advisories.length, 1);
});
test('new or more severe advisory fails the staging boundary', () => {
  const report = audit(); report.vulnerabilities.braces.via[0].url = 'https://github.com/advisories/NEW';
  assert.equal(inspectAudit(report).errors.length, 1);
  const escalated = audit(); escalated.vulnerabilities.braces.via[0].severity = 'critical';
  assert.equal(inspectAudit(escalated).errors.length, 1);
});
test('broken audit, registry errors and missing evidence never appear clean', () => {
  for (const report of [{}, {error:{code:'NETWORK'}}, {...audit(),vulnerabilities:{}}, {...audit(),vulnerabilities:{parent:{severity:'high',via:['missing']}}}]) assert.throws(() => inspectAudit(report));
});
test('clean audit remains distinct from production authorization', () => {
  const result = inspectAudit({auditReportVersion:2,vulnerabilities:{},metadata:{vulnerabilities:{total:0}}});
  assert.equal(result.auditClean,true); assert.equal(result.productionApproved,false);
});
test('source maps reject build-tool code on both path separators', () => {
  for (const source of ['node_modules/deepmerge/dist/cjs.js','node_modules/braces/index.js','C:\\repo\\node_modules\\node-forge\\lib\\rsa.js','../node_modules/xcode/node_modules/uuid/index.js']) {
    assert.throws(() => inspectSourceMap({version:3,sources:[source]}));
  }
});
test('indexed source maps are inspected and empty maps fail closed', () => {
  assert.deepEqual(inspectSourceMap({version:3,sections:[{map:{version:3,sources:['src/app.ts']}}]}),['src/app.ts']);
  for (const map of [{version:3,sources:[]},{version:3,sections:[]},{version:2,sources:['x']}]) assert.throws(() => inspectSourceMap(map));
});
test('bundle verification requires real maps for both platforms', () => {
  const root = mkdtempSync(join(tmpdir(),'nestwise-maps-'));
  try {
    assert.throws(() => verifyDirectory(root));
    for (const platform of ['android','ios']) {
      mkdirSync(join(root,platform));
      writeFileSync(join(root,platform,'app.map'),JSON.stringify({version:3,sources:['src/app.ts']}));
    }
    assert.equal(verifyDirectory(root).evidence.length,2);
    writeFileSync(join(root,'ios','app.map'),'invalid');
    assert.throws(() => verifyDirectory(root));
  } finally {
    assert.equal(dirname(resolve(root)), resolve(tmpdir()));
    assert.ok(root.startsWith(join(tmpdir(),'nestwise-maps-')));
    rmSync(root,{recursive:true,force:true});
  }
});
