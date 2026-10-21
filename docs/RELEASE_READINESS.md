# Release readiness and integration runbook

Current evidence: 2026-10-21, America/Indianapolis. This is a staging acceptance record, not production approval. This current summary supersedes old pending statements in dated phase files. The owner chose manual receipt review and Statement handoff without accountant approval.

## Accepted capabilities

| Area | Evidence / limit |
| --- | --- |
| Identity, workspace/account ACL, journal, manual operations | Implemented and covered by the regression suite; live staging acceptance recorded in the individual status files and PRs |
| Bank originals, reconciliation, duplicate prevention | Implemented for supported CSV; private primary and backup copies; arbitrary scanned bank PDFs remain unsupported |
| Categorized cash Statement and personally paid business shares | Staging synthetic acceptance: 250.00 income / 61.23 expenses; immutable snapshot and print verified; personal/family workspaces excluded from business form |
| Old stock and purchase evidence | Known cost with unknown date supported; job consumption does not book cash; duplicate retry and personal source linkage tested |
| CRM integration | Isolated synthetic canary passed; sender/receiver disabled afterwards; production and historical import not enabled |
| Android | 1.0.3/code 4, EAS 9749c2f1-ff44-4a5b-9b56-657024b4bd1f, source 5232a85e473662fdf2b8f40bb2e3b0294720b60e; signature and non-destructive installation verified |
| Native flows | Launch, live report, exact draft recovery after process exit, PDF share sheet, local JPEG after owner camera permission; no expense confirmed and no photo uploaded |
| Automated validation | Installed revision: CI 39687897178, 159 tests including real PostgreSQL concurrency and restore; further tooling changes require their own CI result |

Camera preview/shutter was not directly observed; the local selected image was observed. External Android PDF viewer readability and server upload of that image were not tested. Web print/PDF was confirmed by the owner. These distinctions are intentional.

## Remaining release work

1. Integrate the existing PR stack with required checks intact. All 21 PRs were open at inspection; none is claimed merged.
2. Complete dependency remediation or an explicit reviewed residual-risk decision for upstream build-tool advisories. Worker bundle exclusion is tested but is not a clean dependency audit.
3. Provision/review production isolation, secrets, actual backup and restore, domain/auth configuration and monitoring as a separate approved release. Existing production guards stay in place. Rehearse the candidate on staging first.
4. If signed iPhone distribution is in scope, obtain Apple signing access and perform real-device QA. The owner has no Apple Developer account; no installable iOS build is claimed.
5. For arbitrary bank PDF support, obtain redacted representative statements and implement/test the specific layouts. Supported CSV remains usable meanwhile. Automatic OCR is deferred, not an accidental missing approval step.
6. Before real financial use, validate the intended production account/data configuration and selected release artifact. Synthetic totals are not imported business records.

## Integrating the stack

PR1 originally targeted main; each PR2 through PR21 targeted the preceding feature branch. A fetched ancestry audit confirmed that all 21 remote PR heads and origin/main are ancestors of the PR21 candidate. Therefore PR21 can target main as a single cumulative release review without rewriting, squashing or dropping history.

- Retarget PR21 to main, retain its complete diff and update its description for the cumulative release. Earlier PR discussions remain historical review evidence.
- Run full CI against the cumulative PR/main merge and exact head. Keep branch protection, required checks and conversation resolution enforced. Never substitute stale green checks or an administrator bypass.
- Keep STAGING_DEPLOY_BRANCH on feature/statement-stock-completion during integration. No intermediate main revision is deployed against the v2 database.
- Merge with a merge commit only after the complete candidate passes. Record the resulting main SHA and verify every former PR head remains an ancestor. Preserve all feature branches and review discussions.
- Run CI on main. Only after success, move the staging target to main, explicitly deploy through the existing workflow and repeat authenticated smoke checks. Main integration is not a production deployment.
- Inspect remaining PR states after integration. GitHub may mark ancestor PRs merged automatically. Close a remaining superseded review only after verifying its exact head is contained in main; do not delete its branch or claim it was independently reviewed.
- CRM companion changes stay in Alex-CRM with their own review/CI. A Nestwise merge does not authorize CRM production delivery.

If ancestry fails or main advances, stop consolidation, inspect the divergent commits and validate the resulting merged candidate again. Do not force-push to manufacture ancestry.

## Candidate evidence and recovery

`node scripts/release-preflight.cjs` checks source configuration and produces `.local/release-evidence.json`. It includes revision, dirty state and LF-normalized SHA-256 for every ordered migration. CI retains it for 30 days. It contains no secret values, receipts or customer records. A dirty local record is diagnostic, not a reproducible release artifact. An artifact from a PR merge ref identifies that merge ref, not necessarily the branch head or installed APK.

Keep installed APK SHA256 and signing certificate from RELIABLE_MOBILE_ACCEPTANCE.md distinct from source/migration hashes. Documentation/tooling commits do not change the already installed APK. Do not request another APK merely for documentation changes.

Before a schema change, verify a fresh backup and restore into a separate database/branch. Never restore the shared Neon branch in place. Staging currently includes migrations 0001–0023; preserve historical records, including the pinned 0014 checksum attestation. Do not rewrite applied SQL.

Statement v2 API is not compatible with an unmodified v1 report parser. Rollback must retain compatible report_input behavior or use a separately restored environment; saved v1/v2 snapshots and history must survive. Disable CRM dispatch/ingestion before any data cutover, preserve stable event IDs and reconcile cursors. Do not delete financial facts to make a rollback pass.

Database dumps do not contain R2 originals. Verify both object copies and their hashes against restored metadata. Two buckets in one Cloudflare account are not independent off-provider disaster recovery. An actual production backup/recovery plan is still required.
