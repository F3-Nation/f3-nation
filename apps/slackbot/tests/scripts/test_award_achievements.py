import os
import sys
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

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


def _post_for_two_workspaces(monkeypatch, client_for_team):
    """Run `post_achievements` for one award in each of workspaces T1 and T2."""
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
    monkeypatch.setattr(award_achievements, "slack_client_for_team", lambda team_id, **kwargs: client_for_team(team_id))
    return award_achievements.post_achievements(session, candidates, dry_run=False)


class _AwardHour(datetime):
    """A clock fixed at the award hour, so `main` gets past its hour check."""

    @classmethod
    def now(cls, tz=None):
        return cls(2026, 1, 15, award_achievements.constants.ACHIEVEMENT_AWARD_HOUR_CST, tzinfo=tz)


def test_main_raises_an_ordinary_exception_when_a_client_lookup_failed(monkeypatch):
    """The hourly runner catches `Exception`; a `SystemExit` here would end the whole run."""
    candidate = award_achievements.CandidateAward(
        achievement_id=7, user_id=1, award_year=2026, award_period=1, metric=5
    )
    session = MagicMock()
    session.scalars.return_value.all.return_value = [SimpleNamespace(id=7)]
    monkeypatch.setattr(sys, "argv", ["award_achievements.py"])
    monkeypatch.setattr(award_achievements, "datetime", _AwardHour)
    monkeypatch.setattr(award_achievements, "get_session", lambda: MagicMock(__enter__=lambda _self: session))
    monkeypatch.setattr(award_achievements, "process_achievement", lambda *_args: [candidate])
    monkeypatch.setattr(award_achievements, "award_candidates", lambda *_args: None)
    monkeypatch.setattr(award_achievements, "post_achievements", lambda *_args: ["T1"])

    with pytest.raises(RuntimeError, match="skipped for 1 workspace"):
        award_achievements.main()


def test_award_achievements_skips_uninstalled_workspace(monkeypatch):
    installed_client = MagicMock()
    clients = {"T1": None, "T2": installed_client}

    failed = _post_for_two_workspaces(monkeypatch, clients.__getitem__)

    assert failed == []
    installed_client.chat_postMessage.assert_called_once()
    assert installed_client.chat_postMessage.call_args.kwargs["channel"] == "C-T2"


def test_award_achievements_reports_failed_client_lookup_and_continues(monkeypatch):
    installed_client = MagicMock()

    def client_for_team(team_id):
        if team_id == "T1":
            raise RuntimeError("database unavailable")
        return installed_client

    failed = _post_for_two_workspaces(monkeypatch, client_for_team)

    assert failed == ["T1"]
    installed_client.chat_postMessage.assert_called_once()
    assert installed_client.chat_postMessage.call_args.kwargs["channel"] == "C-T2"
