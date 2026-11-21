import copy
import datetime
import json
import time
from logging import Logger
from typing import List

import pytz
import requests
from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    EventInstance,
    EventType,
    Location,
    Org,
    Org_Type,
    Series_Exception,
)
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient
from sqlalchemy import or_
from sqlalchemy.exc import IntegrityError

from features.backblast import build_backblast_form
from features.calendar import event_instance, get_preblast_action_buttons
from features.calendar.event_preblast import (
    build_event_preblast_form,
    build_preblast_info,
    get_preblast_channel,
    post_hc_thread_reply,
)
from utilities import constants, storage
from utilities.constants import (
    MAX_CALENDAR_WEEKS,
    WEEK_LABELS,
    WEEK_SCHEDULE_LABELS,
)
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import CalendarHomeQuery, get_admin_users, get_aoq_users, home_schedule_query
from utilities.helper_functions import (
    _parse_view_private_metadata,
    current_date_cst,
    escape_mrkdwn,
    get_location_display_name,
    get_user,
    safe_convert,
    safe_get,
    sort_by_name,
)
from utilities.slack import actions, orm

SLACK_MODAL_BLOCK_LIMIT = 100
# Events requested per page. A page renders fewer when their blocks would pass the modal limit.
HOME_PAGE_SIZE = 60
FILTER_ACTIONS = {
    actions.CALENDAR_HOME_AO_FILTER,
    actions.CALENDAR_HOME_EVENT_TYPE_FILTER,
    actions.CALENDAR_HOME_DATE_FILTER,
    actions.CALENDAR_HOME_Q_FILTER,
}
OPTION_LABELS = {
    actions.FILTER_OPEN_Q: "Show only open Q slots",
    actions.FILTER_MY_EVENTS: "Show only my events",
    actions.FILTER_SPECIAL_EVENTS: "Special events only",
}
OPTION_SUMMARIES = {
    actions.FILTER_OPEN_Q: "Open Q only",
    actions.FILTER_MY_EVENTS: "My events only",
    actions.FILTER_SPECIAL_EVENTS: "Special events only",
}
LEGEND = ":muscle: you're Q · :white_check_mark: you're going · :pencil: preblast written · :star: special event"
# Overflow actions that can instead be the row's visible button, with the button label for each.
PRIMARY_ACTION_LABELS = {"Take Q": "Take Q", "HC": "HC", "Un-HC": ":white_check_mark: Going"}


def _append_calendar_event_group(
    blocks: list[orm.BaseBlock],
    event_blocks: list[orm.BaseBlock],
    event_date: datetime.date,
    active_date: datetime.date | None,
    block_limit: int,
) -> tuple[datetime.date | None, bool]:
    """Append an event's blocks, with a date header when the date changes, only if all of them fit."""
    candidate_blocks: list[orm.BaseBlock] = []
    if event_date != active_date:
        candidate_blocks.append(orm.HeaderBlock(label=f":calendar: {event_date.strftime('%A, %B %d')}"))
    candidate_blocks.extend(event_blocks)

    if len(blocks) + len(candidate_blocks) > block_limit:
        return active_date, False

    blocks.extend(candidate_blocks)
    return event_date, True


def _event_title(event: CalendarHomeQuery) -> str:
    ao_name = escape_mrkdwn(event.org.name)
    start_time = event.event.start_time or "TBD"
    if event.event.highlight:
        return f":star: {escape_mrkdwn(event.event.name)} — {ao_name} @ {start_time}"
    if event.series and event.series.name and event.org.name not in event.series.name:
        return f"{escape_mrkdwn(event.series.name)} — {ao_name} @ {start_time}"
    event_types = " / ".join(escape_mrkdwn(t.name) for t in event.event_types)
    return f"{ao_name} — {event_types} @ {start_time}"


def _event_option_names(event: CalendarHomeQuery, user_is_admin: bool) -> list[str]:
    """Every action the viewer can take on an open event, in overflow-menu order."""
    option_names: list[str] = []
    if not user_is_admin:
        option_names.append("Edit Preblast" if event.user_q else "View Preblast")
    if not event.planned_qs:
        option_names.append("Take Q")
    option_names.append("Un-HC" if event.user_attending else "HC")
    if user_is_admin:
        option_names.extend(["Assign Q", "Close Event"])
        option_names.append("Edit Preblast" if event.event.start_date > current_date_cst() else "Edit Backblast")
    return option_names


