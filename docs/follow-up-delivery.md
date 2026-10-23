# Automatic follow-up delivery protection

Automatic follow-ups now reserve one delivery for each signed-in account,
application ID and scheduled date before calling Gmail. The reservation lives in
the `FOLLOW_UP_DELIVERIES` Cloudflare Durable Object binding, independently of
the workspace JSON snapshot. All app tabs and devices use this same coordinator.
Local development forwards `/api/follow-up/delivery` to the deployed Worker.

The Wrangler configuration creates the SQLite-backed `FollowUpDelivery` namespace
on the next Worker deployment. No Supabase schema change is required. If the
binding or endpoint is unavailable, automatic sending stops without falling back
to an unprotected Gmail request. Restart the local Python server after updating.
Refresh every open application tab after deployment: old JavaScript loaded before
this update still contains the previous direct automatic sender.

The coordinator receives application IDs, schedule dates, reservation tokens and
Gmail delivery IDs/timestamps. Gmail access tokens, recipients and message contents
stay in the browser's direct communication with Gmail.

Before reserving, the browser checks Gmail Sent directly for the exact recipient,
subject and schedule date. The browser sends only after obtaining the reservation,
records the shared receipt after Gmail succeeds, and saves each application's
result immediately. A second invocation within a tab shares the existing run.

A timeout/lost response is ambiguous: Gmail might have accepted the email. The
reservation remains locked without automatic expiration. Later runs can recover
the sent message from Gmail; if none is found they show a delivery-review warning
instead of sending again. Only an explicit Gmail rejection releases a reservation
for retry. Previously sent duplicate messages are left intact.

Checks:

```text
node scripts/test-follow-up-delivery.mjs
node scripts/test-follow-up-browser.mjs
node scripts/test-email-subject-follow-up.cjs
node scripts/test-worker-session.mjs
```
