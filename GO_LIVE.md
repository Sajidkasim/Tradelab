# PrimusLab: your personal online journal

This rebuild is for one owner, with one password. The main pages are Results
and Trades. My journal holds backups, appearance, personal tools and Lock journal.
There are no Google login, invitations, team selectors or shared-results endpoints.

## 1. Set your password privately

Double-click **Set PrimusLab Password.command** in the project folder. Enter a
16–128 character password or passphrase twice in Terminal. Nothing appears while
you type. You must enter it yourself; do not put passwords in chat.

The helper creates `data/private/personal-login.env` with a salted Argon2id hash
and a random session secret. Your actual password is not saved. The file is
readable only by your Mac account and is excluded from Git and Docker builds.
The helper asks before replacing an existing configuration.

For a technical alternative, run:

```bash
.venv/bin/python tools/set_personal_password.py
```

Keep your password in your password manager. If you forget it, use the same
helper and replace the two values in your host's private Environment settings.
Redeploying those values invalidates existing login sessions.

## 2. Review the personal interface

Run `bash run-web.sh`, then open http://127.0.0.1:8100. The launcher loads the
private login configuration if you created it. Without that file, it opens an
unlocked preview available only on this computer. The preview journal is separate
from your real cloud data.

- Results shows win rate, average R and trade count, with one graph.
- All shows separately labelled backtesting and forward sections. It never mixes
  the samples or asks for a second sample choice.
- Explore a setup keeps the graph alongside the filters on larger screens.
- Trades keeps Add trade, Import FX Replay and Needs tagging visible. Manage
  trades holds your editable strategies/key levels, bulk tags and CSV export.
- My journal contains JSON backups, appearance, Lock journal and personal tools.
- Advanced tools now opens personal risk sizing and a route back to setup research
  inside this app. It does not send you to the sleeping Streamlit site.

The legacy bar-based strategy engine and broker integration remain in the
repository; they have not been moved into this browser interface. The trading
formulas are unchanged. Screenshot uploads still require durable image storage.

## 3. Publish this branch to GitHub

In GitHub Desktop, choose Tradelab and `codex/react-rebuild`, then Publish branch
or Push origin. Keep the old live branch unchanged during launch checks.
Never include `.env`, Streamlit secrets, databases, backups or `data/private/`.

## 4. Create an always-on web service

Connect Render to the repository and `codex/react-rebuild`. Use Docker, with
`./Dockerfile.web` and repository-root build context. The optional Blueprint at
`deploy/render.yaml` prepares one instance in Frankfurt and disables automatic
deployments during checks. Choose Frankfurt only if the Supabase database is
still in Frankfurt.

Select the lowest always-on compute plan and review its displayed price before
creating it. The current plan identifier in the recipe is `0.5c-512mb`. Creating
that service incurs hosting charges; saving the recipe does not create a service.
Render's free service sleeps after inactivity, so it does not meet the requested
quick first visit. You can use the host's HTTPS address without buying a domain.

## 5. Add four private settings

In the host's Environment settings:

| Variable | Value |
| --- | --- |
| `PRIMUSLAB_PUBLIC_URL` | Exact new HTTPS address, without a path |
| `TRADELAB_DB_URL` | Existing Supabase PostgreSQL connection string |
| `PRIMUSLAB_PASSWORD_HASH` | From your private `personal-login.env` file |
| `PRIMUSLAB_SESSION_SECRET` | From that same file, or the Blueprint-generated secret |

You can import the helper's file using Render's Add from .env control yourself.
Keep its values out of chat and Git. No Google credentials or OAuth callback
changes are required for the personal journal.

Do not enable `PRIMUSLAB_WEB_LOCAL_ONLY` on the host. Run one worker and one
instance, as the supplied Docker/Render recipes do, so password attempt throttling
applies consistently. Hosting over HTTPS and persistent PostgreSQL are required.

The existing owner records stay in the same database tables. Existing teammate
schemas and old invitations are not deleted, but this application cannot access
or expose them. Keep Supabase's Data API disabled, as described in DEPLOY.md.

The legacy app showed a database connection error when it was awakened. Confirm
the Supabase project is healthy and the existing connection works before launch;
a new password does not repair a database connection. Free Supabase projects can
pause during low activity. No plan upgrade is performed automatically.

## 6. Verify, then use your new link

Check wrong/correct passwords, refresh persistence, Lock journal, rejection of the
old signed-out session, private backup downloads, import previews, duplicate
handling, tagging, risk sizing, desktop/mobile layouts and real hosted latency.
Use a separate disposable test journal for import/restore checks. Local tests do
not prove hosted database connectivity or HTTPS/cookie behaviour.

Download a dated cloud backup before any cutover. Keep the old site available
until the new one is checked, then retire it separately. Do not copy local preview
records into your cloud journal.

## Password and data details

The server stores only a salted Argon2id password hash. The browser receives a
signed HttpOnly/Secure cookie, and the server stores a hash of its opaque session
token separately from trading data. Sessions expire after seven days and Lock
journal revokes the current session immediately. Password/session-secret rotation
invalidates old sessions. Five password checks per minute are allowed on the
single app instance. Writes also require the session's CSRF token and exact origin.

Journal JSON backups include trades, labels, notes, accounts and settings. They
do not include password configuration, login sessions or screenshot image files.
Keep dated copies outside the website so they remain available during an outage.

Sources: [Render settings](https://render.com/docs/blueprint-spec),
[free hosting limits](https://render.com/docs/free),
[password storage](https://cheatsheetseries.owasp.org/cheatsheets/Password_Storage_Cheat_Sheet.html).
