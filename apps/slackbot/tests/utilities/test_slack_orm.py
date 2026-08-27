import logging
import os
import sys
from unittest.mock import MagicMock

import pytest
from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from utilities.slack.orm import BlockView, DividerBlock


def _slack_rejection() -> SlackApiError:
    return SlackApiError(
        "Slack rejected modal",
        {
            "error": "invalid_arguments",
            "response_metadata": {
                "messages": ["no more than 100 items allowed"],
            },
            "view": {"id": "V_SECRET"},
        },
    )


def test_update_modal_logs_sanitized_slack_error_and_preserves_legacy_suppression(caplog):
    client = MagicMock()
    client.views_update.side_effect = _slack_rejection()

    with caplog.at_level(logging.ERROR):
        result = BlockView(blocks=[DividerBlock()]).update_modal(
            client=client,
            view_id="V_SECRET",
            title_text="Calendar",
            callback_id="calendar",
        )

    assert result is None
    assert "slack.modal.update_failed error=invalid_arguments" in caplog.text
    assert "V_SECRET" not in caplog.text
    assert "no more than 100 items allowed" not in caplog.text


def test_update_modal_can_propagate_after_logging(caplog):
    client = MagicMock()
    client.views_update.side_effect = _slack_rejection()

    with caplog.at_level(logging.ERROR), pytest.raises(SlackApiError):
        BlockView(blocks=[DividerBlock()]).update_modal(
            client=client,
            view_id="V_SECRET",
            title_text="Calendar",
            callback_id="calendar",
            raise_on_error=True,
        )

    assert "slack.modal.update_failed error=invalid_arguments" in caplog.text
    assert "V_SECRET" not in caplog.text
