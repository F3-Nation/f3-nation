import os
import sys
from unittest.mock import MagicMock, patch

import pytest
from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from features import backblast, positions
from features.calendar import ao, event_instance, home, series
from main import main_response
from utilities.routing import MAIN_MAPPER
from utilities.slack import actions


@pytest.mark.parametrize(
    ("action_prefix", "suffix", "expected_handler", "add_loading"),
    [
        (actions.BACKBLAST_NEW_BLANK_BUTTON, "", backblast.build_backblast_form, True),
        (actions.EVENT_PREBLAST_NEW_BUTTON, "", home.handle_event_preblast_select_button, False),
        (actions.AO_EDIT_DELETE, "_7", ao.handle_ao_edit_delete, False),
        (actions.EVENT_INSTANCE_EDIT_DELETE, "_7", event_instance.handle_event_instance_edit_delete, False),
        (actions.SERIES_EDIT_DELETE, "_7", series.handle_series_edit_delete, False),
        (actions.POSITION_EDIT_DELETE, "_7", positions.handle_position_edit_delete, False),
    ],
)
def test_restored_confirmation_actions_preserve_dispatch_contract(action_prefix, suffix, expected_handler, add_loading):
    assert MAIN_MAPPER["block_actions"][action_prefix] == (expected_handler, add_loading, False)
    events = []
    ack = MagicMock(side_effect=lambda: events.append("ack"))
    handler = MagicMock(side_effect=lambda **_: events.append("handler"))
    loading_form = MagicMock(side_effect=lambda **_: events.append("loading") or "V_LOADING")
    region = MagicMock()
    logger = MagicMock()
    client = MagicMock()
    context = {}
    action = {"action_id": action_prefix + suffix}
    if suffix:
        action["selected_option"] = {"value": "Delete"}
    else:
        action["value"] = "New Unscheduled Event"
    body = {
        "type": "block_actions",
        "team": {"id": "T_TEST"},
        "view": {"id": "V_PARENT"},
        "actions": [action],
    }

    with (
        patch.dict(MAIN_MAPPER["block_actions"], {action_prefix: (handler, add_loading, False)}),
        patch("main.add_loading_form", loading_form),
        patch("main.get_region_record", return_value=region),
    ):
        main_response(body, logger, client, ack, context)

    ack.assert_called_once_with()
    handler.assert_called_once_with(body=body, client=client, logger=logger, context=context, region_record=region)
    if add_loading:
        loading_form.assert_called_once_with(body=body, client=client)
        assert body[actions.LOADING_ID] == "V_LOADING"
        assert events == ["ack", "loading", "handler"]
    else:
        loading_form.assert_not_called()
        assert events == ["ack", "handler"]


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
