import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import fng
from utilities import constants
from utilities.database.orm import SlackSettings

INVITE_LINK = "https://join.slack.com/t/f3boone/shared_invite/abc"


def region_record(**overrides):
    fields = {
        "team_id": "T1",
        "org_id": 8,
        "workspace_name": "F3 Boone",
        "welcome_channel": "C_WELCOME",
        "welcome_channel_enable": 1,
        "downrange_invite_link": INVITE_LINK,
    }
    fields.update(overrides)
    return SlackSettings(**fields)


def submission(brought_by=None, **values):
    fields = {
        fng.FNG_FIRST_NAME: "John",
        fng.FNG_LAST_NAME: "Smith",
        fng.FNG_F3_NAME: "Chip",
        fng.FNG_EMAIL: " John@Example.com ",
        fng.FNG_PHONE: "828-555-0100",
    }
    fields.update(values)
    state = {action: {action: {"value": value}} for action, value in fields.items()}
    if brought_by:
        state[fng.USER_FORM_BROUGHT_BY] = {fng.USER_FORM_BROUGHT_BY: {"selected_option": {"value": str(brought_by)}}}
    return {"user": {"id": "U_BUDDY"}, "view": {"id": "V1", "state": {"values": state}}, "submission_view_id": "V1"}


def patch_db(monkeypatch, existing_user=None, buddy_user_id=7):
    monkeypatch.setenv("SLACKBOT_ENV", "production")
    db = SimpleNamespace(
        find_records=MagicMock(return_value=[existing_user] if existing_user else []),
        create_record=MagicMock(),
        get=MagicMock(return_value=SimpleNamespace(name="Boone")),
    )
    for name, mock in vars(db).items():
        monkeypatch.setattr(fng.DbManager, name, mock)
    monkeypatch.setattr(fng, "get_user", MagicMock(return_value=SimpleNamespace(user_id=buddy_user_id)))
    send = MagicMock(return_value=True)
    monkeypatch.setattr(fng, "send_via_sendgrid", send)
    view = MagicMock()
    monkeypatch.setattr(fng, "update_submission_wait_view", view)
    return db, send, view


def test_creates_profile_and_emails_invite_without_posting_welcome(monkeypatch):
    db, send, view = patch_db(monkeypatch)
    client = MagicMock()

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    user = db.create_record.call_args.args[0]
    assert (user.email, user.first_name, user.last_name, user.f3_name) == ("john@example.com", "John", "Smith", "Chip")
    assert user.home_region_id == 8 and user.phone == "828-555-0100"
    assert user.meta == {"battle_buddy": 7}  # running /fng doesn't mean he EH'd him
    assert send.call_args.kwargs["to_email"] == "john@example.com"
    assert INVITE_LINK in send.call_args.kwargs["html_content"]
    client.chat_postMessage.assert_not_called()  # team_join welcomes him once he joins
    assert "Chip (John S.)" in view.call_args.kwargs["text"]
    assert view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS
    assert view.call_args.kwargs["view_id"] == "V1"


def test_brought_by_is_whoever_was_picked(monkeypatch):
    db, _, _ = patch_db(monkeypatch)

    fng.handle_fng_form(submission(brought_by=42), MagicMock(), MagicMock(), {}, region_record())

    assert db.create_record.call_args.args[0].meta == {"battle_buddy": 7, "brought_by": 42}


def test_existing_user_is_left_alone(monkeypatch):
    db, send, view = patch_db(monkeypatch, existing_user=SimpleNamespace(id=99, first_name="Jonathan"))
    client = MagicMock()

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    db.create_record.assert_not_called()
    send.assert_called_once()
    html_content = send.call_args.kwargs["html_content"]
    assert "Jonathan!" in html_content and "John!" not in html_content
    client.chat_postMessage.assert_not_called()
    assert "already had an F3 Nation profile" in view.call_args.kwargs["text"]


def test_outside_production_contact_details_go_to_the_sink(monkeypatch):
    db, send, _ = patch_db(monkeypatch)
    monkeypatch.setenv("SLACKBOT_ENV", "staging")

    fng.handle_fng_form(submission(), MagicMock(), MagicMock(), {}, region_record())

    user = db.create_record.call_args.args[0]
    assert user.email.startswith("dev.staging-email-sink+fng-") and user.email.endswith("@f3nation.com")
    assert user.phone is None
    assert send.call_args.kwargs["to_email"] == user.email


def test_failed_buddy_lookup_shows_error_and_creates_nothing(monkeypatch):
    db, send, view = patch_db(monkeypatch)
    fng.get_user.side_effect = RuntimeError("boom")

    fng.handle_fng_form(submission(), MagicMock(), MagicMock(), {}, region_record())

    db.create_record.assert_not_called()
    send.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_without_invite_link_no_email_goes_out(monkeypatch):
    db, send, view = patch_db(monkeypatch)

    fng.handle_fng_form(submission(), MagicMock(), MagicMock(), {}, region_record(downrange_invite_link=None))

    db.create_record.assert_called_once()
    send.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.WARNING
    assert "Downrange" in view.call_args.kwargs["text"]


def test_failed_email_dms_the_buddy_the_link(monkeypatch):
    _, send, view = patch_db(monkeypatch)
    send.return_value = False
    client = MagicMock()

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    dm = client.chat_postMessage.call_args.kwargs
    assert dm["channel"] == "U_BUDDY" and INVITE_LINK in dm["text"]
    assert view.call_args.kwargs["level"] == constants.AlertLevel.WARNING
    assert "DMed you" in view.call_args.kwargs["text"] and INVITE_LINK not in view.call_args.kwargs["text"]


def test_failed_email_and_dm_fall_back_to_the_link_in_the_result(monkeypatch):
    _, send, view = patch_db(monkeypatch)
    send.return_value = False
    client = MagicMock()
    client.chat_postMessage.side_effect = SlackApiError("cannot_dm", {"error": "cannot_dm_bot"})

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    assert INVITE_LINK in view.call_args.kwargs["text"]


def test_unlinked_workspace_creates_nothing(monkeypatch):
    db, send, view = patch_db(monkeypatch)

    fng.handle_fng_form(submission(), MagicMock(), MagicMock(), {}, region_record(org_id=None))

    db.create_record.assert_not_called()
    send.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_failed_user_create_shows_error_and_sends_nothing(monkeypatch):
    db, send, view = patch_db(monkeypatch)
    db.create_record.side_effect = RuntimeError("duplicate key")
    client = MagicMock()

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    send.assert_not_called()
    client.chat_postMessage.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_blank_names_create_nothing(monkeypatch):
    db, send, view = patch_db(monkeypatch)

    fng.handle_fng_form(submission(**{fng.FNG_FIRST_NAME: "   "}), MagicMock(), MagicMock(), {}, region_record())

    db.create_record.assert_not_called()
    send.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_form_asks_only_for_the_fngs_details():
    client = MagicMock()

    fng.build_fng_form({"loading_id": "V_LOADING"}, client, MagicMock(), {}, region_record())

    view = client.views_update.call_args.kwargs
    assert view["view_id"] == "V_LOADING"
    assert view["view"]["callback_id"] == fng.FNG_CALLBACK_ID
    inputs = [b["block_id"] for b in view["view"]["blocks"] if b["type"] == "input"]
    assert inputs == [
        fng.FNG_FIRST_NAME,
        fng.FNG_LAST_NAME,
        fng.FNG_F3_NAME,
        fng.FNG_EMAIL,
        fng.FNG_PHONE,
        fng.USER_FORM_BROUGHT_BY,
    ]
