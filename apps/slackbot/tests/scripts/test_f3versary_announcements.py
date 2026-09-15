import os
import sys
from contextlib import contextmanager
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

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
        "effective_start_date": date(2021, 9, 15),
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


def use_locked_record(monkeypatch, slack_space):
    @contextmanager
    def locked_record(slack_space_id):
        assert slack_space_id == slack_space.id
        yield slack_space

    monkeypatch.setattr(f3versary_announcements, "_locked_slack_space", locked_record)


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
        (1, "Zulu", date(2021, 9, 15), "U1", {}),
        (2, "Alpha", date(2025, 9, 15), None, {}),
        (3, "New PAX", date(2026, 9, 15), "U3", {}),
        (4, "Wrong Day", date(2020, 9, 16), "U4", {}),
        (5, None, date(2020, 9, 15), None, {}),
    ]

    results = f3versary_announcements.select_f3versary_candidates(rows, date(2026, 9, 15))

    assert [result.user_id for result in results] == [2, 1]
    assert [result.completed_years for result in results] == [1, 5]
    assert results[0].slack_id is None
    assert results[1].slack_id == "U1"


def test_select_candidates_prefers_valid_start_date_override_and_falls_back():
    rows = [
        (1, "Override", date(2024, 9, 16), "U1", {"start_date_override": "2020-09-15"}),
        (2, "Blank", date(2021, 9, 15), "U2", {"start_date_override": ""}),
        (3, "Invalid", date(2022, 9, 15), "U3", {"start_date_override": "not-a-date"}),
        (4, "Override Only", None, "U4", {"start_date_override": "2019-09-15"}),
    ]

    results = f3versary_announcements.select_f3versary_candidates(rows, date(2026, 9, 15))

    assert [result.user_id for result in results] == [2, 3, 1, 4]
    assert [result.completed_years for result in results] == [5, 4, 6, 7]
    assert [result.effective_start_date for result in results] == [
        date(2021, 9, 15),
        date(2022, 9, 15),
        date(2020, 9, 15),
        date(2019, 9, 15),
    ]


def test_message_uses_slack_mention_fallback_and_singular_plural():
    candidates = [
        candidate(user_id=1, f3_name="Mentioned", slack_id="U1", completed_years=1),
        candidate(user_id=2, f3_name="Fallback", slack_id=None, completed_years=5),
    ]

    text, blocks = f3versary_announcements.build_f3versary_message(candidates, date(2026, 9, 15))

    assert "<@U1> celebrates 1 year with F3 on September 15" in text
    assert "Fallback celebrates 5 years with F3 on September 15" in text
    assert "grabbing a Q slot" in text
    assert blocks[0]["text"]["text"] == text


def test_message_escapes_fallback_name_for_slack_mrkdwn():
    text, _ = f3versary_announcements.build_f3versary_message(
        [candidate(f3_name="R&D <Lead>", slack_id=None)],
        date(2026, 9, 15),
    )

    assert "R&amp;D &lt;Lead&gt; celebrates" in text
    assert "R&D <Lead> celebrates" not in text


def test_message_splits_large_candidate_list_into_valid_section_blocks():
    candidates = [candidate(user_id=index, f3_name=f"PAX {index} {'x' * 80}", slack_id=None) for index in range(40)]

    text, blocks = f3versary_announcements.build_f3versary_message(candidates, date(2026, 9, 15))

    assert len(text) > f3versary_announcements.MAX_SECTION_TEXT_LENGTH
    assert len(blocks) > 1
    assert all(len(block["text"]["text"]) <= f3versary_announcements.MAX_SECTION_TEXT_LENGTH for block in blocks)
    assert "\n".join(block["text"]["text"] for block in blocks) == text


def test_locked_slack_space_uses_row_lock_and_commits(monkeypatch):
    slack_space = slack_record()[2]
    session = MagicMock()
    session.query.return_value.filter.return_value.with_for_update.return_value.one.return_value = slack_space
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    with f3versary_announcements._locked_slack_space(slack_space.id) as locked:
        assert locked is slack_space

    session.query.return_value.filter.return_value.with_for_update.assert_called_once_with()
    session.commit.assert_called_once_with()
    session.rollback.assert_not_called()
    session.close.assert_called_once_with()


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
    slack_space = records[0][2]
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    use_locked_record(monkeypatch, slack_space)
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
    assert slack_space.settings[f3versary_announcements.LAST_PROCESSED_SETTING] is None


def test_no_candidates_marks_region_processed_without_posting(monkeypatch):
    records = [slack_record()]
    slack_space = records[0][2]
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [])
    use_locked_record(monkeypatch, slack_space)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert slack_space.settings[f3versary_announcements.LAST_PROCESSED_SETTING] == "2026-09-01"


def test_successful_post_marks_region_processed(monkeypatch):
    records = [slack_record()]
    slack_space = records[0][2]
    posts = []

    class Client:
        def __init__(self, **kwargs):
            assert kwargs["token"] == "xoxb-test"

        def chat_postMessage(self, **kwargs):
            posts.append(kwargs)

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    use_locked_record(monkeypatch, slack_space)
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert posts[0]["channel"] == "C1"
    assert posts[0]["client_msg_id"] == f3versary_announcements._message_id(config(), date(2026, 9, 1))
    assert slack_space.settings[f3versary_announcements.LAST_PROCESSED_SETTING] == "2026-09-01"


def test_slack_failure_is_not_marked_processed(monkeypatch, caplog):
    records = [slack_record()]
    slack_space = records[0][2]

    class Client:
        def __init__(self, **kwargs):
            pass

        def chat_postMessage(self, **kwargs):
            raise SlackApiError("post failed", {"error": "channel_not_found"})

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    use_locked_record(monkeypatch, slack_space)
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert slack_space.settings[f3versary_announcements.LAST_PROCESSED_SETTING] is None
    assert "channel_not_found" in caplog.text


def test_fresh_settings_are_rechecked_after_acquiring_lock(monkeypatch):
    records = [slack_record()]
    current_slack_space = slack_record(f3versary_announcements_last_processed_date="2026-09-01")[2]
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    use_locked_record(monkeypatch, current_slack_space)
    monkeypatch.setattr(
        f3versary_announcements,
        "get_f3versary_candidates",
        lambda *args, **kwargs: (_ for _ in ()).throw(AssertionError("candidates should not be queried")),
    )

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))
