import os
import sys
from unittest.mock import MagicMock

from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from utilities.builders import send_error_response
from utilities.slack import actions


def test_send_error_response_replaces_loading_modal():
    client = MagicMock()
    client.views_update.return_value = {"ok": True}

    send_error_response(
        body={actions.LOADING_ID: "V_LOADING", "user": {"id": "U_TEST"}},
        client=client,
        error="Something went wrong.",
    )

    client.views_update.assert_called_once()
    assert client.views_update.call_args.kwargs["view_id"] == "V_LOADING"
    error_view = client.views_update.call_args.kwargs["view"]
    assert error_view["title"]["text"] == "F3 Nation Error"
    assert "Something went wrong." in str(error_view["blocks"])
    client.chat_postMessage.assert_not_called()


def test_send_error_response_falls_back_to_dm_when_loading_modal_update_fails():
    client = MagicMock()
    client.views_update.side_effect = SlackApiError(
        "Slack rejected modal",
        {"error": "invalid_arguments"},
    )

    send_error_response(
        body={actions.LOADING_ID: "V_LOADING", "user": {"id": "U_TEST"}},
        client=client,
        error="Something went wrong.",
    )

    client.chat_postMessage.assert_called_once()
    assert client.chat_postMessage.call_args.kwargs["channel"] == "U_TEST"
    assert client.chat_postMessage.call_args.kwargs["text"] == "Something went wrong."
    assert client.chat_postMessage.call_args.kwargs["blocks"]


def test_send_error_response_also_dms_when_loading_view_may_be_behind_another_modal():
    client = MagicMock()
    client.views_update.return_value = {"ok": True}

    send_error_response(
        body={
            actions.LOADING_ID: "V_LOADING",
            "view": {"id": "V_LOADING"},
            "user": {"id": "U_TEST"},
        },
        client=client,
        error="Something went wrong.",
    )

    client.views_update.assert_called_once()
    client.chat_postMessage.assert_called_once()
