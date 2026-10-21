# Toolchain verification and remaining production evidence

This block changes build/release tooling, not application behavior, the database or the installed Android version. It does not create a production environment, expose endpoints, provision credentials, enable CRM delivery or submit stores.

## Reproducible CI

The two workflows pin official releases to full commit SHAs:

- checkout 7.0.1: `3d3c42e5aac5ba805825da76410c181273ba90b1`
- setup-node 7.1.0: `949feb2413d6458794dcd2491c4babbbce0c15c1`
- upload-artifact 7.0.2: `cf430e030ddbb5b0abf93d22962f4752f3646cd9`

Official action.yml files declare Node 24. All jobs now use ubuntu-24.04 rather than the moving ubuntu-latest alias. Application Node remains pinned by .nvmrc. Source, installed packages and native configuration are unchanged. Existing read-only workflow permissions and protected staging secrets remain unchanged.

Sources: [checkout](https://github.com/actions/checkout/releases/tag/v7.0.1), [setup-node](https://github.com/actions/setup-node/releases/tag/v7.1.0), [upload-artifact](https://github.com/actions/upload-artifact/releases/tag/v7.0.2).

## Dependency evidence

`node scripts/dependency-audit.cjs` runs a fresh npm audit --omit=dev. On Windows provide the npm-cli.js path explicitly under the supported Node, avoiding CMD wrappers. Registry/network failures and malformed/inconsistent reports fail instead of becoming a clean result. New advisories, critical findings and severity escalation fail the staging regression check.

The three already documented advisories remain visible in `.local/dependency-evidence.json`; `auditClean` is false and `productionApproved` is always false. This is a comparison against previously investigated staging findings, not a production waiver. It must not be described as vulnerability remediation.

On 2026-10-21 local audit returned 22 affected dependency nodes (3 moderate, 19 high), representing three leaf advisories. The previous npm invocation reported 27 affected nodes. The lockfile did not change: this count difference is not evidence that five vulnerabilities were fixed. CI records its fresh counts independently.

GitHub advisory records still report no patched release for braces GHSA-vfj7-8cjw-p6xm and node-forge GHSA-86w9-cpqp-85rv. uuid GHSA-w5hq-g745-h8pq has patches, but xcode declares ^7.0.3 and calls uuid.v4; no unvalidated cross-major override was applied. Review a supported upstream update or an explicit compatibility-tested replacement before claiming remediation.

## Mobile bundle boundary

Expo SDK 58's installed CLI supports export --source-maps. CI exports Android and iOS maps into dist-mobile, then inspects every map for both platforms. It handles indexed maps and Windows/Unix paths; missing, empty, malformed or build-tool-containing maps fail closed. Local evidence: Android 3,316 source entries, iOS 3,322; no braces, node-forge or uuid modules present. Counts can differ across platform/tool environments; absence is the asserted property.

Only aggregate evidence is uploaded. Source maps are not part of the web deployment or web-preview artifact. The check complements the existing esbuild Worker-input check. It establishes absence from exported JavaScript, not a comprehensive APK/IPA/native-library audit or proof of every build-time path. A clean boundary cannot close the production dependency gate by itself.

Both normal CI and manually requested EAS builds execute the checks. No schedule, background polling or extra APK build is introduced.

## Production handoff still required

The current production Worker configuration is deliberately inactive. Before a separate activation change, record the exact candidate SHA and the following actual evidence; placeholder names and successful staging tests do not satisfy these requirements:

- A production database and restricted runtime identity isolated from staging/CRM, applied migration hashes and a separate restored-copy verification.
- Private original and backup object storage, metadata-to-object hash verification and an independent disaster recovery destination. Database-only backups omit receipt/statement bytes.
- The selected production HTTPS origin, matching browser/native authentication settings, protected credentials and owner account/workspace provisioning. Existing synthetic staging records must not be promoted as real business data.
- A reviewed dependency decision, signed Android artifact for the production origin and real-device login/report/upload/export acceptance.
- Explicit rollout/cutover and rollback evidence retaining journal identities and compatible v2 reports, monitoring ownership and a recovery rehearsal.

The integration remains disabled unless separately activated; historical import requires its own authorization. iPhone signing and unsupported bank PDF adapters remain external prerequisites as listed in RELEASE_READINESS.md.
