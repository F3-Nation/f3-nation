import json
import os
import sys
from types import SimpleNamespace
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


@pytest.mark.parametrize(
    "saved, submitted, stored",
    [
        (None, INVITE_URL, INVITE_URL),
        (None, SHARE_MESSAGE, INVITE_URL),
        (INVITE_URL, None, None),
        (INVITE_URL, "Join me on Slack", INVITE_URL),
    ],
    ids=["url", "share", "cleared", "unusable_keeps_saved"],
)
def test_saving_settings_stores_only_the_url(monkeypatch, saved, submitted, stored):
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
    record = SlackSettings(team_id="T1", downrange_invite_link=saved)

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


def test_approval_with_no_url_in_the_saved_link_warns_the_admin_and_sends_nothing(monkeypatch):
    requester_client = MagicMock()
    monkeypatch.setattr(downrange, "_get_space_for_team", MagicMock(return_value=MagicMock(bot_token="xoxb")))
    monkeypatch.setattr(downrange, "WebClient", MagicMock(return_value=requester_client))
    admin_client = MagicMock()
    body = {
        "message": {
            "metadata": {"event_payload": {"requester_team_id": "T_REQUESTER", "requester_user_id": "U1"}},
            "ts": "1",
        },
        "channel": {"id": "C1"},
        "user": {"id": "U_ADMIN"},
    }
    record = SlackSettings(team_id="T_TARGET", org_id=42, downrange_invite_link="Join me on Slack")

    downrange.handle_invite_approve(body, admin_client, MagicMock(), {}, record)

    requester_client.chat_postMessage.assert_not_called()
    warning = admin_client.chat_postEphemeral.call_args.kwargs
    assert warning["user"] == "U_ADMIN"
    assert "haven't set an invite link" in warning["text"]


def region_info_blocks(saved):
    return downrange._build_region_info_blocks(
        has_slack=True,
        target_settings=SlackSettings(
            team_id="T_TARGET", downrange_invite_sharing="proactive", downrange_invite_link=saved
        ),
        target_team_id="T_TARGET",
        target_org_id=42,
        selected_org_name="Target",
        requester_team_id="T_REQUESTER",
        requester_user_id="U_REQUESTER",
        requester_name="Requester",
        requester_region_name="Home",
        requester_email="",
    )


def test_proactive_sharing_shows_only_the_url_from_a_saved_share_message():
    labels = [getattr(block, "label", None) for block in region_info_blocks(SHARE_MESSAGE)]

    assert INVITE_URL in labels
    assert SHARE_MESSAGE not in labels


def test_proactive_sharing_without_a_url_falls_back_to_requesting_an_invite():
    blocks = region_info_blocks("Join me on Slack")

    assert not any("Here is their invite link" in str(getattr(block, "label", "")) for block in blocks)
    assert all("Join me on Slack" != getattr(block, "label", None) for block in blocks)
    assert any("You can request an invite from their admins" in str(getattr(block, "label", "")) for block in blocks)


@pytest.mark.parametrize(
    "saved, prefilled", [(SHARE_MESSAGE, INVITE_URL), ("Join me on Slack", None)], ids=["share", "no_url"]
)
def test_region_select_restores_admin_form_with_only_a_valid_url(monkeypatch, saved, prefilled):
    monkeypatch.setattr(
        downrange,
        "get_user",
        MagicMock(return_value=SimpleNamespace(user_id=None, user_name="Admin", email=None)),
    )
    monkeypatch.setattr(downrange, "_get_target_region_info", lambda *_a: (None, None, None))
    monkeypatch.setattr(
        downrange.DbManager,
        "get",
        lambda *_a, **_k: SimpleNamespace(
            name="Region", website=None, email=None, twitter=None, facebook=None, instagram=None
        ),
    )
    client = MagicMock()

    downrange.handle_region_select(
        {
            "user": {"id": "U_ADMIN"},
            "actions": [{"selected_option": {"value": "8", "text": {"text": "Target"}}}],
            "view": {"id": "V_TEST", "private_metadata": json.dumps({"is_admin": True}), "state": {"values": {}}},
        },
        client,
        MagicMock(),
        {},
        SlackSettings(team_id="T1", org_id=7, downrange_invite_link=saved),
    )

    element = invite_link_element(client)
    assert element["type"] == "url_text_input"
    assert element.get("initial_value") == prefilled


TYPED_URL = "https://join.slack.com/t/other/shared_invite/zt-new"


@pytest.mark.parametrize(
    "typed, prefilled",
    [(TYPED_URL, TYPED_URL), (SHARE_MESSAGE.replace(INVITE_URL, TYPED_URL), TYPED_URL)],
    ids=["typed_url", "typed_share"],
)
def test_region_select_keeps_only_the_url_from_a_typed_link(monkeypatch, typed, prefilled):
    monkeypatch.setattr(
        downrange,
        "get_user",
        MagicMock(return_value=SimpleNamespace(user_id=None, user_name="Admin", email=None)),
    )
    monkeypatch.setattr(downrange, "_get_target_region_info", lambda *_a: (None, None, None))
    monkeypatch.setattr(
        downrange.DbManager,
        "get",
        lambda *_a, **_k: SimpleNamespace(
            name="Region", website=None, email=None, twitter=None, facebook=None, instagram=None
        ),
    )
    client = MagicMock()
    state = {actions.DOWNRANGE_INVITE_LINK: {actions.DOWNRANGE_INVITE_LINK: {"type": "url_text_input", "value": typed}}}

    downrange.handle_region_select(
        {
            "user": {"id": "U_ADMIN"},
            "actions": [{"selected_option": {"value": "8", "text": {"text": "Target"}}}],
            "view": {"id": "V_TEST", "private_metadata": json.dumps({"is_admin": True}), "state": {"values": state}},
        },
        client,
        MagicMock(),
        {},
        SlackSettings(team_id="T1", org_id=7, downrange_invite_link=INVITE_URL),
    )

    assert invite_link_element(client).get("initial_value") == prefilled
