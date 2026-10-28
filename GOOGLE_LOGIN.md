# Google sign-in and private journals

The React app supports `PRIMUSLAB_AUTH_MODE=google`. Each verified Google
identity gets its own journal, including trades, imports, settings, results and
backups. The owner-only My journal → Manage access screen lists verified account
emails, last sign-in times, session status and Block/Unblock controls. It never
opens other journals. There is no sharing switch or route for browsing others.
The configured owner retains the original trading tables. New users start empty.
The application does not provide end-to-end encryption: the hosting/database
administrator still has infrastructure access. Ordinary members cannot access
each other's journals through the app or Supabase's browser data API.

## Connect the existing services

1. Google Cloud → existing Web application client → Authorized redirect URIs:
   add `https://gelimppzfstfnwdrlndp.supabase.co/auth/v1/callback`.
2. Supabase → Authentication → Sign In / Providers → Google: enter that client's
   ID and secret, then enable Google. Keep nonce checks enabled and require email.
   Only `openid email profile` scopes are used. No Gmail/Drive access is requested.
3. Supabase → Authentication → URL Configuration: set Site URL to
   `https://primuslab-web.onrender.com` and allow the exact redirect
   `https://primuslab-web.onrender.com/auth/callback`. Do not use wildcards.
4. Google → Audience: ensure the intended friends can sign in (test users if the
   OAuth application remains in Testing). Publishing the basic-profile OAuth app
   is a separate console action. Never request extra scopes for this journal.
5. Render → Environment: retain the existing database URL and session secret.
   Add these settings, keeping real keys out of Git and chat:

   | Setting | Value |
   | --- | --- |
   | `PRIMUSLAB_AUTH_MODE` | `google` |
   | `PRIMUSLAB_OWNER_EMAIL` | `sajid2k15@gmail.com` |
   | `PRIMUSLAB_SUPABASE_URL` | `https://gelimppzfstfnwdrlndp.supabase.co` |
   | `PRIMUSLAB_SUPABASE_PUBLISHABLE_KEY` | Existing project publishable or legacy anon key; never a service-role key |

6. Download a dated owner backup before cutover. Deploy the tested release, then
   complete a real owner Google sign-in and verify the original journal. A friend
   should see an empty journal. Local mocked-provider tests do not prove the
   external provider configuration. Keep Supabase's Data API disabled (Auth still
   works); startup additionally enables RLS and removes browser-role permissions
   on the journal and authentication tables.

Google mode ignores the shared-password cookie and disables `/api/unlock`.
The password mode remains available for an explicit operational rollback; it
opens only the original owner journal, never other members' schemas. Switching
modes does not delete data. Do not change the owner email after first deployment:
the identity registry deliberately refuses reassignment.

## Security and operations

- Login uses a short-lived, single-use PKCE verifier stored only on the server.
  The signed HttpOnly cookie binds the callback to the initiating browser.
- Supabase validates Google. The backend then fetches the authenticated user and
  checks the Google provider identity and verified email. Editable profile
  metadata cannot claim a journal. Provider tokens are discarded server-side.
- A random opaque session is hashed in the database, expires after seven days,
  and is revoked by Sign out. Cookies are Secure on hosting and SameSite=Lax.
  Writes require a CSRF token and the exact application origin.
- Registry keys come from verified identities only. Each non-owner PostgreSQL
  journal uses explicit schema translation for every query, import and backup.
  Numeric trade/account IDs can safely overlap between journals. SQLite tests
  use a separate file per identity. Never use a client-supplied workspace key.
- Blocking disables the identity and revokes all of its app sessions immediately.
  Unblocking requires a fresh Google sign-in; it cannot revive old session cookies.
  Journals remain saved. The owner cannot block their own account. Session counts
  mean unexpired app sessions, not live online presence. Accounts created before
  this account-list update supply their email on their next Google sign-in.
- Auth tables are separate from the eight-table journal backup format. Restoring
  a journal cannot restore identities, sessions or memberships.
- Keep one worker/instance: pending logins are bounded in memory and expire after
  ten minutes. A restart during Google login simply requires starting again.
- Keep the existing paid host and free Supabase plan unless measured usage
  warrants a change. No automatic plan upgrade is part of this feature.

Validation: `python -m pytest -q`, `npm --prefix frontend test`,
`npm --prefix frontend run build`, and `npm run test:browser` in `frontend`.
The Google browser fixture is confined to `tools/run_web_google_tests.py`, uses
synthetic identities and a temporary database, and is never the production app.

Provider reference: https://supabase.com/docs/guides/auth/social-sign-in/auth-google
PKCE reference: https://supabase.com/docs/guides/auth/sessions/pkce-flow
