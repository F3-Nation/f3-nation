import os
import re
import sys
from datetime import date, datetime, timedelta, timezone
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
    settings = {"f3versary_announcements_last_processed_date": None}
    regional_setting = SimpleNamespace(slack_space_id=10, org_id=1, enabled=True, channel="C1", lead_days=14)
    field_names = {
        "f3versary_announcements_enabled": "enabled",
        "f3versary_announcements_channel": "channel",
        "f3versary_announcements_lead_days": "lead_days",
    }
    for name, value in setting_overrides.items():
        if name in field_names:
            setattr(regional_setting, field_names[name], value)
        else:
            settings[name] = value
    org = SimpleNamespace(id=1, name="Test Region")
    slack_space = SimpleNamespace(
        id=10,
        team_id="T1",
        workspace_name="Test Workspace",
        bot_token="xoxb-test",
        settings=settings,
        regional_settings={1: regional_setting},
    )
    return (None, org, slack_space)


class FakeOutbox:
    """Model persisted run/page state without Slack or PostgreSQL side effects."""

    def __init__(self, monkeypatch, slack_space):
        self.slack_space = slack_space
        self.runs = {}
        self.pages = {}
        self.created = 0
        self.abandoned = []
        self.claims = []
        self.sent = []
        self.sleeps = []
        monkeypatch.setattr(f3versary_announcements, "sleep", self.sleeps.append)
        monkeypatch.setattr(f3versary_announcements, "_read_slack_space", self.read_space)
        monkeypatch.setattr(f3versary_announcements, "_read_region_setting", self.read_region_setting)
        monkeypatch.setattr(f3versary_announcements, "_run_for_date", self.run_for_date)
        monkeypatch.setattr(f3versary_announcements, "_abandon_old_runs", self.abandon_old_runs)
        monkeypatch.setattr(f3versary_announcements, "_create_run", self.create_run)
        monkeypatch.setattr(f3versary_announcements, "_claim_next_page", self.claim_next_page)
        monkeypatch.setattr(f3versary_announcements, "_record_sent_page", self.record_sent_page)

    def read_space(self, slack_space_id):
        assert slack_space_id == self.slack_space.id
        return self.slack_space

    def read_region_setting(self, slack_space_id, org_id):
        assert slack_space_id == self.slack_space.id
        return self.slack_space.regional_settings.get(org_id)

    def run_for_date(self, slack_space_id, org_id, processing_date):
        return self.runs.get((slack_space_id, org_id, processing_date))

    def abandon_old_runs(self, slack_space_id, org_id, processing_date):
        for (space_id, region_id, saved_date), run in self.runs.items():
            if (
                space_id == slack_space_id
                and region_id == org_id
                and saved_date < processing_date
                and run.status == "planned"
            ):
                run.status = "abandoned"
                self.abandoned.append(run.id)

    def create_run(self, org, slack_space_id, config, processing_date, target_date, messages):
        existing = self.run_for_date(slack_space_id, org.id, processing_date)
        if existing is not None:
            return existing.id
        self.created += 1
        run = SimpleNamespace(
            id=self.created,
            slack_space_id=slack_space_id,
            org_id=org.id,
            processing_date=processing_date,
            target_date=target_date,
            channel=config.channel,
            lead_days=config.lead_days,
            status="planned" if messages else "complete",
            page_count=len(messages),
        )
        self.runs[(slack_space_id, org.id, processing_date)] = run
        self.pages[run.id] = [
            SimpleNamespace(
                id=number,
                page_number=number,
                text=text,
                blocks=blocks,
                client_msg_id=f3versary_announcements._message_id(
                    slack_space_id, org.id, config.channel, processing_date, number
                ),
                status="pending",
            )
            for number, (text, blocks) in enumerate(messages, start=1)
        ]
        return run.id

    def claim_next_page(self, run_id, org, config, processing_date, check_real_clock=False):
        run = self.run_for_date(self.slack_space.id, org.id, processing_date)
        if run is None or run.id != run_id or run.status != "planned":
            return None
        if not f3versary_announcements._run_matches_config(run, config, processing_date):
            return None
        page = next((page for page in self.pages[run.id] if page.status != "sent"), None)
        if page is None:
            run.status = "complete"
            return None
        claim = f3versary_announcements.ClaimedPage(
            run_id=run_id,
            page_id=page.id,
            page_number=page.page_number,
            channel=run.channel,
            text=page.text,
            blocks=page.blocks,
            client_msg_id=page.client_msg_id,
            claim_token=f"claim-{len(self.claims) + 1}",
        )
        self.claims.append(claim)
        page.status = "claimed"
        return claim

    def record_sent_page(self, claim, slack_ts):
        page = self.pages[claim.run_id][claim.page_number - 1]
        page.status = "sent"
        self.sent.append((claim.page_number, slack_ts))
        if all(page.status == "sent" for page in self.pages[claim.run_id]):
            for run in self.runs.values():
                if run.id == claim.run_id:
                    run.status = "complete"
                    break


