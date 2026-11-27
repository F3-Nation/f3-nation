import datetime
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

import pytest
from f3_data_models.models import Series_Exception
from slack_sdk.errors import SlackApiError

from features.calendar.home import SLACK_MODAL_BLOCK_LIMIT, _append_calendar_event_group, build_home_form
from utilities.slack import actions, orm


@pytest.mark.parametrize("unlinked_coq", [False, True])
def test_assign_q_does_not_delete_existing_attendance_for_unlinked_selection(monkeypatch, unlinked_coq):
    from features.calendar import home
    from utilities import helper_functions

    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    monkeypatch.setattr(helper_functions, "SLACK_USERS", {})
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    identity = SimpleNamespace(user_id=None, slack_id="U_HIDDEN", slack_team_id="T_TEST")
    monkeypatch.setattr(
        helper_functions,
        "create_user",
        lambda profile, *_a, **_k: identity if profile["id"] == "U_HIDDEN" else SimpleNamespace(user_id=42),
    )
    field = actions.CALENDAR_HOME_ASSIGN_Q_USER
    body = {
        "user": {"id": "U_ACTOR"},
        "view": {
            "private_metadata": '{"event_instance_id":7}',
            "blocks": [],
            "state": {"values": {field: {field: {"type": "multi_users_select", "selected_users": ["U_HIDDEN"]}}}},
        },
    }
    client = MagicMock()
    if unlinked_coq:
        body["view"]["state"]["values"][field][field]["selected_users"] = ["U_LINKED"]
        coq_field = actions.CALENDAR_HOME_ASSIGN_Q_CO_QS
        body["view"]["state"]["values"][coq_field] = {
            coq_field: {"type": "multi_users_select", "selected_users": ["U_HIDDEN"]}
        }
    client.users_info.side_effect = lambda user: {"user": {"id": user, "profile": {}}}
    with patch.object(home, "DbManager") as database:
        database.find_records.return_value = [
            SimpleNamespace(id=9, user_id=42, attendance_types=[SimpleNamespace(type="Q")])
        ]
        with pytest.raises(helper_functions.UnlinkedSlackIdentityError):
            home.handle_assign_q_form(body, client, MagicMock(), {}, SimpleNamespace(team_id="T_TEST", org_id=1))
        database.delete_records.assert_not_called()
        database.create_record.assert_not_called()
        database.update_record.assert_not_called()
    client.chat_postMessage.assert_not_called()


def _calendar_event(event_id: int, start_date: datetime.date, *, closed: bool = False) -> SimpleNamespace:
    event = SimpleNamespace(
        id=event_id,
        name=f"Event {event_id}",
        start_date=start_date,
        start_time="0530",
        series_exception=Series_Exception.closed if closed else None,
        highlight=False,
        preblast_rich=False,
    )
    return SimpleNamespace(
        event=event,
        org=SimpleNamespace(name="Test AO"),
        event_types=[SimpleNamespace(name="Bootcamp")],
        series=None,
        planned_qs="",
        user_q=False,
        user_attending=False,
    )


def test_new_date_group_is_not_partially_appended_when_it_would_exceed_limit():
    blocks = [orm.DividerBlock() for _ in range(SLACK_MODAL_BLOCK_LIMIT - 2)]
    original_blocks = list(blocks)
    active_date = datetime.date(2026, 9, 6)

    returned_date, appended = _append_calendar_event_group(
        blocks=blocks,
        event_block=orm.SectionBlock(label="Next event"),
        event_date=datetime.date(2026, 9, 7),
        active_date=active_date,
    )

    assert not appended
    assert returned_date == active_date
    assert blocks == original_blocks


