#!/usr/bin/env bash
# Double-click in Finder to open your personal workspace on this Mac.
set -e
cd "$(dirname "$0")"
exec bash ./run.sh --server.port 8502 --server.headless false
