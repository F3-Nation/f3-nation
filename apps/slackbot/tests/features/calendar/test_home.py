import datetime
import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

import pytest
from f3_data_models.models import Series_Exception
from slack_sdk.errors import SlackApiError

from features.calendar import home
from features.calendar.home import (
    HOME_PAGE_SIZE,
    SLACK_MODAL_BLOCK_LIMIT,
    _append_calendar_event_group,
    build_home_form,
)
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


def _calendar_event(
    event_id: int,
    start_date: datetime.date,
    *,
    closed: bool = False,
    planned_qs: str | None = "Chip",
    user_attending: bool = False,
    user_q: bool = False,
    hc_count: int | None = 3,
    preblast: bool = False,
    highlight: bool = False,
    event_types: tuple[str, ...] = ("Bootcamp",),
) -> SimpleNamespace:
    event = SimpleNamespace(
        id=event_id,
        name=f"Event {event_id}",
        start_date=start_date,
        start_time="0530",
        series_exception=Series_Exception.closed if closed else None,
        highlight=highlight,
        preblast_rich={"blocks": []} if preblast else None,
    )
    return SimpleNamespace(
        event=event,
        org=SimpleNamespace(name="The Forge"),
        event_types=[SimpleNamespace(name=name) for name in event_types],
        series=None,
        planned_qs=planned_qs,
        user_q=user_q,
        user_attending=user_attending,
        hc_count=hc_count,
    )


FUTURE = datetime.date(2099, 9, 7)


def _render(events, body=None, *, admin=False, update_view_id="V_TEST"):
    """Render Calendar Home with `events` as the query result; return (view payload, schedule query mock)."""
    client = MagicMock()
    client.views_update.return_value = {"ok": True}
    client.views_open.return_value = {"ok": True}
    region_record = SimpleNamespace(org_id=25273, team_id="T_TEST", calendar_group_by_option="ao")
    with (
        patch("features.calendar.home.get_user", return_value=SimpleNamespace(user_id=1)),
        patch("features.calendar.home.get_admin_users", return_value=[]),
        patch("features.calendar.home.get_aoq_users", return_value=[]),
        patch("features.calendar.home.constants.ALL_USERS_ARE_ADMINS", admin),
        patch("features.calendar.home.DbManager.find_records", return_value=[]),
        patch("features.calendar.home.DbManager.find_join_records2", return_value=[]),
        patch("features.calendar.home.home_schedule_query", return_value=events) as schedule_query,
    ):
        build_home_form(
            body=body or {"user": {"id": "U_TEST"}, "trigger_id": "TRIGGER"},
            client=client,
            logger=MagicMock(),
            context={},
            region_record=region_record,
            update_view_id=update_view_id,
        )
    call = client.views_update.call_args or client.views_open.call_args
    return call.kwargs["view"], schedule_query


def _legend_index(view):
    return next(
        i
        for i, b in enumerate(view["blocks"])
        if b["type"] == "context" and b["elements"][0]["text"].startswith(":muscle:")
    )


def _event_blocks(view):
    """Blocks after the fixed header area (top buttons, any filter inputs, summary, legend)."""
    return view["blocks"][_legend_index(view) + 1 :]


def _slack_block_count(blocks):
    return len(blocks)


FILTER_BLOCK_IDS = [
    actions.CALENDAR_HOME_AO_FILTER,
    actions.CALENDAR_HOME_EVENT_TYPE_FILTER,
    actions.CALENDAR_HOME_DATE_FILTER,
    actions.CALENDAR_HOME_Q_FILTER,
]


def _filter_inputs(view):
    return [b for b in view["blocks"] if b.get("block_id") in FILTER_BLOCK_IDS]


def _filters_button(view):
    return next(e for e in view["blocks"][0]["elements"] if e["action_id"] == actions.CALENDAR_HOME_FILTERS)


