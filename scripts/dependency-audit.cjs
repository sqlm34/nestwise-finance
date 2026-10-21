// Staging regression boundary, not a production risk acceptance or audit waiver.
const {spawnSync} = require('node:child_process');
const {mkdirSync, writeFileSync} = require('node:fs');
const reviewed = new Map([
  ['braces|https://github.com/advisories/GHSA-vfj7-8cjw-p6xm', 'high'],
  ['node-forge|https://github.com/advisories/GHSA-86w9-cpqp-85rv', 'high'],
  ['uuid|https://github.com/advisories/GHSA-w5hq-g745-h8pq', 'moderate'],
]);
const severity = {info: 0, low: 1, moderate: 2, high: 3, critical: 4};

function inspectAudit(report) {
  if (report?.auditReportVersion !== 2 || report.error || !report.vulnerabilities ||
      typeof report.vulnerabilities !== 'object' || Array.isArray(report.vulnerabilities) ||
      !Number.isInteger(report.metadata?.vulnerabilities?.total)) throw new Error('Audit report is missing or invalid');
  if (report.metadata.vulnerabilities.total !== Object.keys(report.vulnerabilities).length) throw new Error('Audit count does not match evidence');
  const findings = new Map();
  const errors = [];
  for (const vulnerability of Object.values(report.vulnerabilities)) {
    if (!Array.isArray(vulnerability.via) || !Object.hasOwn(severity, vulnerability.severity)) throw new Error('Invalid audit vulnerability');
    if (vulnerability.severity === 'critical') errors.push('Critical dependency finding requires review');
    for (const via of vulnerability.via) {
      if (typeof via === 'string') {
        if (!report.vulnerabilities[via]) throw new Error('Broken audit dependency reference');
        continue;
      }
      if (!via || typeof via.name !== 'string' || typeof via.url !== 'string' || !Object.hasOwn(severity, via.severity)) throw new Error('Invalid audit advisory');
      const key = `${via.name}|${via.url}`;
      const prior = reviewed.get(key);
      if (!prior || severity[via.severity] > severity[prior]) errors.push(`Unreviewed or escalated advisory: ${key}`);
      findings.set(key, {package: via.name, url: via.url, severity: via.severity});
    }
  }
  if (Object.keys(report.vulnerabilities).length && !findings.size) throw new Error('Audit findings have no advisory evidence');
  return {schemaVersion: 1, productionApproved: false, auditClean: Object.keys(report.vulnerabilities).length === 0,
    affectedNodes: report.metadata.vulnerabilities, advisories: [...findings.values()].sort((a,b) => a.url.localeCompare(b.url)), errors: [...new Set(errors)]};
}

if (require.main === module) {
  try {
    // On Windows pass an npm-cli.js path explicitly; never invoke CMD shims.
    if (process.platform === 'win32' && !process.argv[2]) throw new Error('Pass the npm-cli.js path on Windows');
    const result = spawnSync(process.platform === 'win32' ? process.execPath : 'npm',
      [...(process.platform === 'win32' ? [process.argv[2]] : []), 'audit', '--omit=dev', '--json'],
      {encoding: 'utf8', timeout: 120000, maxBuffer: 16 * 1024 * 1024, windowsHide: true});
    if (result.error || ![0,1].includes(result.status)) throw new Error('Dependency audit did not complete');
    const evidence = inspectAudit(JSON.parse(result.stdout));
    mkdirSync('.local', {recursive: true});
    writeFileSync('.local/dependency-evidence.json', JSON.stringify(evidence, null, 2) + '\n');
    console.log(`Dependency audit: ${evidence.advisories.length} distinct advisories; clean=${evidence.auditClean}; production approval=false.`);
    if (evidence.errors.length) throw new Error('New or escalated dependency findings require review');
  } catch {
    console.error('Dependency audit failed. Review the evidence or rerun npm audit; no registry credentials logged.');
    process.exitCode = 1;
  }
}
module.exports = {inspectAudit};
