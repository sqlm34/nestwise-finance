# Isolated Nestwise database and migration runbook

The migration targets a **new database** named `nestwise_development`,
`nestwise_staging`, or disposable `nestwise_test`. Never use the CRM database.
The runner refuses other names and databases containing `public.jobs`.
It serializes migration runs with an advisory lock, records SHA-256 checksums,
refuses modified/missing applied migrations and commits each migration batch
atomically. Runtime requests never run DDL.

```sh
# Set credentials through an environment secret, not a command-line argument.
# NESTWISE_MIGRATION_URL: separate migration-owner connection
NESTWISE_MIGRATION_CONFIRM=apply-nestwise-nonproduction node scripts/migrate.cjs
```

Use a dedicated database cluster/project per environment: `nestwise_api` is a
cluster role. Provision a LOGIN role inheriting only `nestwise_api`, with no
superuser, BYPASSRLS, CREATE, role management or schema/table ownership.
Store that restricted connection in Cloudflare `NESTWISE_DATABASE_URL`.
Never copy the migration owner's connection into the Worker.

Membership/account/session/connection provisioning is deliberately
administrative in this milestone, not a public sign-up API. Seed only synthetic
users for validation. Session hashes must come from cryptographically random
tokens with short expiry; users cannot choose their membership or role.

## Verification

- `npm test`: local PGlite (actual PostgreSQL engine compiled to WASM) applies
  the same SQL migration. Multi-connection concurrency is skipped locally.
- GitHub CI supplies isolated PostgreSQL 17, runs the complete suite including
  simultaneous duplicate deliveries and applies migrations twice to verify
  no duplicate DDL.
- CI dumps the populated test database, restores to `nestwise_restore`, compares
  row counts and SHA-256 fingerprints of every Nestwise table, and checks
  runtime privileges and immutable-history triggers after restore.
- `node scripts/ledger-demo.cjs`: local, synthetic, in-memory demonstration at
  `http://127.0.0.1:8082`. It never connects to a cloud database or the CRM.

## Enablement order

1. Review PR, migrations and the explicit limitations in `docs/CRM_CONTRACT.md`.
2. Provision a separate nonproduction database and test backup/restore there.
3. Provision restricted runtime role, memberships, financial accounts and a
   disabled connection. Store runtime database URL and rotating HMAC keys only
   in Cloudflare secrets. Do not put them in `EXPO_PUBLIC_*` or mobile config.
4. Configure a scheduler to invoke `process_pending()` before enabling delivery.
   No production scheduler is provisioned by this PR.
5. Turn on the test connection and `FINANCIAL_INGESTION_ENABLED=true` in isolated
   development/staging only. The current deployed configuration remains OFF.
6. Exercise synthetic signed events through HTTP and compare ledger results.
7. Only then implement/enable the CRM outbox in the CRM's own repository.
   Historical backfill and production each require owner approval.

## Rollback / restore

Disable ingestion and stop sender/scheduler first. Revert Worker code if
necessary. Keep all accepted events and journal history. Do not use destructive
down migrations on a database containing financial facts.

Before a future schema upgrade, take an encrypted `pg_dump -Fc` snapshot into
private storage with retention/access controls, record migration checksums,
and verify a restore into a separate database with `pg_restore --no-owner`.
Restore role grants, compare event identities, row counts and exact totals,
and test session/workspace denial before any endpoint cutover.
The automated CI drill uses synthetic data only; no production backup exists
or is claimed. Backfill after restore must reuse stable event/fact IDs and
reconcile accepted-event cursors; never simply replay different IDs.
