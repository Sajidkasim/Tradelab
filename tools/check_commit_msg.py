#!/usr/bin/env python3
"""Validate git commit messages to prevent vague/throwaway commit subjects."""
from __future__ import annotations

import re
import sys
from pathlib import Path

DISALLOWED_EXACT = {
    "wip",
    "fix",
    "test",
    "tests",
    "update",
    "pull",
    "push",
    "save",
    "commit",
    "changes",
    "misc",
    "stuff",
    "temp",
    "tmp",
    "twst",
}


def validate_commit_message(message: str) -> str | None:
    """Return an error string if invalid, or None if acceptable."""
    lines = [
        line.strip()
        for line in message.splitlines()
        if line.strip() and not line.lstrip().startswith("#")
    ]
    if not lines:
        return "Commit message cannot be empty."
    subject = lines[0]
    if subject.startswith(("Merge ", "Revert ", "fixup!", "squash!")):
        return None
    normalized = subject.lower().strip(".!?: ")
    if normalized in DISALLOWED_EXACT:
        return f"Commit subject '{subject}' is too vague. Describe what changed and why."
    if len(subject) < 10:
        return f"Commit subject '{subject}' is too short (minimum 10 characters)."
    if re.fullmatch(r"[\d\W_]+", subject):
        return f"Commit subject '{subject}' must include descriptive words, not just numbers/symbols."
    words = [w for w in re.findall(r"[A-Za-z][A-Za-z0-9_-]*", subject) if len(w) >= 2]
    if len(words) < 2:
        return f"Commit subject '{subject}' must contain at least 2 descriptive words."
    return None


def main(argv: list[str]) -> int:
    if len(argv) < 2:
        print("Usage: check_commit_msg.py <commit-msg-file>", file=sys.stderr)
        return 2
    text = Path(argv[1]).read_text(encoding="utf-8", errors="replace")
    error = validate_commit_message(text)
    if error:
        print(f"ERROR: {error}", file=sys.stderr)
        print("Example: journal: fix session tab alignment and Rules popup", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main(sys.argv))