def _filter_body(state: dict, *, action_id: str, view_id="V_TEST", private_metadata=None, value=None) -> dict:
    """A block_actions payload from inside Calendar Home, with filter `state` keyed by block id."""
    values = {}
    for block_id, selected in state.items():
        if block_id == actions.CALENDAR_HOME_DATE_FILTER:
            values[block_id] = {block_id: {"type": "datepicker", "selected_date": selected}}
        else:
            values[block_id] = {
                block_id: {
                    "type": "checkboxes" if block_id == actions.CALENDAR_HOME_Q_FILTER else "multi_static_select",
                    "selected_options": [{"value": v} for v in selected],
                }
            }
    action = {"action_id": action_id}
    if value is not None:
        action["value"] = value
    return {
        "user": {"id": "U_TEST"},
        "actions": [action],
        "view": {
            "id": view_id,
            "callback_id": actions.CALENDAR_HOME_CALLBACK_ID,
            "private_metadata": private_metadata or "{}",
            "blocks": [],
            "state": {"values": values},
        },
    }


def test_new_date_group_is_not_partially_appended_when_it_would_exceed_limit():
    blocks = [orm.DividerBlock() for _ in range(SLACK_MODAL_BLOCK_LIMIT - 2)]
    original_blocks = list(blocks)
    active_date = datetime.date(2026, 9, 6)

    returned_date, appended = _append_calendar_event_group(
        blocks=blocks,
        event_blocks=[orm.SectionBlock(label="Next event"), orm.ActionsBlock()],
        event_date=datetime.date(2026, 9, 7),
        active_date=active_date,
        block_limit=SLACK_MODAL_BLOCK_LIMIT,
    )

    assert not appended
    assert returned_date == active_date
    assert blocks == original_blocks


def test_event_group_that_reaches_exact_limit_is_appended():
    blocks = [orm.DividerBlock() for _ in range(SLACK_MODAL_BLOCK_LIMIT - 3)]
    event_date = datetime.date(2026, 9, 7)

    returned_date, appended = _append_calendar_event_group(
        blocks=blocks,
        event_blocks=[orm.SectionBlock(label="Next event"), orm.ActionsBlock()],
        event_date=event_date,
        active_date=datetime.date(2026, 9, 6),
        block_limit=SLACK_MODAL_BLOCK_LIMIT,
    )

    assert appended
    assert returned_date == event_date
    assert len(blocks) == SLACK_MODAL_BLOCK_LIMIT
    assert isinstance(blocks[-3], orm.HeaderBlock)
    assert isinstance(blocks[-2], orm.SectionBlock)
    assert isinstance(blocks[-1], orm.ActionsBlock)


def test_event_row_has_bold_title_detail_line_and_hc_button():
    view, _ = _render([_calendar_event(7, FUTURE, preblast=True, hc_count=4, event_types=("Bootcamp", "Ruck"))])

    header, section, buttons = _event_blocks(view)[:3]
    assert header == {
        "type": "header",
        "text": {"type": "plain_text", "text": ":calendar: Monday, September 07", "emoji": True},
    }
    assert section["text"]["text"] == "*The Forge — Bootcamp / Ruck @ 0530*\nQ: Chip · 4 HC · :pencil:"
    assert "accessory" not in section
    hc_button, overflow = buttons["elements"]
    assert hc_button["text"]["text"] == "HC"
    assert hc_button["value"] == "HC"
    assert hc_button["action_id"] == f"{actions.CALENDAR_HOME_EVENT}_7_button"
    assert overflow["action_id"] == f"{actions.CALENDAR_HOME_EVENT}_7"
    assert [o["value"] for o in overflow["options"]] == ["View Preblast"]


def test_open_q_slot_makes_take_q_the_visible_button():
    view, _ = _render([_calendar_event(7, FUTURE, planned_qs=None, hc_count=None)])

    section, buttons = _event_blocks(view)[1:3]
    assert section["text"]["text"] == "*The Forge — Bootcamp @ 0530*\nQ: Open! · 0 HC"
    take_q, overflow = buttons["elements"]
    assert (take_q["text"]["text"], take_q["value"], take_q["style"]) == ("Take Q", "Take Q", "primary")
    assert [o["value"] for o in overflow["options"]] == ["View Preblast", "HC"]