def _primary_button(event_id: int, option_names: list[str]) -> orm.ButtonElement | None:
    """The row's visible button: Take Q when the Q slot is open, otherwise HC or Going (Un-HC)."""
    action = next((a for a in PRIMARY_ACTION_LABELS if a in option_names), None)
    if action is None:
        return None
    button = orm.ButtonElement(
        label=PRIMARY_ACTION_LABELS[action],
        action=f"{actions.CALENDAR_HOME_EVENT}_{event_id}_button",
        value=action,
    )
    if action == "Un-HC":
        button.confirm = orm.ConfirmObject(
            title="Remove your HC?", text="You'll no longer be listed as going.", confirm="Un-HC", deny="Keep HC"
        )
    else:
        button.style = "primary"
    return button


def _event_blocks(event: CalendarHomeQuery, user_is_admin: bool) -> list[orm.BaseBlock]:
    """A bold title line and a detail line, then the visible button and the overflow menu of other actions."""
    overflow_action = f"{actions.CALENDAR_HOME_EVENT}_{event.event.id}"
    if event.event.series_exception == Series_Exception.closed:
        event_types = " / ".join(escape_mrkdwn(t.name) for t in event.event_types)
        label = f"*{escape_mrkdwn(event.org.name)} — {event_types} @ {event.event.start_time or 'TBD'}*"
        label += "\n:no_entry: Closed"
        option = "Reopen Event" if user_is_admin else "Event Closed"
        return [
            orm.SectionBlock(
                label=label,
                element=orm.OverflowElement(action=overflow_action, options=orm.as_selector_options([option])),
            )
        ]

    details = [f"Q: {escape_mrkdwn(event.planned_qs)}" if event.planned_qs else "Q: Open!", f"{event.hc_count or 0} HC"]
    icons = " ".join(
        icon
        for icon, shown in [
            (":muscle:", event.user_q),
            (":white_check_mark:", event.user_attending),
            (":pencil:", event.event.preblast_rich),
        ]
        if shown
    )
    if icons:
        details.append(icons)
    label = f"*{_event_title(event)}*\n{' · '.join(details)}"

    option_names = _event_option_names(event, user_is_admin)
    button = _primary_button(event.event.id, option_names)
    other_options = [o for o in option_names if button is None or o != button.value]
    elements: list = [button] if button else []
    if other_options:
        elements.append(orm.OverflowElement(action=overflow_action, options=orm.as_selector_options(other_options)))
    return [orm.SectionBlock(label=label), orm.ActionsBlock(elements=elements)]


def _filter_summary(filter_data: dict, group_by_option: str, start_date_selected: datetime.date | None) -> list[str]:
    """One short phrase per active filter, in display order."""
    parts = []
    group_count = len(safe_get(filter_data, actions.CALENDAR_HOME_AO_FILTER) or [])
    if group_count:
        noun = "AO" if group_by_option == "ao" else "location"
        parts.append(f"{group_count} {noun}{'s' if group_count > 1 else ''}")
    type_count = len(safe_get(filter_data, actions.CALENDAR_HOME_EVENT_TYPE_FILTER) or [])
    if type_count:
        parts.append(f"{type_count} event type{'s' if type_count > 1 else ''}")
    selected_options = safe_get(filter_data, actions.CALENDAR_HOME_Q_FILTER) or []
    parts.extend(OPTION_SUMMARIES[o] for o in OPTION_SUMMARIES if o in selected_options)
    if start_date_selected:
        parts.append(f"from {start_date_selected.strftime('%a, %b %d')}")
    return parts


def _page_offset(body: dict, action_id: str | None, view_id: str | None) -> int:
    """Which page to show: Show more carries its offset, a filter change or Back to start returns to the first page,
    and an action taken directly on the calendar (HC, Take Q, Reopen) keeps the page it was on. A refresh from a
    modal stacked on top (Assign Q, Close Event) arrives from that modal's view, so it returns to the first page."""
    if action_id == actions.CALENDAR_HOME_SHOW_MORE:
        return max(safe_convert(safe_get(body, "actions", 0, "value"), int) or 0, 0)
    if action_id in FILTER_ACTIONS or action_id == actions.CALENDAR_HOME_SHOW_FIRST:
        return 0
    if view_id and safe_get(body, "view", "id") == view_id:
        return max(safe_convert(safe_get(_parse_view_private_metadata(body), "offset"), int) or 0, 0)
    return 0


def _filter_inputs_were_shown(body: dict, action_id: str | None, stored: dict) -> bool:
    """Whether the view the user acted in had the filter inputs on screen, so its state holds their current values."""
    if safe_get(stored, "filters_open") or action_id in FILTER_ACTIONS:
        return True
    state_values = safe_get(body, "view", "state", "values") or {}
    return any(block_id in state_values for block_id in FILTER_ACTIONS)


