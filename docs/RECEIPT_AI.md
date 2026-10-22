# Receipt recognition — staging

OpenAI Responses extracts the selected archived JPEG, PNG, WebP or PDF (5 MB maximum). Both private original copies must already exist. Only a signed-in writer can submit a document, after per-document consent. The result is a separate unsaved draft: Apply replaces editor fields, Review saves a version, and explicit payment confirmation is still required to book an expense. The printed date never silently becomes the payment date. Unsupported currencies and unreadable amounts are not invented.

## Configuration and access

- Staging model: `gpt-6-luna`. Production remains disabled.
- Cloudflare Secret: `NESTWISE_OCR_API_KEY`, never a public Expo variable or a GitHub source file.
- The separately authorized OpenAI key permits Responses API and expires November 20, 2026. Rotate before expiry; do not reuse the Alex CRM key.
- Set `NESTWISE_OCR_ENABLED=false` and deploy to disable recognition. Manual receipt entry remains available. Remove/rotate the secret separately if compromised.
- Database migration 0016 already enforces durable UTC daily limits: 20 attempts per actor, 100 per account. Failed provider attempts count. These are request quotas, not a monetary cap. No automatic provider retries or fallback models.
- Server provider timeout: 55 seconds. Client OCR timeout: 70 seconds; ordinary API calls retain their 30-second timeout. A lost response may still have been billed, which the UI explains.

## Data and cost

The complete selected original is transmitted to OpenAI, including anything visible on it. Extraction instructions exclude card/account numbers and addresses from the returned fields; they do not redact the source before transmission. Requests use `store:false`, no Files API, no tools, no background execution, and reject redirects.

OpenAI API data is not used for training by default. `store:false` does not remove abuse-monitoring retention, normally up to 30 days with documented exceptions. See https://developers.openai.com/api/docs/guides/your-data .

On October 21, 2026 the model page lists standard token prices of $0.10/M input and $0.50/M output; actual document cost varies with images, pages and output. See https://developers.openai.com/api/docs/models/gpt-6-luna . The user authorized at most $1 for synthetic acceptance tests, not unlimited automatic usage or balance replenishment.

## Review and practical limits

- The editor counts missing fields and checks exact integer-cent arithmetic, including discounts.
- Similar-document hints compare seller/date/total on the currently loaded receipt page only. This is not a full-ledger or bank-match search and never establishes that two transactions are identical.
- Existing originals deduplicate by their content hash; explicit expense posting remains idempotent.
- Old stock, personally paid purchases and already recorded payments still require their existing workflows; recognition does not create a second expense.
- This release extracts receipt facts. Automatic tax categorization, arbitrary bank-statement PDF ingestion and inventory recognition are not implied.
- The existing Android binary will require a new build to expose the new UI. Web staging can be verified independently.

## Verification

Contract tests cover nullable fields, refusals, malformed output, transport failures, fixed provider URL, no redirects or retry, authenticated capability reporting, per-document consent, durable quotas, and rejecting paid recognition for already posted receipts. Review tests cover unknown-vs-zero, total mismatch and conservative duplicate hints.

Live acceptance must use only a clearly synthetic receipt and compare visible facts; never treat mock tests as evidence that a real provider call succeeded. Keep receipt data and keys out of logs and public PR artifacts.

### Live acceptance, October 21, 2026

Both a synthetic PNG and its single-page PDF were processed through the authenticated staging interface with the real restricted OpenAI key. Both returned NESTWISE TEST SHOP, 2026-10-21, Printer paper $10.00, Replacement filter $20.00, tax $2.10, and total $32.10. The PNG review was saved as revision 1 without booking an expense. Applying the PDF result displayed the similar-receipt warning. No real receipt was transmitted.

This uncovered two fixes beyond Node-only mocks: Workers rejects redirect mode `error`, so the transport uses `manual` and rejects every non-2xx response without following it; PostgreSQL JSONB key ordering must be normalized before comparing the saved review with the editor. Sanitized diagnostics include only transport error class, HTTP status/safe provider identifiers or SQLSTATE, never document content or credentials.

Dashboard secret creation also triggered Wrangler's remote-config comparison, which exceeded the individual-Worker CI token's read scope. A local OAuth deployment of the checked commit restored the Wrangler-managed state; the unchanged restricted CI token then successfully redeployed staging (run 39697251930). No CI permissions were broadened.

Android 1.0.4/code 5 carries the receipt UI; device acceptance is separate from the successful web/provider acceptance.
