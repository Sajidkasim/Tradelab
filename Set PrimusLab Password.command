#!/bin/bash
set -euo pipefail
cd "$(dirname "$0")"
.venv/bin/python tools/set_personal_password.py
echo
read -r -p "Press Return to close." _primus_done