def _filters_open(action_id: str | None, were_shown: bool) -> bool:
    """Whether the filter inputs show: the Filters button flips them, a filter change keeps them showing, any other
    refresh of the same view keeps them as they were, and a newly opened calendar starts with them hidden."""
    if action_id == actions.CALENDAR_HOME_FILTERS:
        return not were_shown
    if action_id in FILTER_ACTIONS:
        return True
    return were_shown


def _filters_button_label(filters_open: bool, active_count: int) -> str:
    if filters_open:
        return ":gear: Hide filters"
    return f":gear: Filters ({active_count} active)" if active_count else ":gear: Filters"


def handle_event_preblast_select_button(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    action = safe_get(body, "actions", 0, "action_id")
    view_id = safe_get(body, "view", "id")
    if action == actions.EVENT_PREBLAST_NEW_BUTTON:
        event_instance.build_event_instance_add_form(
            body, client, logger, context, region_record, new_preblast=True, loading_form=True
        )
    elif action == actions.OPEN_CALENDAR_BUTTON:
        build_home_form(body, client, logger, context, region_record, update_view_id=view_id)


def build_home_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id: str = None,
):
    action_id = safe_get(body, "actions", 0, "action_id")
    if action_id == actions.CALENDAR_HOME_DATE_FILTER and not safe_get(body, "actions", 0, "selected_date"):
        return
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    user_id = get_user(slack_user_id, region_record, client, logger, require_link=False).user_id

    metadata = safe_convert(safe_get(body, "view", "metadata", "event_payload"), json.loads) or {}
    user_is_admin = safe_get(metadata, "user_is_admin")
    if user_is_admin is None:
        admin_users = get_admin_users(region_record.org_id, region_record.team_id)
        aoq_users = get_aoq_users(region_record.org_id)
        if constants.ALL_USERS_ARE_ADMINS:
            user_is_admin = True
        else:
            user_is_admin = any(u[0].id == user_id for u in admin_users) or any(u.id == user_id for u in aoq_users)
        metadata["user_is_admin"] = user_is_admin

    view_id = update_view_id or safe_get(body, actions.LOADING_ID) or safe_get(body, "view", "id")
    offset = _page_offset(body, action_id, view_id)
    metadata["offset"] = offset
    # Filter values and visibility live in private_metadata so they survive while the inputs are hidden.
    same_view = bool(view_id) and safe_get(body, "view", "id") == view_id
    stored = _parse_view_private_metadata(body) if same_view else {}
    filter_inputs_were_shown = same_view and _filter_inputs_were_shown(body, action_id, stored)
    filters_open = _filters_open(action_id, filter_inputs_were_shown)

    start_time = time.time()
    group_by_option = region_record.calendar_group_by_option or "ao"
    ao_records = DbManager.find_records(
        Org, filters=[Org.parent_id == region_record.org_id, Org.org_type == Org_Type.ao, Org.is_active.is_(True)]
    )
    location_records = DbManager.find_records(Location, [Location.org_id == region_record.org_id, Location.is_active])
    location_records2 = DbManager.find_join_records2(
        Location,
        Org,
        [Location.org_id == Org.id, Org.parent_id == region_record.org_id, Location.is_active],
    )
    location_records.extend(record[0] for record in location_records2)
    location_records.sort(key=sort_by_name(get_location_display_name))
    event_type_records: List[EventType] = DbManager.find_records(
        EventType,
        filters=[or_(EventType.specific_org_id == region_record.org_id, EventType.specific_org_id.is_(None))],
    )
    split_time = time.time()
    logger.debug(f"AO and Event Type query time: {split_time - start_time:.2f} seconds")
    start_time = time.time()

    filter_inputs: list[orm.BaseBlock] = [
        orm.InputBlock(
            label="Filter AOs" if group_by_option == "ao" else "Filter Locations",
            action=actions.CALENDAR_HOME_AO_FILTER,
            element=orm.MultiStaticSelectElement(
                placeholder="Filter AOs" if group_by_option == "ao" else "Filter Locations",
                options=orm.as_selector_options(
                    names=[ao.name for ao in ao_records]
                    if group_by_option == "ao"
                    else [get_location_display_name(location) for location in location_records],
                    values=[str(ao.id) for ao in ao_records]
                    if group_by_option == "ao"
                    else [str(location.id) for location in location_records],
                ),
            ),
            dispatch_action=True,
        ),
        orm.InputBlock(
            label="Filter Event Types",
            action=actions.CALENDAR_HOME_EVENT_TYPE_FILTER,
            element=orm.MultiStaticSelectElement(
                placeholder="Filter Event Types",
                options=orm.as_selector_options(
                    names=[event_type.name for event_type in event_type_records],
                    values=[str(event_type.id) for event_type in event_type_records],
                ),
            ),
            dispatch_action=True,
        ),
        orm.InputBlock(
            label="Start Search Date",
            action=actions.CALENDAR_HOME_DATE_FILTER,
            element=orm.DatepickerElement(
                placeholder="Start Search Date",
            ),
            dispatch_action=True,
        ),
        orm.InputBlock(
            label="Other options",
            action=actions.CALENDAR_HOME_Q_FILTER,
            element=orm.CheckboxInputElement(
                options=orm.as_selector_options(names=list(OPTION_LABELS.values()), values=list(OPTION_LABELS)),
            ),
            dispatch_action=True,
        ),
    ]

    if filter_inputs_were_shown:
        existing_filter_data = orm.BlockView(blocks=filter_inputs).get_selected_values(body)
    else:
        existing_filter_data = safe_get(stored, "filters") or {}
    metadata["filters"] = {k: v for k, v in existing_filter_data.items() if v}
    metadata["filters_open"] = filters_open

    # Build the filter
    start_date_selected = safe_convert(
        safe_get(existing_filter_data, actions.CALENDAR_HOME_DATE_FILTER), datetime.datetime.strptime, ["%Y-%m-%d"]
    )
    if start_date_selected:
        start_date_selected = start_date_selected.date()
    start_date = start_date_selected or datetime.datetime.now(tz=pytz.timezone("US/Central")).date()

    selected_group_filter_ids = [
        v
        for v in (safe_convert(x, int) for x in (safe_get(existing_filter_data, actions.CALENDAR_HOME_AO_FILTER) or []))
        if v is not None
    ]

    filter = [EventInstance.start_date >= start_date, EventInstance.is_active]
    if group_by_option == "ao":
        filter_org_ids = selected_group_filter_ids or [region_record.org_id]
        filter.append(or_(EventInstance.org_id.in_(filter_org_ids), Org.parent_id.in_(filter_org_ids)))
    else:
        # Keep location grouping constrained to this region and its child AOs.
        filter.append(or_(EventInstance.org_id == region_record.org_id, Org.parent_id == region_record.org_id))
        if selected_group_filter_ids:
            filter.append(EventInstance.location_id.in_(selected_group_filter_ids))

    if safe_get(existing_filter_data, actions.CALENDAR_HOME_EVENT_TYPE_FILTER):
        event_type_ids = [int(x) for x in safe_get(existing_filter_data, actions.CALENDAR_HOME_EVENT_TYPE_FILTER)]
        filter.append(EventInstance.event_types.any(EventType.id.in_(event_type_ids)))

    selected_options = safe_get(existing_filter_data, actions.CALENDAR_HOME_Q_FILTER) or []
    open_q_only = actions.FILTER_OPEN_Q in selected_options
    only_users_events = actions.FILTER_MY_EVENTS in selected_options
    if actions.FILTER_SPECIAL_EVENTS in selected_options:
        filter.append(EventInstance.highlight.is_(True))

    summary_parts = _filter_summary(existing_filter_data, group_by_option, start_date_selected)
    blocks: list[orm.BaseBlock] = [
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(
                    ":calendar: Calendar Images", value="calendar", action=actions.OPEN_CALENDAR_IMAGE_BUTTON
                ),
                orm.ButtonElement(
                    ":world_map: Nearby Special Events", value="nearby", action=actions.NEARBY_EVENTS_OPEN
                ),
                # Slack's collapsible container block isn't allowed in modals, so a button shows and hides the inputs.
                orm.ButtonElement(
                    _filters_button_label(filters_open, len(summary_parts)),
                    value="hide" if filters_open else "show",
                    action=actions.CALENDAR_HOME_FILTERS,
                ),
            ]
        ),
        *(filter_inputs if filters_open else []),
        orm.ContextBlock(
            element=orm.ContextElement(
                initial_value=f"Showing: {' · '.join(summary_parts)}"
                if summary_parts
                else "Showing: all upcoming events"
            )
        ),
        orm.ContextBlock(element=orm.ContextElement(initial_value=LEGEND)),
    ]

    # Run the query
    split_time = time.time()
    logger.debug(f"Block building time: {split_time - start_time:.2f} seconds")
    start_time = time.time()
    events: list[CalendarHomeQuery] = home_schedule_query(
        user_id,
        filter,
        limit=HOME_PAGE_SIZE,
        offset=offset,
        open_q_only=open_q_only,
        only_users_events=only_users_events,
    )

    split_time = time.time()
    logger.debug(f"Home schedule query: {split_time - start_time:.2f} seconds")
    start_time = time.time()

    # Build the event list, keeping one block free for the paging buttons.
    active_date: datetime.date | None = None
    rendered = 0
    for event in events:
        active_date, appended = _append_calendar_event_group(
            blocks=blocks,
            event_blocks=_event_blocks(event, user_is_admin),
            event_date=event.event.start_date,
            active_date=active_date,
            block_limit=SLACK_MODAL_BLOCK_LIMIT - 1,
        )
        if not appended:
            break
        rendered += 1

    if not events:
        empty_text = (
            "No more events. Use Back to start to see the first page."
            if offset > 0
            else "No upcoming events match these filters."
        )
        blocks.append(orm.SectionBlock(label=empty_text))

    paging_buttons = []
    if offset > 0:
        paging_buttons.append(
            orm.ButtonElement(label=":rewind: Back to start", action=actions.CALENDAR_HOME_SHOW_FIRST, value="0")
        )
    if rendered < len(events) or len(events) == HOME_PAGE_SIZE:
        paging_buttons.append(
            orm.ButtonElement(label="Show more", action=actions.CALENDAR_HOME_SHOW_MORE, value=str(offset + rendered))
        )
    if paging_buttons:
        blocks.append(orm.ActionsBlock(elements=paging_buttons))

    form = orm.BlockView(blocks=blocks)
    form.set_initial_values(existing_filter_data)
    split_time = time.time()
    logger.debug(f"Block build 2 time: {split_time - start_time:.2f} seconds")
    start_time = time.time()
    if view_id:
        form.update_modal(
            client=client,
            view_id=view_id,
            title_text="Calendar Home",
            callback_id=actions.CALENDAR_HOME_CALLBACK_ID,
            submit_button_text="None",
            parent_metadata=metadata,
            # Paging and the Filters button have no loading view to fall back on, so a rejected update must reach
            # the dispatcher.
            raise_on_error=view_id == safe_get(body, actions.LOADING_ID)
            or action_id
            in (actions.CALENDAR_HOME_SHOW_MORE, actions.CALENDAR_HOME_SHOW_FIRST, actions.CALENDAR_HOME_FILTERS),
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Calendar Home",
            callback_id=actions.CALENDAR_HOME_CALLBACK_ID,
            new_or_add="new",
            parent_metadata=metadata,
        )
    split_time = time.time()
    logger.debug(f"Sending: {split_time - start_time:.2f} seconds")
    start_time = time.time()


