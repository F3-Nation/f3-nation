"""A failure caught inside a scheduled job or one of its buttons is logged as a fixed event with IDs only.

Each test makes the job's Slack or database call raise an error whose message, request and response carry
synthetic sensitive markers, then checks that none of them reached the output and that the job carried on
as before.
"""

import logging
from datetime import datetime
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

from scripts import auto_preblast_send, backblast_reminders, home_region_nudge, preblast_reminders, q_lineups
from tests import log_privacy
from utilities.database.orm import SlackSettings
from utilities.helper_functions import current_date_cst

ERRORS = [log_privacy.slack_error, log_privacy.database_error, lambda: RuntimeError(log_privacy.SENSITIVE_TEXT)]


def _reminder(event_id: int, slack_user_id: str):
    return SimpleNamespace(
        event=SimpleNamespace(id=event_id, start_date=current_date_cst(), meta={}, series_exception=None),
        event_type=SimpleNamespace(name="Bootcamp"),
        org=SimpleNamespace(name="AO"),
        parent_org=SimpleNamespace(name="Region"),
        q_name="Synthetic Member Name",
        q_avatar_url=None,
        slack_avatar_url=None,
        slack_user_id=slack_user_id,
        slack_settings=SlackSettings(team_id="T123"),
    )


@pytest.mark.parametrize("make_error", ERRORS)
@pytest.mark.parametrize(
    "module,list_class,send,event",
    [
        (
            backblast_reminders,
            "BackblastList",
            backblast_reminders.send_backblast_reminders,
            "slack.backblast_reminders.dm_failed",
        ),
        (
            preblast_reminders,
            "PreblastList",
            preblast_reminders.send_preblast_reminders,
            "slack.preblast_reminders.dm_failed",
        ),
    ],
)
def test_failed_reminder_dm_logs_privately_and_reminds_the_next_q(
    monkeypatch, caplog, capsys, module, list_class, send, event, make_error
):
    items = [_reminder(11, "U_SYNTHETIC_FIRST"), _reminder(12, "U_SYNTHETIC_NEXT")]

    def pull_data(self, *args, **kwargs):
        self.items = items

    monkeypatch.setattr(getattr(module, list_class), "pull_data", pull_data)
    monkeypatch.setattr(module, "datetime", SimpleNamespace(now=lambda tz: datetime(2026, 9, 1, 10)))
    client = MagicMock()
    client.chat_postMessage.side_effect = [make_error(), {"ok": True}]
    monkeypatch.setattr(module, "slack_client_for_team", lambda *args, **kwargs: client)

    send(force=True)

    output = log_privacy.assert_private(caplog, capsys)
    assert "U_SYNTHETIC_FIRST" not in output
    (record,) = log_privacy.error_events(caplog, event)
    assert record.json_fields["team_id"] == "T123"
    assert record.json_fields["event_id"] == 11
    assert [call.kwargs["channel"] for call in client.chat_postMessage.call_args_list] == [
        "U_SYNTHETIC_FIRST",
        "U_SYNTHETIC_NEXT",
    ]


def _dismiss_body():
    return {"actions": [{"value": "55"}], "channel": {"id": "D123"}, "message": {"ts": "1700000000.000100"}}


def test_failed_backblast_dismiss_lookup_logs_privately_and_changes_nothing(monkeypatch, caplog, capsys):
    db = backblast_reminders.DbManager
    monkeypatch.setattr(db, "get", MagicMock(side_effect=log_privacy.database_error()))
    update = MagicMock()
    monkeypatch.setattr(db, "update_record", update)
    client = MagicMock()

    backblast_reminders.handle_backblast_reminder_dismiss(
        _dismiss_body(), client, logging.getLogger("tests.dismiss"), {}, SlackSettings(team_id="T123")
    )

    log_privacy.assert_private(caplog, capsys)
    (record,) = log_privacy.error_events(caplog, "slack.backblast_reminders.event_lookup_failed")
    assert record.json_fields["event_id"] == "55"
    update.assert_not_called()
    client.chat_update.assert_not_called()


def test_failed_backblast_dismiss_message_update_logs_privately_and_keeps_dismissal(monkeypatch, caplog, capsys):
    db = backblast_reminders.DbManager
    monkeypatch.setattr(db, "get", lambda cls, event_id: SimpleNamespace(meta={"other": 1}))
    update = MagicMock()
    monkeypatch.setattr(db, "update_record", update)
    client = MagicMock()
    client.chat_update.side_effect = log_privacy.slack_error("message_not_found")

    backblast_reminders.handle_backblast_reminder_dismiss(
        _dismiss_body(), client, logging.getLogger("tests.dismiss"), {}, SlackSettings(team_id="T123")
    )

    log_privacy.assert_private(caplog, capsys)
    (record,) = log_privacy.error_events(caplog, "slack.backblast_reminders.dismiss_update_failed")
    assert record.json_fields["event_id"] == "55"
    assert record.json_fields["slack_error"] == "message_not_found"
    update.assert_called_once()
    assert update.call_args.args[2] == {
        backblast_reminders.EventInstance.meta: {"other": 1, "backblast_reminder_dismissed": True}
    }