def test_going_button_un_hcs_only_after_confirmation():
    view, _ = _render([_calendar_event(7, FUTURE, user_attending=True, user_q=True)])

    section, buttons = _event_blocks(view)[1:3]
    assert section["text"]["text"].endswith("Q: Chip · 3 HC · :muscle: :white_check_mark:")
    going = buttons["elements"][0]
    assert (going["text"]["text"], going["value"]) == (":white_check_mark: Going", "Un-HC")
    assert going["confirm"]["confirm"]["text"] == "Un-HC"


def test_admin_actions_stay_in_the_overflow_menu():
    view, _ = _render([_calendar_event(7, FUTURE)], admin=True)

    overflow = _event_blocks(view)[2]["elements"][1]
    assert [o["value"] for o in overflow["options"]] == ["Assign Q", "Close Event", "Edit Preblast"]


def test_closed_event_is_one_block_with_its_menu():
    view, _ = _render([_calendar_event(7, FUTURE, closed=True), _calendar_event(8, FUTURE)])

    closed, next_event = _event_blocks(view)[1:3]
    assert closed["text"]["text"] == "*The Forge — Bootcamp @ 0530*\n:no_entry: Closed"
    assert [o["value"] for o in closed["accessory"]["options"]] == ["Event Closed"]
    assert next_event["text"]["text"].startswith("*The Forge — Bootcamp")


def test_special_event_title_leads_with_star_and_event_name():
    view, _ = _render([_calendar_event(7, FUTURE, highlight=True)])

    assert _event_blocks(view)[1]["text"]["text"].startswith("*:star: Event 7 — The Forge @ 0530*\n")


def test_mrkdwn_in_org_supplied_names_is_escaped():
    event = _calendar_event(7, FUTURE, planned_qs="<!channel>")
    event.org.name = "<@U123>"

    view, _ = _render([event])

    text = _event_blocks(view)[1]["text"]["text"]
    assert "<" not in text
    assert "&lt;@U123&gt;" in text and "&lt;!channel&gt;" in text


def test_days_are_separated_by_date_headers_without_dividers():
    view, _ = _render([_calendar_event(1, FUTURE), _calendar_event(2, FUTURE + datetime.timedelta(days=1))])

    assert [b["type"] for b in _event_blocks(view)] == ["header", "section", "actions", "header", "section", "actions"]


def test_top_row_legend_and_hidden_filters_on_open():
    view, _ = _render([], update_view_id=None)

    top, summary, legend = view["blocks"][:3]
    assert [e["action_id"] for e in top["elements"]] == [
        actions.OPEN_CALENDAR_IMAGE_BUTTON,
        actions.NEARBY_EVENTS_OPEN,
        actions.CALENDAR_HOME_FILTERS,
    ]
    assert _filters_button(view)["text"]["text"] == ":gear: Filters"
    assert _filter_inputs(view) == []
    assert summary["elements"][0]["text"] == "Showing: all upcoming events"
    assert legend["elements"][0]["text"] == (
        ":muscle: you're Q · :white_check_mark: you're going · :pencil: preblast posted · :star: special event"
    )
    assert _event_blocks(view) == [
        {"type": "section", "text": {"type": "mrkdwn", "text": "No upcoming events match these filters."}}
    ]


def test_calendar_uses_only_block_types_slack_allows_in_modals():
    # Slack rejects a modal containing a container block with invalid_arguments.
    view, _ = _render(_busy_schedule(5), _filter_body({}, action_id=actions.CALENDAR_HOME_FILTERS))

    allowed = {"actions", "context", "divider", "header", "image", "input", "section"}
    assert {b["type"] for b in view["blocks"]} <= allowed


def test_filters_button_shows_the_filter_inputs_below_the_top_row():
    view, _ = _render([], _filter_body({}, action_id=actions.CALENDAR_HOME_FILTERS))

    assert [b["block_id"] for b in view["blocks"][1:5]] == FILTER_BLOCK_IDS
    assert _filters_button(view)["text"]["text"] == ":gear: Hide filters"
    assert '"filters_open": true' in client_metadata(view)


