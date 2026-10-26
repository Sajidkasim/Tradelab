# PrimusLab personal browser rebuild

The React/FastAPI website is now a single-owner journal with one password.
See [GO_LIVE.md](GO_LIVE.md) for password creation and hosted launch steps.
The older Streamlit app remains separate and has not been redeployed or changed.

## Run a separate local preview

```bash
.venv/bin/python -m pip install -r requirements-web.txt
npm --prefix frontend ci
.venv/bin/python tools/web_theme.py
npm --prefix frontend run build
bash run-web.sh
```

Open http://127.0.0.1:8100. Preview records are in `data/primus-web-preview.db`;
no cloud or old local journal is imported. If the user created
`data/private/personal-login.env` through the password helper, the launcher loads
it and exercises the password gate. Otherwise this loopback-only preview opens
without a password. Hosted deployments always require a password and HTTPS.

## Architecture and retained behaviour

`frontend/` contains shared React components and palette-derived theme tokens.
`webapp/` wraps the tested core without changing formulas or signatures. Stats
and chart values come from core.metrics/core.charts; position sizes from core.risk.
Workspaces.bump('owner') invalidates reads after writes.

Results and Trades share one Journal page. All is the default and the first
data-source option; it requests two independent result samples; neither the frontend nor API merges live and backtesting stats.
Explore a strategy opens beside the graphs; the standalone strategy dropdown
is now inside this panel. Summary numbers follow each graph, and Trades sits
below Results with the same data-source selection. Exploration filters affect
Results; search and Needs tagging filter the trade list. A bin button on each
trade asks for confirmation before deletion and refreshes both sections.

Editable strategies/PDA labels, confirmations, timeframes, news, quick entries,
price-based entries, FX Replay/file imports, mapping, duplicate checks, notes,
bulk strategy tags, confirmed individual trade deletion, JSON backups and empty-journal restore remain available.

There are no Google login or team/sharing endpoints in this API. The owner uses
the original root trading tables. The legacy team data is preserved but cannot
be selected. Web login sessions have their own database table and are excluded
from journal exports. The older services.team module remains for the original
Streamlit app and its regression tests.

My journal → Advanced tools now opens a personal position-size calculator and
links back to Results for setup research. The legacy bars backtester, full risk
suite and broker integration remain in the repository, not this browser UI.
No broker order-writing code is added. Chart image upload still needs durable
storage; keep image files separately from JSON journal backups.

## Password setup and hosting

The user runs Set PrimusLab Password.command or tools/set_personal_password.py
and enters the password themselves. The helper writes only its Argon2id hash
and a generated session secret, with file mode 0600 under ignored data/private/.
Never read or print those values in chat, logs or tests against real credentials.

Dockerfile.web serves the frontend and API from one HTTPS origin on a host such
as Render. Four environment settings are listed in .env.web.example. No Google
client or callback is needed. Keep one process/instance for the login throttle.
Paid hosting and final live checks are still separate from a local build.

## Checks

```bash
.venv/bin/python -m pytest -q
npm --prefix frontend test
npm --prefix frontend run build
npm --prefix frontend run test:browser
```

Browser tests start two loopback servers with disposable databases: an unlocked
workflow preview and a password-protected preview with a synthetic test password.
They never open or populate the user's real cloud journal. They cover unlocking,
locking, navigation, import, duplicates, tagging, tools, backups and mobile layout.