def build_calendar_image_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    num_weeks = safe_convert(region_record.calendar_weeks_shown, int) or 2
    num_weeks = max(1, min(num_weeks, MAX_CALENDAR_WEEKS))
    weeks = WEEK_LABELS[:num_weeks]

    valid_weeks: List[str] = []
    image_urls: dict[str, str] = {}
    for week in weeks:
        image_name = getattr(region_record, f"calendar_image_{week}", None)
        if not image_name:
            # No image generated yet - skip the (guaranteed to fail) HEAD request so we stay well
            # inside the few seconds a Slack trigger_id stays valid.
            continue
        image_url = storage.public_url(storage.CALENDAR_IMAGES, image_name)
        try:
            valid = requests.head(image_url, timeout=2).status_code == 200
        except Exception as e:
            logger.error(f"Error checking calendar image URL for {week} week: {e}")
            valid = False
        if valid:
            valid_weeks.append(week)
            image_urls[week] = image_url

    if valid_weeks:
        blocks = [
            orm.image_or_link_block(
                label=WEEK_SCHEDULE_LABELS[week], alt_text=WEEK_SCHEDULE_LABELS[week], image_url=image_urls[week]
            )
            for week in valid_weeks
        ]
        if len(valid_weeks) < len(weeks):
            blocks.append(orm.SectionBlock(label="Some weeks are still generating and will appear here shortly."))
    else:
        blocks = [orm.SectionBlock(label="No calendar images available. Please wait for them to generate.")]
    form = orm.BlockView(blocks=blocks)
    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Calendar Images",
        callback_id=actions.CALENDAR_HOME_CALLBACK_ID,
        new_or_add="add",
        submit_button_text="None",
    )


