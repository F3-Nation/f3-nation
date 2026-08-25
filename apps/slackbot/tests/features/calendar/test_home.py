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
