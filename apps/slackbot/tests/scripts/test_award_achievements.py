from datetime import UTC, date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import award_achievements


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
    post = MagicMock()
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
