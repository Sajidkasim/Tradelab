# TradeLab — how to run it

## On your computer (2 minutes)

You need Python 3.10 or newer (python.org → Downloads). Then, in this folder:

**Mac / Linux**
```bash
./run.sh
```

**Windows**
```
run.bat
```

That creates a private Python environment the first time, installs what's needed, runs the tests,
and opens the app at **http://localhost:8501**. Later runs skip the install and start in seconds.

First visit: press **Load demo data** to explore. Delete it from Settings → Data when you're ready
for your own trades, then use **Trades → Log trade** or **Import**.

Your data lives in `data/tradelab.db` on your machine. Back it up from Import → Backup.

## On the web (30 minutes, free)

Follow **DEPLOY.md**: a free Supabase database → a private GitHub repo → Streamlit Community Cloud.
You get a `something.streamlit.app` link that works on your phone, and the nightly auto-journal runs
on GitHub's servers.

## Optional keys (`.env` locally, Secrets on the web)

```
PROJECTX_USERNAME=...        # TopstepX live pull (needs the ProjectX API subscription)
PROJECTX_API_KEY=...
ANTHROPIC_API_KEY=sk-ant-... # the AI coach (or OPENAI_API_KEY=sk-...)
TRADELAB_DB_URL=postgresql://...   # hosted database; leave unset to use the local file
```

Copy `.env.example` to `.env` and fill in what you have. Everything works without any of them.

## Theme

⋮ menu (top right) → Settings → Theme: Light, Dark, or follow your device.

## If something goes wrong

- `python -m pytest -q` should say **72 passed**. If it doesn't, the install is incomplete.
- A red box on a page is a bug: copy its text into ChatGPT with `CONTINUING_WITH_CHATGPT.md` open.
- Numbers don't match TopstepX after a live pull → Settings → Instruments → check the multiplier.