@pytest.mark.parametrize(
    ("value", "expected", "warning_expected"),
    [
        (0, 0, False),
        ("14", 14, False),
        (30, 30, False),
        (-1, 14, True),
        (31, 14, True),
        ("bad", 14, True),
        (True, 14, True),
        (1.5, 14, True),
        (None, 14, False),
    ],
)
def test_bounded_lead_days(value, expected, warning_expected, caplog):
    assert f3versary_announcements._bounded_lead_days(value) == expected
    warnings = [record for record in caplog.records if record.levelname == "WARNING"]
    assert bool(warnings) is warning_expected
    assert all("F3versary lead-time" in record.message for record in warnings)
    assert "bad" not in caplog.text


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


def test_paginated_message_keeps_original_heading_when_one_page_suffices():
    members = [candidate(user_id=1, f3_name="Sunshine", slack_id="U1")]

    messages = f3versary_announcements.build_f3versary_messages(members, date(2026, 9, 15))

    assert len(messages) == 1
    assert messages[0] == f3versary_announcements.build_f3versary_message(members, date(2026, 9, 15))
    assert messages[0][0].startswith(":tada: *F3versary Announcements:*\n")


@pytest.mark.parametrize("is_today", [False, True])
def test_paginated_message_numbers_all_pages_and_includes_every_member_once(is_today):
    members = [candidate(user_id=index, f3_name=f"PAX-{index:04d}-{'x' * 230}", slack_id=None) for index in range(600)]
    all_lines = [
        ":tada: *F3versary Announcements:*",
        *f3versary_announcements._format_f3versary_lines(members, date(2026, 9, 15), is_today),
    ]
    assert len(f3versary_announcements._chunk_message_lines(all_lines)) > 50

    messages = f3versary_announcements.build_f3versary_messages(members, date(2026, 9, 15), is_today)

    assert len(messages) > 1
    seen_member_ids = []
    for page_number, (text, blocks) in enumerate(messages, start=1):
        assert text.startswith(f":tada: *F3versary Announcements ({page_number}/{len(messages)}):*\n")
        assert len(text) <= f3versary_announcements.MAX_MESSAGE_TEXT_LENGTH
        assert len(blocks) <= f3versary_announcements.MAX_MESSAGE_BLOCKS
        assert all(len(block["text"]["text"]) <= f3versary_announcements.MAX_SECTION_TEXT_LENGTH for block in blocks)
        assert "\n".join(block["text"]["text"] for block in blocks) == text
        if is_today:
            assert all("with F3 TODAY" in line for line in text.splitlines()[1:])
        seen_member_ids.extend(int(value) for value in re.findall(r"PAX-(\d{4})-", text))

    assert seen_member_ids == list(range(600))


def test_paginated_message_rejects_a_single_oversized_member_line():
    members = [candidate(slack_id="U" * 3000)]

    with pytest.raises(ValueError, match="section limit"):
        f3versary_announcements.build_f3versary_messages(members, date(2026, 9, 15))


def test_first_attendance_query_excludes_inactive_events_and_scopes_users(monkeypatch):
    first_query = MagicMock()
    rows_query = MagicMock()
    for method in ("select_from", "join", "filter", "group_by"):
        getattr(first_query, method).return_value = first_query
    for method in ("outerjoin", "filter", "group_by"):
        getattr(rows_query, method).return_value = rows_query
    rows_query.all.return_value = []
    session = MagicMock()
    session.__enter__.return_value = session
    session.query.side_effect = [first_query, rows_query]
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    assert f3versary_announcements.get_f3versary_candidates(config(org_id=6), date(2026, 9, 15)) == []

    filters = first_query.filter.call_args.args
    assert any(expression.compare(f3versary_announcements.EventInstance.is_active.is_(True)) for expression in filters)
    assert any(expression.compare(f3versary_announcements.User.home_region_id == 6) for expression in filters)
    assert all("event_instances.org_id" not in str(expression) for expression in filters)
    assert any(call.args[0] is f3versary_announcements.User for call in first_query.join.call_args_list)