@pytest.fixture
def lineup(monkeypatch):
    """`send_q_lineup_message` for one region posting to C123, returning (client, org, update_record, send)."""
    client = MagicMock()
    monkeypatch.setattr(q_lineups, "slack_client_for_team", lambda *args, **kwargs: client)
    update = MagicMock()
    monkeypatch.setattr(q_lineups.DbManager, "update_record", update)
    org = SimpleNamespace(id=21, name="Region", meta={})
    settings = SlackSettings(team_id="T123", send_q_lineups_method="yes_for_all", send_q_lineups_channel="C123")
    return client, org, update, lambda: q_lineups.send_q_lineup_message(org, [], settings)


@pytest.mark.parametrize("make_error", ERRORS)
def test_failed_lineup_send_logs_privately_then_joins_and_resends(lineup, caplog, capsys, make_error):
    client, org, update, send = lineup
    client.chat_postMessage.side_effect = [make_error(), {"ts": "1700000000.000200"}]

    send()

    log_privacy.assert_private(caplog, capsys)
    (record,) = log_privacy.error_events(caplog, "slack.q_lineups.send_failed_retrying")
    assert (record.json_fields["team_id"], record.json_fields["org_id"]) == ("T123", 21)
    assert not log_privacy.error_events(caplog, "slack.q_lineups.send_failed")
    client.conversations_join.assert_called_once_with(channel="C123")
    assert org.meta == {"q_lineup_ts": "1700000000.000200"}


def test_failed_lineup_resend_logs_privately_and_stops(lineup, caplog, capsys):
    client, org, update, send = lineup
    client.chat_postMessage.side_effect = [log_privacy.slack_error("not_in_channel"), log_privacy.database_error()]

    send()

    log_privacy.assert_private(caplog, capsys)
    (retrying,) = log_privacy.error_events(caplog, "slack.q_lineups.send_failed_retrying")
    assert retrying.json_fields["slack_error"] == "not_in_channel"
    (failed,) = log_privacy.error_events(caplog, "slack.q_lineups.send_failed")
    assert (failed.json_fields["org_id"], failed.json_fields["error_type"]) == (21, "StatementError")
    assert client.chat_postMessage.call_count == 2
    update.assert_not_called()


@pytest.mark.parametrize("make_error", ERRORS)
def test_failed_automated_preblast_logs_privately_and_sends_the_next(monkeypatch, caplog, capsys, make_error):
    items = [
        SimpleNamespace(
            event=SimpleNamespace(id=event_id, meta={}, preblast=None, series_exception=None),
            q_name="Synthetic Member Name",
            slack_settings=SlackSettings(team_id="T123", automated_preblast_option="all"),
        )
        for event_id in (31, 32)
    ]

    def pull_data(self, *args, **kwargs):
        self.items = items

    monkeypatch.setattr(auto_preblast_send.PreblastList, "pull_data", pull_data)
    monkeypatch.setattr(auto_preblast_send, "slack_client_for_team", lambda *args, **kwargs: MagicMock())
    sent = []

    def send_preblast(event_instance_id, **kwargs):
        sent.append(event_instance_id)
        if event_instance_id == 31:
            raise make_error()

    monkeypatch.setattr(auto_preblast_send.event_preblast, "send_preblast", send_preblast)

    auto_preblast_send.send_automated_preblasts(force=True)

    log_privacy.assert_private(caplog, capsys)
    (record,) = log_privacy.error_events(caplog, "slack.auto_preblast.send_failed")
    assert (record.json_fields["team_id"], record.json_fields["event_id"]) == ("T123", 31)
    assert sent == [31, 32]


@pytest.mark.parametrize(
    "handler,event,expected_update",
    [
        (
            home_region_nudge.handle_home_region_switch,
            "slack.home_region_nudge.switch_update_failed",
            {home_region_nudge.User.home_region_id: 300},
        ),
        (home_region_nudge.handle_home_region_dismiss, "slack.home_region_nudge.dismiss_update_failed", None),
        (
            home_region_nudge.handle_home_region_opt_out,
            "slack.home_region_nudge.opt_out_update_failed",
            {home_region_nudge.User.meta: {home_region_nudge.USER_META_NUDGE_OPT_OUT: True}},
        ),
    ],
)
def test_failed_home_region_message_update_logs_privately_and_keeps_the_choice(
    monkeypatch, caplog, capsys, handler, event, expected_update
):
    db = home_region_nudge.DbManager
    monkeypatch.setattr(
        db, "find_first_record", lambda *args, **kwargs: SimpleNamespace(user_id=41, slack_id="U_SYNTHETIC_MEMBER")
    )
    monkeypatch.setattr(
        db,
        "get",
        lambda cls, record_id: SimpleNamespace(id=record_id, meta=None, name="Synthetic Member Name"),
    )
    update = MagicMock()
    monkeypatch.setattr(db, "update_record", update)
    client = MagicMock()
    client.chat_update.side_effect = log_privacy.slack_error("message_not_found")
    body = {
        "actions": [{"value": "300"}],
        "user": {"id": "U_SYNTHETIC_MEMBER", "team_id": "T123"},
        "team": {"id": "T123"},
        "channel": {"id": "D123"},
        "message": {"ts": "1700000000.000300"},
    }

    handler(body, client, logging.getLogger("tests.home_region"), {}, None)

    output = log_privacy.assert_private(caplog, capsys)
    assert "U_SYNTHETIC_MEMBER" not in output
    (record,) = log_privacy.error_events(caplog, event)
    assert record.json_fields["team_id"] == "T123"
    assert record.json_fields["slack_error"] == "message_not_found"
    if expected_update is None:
        update.assert_not_called()
    else:
        update.assert_called_once_with(home_region_nudge.User, 41, expected_update)
        assert record.json_fields["user_id"] == 41
