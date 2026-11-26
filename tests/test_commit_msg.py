"""Unit tests for tools.check_commit_msg."""
import pytest

from tools.check_commit_msg import validate_commit_message


@pytest.mark.parametrize(
    "bad",
    ["", "   \n# comment only", "211", "6666", "ssss", "PULL", "TWST", "wip", "fix", "short"],
)
def test_rejects_vague_or_throwaway_commit_subjects(bad):
    assert validate_commit_message(bad) is not None


@pytest.mark.parametrize(
    "good",
    [
        "journal: upgrade Rules panel to Focus-Sheet modal",
        "Polish Journal session tabs and remove Calendar account filter",
        "Merge branch 'codex/react-rebuild' into main",
        'Revert "Polish Journal session tabs"',
    ],
)
def test_accepts_clear_commit_subjects_and_merge_commits(good):
    assert validate_commit_message(good) is None
