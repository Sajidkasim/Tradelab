#!/usr/bin/env bash
set -euo pipefail
cd "$(dirname "$0")"
if [[ ! -x .venv/bin/python ]]; then
  echo "Create the project's Python environment first; see WEB_REBUILD.md."
  exit 1
fi
if [[ ! -f frontend/dist/index.html ]]; then
  echo "Build the new interface first: npm --prefix frontend ci && npm --prefix frontend run build"
  exit 1
fi
export PRIMUSLAB_WEB_LOCAL_ONLY=1
export PRIMUSLAB_PUBLIC_URL=http://127.0.0.1:8100
exec .venv/bin/python -m uvicorn webapp.app:create_app --factory --host 127.0.0.1 --port 8100 --no-proxy-headers
