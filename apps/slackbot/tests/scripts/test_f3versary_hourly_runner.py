import os
import sys

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import hourly_runner


def silence_other_jobs(monkeypatch, achievement_callback=lambda: None):
    monkeypatch.setattr(hourly_runner.calendar_images, "generate_calendar_images", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.backblast_reminders, "send_backblast_reminders", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.preblast_reminders, "send_preblast_reminders", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.auto_preblast_send, "send_automated_preblasts", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.q_lineups, "send_lineups", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.update_slack_users, "update_slack_users", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.update_slack_users, "update_home_regions", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.home_region_nudge, "send_home_region_nudges", lambda *args, **kwargs: None)
    monkeypatch.setattr(hourly_runner.award_achievements, "main", achievement_callback)
    monkeypatch.setattr(hourly_runner.requests, "post", lambda *args, **kwargs: None)


def test_hourly_runner_calls_f3versary_job_with_force(monkeypatch):
    calls = []
    silence_other_jobs(monkeypatch)
    monkeypatch.setattr(
        hourly_runner.f3versary_announcements,
        "send_f3versary_announcements",
        lambda *args, **kwargs: calls.append(kwargs),
    )

    hourly_runner.run_all_hourly_scripts(force=True, run_reporting=False)

    assert calls == [{"force": True}]


def test_hourly_runner_continues_when_f3versary_job_fails(monkeypatch, capsys):
    achievements = []
    silence_other_jobs(monkeypatch, achievement_callback=lambda: achievements.append("ran"))
    monkeypatch.setattr(
        hourly_runner.f3versary_announcements,
        "send_f3versary_announcements",
        lambda *args, **kwargs: (_ for _ in ()).throw(RuntimeError("test failure")),
    )

    hourly_runner.run_all_hourly_scripts(run_reporting=False)

    assert achievements == ["ran"]
    assert "Error running F3versary announcements: test failure" in capsys.readouterr().out