def test_event_group_that_reaches_exact_limit_is_appended():
    blocks = [orm.DividerBlock() for _ in range(SLACK_MODAL_BLOCK_LIMIT - 3)]
    event_date = datetime.date(2026, 9, 7)

    returned_date, appended = _append_calendar_event_group(
        blocks=blocks,
        event_block=orm.SectionBlock(label="Next event"),
        event_date=event_date,
        active_date=datetime.date(2026, 9, 6),
    )

    assert appended
    assert returned_date == event_date
    assert len(blocks) == SLACK_MODAL_BLOCK_LIMIT
    assert isinstance(blocks[-3], orm.DividerBlock)
    assert isinstance(blocks[-2], orm.HeaderBlock)
    assert isinstance(blocks[-1], orm.SectionBlock)


def test_waxhaw_shaped_closed_events_stop_at_100_blocks():
    start_date = datetime.date(2026, 8, 23)
    events = []
    event_id = 1

    for day_offset in range(15):
        events_on_date = 4 if day_offset < 14 else 3
        for _ in range(events_on_date):
            events.append(_calendar_event(event_id, start_date + datetime.timedelta(days=day_offset)))
            event_id += 1

    closed_date = start_date + datetime.timedelta(days=15)
    events.extend(_calendar_event(event_id + offset, closed_date, closed=True) for offset in range(6))

    client = MagicMock()
    client.views_update.return_value = {"ok": True}
    logger = MagicMock()
    region_record = SimpleNamespace(org_id=25273, team_id="T_TEST", calendar_group_by_option="ao")

    with (
        patch("features.calendar.home.get_user", return_value=SimpleNamespace(user_id=1)),
        patch("features.calendar.home.get_admin_users", return_value=[]),
        patch("features.calendar.home.get_aoq_users", return_value=[]),
        patch("features.calendar.home.DbManager.find_records", return_value=[]),
        patch("features.calendar.home.DbManager.find_join_records2", return_value=[]),
        patch("features.calendar.home.home_schedule_query", return_value=events) as schedule_query,
    ):
        build_home_form(
            body={"user": {"id": "U_TEST"}},
            client=client,
            logger=logger,
            context={},
            region_record=region_record,
            update_view_id="V_TEST",
        )

    schedule_query.assert_called_once()
    assert schedule_query.call_args.kwargs["limit"] == 100

    rendered_blocks = client.views_update.call_args.kwargs["view"]["blocks"]
    closed_blocks = [
        block
        for block in rendered_blocks
        if block.get("type") == "section" and "CLOSED" in block.get("text", {}).get("text", "")
    ]

    assert len(rendered_blocks) == SLACK_MODAL_BLOCK_LIMIT
    assert len(closed_blocks) == 2


def test_internal_calendar_refresh_preserves_legacy_modal_error_suppression():
    client = MagicMock()
    client.views_update.side_effect = SlackApiError("Slack rejected modal", {"error": "not_found"})
    region_record = SimpleNamespace(org_id=1, team_id="T_TEST", calendar_group_by_option="ao")

    with (
        patch("features.calendar.home.get_user", return_value=SimpleNamespace(user_id=1)),
        patch("features.calendar.home.get_admin_users", return_value=[]),
        patch("features.calendar.home.get_aoq_users", return_value=[]),
        patch("features.calendar.home.DbManager.find_records", return_value=[]),
        patch("features.calendar.home.DbManager.find_join_records2", return_value=[]),
        patch("features.calendar.home.home_schedule_query", return_value=[]),
    ):
        build_home_form(
            body={"user": {"id": "U_TEST"}},
            client=client,
            logger=MagicMock(),
            context={},
            region_record=region_record,
            update_view_id="V_EXISTING",
        )


def test_loading_calendar_update_propagates_modal_error_to_dispatcher():
    client = MagicMock()
    client.views_update.side_effect = SlackApiError("Slack rejected modal", {"error": "invalid_arguments"})
    region_record = SimpleNamespace(org_id=1, team_id="T_TEST", calendar_group_by_option="ao")

    with (
        patch("features.calendar.home.get_user", return_value=SimpleNamespace(user_id=1)),
        patch("features.calendar.home.get_admin_users", return_value=[]),
        patch("features.calendar.home.get_aoq_users", return_value=[]),
        patch("features.calendar.home.DbManager.find_records", return_value=[]),
        patch("features.calendar.home.DbManager.find_join_records2", return_value=[]),
        patch("features.calendar.home.home_schedule_query", return_value=[]),
        pytest.raises(SlackApiError),
    ):
        build_home_form(
            body={"user": {"id": "U_TEST"}, actions.LOADING_ID: "V_LOADING"},
            client=client,
            logger=MagicMock(),
            context={},
            region_record=region_record,
            update_view_id="V_LOADING",
        )