def test_region_move_keeps_historical_first_attendance_date_for_current_member():
    # The row came from a current-home-region query; first attendance may predate that move.
    rows = [(1, "Moved PAX", date(2020, 9, 15), None, {})]

    selected = f3versary_announcements.select_f3versary_candidates(rows, date(2026, 9, 15))

    assert len(selected) == 1
    assert selected[0].effective_start_date == date(2020, 9, 15)
    assert selected[0].completed_years == 6


def test_before_send_hour_returns_without_loading_regions(monkeypatch):
    def load_records(*args, **kwargs):
        raise AssertionError("database should not be queried")

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", load_records)

    f3versary_announcements.send_f3versary_announcements(now_cst=datetime(2026, 9, 1, 16, 59))


def test_opted_out_region_is_skipped(monkeypatch):
    records = [slack_record(f3versary_announcements_enabled=False)]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)

    def reject_candidates(*args, **kwargs):
        raise AssertionError("candidates should not be queried")

    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", reject_candidates)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert outbox.created == 0


def test_legacy_same_day_marker_prevents_cutover_repost(monkeypatch):
    records = [slack_record(f3versary_announcements_last_processed_date="2026-09-01")]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)

    def reject_candidates(*args, **kwargs):
        raise AssertionError("already processed candidates should not be queried")

    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", reject_candidates)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert outbox.created == 0


def test_legacy_partial_jsonb_plan_pauses_until_maintainer_cutover(monkeypatch, caplog):
    records = [slack_record(f3versary_announcements_delivery_plan={"next_page": 1})]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)

    def reject_candidates(*args, **kwargs):
        raise AssertionError("a legacy partial batch must not be recomputed")

    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", reject_candidates)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 17))

    assert outbox.created == 0
    assert "legacy partial delivery needs maintainer review" in caplog.text


def test_dry_run_prints_without_slack_or_outbox_writes(monkeypatch, capsys):
    records = [slack_record()]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])

    def reject_client(*args, **kwargs):
        raise AssertionError("dry run must not contact Slack")

    monkeypatch.setattr(f3versary_announcements, "WebClient", reject_client)

    f3versary_announcements.send_f3versary_announcements(force=True, dry_run=True, now_cst=datetime(2026, 9, 1, 12))

    assert "September 15" in capsys.readouterr().out
    assert outbox.created == 0
    assert outbox.abandoned == []


@pytest.mark.parametrize("lead_days", [0, 14, 30])
def test_send_path_passes_configured_target_date_to_candidate_query(monkeypatch, lead_days):
    records = [slack_record(f3versary_announcements_lead_days=lead_days)]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    seen_target_dates = []

    def load_candidates(config, target_date):
        seen_target_dates.append(target_date)
        return []

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", load_candidates)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    assert seen_target_dates == [date(2026, 9, 1) + timedelta(days=lead_days)]
    run = outbox.run_for_date(10, 1, date(2026, 9, 1))
    assert run is not None
    assert run.target_date == seen_target_dates[0]
    assert run.status == "complete"


def test_no_candidates_creates_complete_zero_page_run_without_posting(monkeypatch):
    records = [slack_record()]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [])

    def reject_client(*args, **kwargs):
        raise AssertionError("empty delivery must not contact Slack")

    monkeypatch.setattr(f3versary_announcements, "WebClient", reject_client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 12))

    run = outbox.run_for_date(10, 1, date(2026, 9, 1))
    assert run.status == "complete"
    assert run.page_count == 0
    assert outbox.pages[run.id] == []
    assert records[0][2].settings["f3versary_announcements_last_processed_date"] is None


