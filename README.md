# Nestwise Finance

Expo / React Native / TypeScript application for personal, family and business finances. The current delivery is an authenticated **staging application**, with a verified Android 1.0.3 build. It is not a production release. Workiz is excluded.

## Available in staging

- English/Russian interface; authenticated workspaces, account grants and audit history.
- Immutable journal, manual income/expenses, allocations, linked refunds and transfers; scoped drafts and explicit idempotent retries.
- CSV statement archive with private original/backup storage, evidence search, reconciliation and duplicate-protected bank-only booking.
- Receipt originals and manual review; native camera capture. Automatic OCR is deferred by owner choice.
- Business-only categorized cash Financial Statement, immutable snapshots and PDF/CSV handoff. No accountant approval workflow is required. Personal purchases enter only through explicit business portions.
- Existing parts register: known cost, unknown purchase dates, existing-payment search/linkage, job consumption and returns without creating a second cash expense.
- CRM receiver and separately developed Alex-CRM producer tested with synthetic canary data. The channel is currently disabled; no production or historical import is implied.

For evidence and remaining release requirements see [release readiness](docs/RELEASE_READINESS.md), [native acceptance](docs/RELIABLE_MOBILE_ACCEPTANCE.md) and [Statement/parts behavior](docs/STATEMENT_HANDOFF_AND_PARTS.md). Earlier dated status files are historical checkpoints, not the current feature inventory.

## Development and checks

Use Node **24.19.0** from `.nvmrc`. Linux CI installs dependencies with `npm ci`, then runs types, lint, tests, web/mobile JS exports, Worker dry-run and real PostgreSQL concurrency/restore checks.

In this Windows workspace (spaces, Cyrillic and `&` in its path), use PowerShell:

```powershell
& '.\scripts\check-windows.ps1'
```

The launcher selects the supported bundled Node and invokes JavaScript tools directly. Do not use generated `.cmd` wrappers for these checks. See [AGENTS.md](AGENTS.md). Other CLI tasks should likewise invoke their JavaScript entry point under the selected Node.

```sh
# Linux / a supported shell environment
npm ci
npm run web
npm test
npm run build:web
npm run build:mobile
npm run worker:check
node scripts/release-preflight.cjs
```

The preflight is offline: it checks environment separation and records commit, dirty-tree state, version and normalized migration hashes in `.local/release-evidence.json`. CI retains that file as `release-evidence`. It does not connect to databases, inspect secret values or authorize production. Native JS export is not a signed APK/IPA or device acceptance.

## Bank input and documents

CSV accepts `Date,Description,Amount`, `Date,Description,Debit,Credit`, and recognized Chase-style columns. Dates are ISO `YYYY-MM-DD` or US `M/D/YYYY`; currency is USD. Original archive limits and review rules are documented in [statement archive](docs/STATEMENT_ARCHIVE_STATUS.txt). Unsupported scanned bank PDFs, OFX/QFX and unverified bank layouts are not supported adapters; representative redacted samples are still needed. Equal amounts never establish a match automatically.

## Delivery

The repository is public by owner decision. Never commit credentials, real financial data, receipts or customer information. Features use branches and PRs. The existing 21-PR stack is consolidated through PR21 after verifying ancestry; see the release runbook before merging or changing deployment targets.

Staging deploys only from the selected branch after CI and uses GitHub environment secrets. EAS builds only explicitly selected revisions or manual authorized jobs. There is no automated production/store submission. Production has no public route and remains disabled. Physical iOS distribution still needs Apple signing access; the simulator export is not an installable iPhone release.

Database changes use versioned migrations and separate restore drills. Current Statement v2 rollback needs compatible API code; do not blindly deploy an old v1 app against the current database. CRM changes belong only in Alex-CRM's repository.

[API contract](docs/CRM_CONTRACT.md) · [OpenAPI](docs/openapi.yaml) · [Database recovery](db/README.md) · [Dependency review](docs/DEPENDENCY_REVIEW.txt)