def _home_event_body(action: str) -> dict:
    return {
        "user": {"id": "U_ACTOR"},
        "view": {"id": "V_HOME"},
        "actions": [{"action_id": f"{actions.CALENDAR_HOME_EVENT}_7", "selected_option": {"value": action}}],
    }


def _patch_home_event(monkeypatch, home, preblast_info=None):
    monkeypatch.setattr(home, "get_user", lambda *_a, **_k: SimpleNamespace(user_id=42))
    monkeypatch.setattr(home, "build_home_form", MagicMock())
    monkeypatch.setattr(home, "get_preblast_channel", lambda *_a: "C_PREBLAST")
    monkeypatch.setattr(home, "post_hc_thread_reply", MagicMock())
    info = preblast_info or SimpleNamespace(
        event_record=SimpleNamespace(preblast_ts=None), attendance_records=[], preblast_blocks=[]
    )
    monkeypatch.setattr(home, "build_preblast_info", lambda *_a, **_k: info)


@pytest.mark.parametrize(("existing_type_ids", "inserts_q"), [([1], True), ([2], False), ([1, 2], False)])
def test_take_q_adds_q_link_only_when_attendance_lacks_it(monkeypatch, existing_type_ids, inserts_q):
    from features.calendar import home

    _patch_home_event(monkeypatch, home)
    attendance = SimpleNamespace(
        id=9,
        attendance_x_attendance_types=[SimpleNamespace(attendance_type_id=type_id) for type_id in existing_type_ids],
    )
    with patch.object(home, "DbManager") as database:
        database.find_records.return_value = [attendance]
        home.handle_home_event(_home_event_body("Take Q"), MagicMock(), MagicMock(), {}, SimpleNamespace(org_id=1))

    if inserts_q:
        [created] = [c.args[0] for c in database.create_record.call_args_list]
        assert (created.attendance_id, created.attendance_type_id) == (9, 2)
    else:
        database.create_record.assert_not_called()


def test_home_hc_updates_preblast_post_from_attendance_dicts(monkeypatch):
    from features.calendar import get_preblast_action_blocks, home
    from utilities import constants

    summary = {"type": "section", "text": {"type": "mrkdwn", "text": "PRTEST preblast"}}
    preblast_info = SimpleNamespace(
        event_record=SimpleNamespace(
            preblast_ts="1700000000.000100", meta={constants.PREBLAST_IMAGE_SLACK_FILE_ID_LEGACY: "F_PHOTO"}
        ),
        attendance_records=[
            {"user_id": 42, "attendance_type_ids": [1]},
            {"user_id": 43, "attendance_type_ids": [2]},
            {"user_id": 44, "attendance_type_ids": [1, 3]},
        ],
        preblast_blocks=[summary],
    )
    _patch_home_event(monkeypatch, home, preblast_info)
    client = MagicMock()
    logger = MagicMock()
    with patch.object(home, "DbManager"):
        home.handle_home_event(_home_event_body("HC"), client, logger, {}, SimpleNamespace(org_id=1))

    logger.error.assert_not_called()
    client.chat_postMessage.assert_not_called()
    sent = client.chat_update.call_args.kwargs
    assert sent["metadata"]["event_payload"] == {"event_instance_id": 7, "attendees": [42, 43, 44], "qs": [43, 44]}
    buttons = [b.as_form_field() for b in get_preblast_action_blocks(has_q=True, event_instance_id=7)]
    photo = {"type": "image", "slack_file": {"id": "F_PHOTO"}, "alt_text": "Preblast Image"}
    assert sent["blocks"] == [summary, *buttons[:-1], photo, buttons[-1]]