def test_successful_post_completes_run_and_uses_scoped_message_id(monkeypatch):
    records = [slack_record()]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    posts = []

    class Client:
        def __init__(self, **kwargs):
            assert kwargs == {"token": "xoxb-test", "timeout": 20, "retry_handlers": []}

        def chat_postMessage(self, **kwargs):
            posts.append(kwargs)
            return {"ts": "123.456"}

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 17))

    run = outbox.run_for_date(10, 1, date(2026, 9, 1))
    assert run.status == "complete"
    assert posts[0]["channel"] == "C1"
    assert posts[0]["client_msg_id"] == f3versary_announcements._message_id(10, 1, "C1", date(2026, 9, 1), 1)
    assert posts[0]["client_msg_id"] != f3versary_announcements._message_id(10, 2, "C1", date(2026, 9, 1), 1)
    assert posts[0]["client_msg_id"] != f3versary_announcements._message_id(11, 1, "C1", date(2026, 9, 1), 1)
    assert outbox.sent == [(1, "123.456")]
    assert outbox.sleeps == [f3versary_announcements.MIN_POST_INTERVAL_SECONDS]

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 18))
    assert len(posts) == 1


def test_second_page_failure_retries_saved_unsent_page_without_requery(monkeypatch):
    records = [slack_record()]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    members = [candidate(user_id=index, f3_name=f"PAX-{index:03d}-{'x' * 230}", slack_id=None) for index in range(40)]
    messages = f3versary_announcements.build_f3versary_messages(members, date(2026, 9, 15))
    assert len(messages) >= 2
    queries = []
    posts = []
    fail_second = [True]

    def load_candidates(*args, **kwargs):
        queries.append(True)
        return members

    class Client:
        def __init__(self, **kwargs):
            pass

        def chat_postMessage(self, **kwargs):
            posts.append(kwargs)
            if fail_second[0] and len(posts) == 2:
                raise SlackApiError("second page failed", {"error": "ratelimited"})
            return {"ts": str(len(posts))}

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", load_candidates)
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 17))

    run = outbox.run_for_date(10, 1, date(2026, 9, 1))
    assert run.status == "planned"
    assert [page.status for page in outbox.pages[run.id]][:2] == ["sent", "claimed"]
    assert len(queries) == 1

    # The fake repository simulates the claim lease expiring before the next hourly run.
    outbox.pages[run.id][1].status = "pending"
    fail_second[0] = False
    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 18))

    assert len(queries) == 1
    assert [post["text"] for post in posts] == [messages[0][0], messages[1][0], *[text for text, _ in messages[1:]]]
    assert posts[1]["client_msg_id"] == posts[2]["client_msg_id"]
    assert posts[0]["client_msg_id"] != posts[1]["client_msg_id"]
    assert outbox.sleeps == [f3versary_announcements.MIN_POST_INTERVAL_SECONDS] * len(messages)
    assert run.status == "complete"


@pytest.mark.parametrize(
    "changed_settings",
    [
        {"f3versary_announcements_channel": "C2"},
        {"f3versary_announcements_lead_days": 30},
    ],
)
def test_admin_settings_change_pauses_saved_same_day_run(monkeypatch, changed_settings):
    records = [slack_record()]
    org, slack_space = records[0][1:]
    outbox = FakeOutbox(monkeypatch, slack_space)
    messages = f3versary_announcements.build_f3versary_messages([candidate()], date(2026, 9, 15))
    run_id = outbox.create_run(org, 10, config(), date(2026, 9, 1), date(2026, 9, 15), messages)
    regional_setting = slack_space.regional_settings[org.id]
    if "f3versary_announcements_channel" in changed_settings:
        regional_setting.channel = changed_settings["f3versary_announcements_channel"]
    if "f3versary_announcements_lead_days" in changed_settings:
        regional_setting.lead_days = changed_settings["f3versary_announcements_lead_days"]
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)

    def reject_candidates(*args, **kwargs):
        raise AssertionError("saved plan must not be recomputed")

    def reject_client(*args, **kwargs):
        raise AssertionError("old channel/lead-time plan must not post")

    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", reject_candidates)
    monkeypatch.setattr(f3versary_announcements, "WebClient", reject_client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 18))

    assert outbox.pages[run_id][0].status == "pending"
    assert outbox.run_for_date(10, 1, date(2026, 9, 1)).status == "planned"
    assert regional_setting.channel == changed_settings.get("f3versary_announcements_channel", "C1")
    assert regional_setting.lead_days == changed_settings.get("f3versary_announcements_lead_days", 14)
    assert "f3versary_announcements_channel" not in slack_space.settings


