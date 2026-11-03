import json
import logging
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
from google.cloud.logging_v2.handlers import StructuredLogHandler

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import emergency
from utilities import sendmail


@pytest.fixture
def user():
    return SimpleNamespace(
        id=42,
        email="emergency-test@example.invalid",
        f3_name="Synthetic PAX",
        emergency_contact="Synthetic Contact",
        emergency_phone="202-555-0100",
        emergency_notes="Synthetic emergency notes",
        meta={},
    )


def test_unconfigured_transport_keeps_emergency_details_and_reports_unconfirmed_notification(monkeypatch, user, caplog):
    monkeypatch.delenv("EMAIL_SERVER", raising=False)
    smtp = MagicMock(side_effect=AssertionError("SMTP must not open without configuration"))
    smtp_ssl = MagicMock(side_effect=AssertionError("SMTP_SSL must not open without configuration"))
    monkeypatch.setattr(sendmail.smtplib, "SMTP", smtp)
    monkeypatch.setattr(sendmail.smtplib, "SMTP_SSL", smtp_ssl)
    monkeypatch.setattr(emergency, "add_loading_form", MagicMock(return_value="V_LOADING"))
    monkeypatch.setattr(emergency, "get_user", MagicMock(return_value=SimpleNamespace(user_name="Synthetic Accessor")))
    monkeypatch.setattr(emergency.DbManager, "get", MagicMock(return_value=SimpleNamespace(name="Test Region")))
    client = MagicMock()
    logger = logging.getLogger(__name__)

    with caplog.at_level(logging.WARNING, logger=logger.name):
        emergency._show_emergency_info_modal(
            client,
            {"user": {"id": "U_SYNTHETIC"}},
            user,
            True,
            SimpleNamespace(org_id=10),
            logger,
        )

    smtp.assert_not_called()
    smtp_ssl.assert_not_called()
    client.views_update.assert_called_once()
    assert client.views_update.call_args.kwargs["view_id"] == "V_LOADING"
    view = client.views_update.call_args.kwargs["view"]
    assert view["callback_id"] == emergency.EMERGENCY_INFO_CALLBACK_ID
    contexts = [block["elements"][0]["text"] for block in view["blocks"] if block["type"] == "context"]
    assert contexts == [
        ":x: The email notification about this access may not have been sent. "
        "Please let the member or your region leadership know you viewed their emergency info."
    ]
    assert all("submitted for delivery" not in status for status in contexts)
    sections = [block["text"]["text"] for block in view["blocks"] if block["type"] == "section"]
    assert sections == [
        "*Emergency Contact:* Synthetic Contact",
        "*Phone:* 202-555-0100",
        "*Notes:* Synthetic emergency notes",
    ]
    client.views_push.assert_not_called()
    records = [record for record in caplog.records if record.name == logger.name]
    assert len(records) == 1
    assert records[0].levelno == logging.WARNING
    assert records[0].json_fields == {
        "event": "slackbot.emergency.access_notification_unconfirmed",
        "reason": "send_unconfirmed",
        "accessed_user_id": 42,
        "region_org_id": 10,
        "is_local": True,
    }


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
            ":email: An email notification about this access was submitted for delivery.",
        ),
        (
            "emergency-test@example.invalid",
            False,
            ":x: The email notification about this access may not have been sent. "
            "Please let the member or your region leadership know you viewed their emergency info.",
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
    monkeypatch, user, caplog, is_local, email, send_result, expected_status
):
    user.email = email
    send = MagicMock(return_value=send_result)
    monkeypatch.setattr(emergency, "send_via_sendgrid", send)
    monkeypatch.setattr(emergency, "add_loading_form", MagicMock(return_value="V_LOADING"))
    monkeypatch.setattr(emergency, "get_user", MagicMock(return_value=SimpleNamespace(user_name="Synthetic Accessor")))
    monkeypatch.setattr(emergency.DbManager, "get", MagicMock(return_value=SimpleNamespace(name="Test Region")))
    client = MagicMock()
    logger = logging.getLogger(__name__)

    with caplog.at_level(logging.WARNING, logger=logger.name):
        emergency._show_emergency_info_modal(
            client,
            {"user": {"id": "U_SYNTHETIC"}},
            user,
            is_local,
            SimpleNamespace(org_id=10),
            logger,
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
    contexts = [block["elements"][0]["text"] for block in view["blocks"] if block["type"] == "context"]
    assert contexts == [expected_status]
    client.views_push.assert_not_called()
    if email:
        send.assert_called_once()
        assert send.call_args.kwargs["to_email"] == email
        access_type = "local Slack workspace" if is_local else "downrange search from Test Region"
        assert access_type in send.call_args.kwargs["html_content"]
    else:
        send.assert_not_called()

    records = [record for record in caplog.records if record.name == logger.name]
    if send_result:
        assert records == []
    else:
        assert len(records) == 1
        record = records[0]
        reason = "send_unconfirmed" if email else "no_email"
        expected_fields = {
            "event": "slackbot.emergency.access_notification_unconfirmed",
            "reason": reason,
            "accessed_user_id": 42,
            "region_org_id": 10,
            "is_local": is_local,
        }
        expected_message = (
            "slackbot.emergency.access_notification_unconfirmed "
            f"reason={reason} accessed_user_id=42 region_org_id=10 is_local={is_local}"
        )
        assert record.levelno == logging.WARNING
        assert record.getMessage() == expected_message
        assert record.json_fields == expected_fields
        assert record.exc_info is None
        assert record.stack_info is None
        recorded = json.dumps(record.__dict__, default=str)
        handler = StructuredLogHandler()
        try:
            assert handler.filter(record)
            serialized = handler.format(record)
        finally:
            handler.close()
        payload = json.loads(serialized)
        assert {field: payload[field] for field in expected_fields} == expected_fields
        assert payload["message"] == expected_message
        assert payload["severity"] == "WARNING"
        for private_value in (
            "emergency-test@example.invalid",
            "Synthetic PAX",
            "Synthetic Contact",
            "202-555-0100",
            "Synthetic emergency notes",
            "Synthetic Accessor",
            "Test Region",
            "U_SYNTHETIC",
        ):
            assert private_value not in recorded
            assert private_value not in serialized


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