def test_home_hc_updates_preblast_in_the_channel_it_was_posted_to(monkeypatch):
    from features.calendar import home

    preblast_info = SimpleNamespace(
        event_record=SimpleNamespace(preblast_ts="1700000000.000100", meta={"preblast_post_channel_id": "C_POSTED"}),
        attendance_records=[{"user_id": 42, "attendance_type_ids": [1]}],
        preblast_blocks=[],
    )
    _patch_home_event(monkeypatch, home, preblast_info)
    client = MagicMock()
    with patch.object(home, "DbManager"):
        home.handle_home_event(_home_event_body("HC"), client, MagicMock(), {}, SimpleNamespace(org_id=1))

    assert client.chat_update.call_args.kwargs["channel"] == "C_POSTED"
    assert home.post_hc_thread_reply.call_args.args[3] == "C_POSTED"


def test_home_hc_retries_preblast_update_without_photo_on_invalid_blocks(monkeypatch):
    from features.calendar import home
    from utilities import constants

    summary = {"type": "section", "text": {"type": "mrkdwn", "text": "PRTEST preblast"}}
    preblast_info = SimpleNamespace(
        event_record=SimpleNamespace(
            preblast_ts="1700000000.000100", meta={constants.PREBLAST_IMAGE_SLACK_FILE_ID_LEGACY: "F_PHOTO"}
        ),
        attendance_records=[{"user_id": 42, "attendance_type_ids": [1]}],
        preblast_blocks=[summary],
    )
    _patch_home_event(monkeypatch, home, preblast_info)
    client = MagicMock()
    client.chat_update.side_effect = [SlackApiError("invalid_blocks", {"error": "invalid_blocks"}), {"ok": True}]
    logger = MagicMock()
    with patch.object(home, "DbManager"):
        home.handle_home_event(_home_event_body("HC"), client, logger, {}, SimpleNamespace(org_id=1))

    assert client.chat_update.call_count == 2
    client.chat_postMessage.assert_not_called()
    first_blocks = client.chat_update.call_args_list[0].kwargs["blocks"]
    second_blocks = client.chat_update.call_args_list[1].kwargs["blocks"]
    assert any(b.get("alt_text") == "Preblast Image" for b in first_blocks)
    assert all(b.get("alt_text") != "Preblast Image" for b in second_blocks)


def test_home_hc_fallback_post_retries_without_photo_on_invalid_blocks(monkeypatch):
    from features.calendar import home
    from utilities import constants

    summary = {"type": "section", "text": {"type": "mrkdwn", "text": "PRTEST preblast"}}
    preblast_info = SimpleNamespace(
        event_record=SimpleNamespace(
            preblast_ts="1700000000.000100", meta={constants.PREBLAST_IMAGE_SLACK_FILE_ID_LEGACY: "F_PHOTO"}
        ),
        attendance_records=[{"user_id": 42, "attendance_type_ids": [1]}],
        preblast_blocks=[summary],
    )
    _patch_home_event(monkeypatch, home, preblast_info)
    client = MagicMock()
    client.chat_update.side_effect = SlackApiError("message_not_found", {"error": "message_not_found"})
    client.chat_postMessage.side_effect = [SlackApiError("invalid_blocks", {"error": "invalid_blocks"}), {"ok": True}]
    logger = MagicMock()
    with patch.object(home, "DbManager"):
        home.handle_home_event(_home_event_body("HC"), client, logger, {}, SimpleNamespace(org_id=1))

    assert client.chat_update.call_count == 1
    assert client.chat_postMessage.call_count == 2
    first_blocks = client.chat_postMessage.call_args_list[0].kwargs["blocks"]
    second_blocks = client.chat_postMessage.call_args_list[1].kwargs["blocks"]
    assert any(b.get("alt_text") == "Preblast Image" for b in first_blocks)
    assert all(b.get("alt_text") != "Preblast Image" for b in second_blocks)
