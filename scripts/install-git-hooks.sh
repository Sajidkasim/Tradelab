#!/usr/bin/env bash
# Configure local git commit template and commit-msg hygiene hook for PrimusTrader.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
HOOK_PATH="$REPO_ROOT/.git/hooks/commit-msg"

git config commit.template "$REPO_ROOT/.gitmessage"

cat > "$HOOK_PATH" <<'EOF'
#!/usr/bin/env bash
REPO_ROOT="$(git rev-parse --show-toplevel)"
exec python3 "$REPO_ROOT/tools/check_commit_msg.py" "$1"
EOF
chmod +x "$HOOK_PATH"

echo "Installed PrimusTrader commit template (.gitmessage) and commit-msg hook."
