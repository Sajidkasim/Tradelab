#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
if ! .venv/bin/python tools/set_personal_password.py; then
  echo
  echo "Password setup stopped before saving. The reason is shown above."
fi
echo
read -r -p "Press Return to close." _primus_done
