import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import emergency
from utilities import sendmail


@pytest.fixture
def user():
    return SimpleNamespace(
        email="emergency-test@example.invalid",
        f3_name="Synthetic PAX",
        emergency_contact="Synthetic Contact",
        emergency_phone="202-555-0100",
        emergency_notes="Synthetic emergency notes",
        meta={},
    )


def test_unconfigured_transport_reports_no_submission(monkeypatch, user):
    monkeypatch.delenv("SENDGRID_API_KEY", raising=False)
    monkeypatch.delenv("EMAIL_SERVER", raising=False)

    assert sendmail.send_via_sendgrid(user.email, "Synthetic subject", "Synthetic body") is False


@pytest.mark.parametrize("send_result", [True, False])
def test_notification_propagates_submission_result(monkeypatch, user, send_result):
    send = MagicMock(return_value=send_result)
    monkeypatch.setattr(emergency, "send_via_sendgrid", send)

    assert emergency._notify_user_of_access(user, "Synthetic Accessor", True, "Test Region") is send_result

    send.assert_called_once()
    assert send.call_args.kwargs["to_email"] == user.email
    assert send.call_args.kwargs["from_email"] == "F3 Nation Slackbot Support <support.slackbot@f3nation.com>"
    assert send.call_args.kwargs["subject"] == "F3 Nation - Your Emergency Information Was Accessed"


@pytest.mark.parametrize("email", [None, ""])
def test_missing_email_skips_notification(monkeypatch, user, email):
    user.email = email
    send = MagicMock()
    monkeypatch.setattr(emergency, "send_via_sendgrid", send)

    assert emergency._notify_user_of_access(user, "Synthetic Accessor", True, "Test Region") is False

    send.assert_not_called()


@pytest.mark.parametrize("is_local", [True, False])
@pytest.mark.parametrize(
    ("email", "send_result", "expected_status"),
    [
        (
            "emergency-test@example.invalid",
            True,
            ":warning: An email notification about this access was submitted for delivery.",
        ),
        (
            "emergency-test@example.invalid",
            False,
            ":warning: Email notification about this access could not be confirmed.",
        ),
        (
            None,
            False,
            ":warning: No email notification was sent because this user has no email address on file.",
        ),
        (
            "",
            False,
            ":warning: No email notification was sent because this user has no email address on file.",
        ),
    ],
)
def test_emergency_details_remain_available_with_truthful_notification_status(
    monkeypatch, user, is_local, email, send_result, expected_status
):
    user.email = email
    send = MagicMock(return_value=send_result)
    monkeypatch.setattr(emergency, "send_via_sendgrid", send)
    monkeypatch.setattr(emergency, "add_loading_form", MagicMock(return_value="V_LOADING"))
    monkeypatch.setattr(emergency, "get_user", MagicMock(return_value=SimpleNamespace(user_name="Synthetic Accessor")))
    monkeypatch.setattr(emergency.DbManager, "get", MagicMock(return_value=SimpleNamespace(name="Test Region")))
    client = MagicMock()

    emergency._show_emergency_info_modal(
        client,
        {"user": {"id": "U_SYNTHETIC"}},
        user,
        is_local,
        SimpleNamespace(org_id=10),
        MagicMock(),
    )

    client.views_update.assert_called_once()
    assert client.views_update.call_args.kwargs["view_id"] == "V_LOADING"
    view = client.views_update.call_args.kwargs["view"]
    assert view["callback_id"] == emergency.EMERGENCY_INFO_CALLBACK_ID
    sections = [block["text"]["text"] for block in view["blocks"] if block["type"] == "section"]
    assert sections == [
        "*Emergency Contact:* Synthetic Contact",
        "*Phone:* 202-555-0100",
        "*Notes:* Synthetic emergency notes",
    ]
    assert view["blocks"][-1]["elements"][0]["text"] == expected_status
    client.views_push.assert_not_called()
    if email:
        send.assert_called_once()
        assert send.call_args.kwargs["to_email"] == email
        access_type = "local Slack workspace" if is_local else "downrange search from Test Region"
        assert access_type in send.call_args.kwargs["html_content"]
    else:
        send.assert_not_called()


def test_search_warning_describes_notification_attempt():
    warning = emergency.EMERGENCY_SEARCH_FORM.as_form_field()[1]["elements"][0]["text"]

    assert "will attempt to email" in warning
    assert "Only use this feature in genuine emergency situations." in warning


def test_downrange_access_still_requires_sharing_opt_in(monkeypatch, user):
    monkeypatch.setattr(emergency.DbManager, "get", MagicMock(return_value=user))
    show_info = MagicMock()
    send = MagicMock()
    monkeypatch.setattr(emergency, "_show_emergency_info_modal", show_info)
    monkeypatch.setattr(emergency, "send_via_sendgrid", send)
    client = MagicMock()

    emergency.handle_dr_user_select(
        {"actions": [{"selected_option": {"value": "42"}}], "trigger_id": "T_SYNTHETIC"},
        client,
        MagicMock(),
        {},
        SimpleNamespace(org_id=10),
    )

    show_info.assert_not_called()
    send.assert_not_called()
    client.views_update.assert_not_called()
    client.views_push.assert_called_once()
    error = client.views_push.call_args.kwargs["view"]["blocks"][0]["text"]["text"]
    assert "has not enabled downrange emergency info sharing" in error
