# Receipt to categorized Statement

A business receipt can be posted with an explicit split across the existing Statement cost categories. The owner enters amounts including tax/shipping/discount and the actual payment date, then reviews a summary before confirmation. Recognition never chooses categories or books money. Unassigned receipts remain available for later classification in Reports.

Migration 0024 adds post_receipt_categorized without changing historical functions/tables. It invokes the existing receipt posting and Statement mapping inside one database transaction. Invalid category totals roll back the cash posting. Receipt/operation identity and deterministic mapping identity protect retries, including reversed category order and a retry after a later report correction. Existing Android clients retain the original three-field posting contract.

Business scope is checked independently in PostgreSQL. Personal/family receipts continue to use ordinary receipt posting; their business share is linked explicitly through the existing owner-expense workflow. No tax deduction, reimbursement or stock consumption is inferred. Operational allocations remain the original other_expense; the separately versioned Statement mapping holds the owner's chosen categories.

Recovery: deploy the previous Worker/UI while retaining additive migration 0024 and all financial history. Never roll back by deleting postings or mappings. The database migration must be applied after a fresh snapshot and separate restored-copy verification, before deploying this endpoint. Object originals remain in both private R2 buckets, separate from the database snapshot.

Validation: exact-money/domain tests, authenticated API with database integration, cash-date report/CSV/evidence assertions, atomic rollback, duplicate/reordered/concurrent retries, later mapping revision preservation, personal/family and revoked-writer rejection, public function denial. Local full suite: 176 passed / 7 PostgreSQL-only skipped before the additional concurrency case; focused final receipt tests passed. CI must run the complete suite on PostgreSQL and verify dump/restore before merge.

Staging migration/deployment and live synthetic UI acceptance are recorded in the PR after completion. This UI change is newer than the pending 1.0.4/code 5 OCR APK; do not claim its category picker is installed on Android until a subsequent signed build is verified.

## Staging evidence, October 21, 2026

PR25 candidate 9f828aa: CI 39700644459 passed 184/184 tests, including PostgreSQL concurrency and full dump/restore comparison. The first run exposed a stale migration-count assertion (23 versus 24); both ledger fixture paths were updated and all checks rerun.

A fresh Neon snapshot at 2026-10-22 00:31:28 UTC was restored into br-tiny-unit-b5w92s7g. Its 20 journal transactions, 2 receipt reviews and saved-report fingerprints matched the source staging branch; direct runtime table access remained denied. Migration 0024 was rehearsed there, then applied to staging. SHA256: f10694c6bb69064dcd6fe96337409ea30fad766b900cfb06bf5609ea497e8126. The copied branch and snapshot remain available; connections were not migrated or switched.

On web staging, the synthetic NESTWISE TEST SHOP receipt (32.10 USD) was split into Office Expenses 10.70 and Purchases 21.40. A one-cent mismatch prevented confirmation. Canceling the confirmation preserved payment date and both splits. Explicit confirmation created operation 4805ff99-7426-4fa6-bfa2-280e819c2452; the report showed 250.00 income / 93.33 expenses, including the earlier 61.23 synthetic supplies and zero unclassified totals. No real payment or extra OpenAI call was made. HTTPS/auth/ingestion-disabled checks passed.

Separately, OCR APK 1.0.4/code 5 (source 1e3fbfa, Expo b4427faa-73bb-4684-bcef-71168f18fed8) was downloaded, certificate-verified and installed using adb install -r on the connected Samsung. APK SHA256 9fd5192ebc3a2857c214cf8cdeb9a9b73808afe39daf7ccbcf77914b5f3bd780; certificate SHA256 18512e460f8eff93b69ce565a2c6c3d097b7f779080198b4ae4f589478072266. This binary predates this PR's category picker. Device UI confirmation remains pending because the mirrored display was black. The temporary build monitor was paused after successful installation.
