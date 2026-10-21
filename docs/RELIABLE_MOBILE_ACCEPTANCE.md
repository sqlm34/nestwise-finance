# Reliable mobile acceptance — first release block

Prepared manual commands are persisted per API origin, authenticated user, workspace and account. The Review button validates and saves the complete draft; partially typed fields before Review are not persisted. Native storage uses Expo SecureStore; browser storage uses same-origin IndexedDB (not an encrypted vault). The app does not cache authorization or open accounts offline after restart: sign in and obtain live account access before recovering a draft. Never use shared browser profiles for private financial data.

States: prepared → pending → confirmed. Persist pending before network I/O. A response timeout, closed screen or lost ACK retains the exact operation ID and payload. Pending commands cannot be edited/discarded. Explicit retry revalidates identity/access and sends the same command; the server remains authoritative for idempotency. A failed local write prevents sending. A confirmed record remains until the owner chooses the next operation, including if cleanup fails. Same-origin browser transactions serialize competing tabs; native transitions serialize across screen remounts. No background send, automatic financial retry, expiry or sign-out deletion of unresolved commands.

Drafts are device-local, not backup or cross-device synchronization. Clearing browser/app data or uninstalling can remove them. A pending command rejected because access or source conditions changed remains locked: restore access and inspect the journal before resolving with support; do not create a replacement payment. Recovery notices on overview, journal and settings lead to the saved operation. Authenticated API waits are bounded; a timeout does not establish whether a write committed.

Web PDF displays a dedicated printable document in the current tab and requires an explicit Print / Save PDF click. The accounting screen no longer invokes a hidden blocking print dialog or relies on popup windows. An explicit Back button reloads the authenticated app route. Printable HTML and CSV downloads are available from immutable snapshots. Native export uses Expo Print then system sharing. Only the generated temporary export is removed after sharing. No report is finalized by export.

Acceptance required for this block:
- CI: types, lint, complete tests, actual PostgreSQL concurrency and restore, web/mobile exports, Worker dry-run.
- Staging: prepared draft survives reload/navigation; confirmation survives reload; journal contains exactly one synthetic posting; second draft cannot replace a pending command; printable snapshot opens and HTML/CSV downloads retain snapshot identity.
- Android: new signed APK matches selected commit, signature verification and installation; owner/device interaction for login, draft recovery, receipt camera and PDF share. An APK installation or JS export alone is not complete mobile acceptance.

No database migration, production change, CRM activation, tax approval or store publication is part of this block.

Definitive server validation errors (`invalid_manual_operation`, `manual_refund_exceeded`) retain a rejected draft that can be corrected. Generic 4xx/5xx, malformed replies, changed identity or lost access never establish absence of a prior posting and do not unlock a pending command.
