# Final release scope

Owner decision: finish the following four blocks, without adding unrelated features. This is a work list, not evidence of completion or authorization to publish in app stores.

## 1. Unified application candidate

- Receipt inbox: readable names, payment/review/upload states, page-scoped search and filters, optional technical identifiers.
- Include PR25 Statement category allocation in the next signed Android candidate.
- Verify web workflow and Android launch, account, receipt capture/review, report export and draft recovery against that exact candidate.
- Owner confirmed installed Android 1.0.4/code 5 opens Account and Receipts without a crash. This does not verify changes after its source revision.

## 2. Release verification

- TypeScript, lint, full PostgreSQL tests, backup/restore and both mobile exports must pass CI.
- Review three remaining dependency advisories and tested remediation or a documented residual-risk decision; an allowlist and absence from runtime bundles alone do not close this gate.
- Preserve cash-basis date checks, idempotency, workspace isolation and explicit review of AI suggestions.

## 3. Production preparation and activation

- Separate database and least-privilege auth/runtime identities, private original/backup storage, production secrets and HTTPS origin.
- Verify restored database plus original document hashes; provide independent recovery outside the serving Cloudflare account.
- Verify authentication, monitoring, incident ownership, rollout and rollback with the exact release candidate.
- Existing production guards remain until the concrete configuration and release evidence are reviewed. Store publication remains separately authorized.

## 4. Actual accounts and CRM

- The owner confirmed one business bank account and two personal bank accounts. Actual names and mappings are kept out of this public repository and must be entered into the authenticated production configuration.
- Target production origin: https://nestwise.universestitch.com. The owner confirmed ownership of universestitch.com in Hostinger. DNS activation and HTTPS must be verified before release; configuration alone does not establish a working domain.
- Start with empty real workspaces. Do not promote synthetic staging records or invent opening balances.
- Enable CRM with explicit account mapping and reconciliation of source totals. Historical backfill has separate scope; preserve source IDs and avoid duplicate entries.

## Separate prerequisites

Bank PDF adapters require representative redacted statements. Receipt PDF OCR is not a bank parser. Signed iPhone distribution requires Apple signing access. These do not block a web/Android release with supported bank CSV import.

No completion date is established until production recovery, dependency disposition and the final signed artifact have evidence.

## 2026-10-25 evidence update

PR26 merged as dfe7e0ecf46c1c49f191417464f0d0c236cb69da. PR CI 40195979710 passed all 199 tests including PostgreSQL and restore. Main CI 40196288047 passed checks, staging deployment and EAS access. Web receipt search, review-status filtering, friendly names and technical-detail disclosure were verified in the authenticated synthetic account. No expense was created during this acceptance.

The scoped Expo CLI Zod update removed the new advisory; two existing tooling advisories remain (node-forge, uuid). Web and Android/iOS JavaScript boundary checks passed. This is not native binary acceptance or a clean audit.

Production preparation performed under the owner's explicit approval:
- New isolated Neon project/database, PostgreSQL 17, Ohio; empty database verified before migration.
- Baseline snapshot created, then all 24 historical migrations applied atomically with exact database/owner guards and recorded canonical hashes.
- Separate runtime and authentication roles: no superuser, create-role, create-database or bypass-RLS privileges; membership restricted to the corresponding API role.
- Separate private original/backup R2 buckets and a Worker with no active routes. Authentication, ingestion and OCR remain disabled.
- Three isolated Cloudflare Secrets configured: NESTWISE_DATABASE_URL, AUTH_DATABASE_URL, AUTH_SECRET. Owner credentials were not used as runtime secrets. No secret values are recorded here.
- Domain nameservers changed with owner approval; Cloudflare propagation remains pending. No domain route has been activated.
- Android internal build workflow 40196453184 started from the merged main revision; installation is not yet verified.

Remaining: production restore rehearsal and independent document recovery, dependency disposition, HTTPS/auth activation review, monitoring, real account provisioning/CRM mapping, and exact APK device acceptance. No synthetic financial records were promoted.

## 2026-10-25 recovery and Android verification

- Production snapshot was restored into a separate Neon branch without migrating connections. All 24 migration hashes match; the restored database has no workspaces or financial records, and runtime/auth role isolation was verified. This empty production rehearsal complements the populated PostgreSQL restore exercised in CI.
- An independent synthetic document archive was created outside the repository and OneDrive, protected with AES-256-GCM and a Windows CurrentUser DPAPI key. Both R2 copies and the restored original SHA256 matched. This is manual provider-independent recovery; loss of the Windows profile remains a separate recovery limitation.
- Cloudflare now reports the domain active. No Nestwise route has been published yet.
- Android build f2b56128-d679-49ef-bc2a-ac8a95fe76a9 from dfe7e0e completed. Version 1.0.5/code 6 was installed over the existing staging application via USB without clearing data. Signing certificate SHA256 matched 18512e460f8eff93b69ce565a2c6c3d097b7f779080198b4ae4f589478072266. APK SHA256: b527d883ed666857f426347f6b8f77a77566aa22760feb46d83298294a8d1d38. The owner confirmed the updated application and Receipts open without a crash and show readable names.
- Tooling dependency residual-risk disposition is recorded in DEPENDENCY_REVIEW.txt. It is scoped to the current architecture and does not declare a clean audit.
- The next candidate adds guarded production runtime configuration, redacted incident identifiers, manual candidate packaging, and disabled-until-activation liveness monitoring. None of these changes alone enables production authentication or CRM delivery.
