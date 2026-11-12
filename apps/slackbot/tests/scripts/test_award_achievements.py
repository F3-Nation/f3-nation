import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import award_achievements


def _slack_space(team_id: str):
    return SimpleNamespace(
        team_id=team_id,
        settings={
            "team_id": team_id,
            "send_achievements": True,
            "achievement_send_option": "post_summary",
            "achievement_channel": f"C-{team_id}",
        },
    )


def test_award_achievements_skips_uninstalled_workspace(monkeypatch):
    candidates = [
        award_achievements.CandidateAward(achievement_id=7, user_id=1, award_year=2026, award_period=1, metric=5),
        award_achievements.CandidateAward(achievement_id=7, user_id=2, award_year=2026, award_period=1, metric=5),
    ]
    users = [SimpleNamespace(id=1, home_region_id=10), SimpleNamespace(id=2, home_region_id=20)]
    achievement = SimpleNamespace(id=7, name="Ironman", description=None, image_url=None)
    slack_users = [
        SimpleNamespace(user_id=1, slack_team_id="T1", slack_id="U1", user_name="One"),
        SimpleNamespace(user_id=2, slack_team_id="T2", slack_id="U2", user_name="Two"),
    ]
    session = MagicMock()
    session.scalars.side_effect = [
        MagicMock(all=lambda: users),
        MagicMock(all=lambda: [achievement]),
        MagicMock(all=lambda: slack_users),
    ]
    session.execute.return_value.all.return_value = [(10, _slack_space("T1")), (20, _slack_space("T2"))]
    installed_client = MagicMock()
    clients = {"T1": None, "T2": installed_client}
    monkeypatch.setattr(award_achievements, "slack_client_for_team", lambda team_id, **kwargs: clients[team_id])

    award_achievements.post_achievements(session, candidates, dry_run=False)

    installed_client.chat_postMessage.assert_called_once()
    assert installed_client.chat_postMessage.call_args.kwargs["channel"] == "C-T2"