def test_two_regions_in_one_workspace_have_distinct_run_and_page_keys(monkeypatch):
    records = [slack_record()]
    other_org = SimpleNamespace(id=2, name="Other Region")
    records[0][2].regional_settings[2] = SimpleNamespace(
        slack_space_id=10, org_id=2, enabled=True, channel="C2", lead_days=30
    )
    records.append((None, other_org, records[0][2]))
    outbox = FakeOutbox(monkeypatch, records[0][2])
    posts = []

    class Client:
        def __init__(self, **kwargs):
            pass

        def chat_postMessage(self, **kwargs):
            posts.append(kwargs)
            return {"ts": str(len(posts))}

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 17))

    assert outbox.run_for_date(10, 1, date(2026, 9, 1)).status == "complete"
    assert outbox.run_for_date(10, 2, date(2026, 9, 1)).status == "complete"
    assert len(posts) == 2
    assert posts[0]["client_msg_id"] != posts[1]["client_msg_id"]
    assert [post["channel"] for post in posts] == ["C1", "C2"]
    assert outbox.run_for_date(10, 1, date(2026, 9, 1)).target_date == date(2026, 9, 15)
    assert outbox.run_for_date(10, 2, date(2026, 9, 1)).target_date == date(2026, 10, 1)


def test_missing_region_row_defaults_off_without_suppressing_other_region(monkeypatch):
    records = [slack_record()]
    other_org = SimpleNamespace(id=2, name="Other Region")
    records.append((None, other_org, records[0][2]))
    outbox = FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [])

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 17))

    assert outbox.run_for_date(10, 1, date(2026, 9, 1)).status == "complete"
    assert outbox.run_for_date(10, 2, date(2026, 9, 1)) is None


def test_unfinished_prior_day_run_is_abandoned_and_new_day_proceeds(monkeypatch):
    records = [slack_record()]
    org = records[0][1]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    old_messages = f3versary_announcements.build_f3versary_messages([candidate()], date(2026, 9, 15))
    old_id = outbox.create_run(org, 10, config(), date(2026, 9, 1), date(2026, 9, 15), old_messages)
    queried_dates = []

    def load_candidates(config, target_date):
        queried_dates.append(target_date)
        return []

    def reject_client(*args, **kwargs):
        raise AssertionError("stale pages must not be posted")

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", load_candidates)
    monkeypatch.setattr(f3versary_announcements, "WebClient", reject_client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 2, 18))

    assert outbox.runs[(10, 1, date(2026, 9, 1))].status == "abandoned"
    assert outbox.pages[old_id][0].status == "pending"
    assert outbox.abandoned == [old_id]
    assert queried_dates == [date(2026, 9, 16)]
    assert outbox.runs[(10, 1, date(2026, 9, 2))].status == "complete"


def test_invalid_saved_page_rejects_more_than_fifty_blocks():
    _, blocks = f3versary_announcements.build_f3versary_message([candidate()], date(2026, 9, 15))
    page = {"text": "\n".join(block["text"]["text"] for block in blocks), "blocks": blocks * 51}

    assert not f3versary_announcements._valid_saved_page(page)


def test_production_real_clock_stops_stale_day_before_claiming(monkeypatch):
    class NextDayClock:
        @classmethod
        def now(cls, timezone_value):
            return datetime(2026, 9, 2, 0, 1)

    def reject_session():
        raise AssertionError("stale batch must not even open a DB claim")

    monkeypatch.setattr(f3versary_announcements, "datetime", NextDayClock)
    monkeypatch.setattr(f3versary_announcements, "get_session", reject_session)

    assert (
        f3versary_announcements._claim_next_page(
            1, SimpleNamespace(id=1), config(), date(2026, 9, 1), check_real_clock=True
        )
        is None
    )


