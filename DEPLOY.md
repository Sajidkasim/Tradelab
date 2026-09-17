# Putting PrimusLab on the web

About 30 minutes, all free. You end up with a URL like `https://sajid-primuslab.streamlit.app`
that works on your phone, plus a database that keeps your journal safe across restarts.

## 1 · Database (Supabase, free)

1. Sign up at supabase.com → **New project**. Pick a region near you (London/Frankfurt). Save the database password.
2. Project → **Connect** (top bar) → **Connection string** → choose **Session pooler** (not "Direct" — direct connections
   are IPv6-only and Streamlit Cloud can't reach them) → copy the URI. It looks like:
   ```
   postgresql://postgres.abcdefgh:[YOUR-PASSWORD]@aws-0-eu-west-2.pooler.supabase.com:5432/postgres
   ```
3. Replace `[YOUR-PASSWORD]` and add `?sslmode=require` on the end. That whole string is your `TRADELAB_DB_URL`.

PrimusLab creates its own tables on first run. Nothing else to set up.

## 2 · Code (GitHub)

1. Create a **private** repository (private repo ⇒ private app; a free Streamlit account allows one private app).
2. Push this folder to it. `.env` and `secrets.toml` are git-ignored — never commit keys.
   ```bash
   git init && git add -A && git commit -m "PrimusLab"
   git branch -M main && git remote add origin https://github.com/YOU/primuslab.git && git push -u origin main
   ```

## 3 · App (Streamlit Community Cloud, free)

1. share.streamlit.io → sign in with GitHub → **Create app** → pick the repo, branch `main`, file `app.py`.
2. **Advanced settings → Secrets** — paste:
   ```toml
   TRADELAB_DB_URL = "postgresql://postgres.abcdefgh:PASSWORD@aws-0-eu-west-2.pooler.supabase.com:5432/postgres?sslmode=require"
   PROJECTX_USERNAME = "your_topstepx_username"
   PROJECTX_API_KEY = "your_projectx_api_key"
   ```
   All keys are optional — CSV, Excel, FX Replay and manual entry work without any of them.
3. Deploy. First build takes a few minutes. You'll get `https://<name>.streamlit.app`.
4. **Share → "Only specific people can view this app"** and add your email. Keep it private: it's your P&L.

To update the app later, just push to `main`; it redeploys automatically.

## 4 · Nightly auto-journal (GitHub Action, free)

Repo → **Settings → Secrets and variables → Actions** → add the same three secrets
(`TRADELAB_DB_URL`, `PROJECTX_USERNAME`, `PROJECTX_API_KEY`). The workflow in
`.github/workflows/nightly.yml` then runs every weekday at 21:45 UTC: pulls the day's fills,
reconciles them, writes the review you'll see under Journal → Daily reviews. Run it on demand from
the **Actions** tab. Topstep allows read-only data pulls on servers; this never places orders.

## 5 · Putting it on your own website

Community Cloud doesn't support custom domains, but you can embed the app:

```html
<iframe src="https://<name>.streamlit.app/?embed=true" style="width:100%;height:100vh;border:0"></iframe>
```

A private app still asks viewers to sign in inside the frame. If you want it on your own domain
without the sign-in step, that's the paid-host route (Render / Railway / Fly, a few dollars a month) —
same code, set the same three environment variables.

## Things to know

- **Uploads on a free host don't persist.** Screenshots you attach in the Journal live on the server's
  disk and vanish on restart; keep originals. Trades, notes, tags and settings are in Postgres and are safe.
- **Backups:** Import → Backup downloads everything as one JSON. Do it occasionally regardless.
- **The app sleeps** after a few days without visitors on the free tier and wakes on the next visit (30–60 s).
- **Local and hosted at once:** the app reads `TRADELAB_DB_URL` from `.env` locally too, so you can point your
  laptop at the same Supabase database and see identical data in both places.
