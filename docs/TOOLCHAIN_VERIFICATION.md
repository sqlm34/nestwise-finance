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

## Web export boundary and remaining advisory disposition

CI now exports the web build with external source maps, verifies every JavaScript chunk (including lazy chunks), and removes all map files and sourceMappingURL comments before uploading the web-preview artifact. The staging deploy job repeats this on its own actual export before deploying. Missing, malformed, orphan or inline maps and unsafe filesystem links fail the job. The aggregate `.local/web-dependency-evidence.json` contains source counts and hashes of the sanitized deployed JavaScript, not source contents. This closes the previous gap where the mobile and Worker bundles were checked but the web bundle was not. The check is read-before-mutate: failed validation leaves source evidence intact and blocks publication. This evidence is not a clean dependency audit.

The advisory review still has three findings. Installed braces 3.0.3 and node-forge 1.4.0 have no patched release listed in the GitHub advisories checked on October 21, 2026. braces needs attacker-controlled deeply nested patterns for its stack-exhaustion path. Expo's code-signing library actually calls node-forge certificate/publicKey verification; do not claim that the vulnerable function is never invoked by tooling. This application has no expo-updates or OTA code-signing configuration. That limits the current surface but does not prove every build-time input harmless.

The uuid finding concerns v3/v5/v6 with caller-supplied buffers. Installed xcode 3.0.1 calls only uuid.v4() without a buffer, so the identified vulnerable method is not used by that consumer. xcode still declares uuid ^7.0.3. A forced override to patched uuid 11.1.1 would cross a major range and needs separate Xcode parse/write and prebuild compatibility tests. No override or package/lockfile change is included here.

The production residual-risk decision remains open. A future decision must identify the exact candidate, trusted build inputs, closed development servers, disabled unused signing flows, and fresh Worker/web/mobile evidence. Source-map evidence covers exported JavaScript only; it is not a full native APK/IPA audit. Do not describe these controls as patched packages or automatic acceptance of production risk.

Sources: [braces advisory](https://github.com/advisories/GHSA-vfj7-8cjw-p6xm), [node-forge advisory](https://github.com/advisories/GHSA-86w9-cpqp-85rv), [uuid advisory](https://github.com/advisories/GHSA-w5hq-g745-h8pq).

## Production handoff still required

The current production Worker configuration is deliberately inactive. Before a separate activation change, record the exact candidate SHA and the following actual evidence; placeholder names and successful staging tests do not satisfy these requirements:

- A production database and restricted runtime identity isolated from staging/CRM, applied migration hashes and a separate restored-copy verification.
- Private original and backup object storage, metadata-to-object hash verification and an independent disaster recovery destination. Database-only backups omit receipt/statement bytes.
- The selected production HTTPS origin, matching browser/native authentication settings, protected credentials and owner account/workspace provisioning. Existing synthetic staging records must not be promoted as real business data.
- A reviewed dependency decision, signed Android artifact for the production origin and real-device login/report/upload/export acceptance.
- Explicit rollout/cutover and rollback evidence retaining journal identities and compatible v2 reports, monitoring ownership and a recovery rehearsal.

The integration remains disabled unless separately activated; historical import requires its own authorization. iPhone signing and unsupported bank PDF adapters remain external prerequisites as listed in RELEASE_READINESS.md.
