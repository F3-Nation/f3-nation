import logging
import os
import sys
from unittest.mock import MagicMock

import pytest
from slack_sdk.errors import SlackApiError

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from utilities.slack.orm import (
    BlockView,
    CheckboxInputElement,
    ContainerBlock,
    DividerBlock,
    InputBlock,
    SectionBlock,
    as_selector_options,
)


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


def _container_with_checkbox() -> BlockView:
    return BlockView(
        blocks=[
            ContainerBlock(
                action="filters",
                label="Filters (1 active)",
                is_collapsible=True,
                default_collapsed=True,
                child_blocks=[
                    InputBlock(
                        label="Options",
                        action="options",
                        element=CheckboxInputElement(options=as_selector_options(["A", "B"], ["a", "b"])),
                        dispatch_action=True,
                    ),
                ],
            ),
            SectionBlock(label="after"),
        ]
    )


def test_container_block_renders_collapsible_payload_with_children():
    payload = _container_with_checkbox().as_form_field()[0]

    assert payload["type"] == "container"
    assert payload["block_id"] == "filters"
    assert payload["title"] == {"type": "plain_text", "text": "Filters (1 active)", "emoji": True}
    assert payload["is_collapsible"] is True
    assert payload["default_collapsed"] is True
    assert [child["type"] for child in payload["child_blocks"]] == ["input"]
    assert payload["child_blocks"][0]["block_id"] == "options"


def test_container_block_omits_default_collapsed_when_expanded():
    view = _container_with_checkbox()
    view.blocks[0].default_collapsed = False

    payload = view.as_form_field()[0]

    assert "default_collapsed" not in payload


def test_block_view_reads_and_sets_values_for_inputs_inside_a_container():
    view = _container_with_checkbox()
    body = {
        "view": {
            "blocks": [],
            "state": {"values": {"options": {"options": {"type": "checkboxes", "selected_options": [{"value": "b"}]}}}},
        }
    }

    assert view.get_selected_values(body) == {"options": ["b"]}

    view.set_initial_values({"options": ["a"]})
    child = view.as_form_field()[0]["child_blocks"][0]
    assert child["element"]["initial_options"][0]["value"] == "a"
