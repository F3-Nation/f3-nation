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


def submission(ao=True, **values):
    fields = {
        fng.FNG_FIRST_NAME: "John",
        fng.FNG_LAST_NAME: "Smith",
        fng.FNG_F3_NAME: "Chip",
        fng.FNG_EMAIL: " John@Example.com ",
        fng.FNG_PHONE: "828-555-0100",
    }
    fields.update(values)
    state = {action: {action: {"value": value}} for action, value in fields.items()}
    if ao:
        state[fng.FNG_AO] = {fng.FNG_AO: {"selected_option": {"value": "42", "text": {"text": "The Grove"}}}}
    return {"user": {"id": "U_BUDDY"}, "view": {"id": "V1", "state": {"values": state}}, "submission_view_id": "V1"}


def patch_db(monkeypatch, existing_user=None, buddy_user_id=7):
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


def test_creates_profile_emails_invite_and_posts_welcome(monkeypatch):
    db, send, view = patch_db(monkeypatch)
    client = MagicMock()

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    user = db.create_record.call_args.args[0]
    assert (user.email, user.first_name, user.last_name, user.f3_name) == ("john@example.com", "John", "Smith", "Chip")
    assert user.home_region_id == 8
    assert user.meta == {"brought_by": 7}
    assert send.call_args.kwargs["to_email"] == "john@example.com"
    assert INVITE_LINK in send.call_args.kwargs["html_content"]
    client.chat_postMessage.assert_called_once()
    post = client.chat_postMessage.call_args.kwargs
    assert post["channel"] == "C_WELCOME"
    assert "Chip (John S.)" in post["text"] and "*The Grove*" in post["text"] and "<@U_BUDDY>" in post["text"]
    assert "john@example.com" not in post["text"]
    assert view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS
    assert view.call_args.kwargs["view_id"] == "V1"


def test_existing_user_is_left_alone(monkeypatch):
    db, send, view = patch_db(monkeypatch, existing_user=SimpleNamespace(id=99))

    fng.handle_fng_form(submission(), MagicMock(), MagicMock(), {}, region_record())

    db.create_record.assert_not_called()
    send.assert_called_once()
    assert "already had an F3 Nation profile" in view.call_args.kwargs["text"]


def test_without_invite_link_no_email_goes_out(monkeypatch):
    db, send, view = patch_db(monkeypatch)

    fng.handle_fng_form(submission(), MagicMock(), MagicMock(), {}, region_record(downrange_invite_link=None))

    db.create_record.assert_called_once()
    send.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.WARNING
    assert "Downrange" in view.call_args.kwargs["text"]


def test_failed_email_shows_the_link_to_text_him(monkeypatch):
    _, send, view = patch_db(monkeypatch)
    send.return_value = False

    fng.handle_fng_form(submission(ao=False), MagicMock(), MagicMock(), {}, region_record(welcome_channel_enable=0))

    assert view.call_args.kwargs["level"] == constants.AlertLevel.WARNING
    assert INVITE_LINK in view.call_args.kwargs["text"]


def test_welcome_post_respects_welcome_channel_setting(monkeypatch):
    patch_db(monkeypatch)
    client = MagicMock()

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record(welcome_channel_enable=0))

    client.chat_postMessage.assert_not_called()


def test_unlinked_workspace_creates_nothing(monkeypatch):
    db, send, view = patch_db(monkeypatch)

    fng.handle_fng_form(submission(), MagicMock(), MagicMock(), {}, region_record(org_id=None))

    db.create_record.assert_not_called()
    send.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_form_lists_region_aos_alphabetically(monkeypatch):
    aos = [SimpleNamespace(id=2, name="the Grove"), SimpleNamespace(id=1, name="Anvil")]
    monkeypatch.setattr(fng.DbManager, "find_records", MagicMock(return_value=aos))
    client = MagicMock()

    fng.build_fng_form({"loading_id": "V_LOADING"}, client, MagicMock(), {}, region_record())

    view = client.views_update.call_args.kwargs
    assert view["view_id"] == "V_LOADING"
    assert view["view"]["callback_id"] == fng.FNG_CALLBACK_ID
    ao_block = next(b for b in view["view"]["blocks"] if b.get("block_id") == fng.FNG_AO)
    assert [o["value"] for o in ao_block["element"]["options"]] == ["1", "2"]


def test_failed_user_create_shows_error_and_sends_nothing(monkeypatch):
    db, send, view = patch_db(monkeypatch)
    db.create_record.side_effect = RuntimeError("duplicate key")
    client = MagicMock()

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    send.assert_not_called()
    client.chat_postMessage.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_welcome_post_escapes_typed_names(monkeypatch):
    patch_db(monkeypatch)
    client = MagicMock()
    body = submission(**{fng.FNG_F3_NAME: "<!channel>"})
    body["view"]["state"]["values"][fng.FNG_AO][fng.FNG_AO]["selected_option"]["text"]["text"] = "Rock & Roll"

    fng.handle_fng_form(body, client, MagicMock(), {}, region_record())

    text = client.chat_postMessage.call_args.kwargs["text"]
    assert "<!channel>" not in text and "&lt;!channel&gt;" in text
    assert "*Rock &amp; Roll*" in text and "<@U_BUDDY>" in text


def test_blank_names_create_nothing(monkeypatch):
    db, send, view = patch_db(monkeypatch)

    fng.handle_fng_form(submission(**{fng.FNG_FIRST_NAME: "   "}), MagicMock(), MagicMock(), {}, region_record())

    db.create_record.assert_not_called()
    send.assert_not_called()
    assert view.call_args.kwargs["level"] == constants.AlertLevel.ERROR


def test_failed_welcome_post_warns_the_buddy(monkeypatch):
    _, _, view = patch_db(monkeypatch)
    client = MagicMock()
    client.chat_postMessage.side_effect = SlackApiError("not_in_channel", {"error": "not_in_channel"})

    fng.handle_fng_form(submission(), client, MagicMock(), {}, region_record())

    assert view.call_args.kwargs["level"] == constants.AlertLevel.WARNING
    assert "couldn't post the welcome" in view.call_args.kwargs["text"]
