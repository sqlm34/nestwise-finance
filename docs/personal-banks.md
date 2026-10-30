# Personal bank connections

The first release imports a manually provisioned Plaid connection into a dedicated
personal financial account. It does not write CRM journal entries or business tax
reports. Bank feed amounts use positive inflows and negative outflows. Pending
transactions are labelled and replaced/removed according to Plaid's sync feed.
The UI deliberately reports money movements, not taxable income or deductible
expenses; transfers and credit card payments are not classified as spending.

Apply migration 0026 with the existing production migration guard. Provision one
`bank_feeds` row per explicitly selected personal bank account; create a dedicated
financial account in the user's personal workspace via `workspace_command` first.
Never reuse a business workspace or a CRM account. Read authorization respects
workspace membership and individual account grants. Sync refuses business feeds.

Store only in encrypted Worker secret bindings:

- `PLAID_CLIENT_ID`, `PLAID_SECRET`
- `PLAID_ENVIRONMENT`: `production` (or `sandbox` for isolated development)
- `PLAID_PERSONAL_CONNECTIONS`: JSON array of `{feed, access_token, account_id}`.
  `feed` is the internal bank_feeds UUID. `account_id` is the single consented
  Plaid account ID, not the Nestwise account UUID. Never include unselected accounts.

Enable a 15-minute Worker cron without replacing existing CRM schedules. Each feed
has a database lease and persistent 15-minute cooldown. Cursor batches commit
atomically after all pages; pagination mutations restart from the original cursor.
No `/transactions/refresh` calls or bank credentials are used. Plaid's own bank
refresh cadence determines freshness, and bank data is not real time.

Secrets, API responses and access tokens must never enter Git, browser storage,
logs or frontend bundles. One-time setup files on Windows use CurrentUser DPAPI
inside a directory restricted to that user. A completed Link token must be
exchanged and saved before it expires; an exchange timeout must be investigated
before retrying or creating another paid/Trial Item.

To disconnect, disable the feed, call Plaid `/item/remove` for the associated Item
after confirming it is not shared by another configured feed, and remove the
Worker secret entry. Disabling alone stops our sync but does not revoke Plaid's
bank access or end any subscription. Retained historical rows remain read-only.

Deployment must preserve current Worker bindings, asset behavior, ingestion
approvals and secrets. Verify the authenticated personal view and a business
account after release. Never display a successful connection solely because a
Link session was created: require the exchange and an authorized accounts result.