def test_active_claim_lease_blocks_reclaim_then_expired_claim_is_reused(monkeypatch):
    org, slack_space = slack_record()[1:]
    run = SimpleNamespace(
        id=1,
        slack_space_id=10,
        org_id=1,
        processing_date=date(2026, 9, 1),
        target_date=date(2026, 9, 15),
        channel="C1",
        lead_days=14,
        status="planned",
    )
    page_text, blocks = f3versary_announcements.build_f3versary_message([candidate()], date(2026, 9, 15))
    page = SimpleNamespace(
        id=1,
        page_number=1,
        text=page_text,
        blocks=blocks,
        client_msg_id=f3versary_announcements._message_id(10, 1, "C1", date(2026, 9, 1), 1),
        status="claimed",
        claim_token="old",
        claim_expires_at=datetime.now(timezone.utc) + timedelta(hours=1),
    )
    run_query, region_query, space_query, page_query = MagicMock(), MagicMock(), MagicMock(), MagicMock()
    run_query.filter.return_value.with_for_update.return_value.one.return_value = run
    region_query.filter.return_value.with_for_update.return_value.one_or_none.return_value = (
        slack_space.regional_settings[org.id]
    )
    space_query.filter.return_value.one.return_value = slack_space
    page_query.filter.return_value.order_by.return_value.first.return_value = page
    session = MagicMock()
    session.__enter__.return_value = session
    queries = {
        f3versary_announcements.F3versaryDeliveryRun: run_query,
        f3versary_announcements.F3versaryAnnouncementSetting: region_query,
        f3versary_announcements.SlackSpace: space_query,
        f3versary_announcements.F3versaryDeliveryPage: page_query,
    }
    session.query.side_effect = lambda model: queries[model]
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    assert f3versary_announcements._claim_next_page(1, org, config(), date(2026, 9, 1)) is None
    assert page.claim_token == "old"
    session.commit.assert_not_called()

    page.claim_expires_at = datetime.now(timezone.utc) - timedelta(hours=1)
    claimed = f3versary_announcements._claim_next_page(1, org, config(), date(2026, 9, 1))

    assert claimed is not None
    assert claimed.client_msg_id == page.client_msg_id
    assert claimed.claim_token != "old"
    assert page.claim_token == claimed.claim_token
    session.commit.assert_called_once()


def test_superseded_claim_cannot_finalize_a_page(monkeypatch):
    claim = f3versary_announcements.ClaimedPage(
        run_id=1,
        page_id=2,
        page_number=1,
        channel="C1",
        text="test",
        blocks=[],
        client_msg_id="stable",
        claim_token="old",
    )
    run = SimpleNamespace(id=1, status="planned")
    page = SimpleNamespace(id=2, status="claimed", claim_token="new", slack_ts=None, sent_at=None)
    run_query, page_query = MagicMock(), MagicMock()
    run_query.filter.return_value.with_for_update.return_value.one.return_value = run
    page_query.filter.return_value.one.return_value = page
    session = MagicMock()
    session.__enter__.return_value = session
    session.query.side_effect = lambda model: {
        f3versary_announcements.F3versaryDeliveryRun: run_query,
        f3versary_announcements.F3versaryDeliveryPage: page_query,
    }[model]
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    with pytest.raises(RuntimeError, match="superseded"):
        f3versary_announcements._record_sent_page(claim, "123.456")

    assert page.status == "claimed"
    session.commit.assert_not_called()


def test_successful_page_finalization_does_not_write_admin_settings(monkeypatch):
    claim = f3versary_announcements.ClaimedPage(
        run_id=1,
        page_id=2,
        page_number=1,
        channel="C1",
        text="test",
        blocks=[],
        client_msg_id="stable",
        claim_token="owned",
    )
    run = SimpleNamespace(id=1, status="planned")
    page = SimpleNamespace(id=2, status="claimed", claim_token="owned", claim_expires_at=None, slack_ts=None)
    run_query, page_query, remaining_query = MagicMock(), MagicMock(), MagicMock()
    run_query.filter.return_value.with_for_update.return_value.one.return_value = run
    page_query.filter.return_value.one.return_value = page
    remaining_query.filter.return_value.first.return_value = None
    session = MagicMock()
    session.__enter__.return_value = session

    def query(model):
        if model is f3versary_announcements.F3versaryDeliveryRun:
            return run_query
        if model is f3versary_announcements.F3versaryDeliveryPage:
            return page_query
        if model is f3versary_announcements.F3versaryDeliveryPage.id:
            return remaining_query
        raise AssertionError("finalization must not read or write SlackSpace.settings")

    session.query.side_effect = query
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    f3versary_announcements._record_sent_page(claim, "123.456")

    assert page.status == "sent"
    assert page.slack_ts == "123.456"
    assert run.status == "complete"
    session.commit.assert_called_once()


