# Login activity

The website's Account page has **Security · Login activity**. It shows the latest
100 attempts for the signed-in account's verified email, across updated website
and Android password sign-ins. It includes result, server time, method, IP, and
User-Agent. Records expire after 30 days. Google successes are recorded after a
recent Supabase-verified sign-in; Google failures remain with the identity provider.

Password sign-ins use `/api/auth/login`, which calls Supabase Auth and records the
real outcome. The account reader uses `/api/auth/activity`; it verifies the bearer
session with Supabase and derives the email from that user, never from a supplied
query parameter. Browsers cannot submit arbitrary failed/successful outcomes.

Activity uses the existing `FOLLOW_UP_DELIVERIES` Durable Object binding, in a
separate hashed namespace. No SQL migration or service-role key is needed. Stored
events contain no passwords, tokens, email addresses, or request bodies. IP comes
only from Cloudflare's `CF-Connecting-IP`. User-Agent is descriptive, not proof of
device identity. Rate limits allow 20 gateway requests per source IP per 5 minutes.
Interrupted requests remain distinguishable from rejected credentials.

## Rollout

Deploy the updated Worker **before** updating website assets or distributing a new
Android build. The new clients do not fall back to untracked password requests if
the endpoint or activity storage is unavailable. Cloudflare deployment with the
existing binding supports the new endpoint without a new Durable Object migration.
Restart the local Python app server after deployment. Its `/api/auth/*` routes
forward to the production Worker; a generic static/Live Server cannot provide them.
For local sign-ins, Cloudflare observes the local server's public outbound IP.

Rebuild/install Android to use the new password gateway. Existing APKs and direct
Supabase requests bypass this application history; inspect Supabase Auth logs for
those requests. This feature does not claim to collect every Supabase request or
Google rejection. Successful older app-state history remains separately visible.

Validation: `node scripts/test-login-activity.mjs`, existing session/authentication
checks, `pwsh -File scripts/build-cloudflare.ps1`, and the Android Java compilation.