ASSIGN_Q_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(label="Assign Q to this event"),
        orm.InputBlock(
            label="Select User",
            action=actions.CALENDAR_HOME_ASSIGN_Q_USER,
            element=orm.MultiUsersSelectElement(
                placeholder="Select a user to assign to the Q",
                initial_value=None,
                max_selected_items=1,
            ),
        ),
        orm.InputBlock(
            label="Select Co-Qs (optional)",
            action=actions.CALENDAR_HOME_ASSIGN_Q_CO_QS,
            element=orm.MultiUsersSelectElement(
                placeholder="Select users to assign as Co-Qs",
                initial_value=None,
            ),
            optional=True,
        ),
    ]
)


def build_assign_q_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    event_instance_id: int,
    update_view_id: str = None,
):
    event_instance = DbManager.get(EventInstance, event_instance_id, joinedloads=[EventInstance.org])
    attendance = DbManager.find_records(
        Attendance,
        filters=[Attendance.event_instance_id == event_instance_id],
        joinedloads=[Attendance.slack_users, Attendance.attendance_types],
    )

    form = copy.deepcopy(ASSIGN_Q_FORM)
    form.blocks[0].label = (
        f"*AO:* {event_instance.org.name}\n"
        + f"*Event:* {event_instance.name}\n"
        + f"*Date:* {event_instance.start_date.strftime('%A, %B %d')}\n"
        + f"*Start Time:* {event_instance.start_time or 'TBD'}\n"
    )

    existing_q_slack_users = [a.slack_users for a in attendance if any(at.type == "Q" for at in a.attendance_types)]
    if existing_q_slack_users:
        slack_user_id = [su.slack_id for su in existing_q_slack_users[0] if su.slack_team_id == region_record.team_id]
        form.set_initial_values({actions.CALENDAR_HOME_ASSIGN_Q_USER: slack_user_id[:1] if slack_user_id else None})
    existing_co_q_slack_users = [
        a.slack_users for a in attendance if any(at.type == "Co-Q" for at in a.attendance_types)
    ]
    if existing_co_q_slack_users:
        slack_user_ids = []
        for slack_user in existing_co_q_slack_users:
            slack_user_id = [su.slack_id for su in slack_user if su.slack_team_id == region_record.team_id]
            slack_user_ids.append(safe_get(slack_user_id, 0))
        form.set_initial_values({actions.CALENDAR_HOME_ASSIGN_Q_CO_QS: slack_user_ids})

    metadata = {
        "event_instance_id": event_instance_id,
        "update_view_id": update_view_id,
        "event_instance_name": event_instance.name,
        "event_instance_date": event_instance.start_date.strftime("%A, %B %d"),
    }
    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Assign Q",
        callback_id=actions.HOME_ASSIGN_Q_CALLBACK_ID,
        submit_button_text="Assign Q",
        parent_metadata=metadata,
        new_or_add="add",
    )


