from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import award_achievements
from tests import log_privacy


@pytest.fixture
def award_run(monkeypatch):
    class AwardTime(datetime):
        @classmethod
        def now(cls, tz=None):
            return datetime(2099, 1, 1, 18, tzinfo=UTC).astimezone(tz)

    monkeypatch.setattr(award_achievements, "datetime", AwardTime)
    monkeypatch.setattr(award_achievements.constants, "ACHIEVEMENT_AWARD_HOUR_CST", 12)
    session = MagicMock()
    achievement = SimpleNamespace(id=42)
    session.scalars.return_value.all.return_value = [achievement]
    context = MagicMock()
    context.__enter__.return_value = session
    get_session = MagicMock(return_value=context)
    monkeypatch.setattr(award_achievements, "get_session", get_session)
    candidate = SimpleNamespace(achievement_id=42, user_id=7, award_year=2098, award_period=12, metric=5)
    process = MagicMock(return_value=[candidate])
    award = MagicMock()
    post = MagicMock(return_value=[])
    monkeypatch.setattr(award_achievements, "process_achievement", process)
    monkeypatch.setattr(award_achievements, "award_candidates", award)
    monkeypatch.setattr(award_achievements, "post_achievements", post)
    return SimpleNamespace(
        session=session,
        achievement=achievement,
        candidate=candidate,
        get_session=get_session,
        process=process,
        award=award,
        post=post,
    )


def test_cli_defaults_process_current_date_and_post(award_run):
    award_achievements.main([])

    award_run.process.assert_called_once_with(award_run.session, award_run.achievement, date(2099, 1, 1))
    award_run.award.assert_called_once_with(award_run.session, [award_run.candidate], False)
    award_run.post.assert_called_once_with(award_run.session, [award_run.candidate], False)


