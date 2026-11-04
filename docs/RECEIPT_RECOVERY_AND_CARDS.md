# Receipt recovery and card routing

The original is persisted before any upload. Native storage uses private application documents (not cache), with the binary written before an atomic metadata rename. Web uses an IndexedDB transaction. Scope contains API origin, authenticated user, workspace and account. Each scope holds at most 20 pending originals, each at most 5 MB. Never clear these stores on network failure or logout.

The receipt screen retries original uploads every 30 seconds while open and on foreground return. This is not an operating-system background service. After restarting, sign in and reopen the same account's receipt screen to resume. Do not promise capture from a cold start without login. Application removal or browser data deletion removes local drafts; retain separate originals for important evidence.

Only a matching content hash and `archived: true` acknowledgement permits local removal. The existing server verifies both document archives. Original upload is idempotent and never books money. Recovery does not automatically repeat paid OCR: the user opens an uploaded receipt and selects processing or manual entry.

Editor fields and the exact pending confirmation command are saved locally. Recovery requires the same receipt revision. A newer server revision blocks automatic restoration. Saving reviewed data remains explicit. A local-storage error must be visible; it must not claim durable success.

OCR may return `card_last4` (four digits or null). Historical receipts without this field remain valid. Full numbers, ambiguous/multiple cards and unidentifiable wallet tokens must not be inferred. Native clients advertise `Accept: application/vnd.nestwise.receipt-v2+json`; the receipt API omits the new field for older strict clients.

`NESTWISE_RECEIPT_CARD_ROUTES` is private environment configuration containing an array of `{last4, workspace, account}`. Do not commit real card/account mappings. Resolve only a unique exact match among the authenticated user's writable USD accounts. No bank-name heuristics. Unknown cards require the user to check the selected account.

For a mapped mismatch, the UI offers a transfer. The server verifies source and target permissions, rejects already-recorded source purchases, copies and verifies the original in both archives, and reuses recognized data without another OCR call. Repeated transfer preserves an existing target review. Source originals remain as evidence; neither transfer nor recognition creates an expense. Posting on a known wrong account is refused for both business and personal receipts. The user must verify the card suffix before recording payment.

Personal-card business items continue using the existing item classification and proportional cents allocation. Linking a personal receipt to a bank row adds evidence rather than a second withdrawal. Service charts continue reading bank withdrawals only; receipt originals and review versions are not added again.

Release requires CI, synthetic transfer/retry and editor recovery checks, existing-client compatibility, plus Android foreground/restart verification. Configure only verified current account IDs (do not confuse legacy unconnected accounts with connected bank accounts). No database migration is needed. Roll back Worker version and OTA if acceptance fails; preserve local queue/draft storage for forward recovery.
