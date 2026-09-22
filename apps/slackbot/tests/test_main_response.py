import os
import sys
from unittest.mock import MagicMock, patch

from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from main import main_response


def test_calendar_shortcut_acknowledges_before_loading_form_and_handler():
    events = []
    ack = MagicMock(side_effect=lambda: events.append("ack"))
    add_loading_form = MagicMock(side_effect=lambda **_: events.append("loading"))
    handler = MagicMock(side_effect=lambda **_: events.append("handler"))
    body = {"type": "shortcut", "callback_id": "calendar_shortcut", "team": {"id": "T123"}}

    with (
        patch("main.MAIN_MAPPER", {"shortcut": {"calendar_shortcut": (handler, True, False)}}),
        patch("main.add_loading_form", add_loading_form),
        patch("main.get_region_record", return_value=MagicMock()),
    ):
        main_response(body, MagicMock(), MagicMock(), ack, {})

    assert events == ["ack", "loading", "handler"]
    ack.assert_called_once_with()


def test_handler_failure_does_not_log_normal_completion():
    ack = MagicMock()
    handler = MagicMock(side_effect=RuntimeError("handler failed"))
    logger = MagicMock()
    body = {"type": "shortcut", "callback_id": "calendar_shortcut", "team": {"id": "T123"}}

    with (
        patch("main.MAIN_MAPPER", {"shortcut": {"calendar_shortcut": (handler, True, False)}}),
        patch("main.add_loading_form", return_value="V_LOADING"),
        patch("main.get_region_record", return_value=MagicMock()),
        patch("main.send_error_response") as send_error_response,
    ):
        main_response(body, logger, MagicMock(), ack, {})

    send_error_response.assert_called_once()
    assert not any(" took " in call.args[0] for call in logger.info.call_args_list)


def test_request_logging_does_not_record_slack_payload():
    ack = MagicMock()
    handler = MagicMock()
    logger = MagicMock()
    body = {
        "command": "/f3-calendar",
        "token": "SECRET_VERIFICATION_TOKEN",
        "response_url": "https://hooks.slack.com/SECRET_RESPONSE_URL",
        "user_id": "U_SECRET",
        "team_id": "T_SECRET",
    }

    with (
        patch("main.MAIN_MAPPER", {"command": {"/f3-calendar": (handler, False, False)}}),
        patch("main.get_region_record", return_value=MagicMock()),
    ):
        main_response(body, logger, MagicMock(), ack, {})

    assert logger.info.call_args_list[0].args == ("slack.request.received type=%s", "command")
    logged_values = " ".join(str(value) for call in logger.info.call_args_list for value in call.args)
    assert "SECRET" not in logged_values
    assert "hooks.slack.com" not in logged_values


def test_slack_handler_failure_logs_only_sanitized_error_code():
    slack_error = SlackApiError(
        "Slack rejected modal",
        {
            "error": "invalid_arguments",
            "response_metadata": {"messages": ["payload contained SECRET_EVENT_NAME"]},
            "url": "https://slack.com/api/views.update",
        },
    )
    handler = MagicMock(side_effect=slack_error)
    logger = MagicMock()
    body = {"type": "shortcut", "callback_id": "calendar_shortcut", "team": {"id": "T123"}}

    with (
        patch("main.MAIN_MAPPER", {"shortcut": {"calendar_shortcut": (handler, True, False)}}),
        patch("main.add_loading_form", return_value="V_LOADING"),
        patch("main.get_region_record", return_value=MagicMock()),
        patch("main.send_error_response"),
    ):
        main_response(body, logger, MagicMock(), MagicMock(), {})

    logger.error.assert_called_once_with(
        "slack.api.handler_failed type=%s handler=%s error=%s",
        "shortcut",
        "MagicMock",
        "invalid_arguments",
    )
    logged_values = " ".join(str(value) for call in logger.error.call_args_list for value in call.args)
    assert "SECRET_EVENT_NAME" not in logged_values
    assert "slack.com/api" not in logged_values