def test_hiding_filters_keeps_them_applied_and_counts_them_on_the_button():
    body = _filter_body(
        {actions.CALENDAR_HOME_Q_FILTER: [actions.FILTER_OPEN_Q]},
        action_id=actions.CALENDAR_HOME_FILTERS,
        private_metadata='{"filters_open": true}',
    )

    view, schedule_query = _render([], body)

    assert _filter_inputs(view) == []
    assert _filters_button(view)["text"]["text"] == ":gear: Filters (1 active)"
    assert view["blocks"][1]["elements"][0]["text"] == "Showing: Open Q only"
    assert schedule_query.call_args.kwargs["open_q_only"] is True


def test_hidden_filters_still_apply_on_show_more():
    metadata = json.dumps({"filters_open": False, "filters": {actions.CALENDAR_HOME_Q_FILTER: [actions.FILTER_OPEN_Q]}})
    body = _filter_body({}, action_id=actions.CALENDAR_HOME_SHOW_MORE, value="37", private_metadata=metadata)

    view, schedule_query = _render(_busy_schedule(5), body)

    assert schedule_query.call_args.kwargs["open_q_only"] is True
    assert schedule_query.call_args.kwargs["offset"] == 37
    assert _filter_inputs(view) == []


def test_filters_stay_shown_and_count_active_filters_after_a_filter_change():
    body = _filter_body(
        {
            actions.CALENDAR_HOME_AO_FILTER: ["11", "12"],
            actions.CALENDAR_HOME_Q_FILTER: [actions.FILTER_OPEN_Q, actions.FILTER_SPECIAL_EVENTS],
            actions.CALENDAR_HOME_DATE_FILTER: "2099-09-07",
        },
        action_id=actions.CALENDAR_HOME_Q_FILTER,
    )

    view, schedule_query = _render([], body)

    assert [b["block_id"] for b in _filter_inputs(view)] == FILTER_BLOCK_IDS
    assert _filters_button(view)["text"]["text"] == ":gear: Hide filters"
    summary = view["blocks"][_legend_index(view) - 1]
    assert summary["elements"][0]["text"] == "Showing: 2 AOs · Open Q only · Special events only · from Mon, Sep 07"
    assert schedule_query.call_args.kwargs["open_q_only"] is True
    compiled = [str(f) for f in schedule_query.call_args.args[1]]
    assert any("event_instances.highlight" in f for f in compiled)


def test_other_options_offer_special_events_and_not_nearby_regions():
    view, _ = _render([], _filter_body({}, action_id=actions.CALENDAR_HOME_FILTERS))

    options = _filter_inputs(view)[3]["element"]["options"]
    assert [o["value"] for o in options] == [
        actions.FILTER_OPEN_Q,
        actions.FILTER_MY_EVENTS,
        actions.FILTER_SPECIAL_EVENTS,
    ]
    assert [o["text"]["text"] for o in options] == [
        "Show only open Q slots",
        "Show only my events",
        "Special events only",
    ]


def test_event_type_filter_matches_events_having_any_selected_type():
    body = _filter_body(
        {actions.CALENDAR_HOME_EVENT_TYPE_FILTER: ["3"]}, action_id=actions.CALENDAR_HOME_EVENT_TYPE_FILTER
    )

    _, schedule_query = _render([], body)

    compiled = [str(f) for f in schedule_query.call_args.args[1]]
    assert any("EXISTS" in f and "event_instances_x_event_types" in f for f in compiled)


