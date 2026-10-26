# PrimusLab: next steps to go live

The React rebuild is saved on `codex/react-rebuild`. The Streamlit site remains
separate. Local preview data does not move to the cloud.

## 1. Review the simpler interface

Run `bash run-web.sh` and open http://127.0.0.1:8100.

- The top bar contains Results, Trades and Team.
- Workspace holds backups, appearance and the link to existing advanced tools.
- Results starts with win rate, average R and trade count, then the graph.
  Explore a setup keeps the graph alongside the filters on larger screens.
  All data source shows backtesting and forward results in two labelled sections,
  with separate statistics and graphs and no second sample selector.
- Trades keeps Add trade and Import FX Replay visible. Manage trades holds
  editable strategy/level lists, bulk tagging and CSV export.
- Import starts with a file upload. Account, source, time zone and column mapping
  remain available under File options & column mapping. The chosen account and
  source remain visible above the upload.

## 2. Publish this branch to GitHub

In GitHub Desktop, choose the Tradelab repository and `codex/react-rebuild`, then
Publish branch or Push origin. Do not merge into the old live branch yet.
Never include `.env`, Streamlit secrets, database files or downloaded backups.

## 3. Create an always-on web service

Use Render's Docker web service, linked to this GitHub repository and branch:

| Setting | Value |
| --- | --- |
| Branch | `codex/react-rebuild` |
| Runtime | Docker |
| Dockerfile | `./Dockerfile.web` |
| Build context | repository root (`.`) |
| Region | Frankfurt, if the existing Supabase database is still in Frankfurt |
| Health check | `/health` |
| Automatic deploys | Off during launch checks |
| Compute | Lowest always-on plan; confirm the displayed price before purchase |

An optional Blueprint is provided at `deploy/render.yaml`. The current Render
specification names the smallest paid compute size `0.5c-512mb`. Creating that
service incurs hosting charges; the file itself does not create anything.
Check memory and response times on the actual service before opening it to the team.

Render's free web service sleeps after 15 minutes of inactivity and can take
around a minute to wake. That is unsuitable for the requested quick first visit.
There is no need to buy a domain to launch: use the host-provided HTTPS address.

## 4. Connect the existing database and Google login

Download a dated backup from the existing cloud journal first. In the new host's
Environment settings, set these values privately:

| Variable | Where to find it |
| --- | --- |
| `PRIMUSLAB_PUBLIC_URL` | Exact new HTTPS service address, without a path |
| `PRIMUSLAB_OWNER_EMAIL` | Existing workspace owner's Google email |
| `TRADELAB_DB_URL` | Existing Supabase PostgreSQL connection string |
| `GOOGLE_CLIENT_ID` | Existing Google OAuth web client ID |
| `GOOGLE_CLIENT_SECRET` | The same OAuth client's secret |
| `PRIMUSLAB_SESSION_SECRET` | A new random secret of at least 32 characters; the Blueprint generates one |

The existing Streamlit secrets call the Google values `client_id` and
`client_secret` under `[auth]`. They become `GOOGLE_CLIENT_ID` and
`GOOGLE_CLIENT_SECRET` on this host. Copy values only between the secure settings
screens, never into chat, Git or the frontend bundle.

Add `https://YOUR-NEW-HOST/auth/callback` to the existing Google client's
authorised redirect URLs. Keep the old Streamlit callback until the move is
verified. Changing an OAuth redirect through computer control requires owner
confirmation at the action. No password changes or new Google client are required.

Do not set `PRIMUSLAB_WEB_LOCAL_ONLY` on the host. Keep Supabase's Data API
disabled, as documented in DEPLOY.md. Reuse the existing database URL and owner
email so journal records and per-member workspaces stay where they are.

## 5. Verify the hosted site, then share it

Check owner login, an invited teammate, rejection of an uninvited account,
private workspace isolation and paused access. Check actual page/filter latency,
CSV preview and import, duplicate handling, Save & next, and backup downloads.
Use disposable test records in a dedicated test workspace, not the owner's real
journal. Test restoring a backup only into an empty test journal.

Local tests cannot prove production OAuth redirects, PostgreSQL permissions or
hosting latency. Share the new URL with the team after these checks pass. Keep
the old site available during the transition.

## Future changes and your data

Updates can be built and checked locally, then deployed to the new service.
The database persists separately from application deployments. Download dated
JSON backups regularly; CSV is useful for inspecting trades elsewhere. Neither
download includes screenshot image files or the team invitation table. Keep
separate database and image backups as described in DEPLOY.md.

Sources: [Render deployment settings](https://render.com/docs/blueprint-spec),
[free service limits](https://render.com/docs/free),
[regions](https://render.com/docs/regions).