def test_cli_options_preserve_filter_date_dry_run_and_skip_post(award_run, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    award_achievements.main(
        [
            "--achievement-id",
            "42",
            "--today",
            "2098-12-31",
            "--dry-run",
            "--skip-post",
        ]
    )

    stmt = award_run.session.scalars.call_args.args[0].compile()
    assert "achievements.id = :id_1" in str(stmt)
    assert stmt.params == {"id_1": 42}
    award_run.process.assert_called_once_with(award_run.session, award_run.achievement, date(2098, 12, 31))
    award_run.award.assert_called_once_with(award_run.session, [award_run.candidate], True)
    award_run.post.assert_not_called()
    assert (tmp_path / "achievement_candidates_2098-12-31.csv").read_text() == (
        "achievement_id,user_id,award_year,award_period,metric\n42,7,2098,12,5\n"
    )


def test_callable_keeps_award_hour_guard(award_run, monkeypatch):
    monkeypatch.setattr(award_achievements.constants, "ACHIEVEMENT_AWARD_HOUR_CST", 13)
    award_achievements.run()

    award_run.get_session.assert_not_called()
    award_run.process.assert_not_called()
    award_run.award.assert_not_called()
    award_run.post.assert_not_called()


def test_cli_keeps_dry_run_enabled_when_posting(award_run, monkeypatch, tmp_path):
    monkeypatch.chdir(tmp_path)
    award_achievements.main(["--dry-run"])

    award_run.award.assert_called_once_with(award_run.session, [award_run.candidate], True)
    award_run.post.assert_called_once_with(award_run.session, [award_run.candidate], True)


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
    monkeypatch.setattr(award_achievements, "datetime", _AwardHour)
    monkeypatch.setattr(award_achievements, "get_session", lambda: MagicMock(__enter__=lambda _self: session))
    monkeypatch.setattr(award_achievements, "process_achievement", lambda *_args: [candidate])
    monkeypatch.setattr(award_achievements, "award_candidates", lambda *_args: None)
    monkeypatch.setattr(award_achievements, "post_achievements", lambda *_args: ["T1"])

    with pytest.raises(RuntimeError, match="skipped for 1 workspace"):
        award_achievements.main([])


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


def _post_one_workspace(monkeypatch, send_option, client, dry_run=False):
    """Run `post_achievements` for achievement 7 awarded to users 1 and 2 in workspace T1."""
    candidates = [
        award_achievements.CandidateAward(achievement_id=7, user_id=user_id, award_year=2026, award_period=1, metric=5)
        for user_id in (1, 2)
    ]
    users = [SimpleNamespace(id=user_id, home_region_id=10, f3_name="Synthetic Member Name") for user_id in (1, 2)]
    achievement = SimpleNamespace(id=7, name="Ironman", description=None, image_url=None)
    slack_users = [
        SimpleNamespace(user_id=user_id, slack_team_id="T1", slack_id=f"U_SYNTHETIC_{user_id}", user_name=None)
        for user_id in (1, 2)
    ]
    session = MagicMock()
    session.scalars.side_effect = [
        MagicMock(all=lambda: users),
        MagicMock(all=lambda: [achievement]),
        MagicMock(all=lambda: slack_users),
    ]
    space = _slack_space("T1")
    space.settings["achievement_send_option"] = send_option
    session.execute.return_value.all.return_value = [(10, space)]
    monkeypatch.setattr(award_achievements, "slack_client_for_team", lambda team_id, **kwargs: client)
    return award_achievements.post_achievements(session, candidates, dry_run=dry_run)


def _assert_no_member_identity(caplog, capsys):
    output = log_privacy.assert_private(caplog, capsys)
    assert "U_SYNTHETIC_" not in output
    return output


def _region_summary(caplog):
    (record,) = [
        r for r in caplog.records if getattr(r, "json_fields", {}).get("event") == "slack.achievements.region_complete"
    ]
    assert record.levelname == "INFO"
    return record.json_fields


@pytest.mark.parametrize(
    "send_option,event",
    [("post_individually", "slack.achievements.post_failed"), ("send_in_dms_only", "slack.achievements.dm_failed")],
)
def test_failed_award_message_logs_ids_privately_and_sends_the_rest(monkeypatch, caplog, capsys, send_option, event):
    caplog.set_level("INFO")
    client = MagicMock()
    client.chat_postMessage.side_effect = [log_privacy.slack_error("channel_not_found"), {"ok": True}]

    assert _post_one_workspace(monkeypatch, send_option, client) == []

    _assert_no_member_identity(caplog, capsys)
    (record,) = log_privacy.error_events(caplog, event)
    assert (record.json_fields["team_id"], record.json_fields["achievement_id"], record.json_fields["user_id"]) == (
        "T1",
        7,
        1,
    )
    assert client.chat_postMessage.call_count == 2
    summary = _region_summary(caplog)
    assert (summary["awards"], summary["messages_sent"], summary["messages_failed"]) == (2, 1, 1)


def test_failed_achievement_summary_logs_privately(monkeypatch, caplog, capsys):
    caplog.set_level("INFO")
    client = MagicMock()
    client.chat_postMessage.side_effect = log_privacy.database_error()

    _post_one_workspace(monkeypatch, "post_summary", client)

    _assert_no_member_identity(caplog, capsys)
    (record,) = log_privacy.error_events(caplog, "slack.achievements.summary_failed")
    assert record.json_fields["team_id"] == "T1"
    summary = _region_summary(caplog)
    assert (summary["awards"], summary["messages_sent"], summary["messages_failed"]) == (2, 0, 1)


@pytest.mark.parametrize(
    "send_option,messages", [("post_individually", 2), ("send_in_dms_only", 2), ("post_summary", 1)]
)
def test_successful_achievement_posts_log_counts_without_member_identity(
    monkeypatch, caplog, capsys, send_option, messages
):
    caplog.set_level("INFO")
    client = MagicMock()

    _post_one_workspace(monkeypatch, send_option, client)

    _assert_no_member_identity(caplog, capsys)
    assert not [r for r in caplog.records if r.levelname == "ERROR"]
    assert client.chat_postMessage.call_count == messages
    summary = _region_summary(caplog)
    assert summary == {
        "event": "slack.achievements.region_complete",
        "team_id": "T1",
        "send_option": send_option,
        "awards": 2,
        "messages_sent": messages,
        "messages_failed": 0,
    }


def test_achievement_dry_run_lists_counts_without_member_identity(monkeypatch, caplog, capsys):
    client = MagicMock()

    _post_one_workspace(monkeypatch, "post_individually", client, dry_run=True)

    output = _assert_no_member_identity(caplog, capsys)
    assert "Ironman (achievement 7): 2 member(s)" in output
    client.chat_postMessage.assert_not_called()
