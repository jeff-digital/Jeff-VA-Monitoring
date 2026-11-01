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
device identity. Five wrong-password responses from one IP block further password
checks for five minutes. Pending requests reserve slots, preventing concurrent
requests from bypassing this limit. A separate 20-request/5-minute IP limit also
bounds malformed and empty submissions. Successful checks do not count as failures.
Interrupted requests remain distinguishable from rejected credentials.

All password-form submissions, including invalid input and nonexistent account
details, are also recorded in a site-wide feed. Only a hashed account reference
is stored, never the submitted identifier text. Supabase deliberately does not
distinguish nonexistent accounts from wrong passwords in the public response.
Typing alone is not logged: the visitor must submit the form.

The all-attempts view requires a server-authorized administrator. Set the Worker's
`LOGIN_ACTIVITY_ADMIN_IDS` environment variable to comma-separated verified account
user IDs, or set `login_activity_admin: true` in trusted Supabase `app_metadata`.
Never use user-editable `user_metadata` for this permission. With no administrator
configured, the global feed is recorded but its reader remains disabled. Once
authorized, choose **All submitted attempts (admin)** on the Account page.

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
