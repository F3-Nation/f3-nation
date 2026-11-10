import json
import os
import sys
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import downrange
from utilities.database.orm import SlackSettings
from utilities.slack import actions

INVITE_URL = "https://join.slack.com/t/f3boone/shared_invite/zt-abc"
SHARE_MESSAGE = (
    f"Join me on Slack -- it\u2019s a faster, simpler way to work. Sign up here, from any device: {INVITE_URL}"
)


def invite_link_element(client):
    blocks = client.views_update.call_args.kwargs["view"]["blocks"]
    return next(b for b in blocks if b.get("block_id") == actions.DOWNRANGE_INVITE_LINK)["element"]


@pytest.mark.parametrize(
    "saved, prefilled",
    [(INVITE_URL, INVITE_URL), (SHARE_MESSAGE, INVITE_URL), ("Join me on Slack", None), (None, None)],
)
def test_admin_form_uses_a_url_input_prefilled_only_with_a_valid_url(monkeypatch, saved, prefilled):
    # Slack rejects a url_text_input whose initial_value isn't a URL, which would keep the form from opening.
    monkeypatch.setattr(downrange, "_is_admin", MagicMock(return_value=True))
    client = MagicMock()

    downrange.build_downrange_menu(
        {actions.LOADING_ID: "V_LOADING"},
        client,
        MagicMock(),
        {},
        SlackSettings(team_id="T1", downrange_invite_link=saved),
    )

    element = invite_link_element(client)
    assert element["type"] == "url_text_input"
    assert element.get("initial_value") == prefilled


@pytest.mark.parametrize("submitted, stored", [(INVITE_URL, INVITE_URL), (SHARE_MESSAGE, INVITE_URL), (None, None)])
def test_saving_settings_stores_only_the_url(monkeypatch, submitted, stored):
    update = MagicMock()
    monkeypatch.setattr(downrange.DbManager, "update_records", update)
    monkeypatch.setattr(downrange, "update_local_region_records", MagicMock())
    link_state = {"type": "url_text_input", "value": submitted}
    body = {
        "view": {
            "private_metadata": json.dumps({"is_admin": True}),
            "blocks": [],
            "state": {"values": {actions.DOWNRANGE_INVITE_LINK: {actions.DOWNRANGE_INVITE_LINK: link_state}}},
        }
    }
    record = SlackSettings(team_id="T1")

    downrange.handle_downrange_settings(body, MagicMock(), MagicMock(), {}, record)

    assert record.downrange_invite_link == stored
    update.assert_called_once()


def test_approval_dm_sends_only_the_url_from_a_saved_share_message(monkeypatch):
    send = MagicMock()
    monkeypatch.setattr(downrange, "_get_space_for_team", MagicMock(return_value=MagicMock(bot_token="xoxb")))
    monkeypatch.setattr(downrange, "WebClient", MagicMock(return_value=send))
    body = {
        "message": {
            "metadata": {"event_payload": {"requester_team_id": "T_REQUESTER", "requester_user_id": "U1"}},
            "ts": "1",
        },
        "channel": {"id": "C1"},
        "user": {"id": "U_ADMIN"},
    }
    record = SlackSettings(team_id="T_TARGET", org_id=42, downrange_invite_link=SHARE_MESSAGE)

    downrange.handle_invite_approve(body, MagicMock(), MagicMock(), {}, record)

    link_block = send.chat_postMessage.call_args.kwargs["blocks"][1]
    assert link_block["text"]["text"] == f"*Invite link:* {INVITE_URL}"
