# Website invoice check

Open **Active clients**, choose a client, then open the actions side panel and select **Invoice**. This single entry contains **Generate invoice**, **Upload invoice**, and saved drafts. Upload, generated setup and email review use the same side panel. This feature is in the website; it does not require an APK update.

Upload accepts PDF and Word files up to 25 MB. It detects invoice number, issue/due dates, billing start/end dates, amount and currency where available. Review or fill any missing details, then choose **Prepare email**. Scanned PDFs and older Word files may require manual details. The original uploaded file becomes the email attachment. No email sends until you click Send.

For each client, choose **Logged hours** with an agreed hourly rate, or **Fixed weekly fee**. Monthly salary amounts are never converted automatically. Select any date in the billing week; the form uses that week's Monday through Sunday. Logged hours come from saved client-task time entries, clipped to the billing time zone. Stop running timers before preparing the invoice.

You can also choose **Agreed weekly hours**, enter an hourly rate, and set weekly hours/workdays. Presets fill **20 hours / 5 days** or **40 hours / 5 days**; custom hours and 1–7 workdays are supported. The form shows hours per day and the weekly amount. For example, 40 hours over 5 days at USD 10/hour is 8 hours/day and USD 400/week. The agreed schedule appears in the preview and PDF. Fixed-fee totals stay fixed; logged-hour totals use actual saved entries. For an existing draft, use **Edit** to set its schedule and review service-line quantities/rates before saving.

Typing weekly hours or choosing a preset selects hourly billing automatically. A prominent weekly total shows the calculation and daily amount. Editing hours/rate updates a single saved service line immediately; saving also updates the client's hourly setup for future weekly invoices. Generating the same week with hourly billing recalculates that existing draft instead of creating a duplicate. For a draft with multiple service lines, **Apply hourly calculation** explicitly replaces those lines with one weekly hourly charge before saving. Choose **Fixed weekly fee** explicitly to use a flat total.

The application's JA logo fills in automatically; you can upload another logo if needed. Saved payment choices fill their instructions when selected. The local website can import an account-scoped private profile from the supplied template; this file remains outside public assets and Git. Save the setup or generate the first invoice to keep these details in the private workspace and reuse them on other devices. Generate a preview, edit the invoice number, dates, client details, service lines, discount, applicable tax and notes, then save changes. Existing drafts for the same client and week are reused without overwriting edits. The preview is compact and adapts to narrow screens; the PDF uses A4. Drafts do not count as sent invoices, outstanding payments or received salary.

New invoice numbers use the issue year and a sequence shared across the account, for example **2026-001**, **2026-002**. Each year starts a new sequence. The server rejects new duplicate numbers; a sent history entry can share its own source draft's number. Opening an older unsent generated draft repairs missing branding and replaces its former date/hash number with the next sequence. Sent invoices keep their original numbers.

**Prepare email** generates the PDF attachment and opens the existing invoice email template with the recipient, invoice number, service, billing period and due date filled in. Review the editable email and click **Send** yourself. Preparation never sends an email or marks the invoice sent. A successful Gmail send creates the sent-invoice history entry and closes out its source draft. Missing attachments, changed drafts and already-sent invoice numbers are checked before sending.

The PDF retains the compact branded header and prints the business address on one line when it fits. Its body uses client/invoice-detail panels, weekly schedule metrics, and a bordered service table with explicit unit rates such as **$10.00 per hour**. Payment options have bank/card icons and a table separating method, account-field label and information. Notes & Terms appear in their own full-width panel below. The redundant payment-reference line is omitted. Long invoices repeat service/payment table headers and paginate long payment rows when needed.

## Weekly preparation

The updated Cloudflare Worker must be deployed with the existing D1 binding and the configuration in `wrangler.jsonc`: `INVOICE_DRAFTS_SCHEDULED=true` and `*/15 * * * *`. No additional database migration is needed. The authenticated status endpoint enables the schedule switch only when the server advertises this capability.

Enable weekly preparation per client, choose a day, hour and IANA time zone, and save the setup. At the first eligible run after that time, the Worker prepares the last completed Monday–Sunday billing week and stores an **Invoice is ready for preview** notification in the workspace. Preparation can run while the website is closed. Notification delivery is in the website's notification centre; this feature does not add phone push delivery.

Generation requires an active client and valid billing setup. Hourly clients with no saved hours are skipped. Draft plus notification are inserted atomically with an account revision guard. Repeat runs preserve existing drafts. Turning off preparation and saving stops future drafts for that client.

**No invoice is automatically emailed or sent.** The invoice scheduler does not call Gmail, follow-up delivery, or another sending service. Sending requires the user's action in the email composer.

## Storage and verification

Setup, payment instructions, logos and structured drafts use the authenticated account's existing application/invoice collections. They are not public source presets. Excel backups include a chunked **Invoice check** sheet to preserve structured drafts and logos within Excel's cell limits. Keep downloaded backups private.

Run `node scripts/test-invoice-check.mjs` for calculation, time-boundary, DST, backup round-trip, scheduling, isolation, duplicate, edit-preservation and transaction checks. Build the website assets with `scripts/build-cloudflare.ps1` or `scripts/build-cloudflare.sh` before deployment.
