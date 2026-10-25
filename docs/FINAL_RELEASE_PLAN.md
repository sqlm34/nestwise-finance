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
