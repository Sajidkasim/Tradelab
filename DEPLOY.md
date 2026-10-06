# Put PrimusLab on the web

PrimusLab's public website path requires Google sign-in and an owner email. The site shows a setup gate until authentication is configured. Use [TEAM_SETUP.md](TEAM_SETUP.md) for the Google OAuth client, exact callback URL, owner and teammate invitations, and workspace permissions.

## Before deploying

1. Choose a host that can run `streamlit run app.py` over HTTPS and a persistent PostgreSQL database. The database role must be allowed to create the `primus_<member-id>` schemas used for private teammate workspaces.
   If using Supabase, turn off its Data API under **Integrations → Data API** before storing private trades. PrimusLab connects directly to PostgreSQL and never needs those public REST endpoints.
2. Configure the host's Streamlit secrets with `TRADELAB_DB_URL`, `PRIMUSLAB_OWNER_EMAIL`, and the `[auth]` values shown in TEAM_SETUP.md. Store secrets in the host's secrets interface, never in Git.
3. Register the website's exact `/oauth2callback` URL with the Google OAuth client. Add the owner and four teammates as Google test users if the Google app remains in testing mode.
4. Start the hosted app with `streamlit run app.py`. The local launchers set the loopback address themselves. Do not set `PRIMUSLAB_LOCAL_ONLY` on a public host.
5. Keep the site private while you verify owner login, invited and uninvited Google accounts, separate workspaces, revocation, CSV import, and backups against the actual hosted database.

The local owner journal remains in `data/tradelab.db`. A new PostgreSQL database starts empty; this project does not automatically move existing local trades into it. Export or back up local data before any planned migration, then verify restored trade counts and results on the hosted site.

## Data that needs persistent storage

Trades, notes, tags, settings, invitations and sharing choices live in PostgreSQL. Each member can download their journal backup in **Settings → Data**. Keep dated copies on your own computer or another service, because a backup button cannot be used during a website outage. The in-app JSON backup omits the team invitation table and chart image files.

Chart screenshots are stored on the server filesystem under `data/screenshots/`. Streamlit Community Cloud does not provide persistent local file storage, so screenshots uploaded there can disappear after a restart. Until separate persistent storage is connected, keep the original image files yourself. For a complete team backup, export PostgreSQL (including `primus_members` and member schemas) and the screenshot directory separately. Supabase's free plan does not include automatic database backups; arrange regular off-site database exports.

The website keeps chart uploads disabled by default on hosts without durable screenshot storage. If you move to a host with a persistent `data/screenshots/` volume and back up that directory, set `PRIMUSLAB_SCREENSHOTS_PERSISTENT=1` in the host's secrets to enable uploads.

Optional read-only broker credentials are separate from the trading journal and never enable order placement. The nightly job, if enabled, writes only to the owner's workspace.

## Launch check

Run the tests with the project's virtual environment:

```bash
.venv/bin/python -m pytest -q
```

Then follow the live account and storage checks in [TEAM_SETUP.md](TEAM_SETUP.md). Local SQLite tests cannot prove that the hosted Google redirect, PostgreSQL permissions, network access or persistent screenshots work; those must be checked on the actual host before inviting the team.