def handle_assign_q_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    form_data = ASSIGN_Q_FORM.get_selected_values(body)
    metadata = safe_convert(safe_get(body, "view", "private_metadata"), json.loads) or {}
    event_instance_id = safe_convert(safe_get(metadata, "event_instance_id"), int)
    event_instance_name = safe_get(metadata, "event_instance_name")
    event_instance_date = safe_get(metadata, "event_instance_date")

    # Get the selected user and co-Qs
    q_slack_user_ids = safe_get(form_data, actions.CALENDAR_HOME_ASSIGN_Q_USER) or []
    q_slack_user_id = safe_get(q_slack_user_ids, 0)
    q_user_id = get_user(q_slack_user_id, region_record, client, logger).user_id if q_slack_user_id else None
    co_qs_slack_ids = safe_get(form_data, actions.CALENDAR_HOME_ASSIGN_Q_CO_QS) or []
    co_qs_user_ids = [get_user(co_q, region_record, client, logger).user_id for co_q in co_qs_slack_ids]

    # Existing attendance records
    existing_attendance_records = DbManager.find_records(
        Attendance,
        filters=[Attendance.event_instance_id == event_instance_id],
        joinedloads=[Attendance.slack_users, Attendance.attendance_types],
    )

    # Delete existing Q / Co-Q attendance records entirely
    q_changed = False
    for ea in existing_attendance_records:
        if any(at.type in ["Q", "Co-Q"] for at in ea.attendance_types):
            q_changed = True
            DbManager.delete_records(
                cls=Attendance_x_AttendanceType,
                filters=[Attendance_x_AttendanceType.attendance_id == ea.id],
            )
            DbManager.delete_records(
                cls=Attendance,
                filters=[Attendance.id == ea.id],
            )

    # Touch EventInstance.updated so calendar images are regenerated when Q changes
    if q_changed or q_user_id or co_qs_user_ids:
        DbManager.update_record(
            EventInstance, event_instance_id, fields={"updated": datetime.datetime.now(datetime.timezone.utc)}
        )

    # Existing attendance records again (probably a better way to do this)
    existing_attendance_records = DbManager.find_records(
        Attendance,
        filters=[Attendance.event_instance_id == event_instance_id],
        joinedloads=[Attendance.slack_users, Attendance.attendance_types],
    )

    if q_user_id:
        if q_user_id in [ea.user_id for ea in existing_attendance_records]:
            attendance_record = next((ea for ea in existing_attendance_records if ea.user_id == q_user_id), None)
            if attendance_record and 2 not in [at.id for at in attendance_record.attendance_types]:
                DbManager.create_record(
                    Attendance_x_AttendanceType(attendance_id=attendance_record.id, attendance_type_id=2)
                )
        else:
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=q_user_id,
                    is_planned=True,
                    attendance_x_attendance_types=[
                        Attendance_x_AttendanceType(attendance_type_id=2)  # Q
                    ],
                )
            )

    if co_qs_user_ids:
        for co_q_user_id in co_qs_user_ids:
            if co_q_user_id in [ea.user_id for ea in existing_attendance_records]:
                attendance_record = next((ea for ea in existing_attendance_records if ea.user_id == co_q_user_id), None)
                if attendance_record and 3 not in [at.id for at in attendance_record.attendance_types]:
                    DbManager.create_record(
                        Attendance_x_AttendanceType(attendance_id=attendance_record.id, attendance_type_id=3)
                    )
            else:
                DbManager.create_record(
                    Attendance(
                        event_instance_id=event_instance_id,
                        user_id=co_q_user_id,
                        is_planned=True,
                        attendance_x_attendance_types=[
                            Attendance_x_AttendanceType(attendance_type_id=3)  # Co-Q
                        ],
                    )
                )

    # Update the home view if needed
    update_view_id = safe_get(metadata, "update_view_id")
    if update_view_id:
        build_home_form(body, client, logger, context, region_record, update_view_id=update_view_id)

    # Send messages to the assigned users
    if q_slack_user_id and q_slack_user_id != user_id:
        msg = f"<@{user_id}> has assigned you to Q {event_instance_name} on {event_instance_date}. Use the button below to set the preblast."  # noqa
        blocks: List[orm.BaseBlock] = [
            orm.SectionBlock(label=msg),
            orm.ActionsBlock(
                elements=[
                    orm.ButtonElement(
                        label="Fill Out Preblast",
                        value=str(event_instance_id),
                        style="primary",
                        action=actions.MSG_EVENT_PREBLAST_BUTTON,
                    ),
                ],
            ),
        ]
        client.chat_postMessage(
            channel=q_slack_user_id,
            text=msg,
            blocks=[b.as_form_field() for b in blocks],
        )
    for co_q_slack_id in co_qs_slack_ids:
        if co_q_slack_id != user_id:
            client.chat_postMessage(
                channel=co_q_slack_id,
                text=f"<@{user_id}> has assigned you to Co-Q {event_instance_name} on {event_instance_date}.",  # noqa
            )


