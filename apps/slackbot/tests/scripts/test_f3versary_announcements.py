import os
import sys
from datetime import date, datetime
from types import SimpleNamespace

import pytest
from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import f3versary_announcements


def config(**overrides):
    values = {
        "enabled": True,
        "org_id": 1,
        "team_id": "T1",
        "bot_token": "xoxb-test",
        "channel": "C1",
        "lead_days": 14,
        "last_processed_date": None,
    }
    values.update(overrides)
    return f3versary_announcements.F3versaryConfig(**values)


def candidate(**overrides):
    values = {
        "user_id": 1,
        "f3_name": "Sunshine",
        "slack_id": "U1",
        "first_attendance_date": date(2021, 9, 15),
        "anniversary_date": date(2026, 9, 15),
        "completed_years": 5,
    }
    values.update(overrides)
    return f3versary_announcements.F3versaryCandidate(**values)


def slack_record(**setting_overrides):
    settings = {
        "team_id": "T1",
        "org_id": 1,
        "bot_token": "xoxb-test",
        "f3versary_announcements_enabled": True,
        "f3versary_announcements_channel": "C1",
        "f3versary_announcements_lead_days": 14,
        "f3versary_announcements_last_processed_date": None,
    }
    settings.update(setting_overrides)
    org = SimpleNamespace(id=1, name="Test Region")
    slack_space = SimpleNamespace(
        id=10,
        team_id="T1",
        workspace_name="Test Workspace",
        bot_token="xoxb-test",
        settings=settings,
    )
    return (None, org, slack_space)


@pytest.mark.parametrize(
    ("value", "expected"),
    [(0, 0), (14, 14), (30, 30), (-1, 14), (31, 14), ("bad", 14), (None, 14)],
)
def test_bounded_lead_days(value, expected):
    assert f3versary_announcements._bounded_lead_days(value) == expected


def test_observed_anniversary_handles_leap_day():
    first_attendance = date(2020, 2, 29)
    assert f3versary_announcements.observed_anniversary(first_attendance, 2024) == date(2024, 2, 29)
    assert f3versary_announcements.observed_anniversary(first_attendance, 2025) == date(2025, 2, 28)


def test_select_candidates_matches_exact_date_year_count_identity_and_sorting():
    rows = [
        (1, "Zulu", date(2021, 9, 15), "U1"),
        (2, "Alpha", date(2025, 9, 15), None),
        (3, "New PAX", date(2026, 9, 15), "U3"),
        (4, "Wrong Day", date(2020, 9, 16), "U4"),
        (5, None, date(2020, 9, 15), None),
    ]

    results = f3versary_announcements.select_f3versary_candidates(rows, date(2026, 9, 15))

    assert [result.user_id for result in results] == [2, 1]
    assert [result.completed_years for result in results] == [1, 5]
    assert results[0].slack_id is None
    assert results[1].slack_id == "U1"


def test_message_uses_slack_mention_fallback_and_singular_plural():
    candidates = [
        candidate(user_id=1, f3_name="Mentioned", slack_id="U1", completed_years=1),
        candidate(user_id=2, f3_name="Fallback", slack_id=None, completed_years=5),
    ]

    text, blocks = f3versary_announcements.build_f3versary_message(candidates, date(2026, 9, 15))
    assert text.startswith(":tada: *F3versary Announcements:*\n")
    assert "*• <@U1> celebrates 1 year with F3 on September 15 — be sure to celebrate by grabbing a Q slot!*" in text
    assert "<@U1> celebrates 1 year with F3 on September 15" in text
    assert "Fallback celebrates 5 years with F3 on September 15" in text
    assert "grabbing a Q slot" in text
    assert blocks[0]["text"]["text"] == text


def test_message_uses_today_for_zero_day_lead_time():
    text, blocks = f3versary_announcements.build_f3versary_message(
        [candidate(completed_years=5)],
        date(2026, 9, 1),
        is_today=True,
    )

    assert ":tada: *F3versary Announcements:*" in text
    assert "*• <@U1> celebrates 5 years with F3 TODAY — be sure to celebrate by grabbing a Q slot!*" in text
    assert "on September 1" not in text
    assert blocks[0]["text"]["text"] == text


def test_before_send_hour_returns_without_loading_regions(monkeypatch):
    def load_records(*args, **kwargs):
        raise AssertionError("database should not be queried")

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", load_records)

    f3versary_announcements.send_f3versary_announcements(now_cst=datetime(2026, 9, 1, 16, 59))


def test_opted_out_region_is_skipped(monkeypatch):
    records = [slack_record(f3versary_announcements_enabled=False)]
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(
        f3versary_announcements,
        "get_f3versary_candidates",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("candidates should not be queried")),
    )

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))


def test_region_already_processed_today_is_skipped(monkeypatch):
    records = [slack_record(f3versary_announcements_last_processed_date="2026-09-01")]
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(
        f3versary_announcements,
        "get_f3versary_candidates",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("candidates should not be queried")),
    )

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))


def test_dry_run_prints_message_without_posting_or_marking(monkeypatch, capsys):
    records = [slack_record()]
    marked = []
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    monkeypatch.setattr(f3versary_announcements, "_mark_processed", lambda *args: marked.append(args))
    monkeypatch.setattr(
        f3versary_announcements,
        "WebClient",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("Slack should not be contacted")),
    )

    f3versary_announcements.send_f3versary_announcements(
        force=True,
        dry_run=True,
        now_cst=datetime(2026, 9, 1, 12),
    )

    assert "September 15" in capsys.readouterr().out
    assert marked == []


def test_no_candidates_marks_region_processed_without_posting(monkeypatch):
    records = [slack_record()]
    marked = []
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [])
    monkeypatch.setattr(f3versary_announcements, "_mark_processed", lambda *args: marked.append(args))

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert marked == [(10, date(2026, 9, 1))]


def test_successful_post_marks_region_processed(monkeypatch):
    records = [slack_record()]
    posts = []
    marked = []

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["token"] == "xoxb-test"

        def chat_postMessage(self, **kwargs):
            posts.append(kwargs)

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    monkeypatch.setattr(f3versary_announcements, "_mark_processed", lambda *args: marked.append(args))
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert posts[0]["channel"] == "C1"
    assert marked == [(10, date(2026, 9, 1))]


def test_slack_failure_is_not_marked_processed(monkeypatch, caplog):
    records = [slack_record()]
    marked = []

    class Client:
        def __init__(self, **kwargs):
            pass

        def chat_postMessage(self, **kwargs):
            raise SlackApiError("post failed", {"error": "channel_not_found"})

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    monkeypatch.setattr(f3versary_announcements, "_mark_processed", lambda *args: marked.append(args))
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert marked == []
    assert "channel_not_found" in caplog.text