def test_plan_save_failure_never_calls_slack(monkeypatch, caplog):
    records = [slack_record()]
    FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])

    def fail_create_run(*args, **kwargs):
        raise RuntimeError("database unavailable, member name and token")

    def reject_client(*args, **kwargs):
        raise AssertionError("Slack must not post before the plan commits")

    monkeypatch.setattr(f3versary_announcements, "_create_run", fail_create_run)
    monkeypatch.setattr(f3versary_announcements, "WebClient", reject_client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 17))

    assert "error_type=RuntimeError" in caplog.text
    assert "member name and token" not in caplog.text


def test_slack_success_and_failed_db_finalize_reuses_same_message_id_on_retry(monkeypatch):
    records = [slack_record()]
    outbox = FakeOutbox(monkeypatch, records[0][2])
    posts = []
    fail_finalization = [True]
    original_record_sent = outbox.record_sent_page

    def record_sent(claim, slack_ts):
        if fail_finalization[0]:
            raise RuntimeError("commit failed")
        original_record_sent(claim, slack_ts)

    class Client:
        def __init__(self, **kwargs):
            pass

        def chat_postMessage(self, **kwargs):
            posts.append(kwargs)
            return {"ts": str(len(posts))}

    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)
    monkeypatch.setattr(f3versary_announcements, "get_f3versary_candidates", lambda *args, **kwargs: [candidate()])
    monkeypatch.setattr(f3versary_announcements, "_record_sent_page", record_sent)
    monkeypatch.setattr(f3versary_announcements, "WebClient", Client)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 17))
    assert len(posts) == 1
    run = outbox.run_for_date(10, 1, date(2026, 9, 1))
    assert outbox.pages[run.id][0].status == "claimed"
    assert run.status == "planned"

    # A real claimant must wait until the lease expires; the fake releases it for this hourly retry.
    outbox.pages[run.id][0].status = "pending"
    fail_finalization[0] = False
    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 18))

    assert len(posts) == 2
    assert posts[0]["client_msg_id"] == posts[1]["client_msg_id"]
    assert run.status == "complete"


def test_create_run_rechecks_admin_settings_under_row_lock(monkeypatch):
    org, slack_space = slack_record()[1:]
    regional_setting = slack_space.regional_settings[org.id]
    regional_setting.channel = "C2"
    region_query, space_query = MagicMock(), MagicMock()
    region_query.filter.return_value.with_for_update.return_value.one_or_none.return_value = regional_setting
    space_query.filter.return_value.one.return_value = slack_space
    session = MagicMock()
    session.__enter__.return_value = session
    session.query.side_effect = lambda model: {
        f3versary_announcements.F3versaryAnnouncementSetting: region_query,
        f3versary_announcements.SlackSpace: space_query,
    }[model]
    monkeypatch.setattr(f3versary_announcements, "get_session", lambda: session)

    result = f3versary_announcements._create_run(
        org,
        10,
        config(channel="C1"),
        date(2026, 9, 1),
        date(2026, 9, 15),
        f3versary_announcements.build_f3versary_messages([candidate()], date(2026, 9, 15)),
    )

    assert result is None
    region_query.filter.return_value.with_for_update.assert_called_once()
    session.add.assert_not_called()
    session.commit.assert_not_called()


def test_unexpected_error_logs_safe_stack_without_exception_message(monkeypatch, caplog):
    records = [slack_record()]
    FakeOutbox(monkeypatch, records[0][2])
    monkeypatch.setattr(f3versary_announcements.DbManager, "find_join_records3", lambda *args, **kwargs: records)

    def fail_run_read(*args, **kwargs):
        raise RuntimeError("private member name and token must not be logged")

    monkeypatch.setattr(f3versary_announcements, "_run_for_date", fail_run_read)

    f3versary_announcements.send_f3versary_announcements(force=True, now_cst=datetime(2026, 9, 1, 18))

    assert "error_type=RuntimeError" in caplog.text
    assert "fail_run_read" in caplog.text
    assert "private member name" not in caplog.text