def handle_home_event(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    event_instance_id = safe_convert(safe_get(body, "actions", 0, "action_id").split("_")[1], int)
    # The overflow menu sends the chosen option; the row's visible button sends the same action name as its value.
    action = safe_get(body, "actions", 0, "selected_option", "value") or safe_get(body, "actions", 0, "value")
    user_id = get_user(
        safe_get(body, "user", "id"), region_record, client, logger, require_link=action != "View Preblast"
    ).user_id
    view_id = safe_get(body, "view", "id")
    update_post = False
    hc_action: bool | None = None  # True = HC, False = Un-HC, None = not an HC action

    if action in ["View Preblast", "Edit Preblast"]:
        build_event_preblast_form(body, client, logger, context, region_record, event_instance_id=event_instance_id)
    elif action == "Edit Backblast":
        build_backblast_form(body, client, logger, context, region_record, event_instance_id=event_instance_id)
    elif action == "Take Q":
        attendance_record = DbManager.find_records(
            Attendance,
            filters=[
                Attendance.event_instance_id == event_instance_id,
                Attendance.user_id == user_id,
                Attendance.is_planned,
            ],
            joinedloads=[Attendance.attendance_x_attendance_types],
        )
        if attendance_record:
            if 2 not in attendance_record[0].attendance_x_attendance_types:
                DbManager.create_record(
                    Attendance_x_AttendanceType(attendance_id=attendance_record[0].id, attendance_type_id=2)
                )
        else:
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=user_id,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],
                    is_planned=True,
                )
            )

        # TODO: build the q / preblast form
        update_post = True
        build_home_form(body, client, logger, context, region_record, update_view_id=view_id)
    elif action == "HC":
        try:
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=user_id,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=1)],
                    is_planned=True,
                )
            )
            update_post = True
            hc_action = True
            build_home_form(body, client, logger, context, region_record, update_view_id=view_id)
        except IntegrityError as e:
            logger.warning(
                f"User {user_id} already has an attendance record for event instance {event_instance_id}, ignoring HC: {e}"  # noqa
            )
            update_post = False
    elif action == "Un-HC":
        DbManager.delete_records(
            cls=Attendance,
            filters=[
                Attendance.event_instance_id == event_instance_id,
                Attendance.user_id == user_id,
                Attendance.attendance_types.any(Attendance_x_AttendanceType.attendance_type_id == 1),
                Attendance.is_planned,
            ],
            joinedloads=[Attendance.attendance_types],
        )
        update_post = True
        hc_action = False
        build_home_form(body, client, logger, context, region_record, update_view_id=view_id)
    elif action == "Assign Q":
        build_assign_q_form(
            body, client, logger, context, region_record, event_instance_id=event_instance_id, update_view_id=view_id
        )
    elif action == "Close Event":
        form = copy.deepcopy(event_instance.EVENT_CLOSE_FORM)
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            callback_id=actions.EVENT_CLOSE_HOME_CALLBACK_ID,
            title_text="Close Event",
            submit_button_text="Close Event",
            parent_metadata={"event_instance_id": event_instance_id},
            new_or_add="add",
            close_button_text="Cancel",
        )
        update_post = False
        # build_home_form(body, client, logger, context, region_record, update_view_id=view_id)
    elif action == "Reopen Event":
        DbManager.update_record(EventInstance, event_instance_id, fields={EventInstance.series_exception: None})
        update_post = True
        build_home_form(body, client, logger, context, region_record, update_view_id=view_id)

    if update_post:
        preblast_info = build_preblast_info(body, client, logger, context, region_record, event_instance_id)
        if preblast_info.event_record.preblast_ts:
            q_list = [
                r.user.id
                for r in preblast_info.attendance_records
                if bool({t.id for t in r.attendance_types}.intersection([2, 3]))
            ]  # noqa
            blocks = [
                *preblast_info.preblast_blocks,
                orm.ActionsBlock(
                    elements=get_preblast_action_buttons(has_q=len(q_list) > 0, event_instance_id=event_instance_id)
                ),
            ]
            blocks = [b.as_form_field() for b in blocks]
            metadata = {
                "event_instance_id": event_instance_id,
                "attendees": [r.user.id for r in preblast_info.attendance_records],
                "qs": q_list,
            }
            try:
                client.chat_update(
                    channel=get_preblast_channel(region_record, preblast_info),
                    ts=safe_get(metadata, "preblast_ts") or str(preblast_info.event_record.preblast_ts),
                    blocks=blocks,
                    text="Event Preblast",
                    metadata={"event_type": "preblast", "event_payload": metadata},
                )
            except Exception as e:
                logger.error(f"Error updating preblast post, posting a new one: {e}")
                client.chat_postMessage(
                    channel=get_preblast_channel(region_record, preblast_info),
                    blocks=blocks,
                    text="Event Preblast",
                    metadata={"event_type": "preblast", "event_payload": metadata},
                )
            if hc_action is not None:
                post_hc_thread_reply(
                    client,
                    logger,
                    region_record,
                    get_preblast_channel(region_record, preblast_info),
                    safe_get(metadata, "preblast_ts") or str(preblast_info.event_record.preblast_ts),
                    safe_get(body, "user", "id"),
                    is_hc=hc_action,
                )

    elif action == "edit":
        pass


def handle_event_instance_close(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    metadata = _parse_view_private_metadata(body)
    event_instance_id = safe_get(metadata, "event_instance_id")
    close_reason = event_instance.EVENT_CLOSE_FORM.get_selected_values(body).get(event_instance.EVENT_CLOSE_REASON)
    event_instance_meta = safe_get(DbManager.get(EventInstance, event_instance_id), "meta") or {}
    event_instance_meta["series_exception_reason"] = close_reason
    prior_view_id = safe_get(body, "view", "previous_view_id")

    DbManager.update_record(
        EventInstance,
        event_instance_id,
        fields={
            EventInstance.series_exception: Series_Exception.closed,
            EventInstance.meta: event_instance_meta,
        },
    )
    build_home_form(body, client, logger, context, region_record, update_view_id=prior_view_id)
