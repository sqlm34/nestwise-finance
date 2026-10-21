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

Android acceptance on 2026-10-21: owner reported launch crash after installing 1.0.1 (2). Device crash log identifies TypeError: Cannot convert BigInt to number in insightMoney / AccountInsights. Installation success was not runtime acceptance. Replaced Intl BigInt formatting in both overview and journal with exact decimal-string grouping; added regression coverage for missing Intl BigInt support, both locales, negative/sub-dollar and PostgreSQL bigint-limit values. Replacement APK and device acceptance remain required. Temporary build monitor remains paused at owner request.

Owner reconnected the Android device on 2026-10-21. Build 4b139e30 (1.0.2 / code 3) succeeded, but predates Statement v2 and the parts register. Prepare 1.0.3 / code 4 from PR21 for acceptance against the current staging API. It includes the BigInt startup fix and the complete Statement/parts block. Verify the established signing certificate and update without uninstalling or clearing data. Device acceptance remains pending until launch, authenticated reports, prepared draft recovery, receipt camera and PDF sharing are checked.

1.0.3 installation evidence, 2026-10-21:
- EAS build `9749c2f1-ff44-4a5b-9b56-657024b4bd1f`, commit `5232a85e473662fdf2b8f40bb2e3b0294720b60e`, succeeded. Build time 13m28s; total 13m34s.
- GitHub run `39687897178`: all jobs successful, 159/159 tests and PostgreSQL backup/restore passed.
- APK signature verified; certificate SHA256 `18512e460f8eff93b69ce565a2c6c3d097b7f779080198b4ae4f589478072266` matches the established signer.
- APK SHA256 `096d87a94969abc865c80ca4f04e71de597d1833fb7ea54c814fb2a158354c40`; package `com.aksenov.nestwise.staging`, version 1.0.3, code 4.
- `adb install -r` succeeded on the connected Samsung SM-G986U; installed-package metadata independently confirms version/code. No uninstall or data clearing.
- Build monitor paused after installation. Owner launch and native acceptance are still pending; successful installation is not proof of crash-free runtime, camera or PDF behavior.
- Owner subsequently confirmed the app opens and works without a crash. ADB confirms a running app process; its captured AndroidRuntime/ReactNativeJS/ReactNative error log was empty at inspection. This is a launch smoke check, not proof of all native flows. Prepared draft recovery, authenticated reports, receipt camera and PDF sharing remain separate acceptance checks.

Physical-device acceptance via the scrcpy desktop window, 2026-10-21:
- Used installed 1.0.3 on Samsung SM-G986U, not a browser substitute. Existing authenticated session and selected SYNTHETIC business card restored after app restart.
- Prepared (did not confirm/post) synthetic expense 12.34 USD, paid date 2026-10-21, note `SYNTHETIC Android 1.0.3 draft recovery - no posting`, operation `c527e760-bdc4-4f61-b07c-1f2278f63be0`.
- Removed only Nestwise from Android recents; ADB confirmed its process had exited. Reopened via its home-screen icon. The same amount, note, date and operation ID returned on the review screen. No uninstall/data clearing. Prepared draft deliberately remains available; no financial confirmation pressed.
- Native Financial Statement loaded live totals 250.00 / 61.23 USD and saved snapshot `5d446a06-f641-4598-9fd5-202ded3fd9fb` with hash `2c770ad6052aaa2f8f71370c86d7ef432f123cef9f272c322cc23b2a4cabfc07`. Stock and personal-business evidence displayed. Draft did not add an expense.
- Native Print/PDF generated a `.pdf` and opened the Android share sheet. Dismissed without selecting any recipient; delivery and an external PDF viewer were not tested.
- Receipt camera action reached Android's permission prompt; the owner handled permission and replied ready. The native screen subsequently displayed a selected JPEG (2,854,598 bytes) awaiting explicit upload. Camera preview/shutter interaction was not directly observed. The photo was not uploaded or discarded; its contents were not inspected.
- Final running-process AndroidRuntime/ReactNativeJS/ReactNative error-log inspection returned no matching errors. This bounded observation does not prove absence of every possible runtime issue.
- Available native acceptance is complete for launch, authenticated report loading, prepared draft recovery, capture returning a local image and PDF share-sheet generation. External PDF viewer readability and receipt server upload were not exercised in this native pass.
