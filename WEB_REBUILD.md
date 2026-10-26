# PrimusLab browser rebuild

The new React interface and FastAPI backend run alongside the existing Streamlit
site. No changes to `core/` or the hosted journal are required. Navigation and form
edits happen in the browser; financial results are calculated by the existing core.

## Local preview

```bash
.venv/bin/python -m pip install -r requirements-web.txt
npm --prefix frontend ci
.venv/bin/python tools/web_theme.py
npm --prefix frontend run build
bash run-web.sh
```

Open http://127.0.0.1:8100. The launcher creates an empty, separate
`data/primus-web-preview.db`. It never imports the existing local or cloud journal.
The preview deliberately has no Google login and refuses off-computer requests.
Use a separate filename via `PRIMUSLAB_WEB_PREVIEW_DB` for disposable test journals.

For editing, rebuild the frontend and reload the page. Vite's optional development
server proxies API requests to port 8100; set `PRIMUSLAB_PUBLIC_URL` to its exact
loopback origin when running that development server so CSRF checks remain strict.

## Included workflows

- Results, Trades and Team, with light/dark themes and responsive layouts.
- Setup filters alongside the equity/drawdown graph. Statistics, equity and
  comparison groups call `core.metrics` and `core.charts` unchanged.
- All data source for browsing; results still require one backtesting or forward
  sample per result section. All shows both sections separately. Demo data is excluded from the API.
- Quick dollar-result entries or full entry/stop/exit, New York timestamps,
  editable strategy and PDA lists, confirmations, notes, Save & next and bulk tags.
- FX Replay Analytics and generic trade/fill file upload, explicit time zone,
  column mapping, saved tag mappings, row errors, duplicates, preview and confirm.
- Owner invitations, private per-member databases, revocation on every request,
  optional shared summaries with separate testing samples. Invitations do not email.
- Full JSON journal backups and CSV downloads. Restore is limited to an empty
  journal, so existing records cannot be overwritten through this interface.

Advanced risk, backtest engine and broker tools remain on the current Streamlit
site under More tools while the new interface is prepared for hosted launch.
Screenshot image upload is not enabled until durable image storage is connected.
Existing screenshot paths are kept in backups; image files need a separate backup.

## Hosting the new app

Start with [GO_LIVE.md](GO_LIVE.md) for the launch checklist and an optional
Render deployment recipe. No hosting subscription has been created by these files.

Streamlit Community Cloud cannot run this React/API server. Use an always-on
container or Python web host, preferably near the existing Supabase database.
`Dockerfile.web` builds and serves the frontend and API from one origin. Hosting
selection, any subscription and the final cutover must be reviewed before purchase.

1. Deploy the container in a staging service with HTTPS. Supply the environment
   secrets in `.env.web.example` through the host's secret settings. Never commit
   real values. Set `PRIMUSLAB_PUBLIC_URL` to the exact new origin.
2. Add `https://NEW_HOST/auth/callback` to the existing Google OAuth client's
   authorised redirect URLs. Keep the old Streamlit callback during the transition.
   This is a new OAuth redirect and needs owner confirmation before editing.
3. Use the same Supabase URL and owner email to retain existing records and team
   workspaces. The new service reuses the existing `primus_members` table and
   per-member schemas. Do not copy any local preview records into cloud storage.
4. Keep the Supabase Data API disabled as in DEPLOY.md. All journal data is served
   only by the authenticated backend, never queried directly from the browser.
5. Verify owner, invited/uninvited login, isolation, pause access, CSV import,
   tagging, sharing, export/restore and latency against the staging deployment.
   Local tests cannot prove production Google redirects, PostgreSQL or network speed.
6. Only after those checks, share the new link and retire or retain the old site.

The web session uses a signed, HttpOnly, Secure cookie in production, SameSite=Lax,
12-hour expiry and CSRF headers plus exact-origin checks on writes. Google identity
is validated by Authlib's OpenID Connect flow. Membership and bound subject are
checked on every private API request; no workspace identity is accepted in form data.
No tokens or secrets enter the frontend bundle. Avoid logging OAuth callback query
strings; the container disables Uvicorn access logs. Session secret rotation signs
everyone out. Database writes invalidate workspace caches; five-second read expiry
also picks up writes made from the old app during the transition.

## Verification

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

The browser tests start their own loopback-only backend with a temporary journal,
not the user's preview journal or hosted database. They cover adding a trade,
filtering a plotted sample, import/duplicates, tagging, backup downloads, themes
and mobile overflow. The tests use synthetic trading records only.
