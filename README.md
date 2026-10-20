# Nestwise Finance

Expo / React Native / TypeScript application for family, personal and business finances.

**Phase 2A development preview. This is not a live accounting system.**
All transaction fixtures are synthetic. Alex CRM, banking and OCR are not connected.
Uploaded CSV files are parsed locally, kept in memory, and never posted to a ledger.
Workiz is excluded from this project.

## Run

Use Node **24.19.0** (`.nvmrc`) and npm.

```sh
npm ci
npm run web
```

The same React Native source targets Android, iOS and web. The web build is a
development preview, not the later accountant portal.

```sh
npm run typecheck
npm run lint
npm test
npm run build:web
npm run build:mobile
npm run worker:check
```

Native JavaScript export is not an APK/IPA or proof of behavior on a real device.

## Implemented

- Four independent local workspace views.
- Full English/Russian interface and device-local language preference.
- Overview, searchable/filterable/sortable transactions and transaction details.
- CSV selection, exact integer-cent parsing, SHA-256 file identity, preview,
  sign checks, invalid-row diagnostics and possible duplicate detection.
- Original 44 accountant category IDs and English labels, with Russian labels.
- Explicitly disconnected CRM page and unimplemented reconciliation disclosure.
- Staging-only Worker health probe; all financial endpoints return 404.

CSV columns: `Date,Description,Amount` (signed amount), or
`Date,Description,Debit,Credit`. Chase checking-style
`Details,Posting Date,Description,Amount` is also recognized.
Dates must be ISO `YYYY-MM-DD` or US `M/D/YYYY`; currency is USD.
Maximum 2 MB / 5,000 rows. Identical rows are flagged, never silently removed.
South National currently uses the explicit generic column layout. Real bank
fixtures are still required before claiming a verified bank-specific adapter.

PDF/OCR/OFX/QFX, bank balances, durable file storage, ledger posting,
mobile login, automatic matching, the CRM sender, cloud database provisioning
and accountant report generation are **not yet implemented**.

## Server foundation (phase 2A)

The new receiver validates HMAC-signed CRM events and commits a durable inbox
and balanced immutable journal. Sessions, workspace membership and account
grants protect the read API. Refunds, supplier credits, fee refunds, corrections,
out-of-order delivery and idempotency are covered by database tests.
The deployed receiver remains disabled and production is explicitly refused.

See [CRM API contract and ERD](docs/CRM_CONTRACT.md),
[OpenAPI](docs/openapi.yaml), and [migration/restore runbook](db/README.md).
`npm run demo:ledger` opens a synthetic, in-memory PostgreSQL demonstration
at `http://127.0.0.1:8082`. It is a verification tool, not the user-facing app.
CI runs PostgreSQL 17 concurrency tests and a dump/restore verification.

## Version control and CI

Public repository by owner decision on 2026-10-20. No live financial data,
credentials, receipts or customer information may be committed.
Features use `feature/*` branches and Pull Requests into protected `main`.
The required `checks` job runs types, lint, tests, web/native JS exports and
Worker dry-run. Actions are pinned to commit SHAs.

The staging job requires `STAGING_ENABLED=true` and the staging environment
secrets `CLOUDFLARE_API_TOKEN` and `CLOUDFLARE_ACCOUNT_ID`. It runs only after
successful checks on trusted push events, never on fork PR events.
Use a scoped Cloudflare service token; do not copy a developer OAuth session
into GitHub secrets.

EAS has separate development, staging and production profiles and application
identifiers. Staging creates an Android APK and an iOS Simulator build.
Physical iOS installation requires a later signing/device-provisioning setup.
The manual EAS workflow requires `EAS_ENABLED=true`, `EAS_PROJECT_ID`, and
the `EXPO_TOKEN` staging secret. There is no automated store submission or
production deployment workflow.

## Architecture and next stages

See [implementation and rollback plan](docs/IMPLEMENTATION_PLAN.txt),
[release status](docs/PHASE_1_STATUS.txt), and
[dependency review](docs/DEPENDENCY_REVIEW.txt).

Nestwise will have its own database. CRM modifications belong only in the
Alex-CRM repository. No production CRM code or data was changed for this phase.
Database migration files will be versioned, tested in isolation, and accompanied
by restore procedures before any schema is deployed.

## Reference material

`reference/design.html` is the supplied design concept, not the application.
`reference/financial-statement.pdf` is the supplied blank reconstructed form,
not a generated financial report. Its labels are preserved in
`src/data/accountant-categories.json`.

Framework setup references:
[Expo SDK 58](https://docs.expo.dev/versions/v58.0.0/),
[EAS profiles](https://docs.expo.dev/build/eas-json/),
[Cloudflare GitHub Actions](https://developers.cloudflare.com/workers/ci-cd/external-cicd/github-actions/).
