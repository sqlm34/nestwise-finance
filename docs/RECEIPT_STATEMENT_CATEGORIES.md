# Receipt to categorized Statement

A business receipt can be posted with an explicit split across the existing Statement cost categories. The owner enters amounts including tax/shipping/discount and the actual payment date, then reviews a summary before confirmation. Recognition never chooses categories or books money. Unassigned receipts remain available for later classification in Reports.

Migration 0024 adds post_receipt_categorized without changing historical functions/tables. It invokes the existing receipt posting and Statement mapping inside one database transaction. Invalid category totals roll back the cash posting. Receipt/operation identity and deterministic mapping identity protect retries, including reversed category order and a retry after a later report correction. Existing Android clients retain the original three-field posting contract.

Business scope is checked independently in PostgreSQL. Personal/family receipts continue to use ordinary receipt posting; their business share is linked explicitly through the existing owner-expense workflow. No tax deduction, reimbursement or stock consumption is inferred. Operational allocations remain the original other_expense; the separately versioned Statement mapping holds the owner's chosen categories.

Recovery: deploy the previous Worker/UI while retaining additive migration 0024 and all financial history. Never roll back by deleting postings or mappings. The database migration must be applied after a fresh snapshot and separate restored-copy verification, before deploying this endpoint. Object originals remain in both private R2 buckets, separate from the database snapshot.

Validation: exact-money/domain tests, authenticated API with database integration, cash-date report/CSV/evidence assertions, atomic rollback, duplicate/reordered/concurrent retries, later mapping revision preservation, personal/family and revoked-writer rejection, public function denial. Local full suite: 176 passed / 7 PostgreSQL-only skipped before the additional concurrency case; focused final receipt tests passed. CI must run the complete suite on PostgreSQL and verify dump/restore before merge.

Staging migration/deployment and live synthetic UI acceptance are recorded in the PR after completion. This UI change is newer than the pending 1.0.4/code 5 OCR APK; do not claim its category picker is installed on Android until a subsequent signed build is verified.