def _busy_schedule(count: int):
    return [_calendar_event(i, FUTURE + datetime.timedelta(days=i // 3)) for i in range(count)]


def test_full_page_stays_under_the_block_limit_and_offers_show_more():
    view, schedule_query = _render(_busy_schedule(HOME_PAGE_SIZE))

    assert _slack_block_count(view["blocks"]) <= SLACK_MODAL_BLOCK_LIMIT
    rendered = [b for b in view["blocks"] if b["type"] == "section" and b["text"]["text"].startswith("*The Forge")]
    paging = view["blocks"][-1]
    assert [e["action_id"] for e in paging["elements"]] == [actions.CALENDAR_HOME_SHOW_MORE]
    assert paging["elements"][0]["value"] == str(len(rendered))
    assert schedule_query.call_args.kwargs["limit"] == HOME_PAGE_SIZE
    assert schedule_query.call_args.kwargs["offset"] == 0


def test_show_more_loads_the_next_page_and_offers_back_to_start():
    body = _filter_body({}, action_id=actions.CALENDAR_HOME_SHOW_MORE, value="37")

    view, schedule_query = _render(_busy_schedule(5), body)

    assert schedule_query.call_args.kwargs["offset"] == 37
    paging = view["blocks"][-1]
    assert [e["action_id"] for e in paging["elements"]] == [actions.CALENDAR_HOME_SHOW_FIRST]
    assert '"offset": 37' in client_metadata(view)


def client_metadata(view) -> str:
    return view["private_metadata"]


def test_refresh_after_an_event_action_keeps_the_current_page():
    body = _filter_body(
        {}, action_id=f"{actions.CALENDAR_HOME_EVENT}_7_button", private_metadata='{"offset": 37}', value="HC"
    )

    _, schedule_query = _render(_busy_schedule(5), body)

    assert schedule_query.call_args.kwargs["offset"] == 37


def test_changing_a_filter_returns_to_the_first_page():
    body = _filter_body(
        {actions.CALENDAR_HOME_Q_FILTER: [actions.FILTER_OPEN_Q]},
        action_id=actions.CALENDAR_HOME_Q_FILTER,
        private_metadata='{"offset": 37}',
    )

    _, schedule_query = _render(_busy_schedule(5), body)

    assert schedule_query.call_args.kwargs["offset"] == 0


def test_last_page_has_no_show_more_button():
    view, _ = _render(_busy_schedule(5))

    assert view["blocks"][-1]["type"] != "actions" or not any(
        e["action_id"] == actions.CALENDAR_HOME_SHOW_MORE for e in view["blocks"][-1]["elements"]
    )


def test_waxhaw_shaped_closed_events_stay_under_100_blocks():
    start_date = datetime.date(2026, 8, 23)
    events = [
        _calendar_event(i, start_date + datetime.timedelta(days=i // 4), closed=i >= 56) for i in range(HOME_PAGE_SIZE)
    ]

    view, _ = _render(events)

    assert _slack_block_count(view["blocks"]) <= SLACK_MODAL_BLOCK_LIMIT
    assert view["blocks"][-1]["elements"][0]["action_id"] == actions.CALENDAR_HOME_SHOW_MORE


@pytest.mark.parametrize(("button_value", "expected"), [("HC", "create"), ("Un-HC", "delete")])
def test_event_button_runs_the_same_action_as_the_menu(button_value, expected):
    body = {
        "user": {"id": "U_TEST"},
        "actions": [{"action_id": f"{actions.CALENDAR_HOME_EVENT}_7_button", "type": "button", "value": button_value}],
        "view": {"id": "V_TEST"},
    }
    with (
        patch("features.calendar.home.get_user", return_value=SimpleNamespace(user_id=42)),
        patch("features.calendar.home.DbManager") as database,
        patch("features.calendar.home.build_home_form"),
        patch(
            "features.calendar.home.build_preblast_info",
            return_value=SimpleNamespace(event_record=SimpleNamespace(preblast_ts=None)),
        ),
    ):
        home.handle_home_event(body, MagicMock(), MagicMock(), {}, SimpleNamespace(team_id="T_TEST", org_id=1))

    if expected == "create":
        attendance = database.create_record.call_args.args[0]
        assert (attendance.event_instance_id, attendance.user_id, attendance.is_planned) == (7, 42, True)
        assert [t.attendance_type_id for t in attendance.attendance_x_attendance_types] == [1]
        database.delete_records.assert_not_called()
    else:
        filters = [str(f) for f in database.delete_records.call_args.kwargs["filters"]]
        assert any("attendance.event_instance_id" in f for f in filters)
        assert database.delete_records.call_args.kwargs["cls"].__name__ == "Attendance"
        database.create_record.assert_not_called()


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
