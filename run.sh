#!/usr/bin/env bash
# One-click start for Mac/Linux. First run installs; later runs just start.
set -e
cd "$(dirname "$0")"
PY=${PYTHON:-python3}
if [ ! -d .venv ]; then
  echo "Creating environment…"; $PY -m venv .venv
  . .venv/bin/activate
  pip install --upgrade pip >/dev/null
  pip install -r requirements.txt
  python -m pytest -q || { echo "Tests failed — see output above."; exit 1; }
else
  . .venv/bin/activate
fi
[ -f .env ] || cp .env.example .env
export PRIMUSLAB_LOCAL_ONLY=1
exec python -m streamlit run app.py --server.address 127.0.0.1
