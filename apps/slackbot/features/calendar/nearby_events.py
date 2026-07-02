import datetime
import json
import math
from dataclasses import dataclass
from logging import Logger
from typing import List, Optional

from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    EventInstance,
    Location,
    Org,
    Org_x_SlackSpace,
    SlackSpace,
)
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    REGION_RECORDS,
    current_date_cst,
    get_user,
    safe_convert,
    safe_get,
)
from utilities.slack import actions, orm

# ──────────────────────────────────────────────────────────────────────────────
# Constants
# ──────────────────────────────────────────────────────────────────────────────

DISTANCE_OPTIONS = ["25 miles", "50 miles", "100 miles", "200 miles"]
DISTANCE_VALUES = ["25", "50", "100", "200"]
SORT_OPTIONS = ["Sort by: Distance", "Sort by: Date"]
SORT_VALUES = ["distance", "date"]
DEFAULT_DISTANCE = "50"
DEFAULT_SORT = "distance"
DEFAULT_DAYS_AHEAD = 60
MAX_EVENTS_DISPLAYED = 20


# ──────────────────────────────────────────────────────────────────────────────
# Helpers
# ──────────────────────────────────────────────────────────────────────────────


def haversine_miles(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Return the great-circle distance in miles between two lat/lon points."""
    R = 3958.8  # Earth radius in miles
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    dphi = math.radians(lat2 - lat1)
    dlambda = math.radians(lon2 - lon1)
    a = math.sin(dphi / 2) ** 2 + math.cos(phi1) * math.cos(phi2) * math.sin(dlambda / 2) ** 2
    return R * 2 * math.atan2(math.sqrt(a), math.sqrt(1 - a))


def _get_target_settings(region_org_id: int) -> Optional[SlackSettings]:
    """Return SlackSettings for a region org, or None if not found or not on Slack."""
    ox = DbManager.find_first_record(Org_x_SlackSpace, [Org_x_SlackSpace.org_id == region_org_id])
    if not ox:
        return None
    slack_space = DbManager.get(SlackSpace, ox.slack_space_id)
    if not slack_space:
        return None
    settings = REGION_RECORDS.get(slack_space.team_id)
    if not settings and slack_space.settings:
        try:
            settings = SlackSettings(**slack_space.settings)
        except Exception:
            pass
    return settings


def _get_event_preblast_channel(target_settings: Optional[SlackSettings], event: EventInstance) -> Optional[str]:
    """Return the preblast channel for a target region's event."""
    if (
        target_settings
        and target_settings.default_preblast_destination == "specified_channel"
        and target_settings.preblast_destination_channel
    ):
        return target_settings.preblast_destination_channel
    if event.org and event.org.meta:
        return event.org.meta.get("slack_channel_id")
    return None


# ──────────────────────────────────────────────────────────────────────────────
# Data classes
# ──────────────────────────────────────────────────────────────────────────────


@dataclass
class NearbyEventRow:
    event: EventInstance
    ao_org: Org
    region_org: Optional[Org]
    distance_miles: float
    hc_count: int
    user_attending: bool


# ──────────────────────────────────────────────────────────────────────────────
# Service
# ──────────────────────────────────────────────────────────────────────────────


def get_region_midpoint(org_id: int) -> Optional[tuple]:
    """
    Return (avg_lat, avg_lon) centroid of all geolocated locations for this region and its AOs.
    Returns None if no locations with lat/lon are found.
    """
    region_locations: List[Location] = DbManager.find_records(
        Location,
        filters=[Location.org_id == org_id, Location.is_active],
    )
    ao_location_rows = DbManager.find_join_records2(
        Location,
        Org,
        [Location.org_id == Org.id, Org.parent_id == org_id, Location.is_active],
    )
    ao_locations = [row[0] for row in ao_location_rows]

    all_locations = region_locations + ao_locations
    geolocated = [loc for loc in all_locations if loc.latitude and loc.longitude]

    if not geolocated:
        return None

    avg_lat = sum(loc.latitude for loc in geolocated) / len(geolocated)
    avg_lon = sum(loc.longitude for loc in geolocated) / len(geolocated)
    return avg_lat, avg_lon


def get_nearby_special_events(
    org_id: int,
    center_lat: float,
    center_lon: float,
    max_miles: float,
    user_id: Optional[int],
    days_ahead: int = DEFAULT_DAYS_AHEAD,
) -> List[NearbyEventRow]:
    """
    Return upcoming special events (highlight=True) from other regions
    within max_miles of (center_lat, center_lon).
    """
    today = current_date_cst()
    end_date = today + datetime.timedelta(days=days_ahead)

    # Fetch all highlighted active upcoming events
    all_events: List[EventInstance] = DbManager.find_records(
        EventInstance,
        filters=[
            EventInstance.highlight,
            EventInstance.is_active,
            EventInstance.start_date >= today,
            EventInstance.start_date <= end_date,
        ],
        joinedloads=[EventInstance.org, EventInstance.location],
    )

    # Filter: AO-level events from other regions with location data within range
    candidates: List[tuple] = []
    for event in all_events:
        if not event.org or not event.org.parent_id:
            continue  # skip region-level events without an AO parent
        if event.org.parent_id == org_id:
            continue  # skip current region's events

        loc = event.location
        if not loc or not loc.latitude or not loc.longitude:
            continue  # skip events without geolocated location

        dist = haversine_miles(center_lat, center_lon, loc.latitude, loc.longitude)
        if dist <= max_miles:
            candidates.append((event, dist))

    if not candidates:
        return []

    # Batch-fetch region orgs
    region_ids = list({event.org.parent_id for event, _ in candidates})
    region_orgs: List[Org] = DbManager.find_records(Org, [Org.id.in_(region_ids)])
    region_org_dict = {org.id: org for org in region_orgs}

    # Batch-fetch all planned attendance for candidate events
    event_ids = [event.id for event, _ in candidates]
    attendances: List[Attendance] = DbManager.find_records(
        Attendance,
        filters=[
            Attendance.event_instance_id.in_(event_ids),
            Attendance.is_planned,
        ],
    )
    hc_count_dict: dict = {}
    user_attending_set: set = set()
    for att in attendances:
        hc_count_dict[att.event_instance_id] = hc_count_dict.get(att.event_instance_id, 0) + 1
        if user_id and att.user_id == user_id:
            user_attending_set.add(att.event_instance_id)

    rows = []
    for event, dist in candidates:
        rows.append(
            NearbyEventRow(
                event=event,
                ao_org=event.org,
                region_org=region_org_dict.get(event.org.parent_id),
                distance_miles=dist,
                hc_count=hc_count_dict.get(event.id, 0),
                user_attending=event.id in user_attending_set,
            )
        )
    return rows


# ──────────────────────────────────────────────────────────────────────────────
# View builder
# ──────────────────────────────────────────────────────────────────────────────


def _build_nearby_events_blocks(
    rows: List[NearbyEventRow],
    max_miles: float,
    sort_by: str,
    center_found: bool,
) -> List[orm.BaseBlock]:
    """Build the block list for the nearby events modal."""
    blocks: List[orm.BaseBlock] = [
        orm.InputBlock(
            label="Max distance",
            action=actions.NEARBY_EVENTS_DISTANCE,
            element=orm.StaticSelectElement(
                placeholder="Select distance",
                options=orm.as_selector_options(names=DISTANCE_OPTIONS, values=DISTANCE_VALUES),
                initial_value=str(int(max_miles)),
            ),
            dispatch_action=True,
        ),
        orm.InputBlock(
            label="Sort by",
            action=actions.NEARBY_EVENTS_SORT,
            element=orm.StaticSelectElement(
                placeholder="Sort by",
                options=orm.as_selector_options(names=SORT_OPTIONS, values=SORT_VALUES),
                initial_value=sort_by,
            ),
            dispatch_action=True,
        ),
        orm.DividerBlock(),
    ]

    if not center_found:
        blocks.append(
            orm.SectionBlock(label=":warning: No location data found for your region. Distances cannot be calculated.")
        )

    if not rows:
        blocks.append(
            orm.SectionBlock(
                label=(
                    f":mag: No special events found within *{int(max_miles)} miles* "
                    f"in the next {DEFAULT_DAYS_AHEAD} days."
                )
            )
        )
        return blocks

    if sort_by == "date":
        rows = sorted(rows, key=lambda r: (r.event.start_date, r.event.start_time or ""))
    else:
        rows = sorted(rows, key=lambda r: r.distance_miles)

    rows = rows[:MAX_EVENTS_DISPLAYED]

    active_date = None
    for row in rows:
        if row.event.start_date != active_date:
            active_date = row.event.start_date
            blocks.append(orm.DividerBlock())
            blocks.append(orm.HeaderBlock(label=f":calendar: {active_date.strftime('%A, %B %d')}"))

        region_name = row.region_org.name if row.region_org else "Unknown Region"
        ao_name = row.ao_org.name if row.ao_org else "Unknown AO"
        dist_str = f"{row.distance_miles:.0f} mi"
        time_str = row.event.start_time or "TBD"
        hc_emoji = " :white_check_mark:" if row.user_attending else ""
        location_name = row.event.location.name if row.event.location else "Maps Link"
        location_link = f"<https://www.google.com/maps/search/?api=1&query={row.event.location.latitude},{row.event.location.longitude}|{location_name}>"

        label = (
            f":star: *{row.event.name}*\n"
            f":house: {region_name} • {ao_name} ({dist_str})\n"
            f":round_pushpin: {location_link}\n"
            f":clock1: {time_str}   :muscle: {row.hc_count} HC(s){hc_emoji}"
        )

        action_value = json.dumps({"event_instance_id": row.event.id, "region_org_id": row.ao_org.parent_id})
        if row.user_attending:
            action_element = orm.ButtonElement(
                label="Un-HC",
                action=actions.NEARBY_EVENTS_UN_HC,
                value=action_value,
            )
        else:
            action_element = orm.ButtonElement(
                label="HC :raised_hands:",
                action=actions.NEARBY_EVENTS_HC,
                value=action_value,
            )

        blocks.append(orm.SectionBlock(label=label, element=action_element))

    return blocks


# ──────────────────────────────────────────────────────────────────────────────
# Handlers
# ──────────────────────────────────────────────────────────────────────────────


def build_nearby_events_modal(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    """Open or refresh the Nearby Special Events modal."""
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    user = get_user(slack_user_id, region_record, client, logger)
    user_id = user.user_id if user else None

    existing_view_id = safe_get(body, "view", "id")
    loading_id = safe_get(body, actions.LOADING_ID)
    action_id = safe_get(body, "actions", 0, "action_id")

    # Read filter state from current view (if any)
    state_values = safe_get(body, "view", "state", "values") or {}
    max_miles_str = (
        safe_get(
            state_values,
            actions.NEARBY_EVENTS_DISTANCE,
            actions.NEARBY_EVENTS_DISTANCE,
            "selected_option",
            "value",
        )
        or DEFAULT_DISTANCE
    )
    sort_by = (
        safe_get(
            state_values,
            actions.NEARBY_EVENTS_SORT,
            actions.NEARBY_EVENTS_SORT,
            "selected_option",
            "value",
        )
        or DEFAULT_SORT
    )
    max_miles = safe_convert(max_miles_str, float) or float(DEFAULT_DISTANCE)

    # Compute region midpoint and fetch events
    center = None
    if region_record.org_id:
        try:
            center = get_region_midpoint(region_record.org_id)
        except Exception as e:
            logger.error(f"Error computing region midpoint for org_id {region_record.org_id}: {e}")

    rows: List[NearbyEventRow] = []
    if center:
        try:
            rows = get_nearby_special_events(
                org_id=region_record.org_id,
                center_lat=center[0],
                center_lon=center[1],
                max_miles=max_miles,
                user_id=user_id,
            )
        except Exception as e:
            logger.error(f"Error fetching nearby special events: {e}")

    blocks = _build_nearby_events_blocks(
        rows=rows,
        max_miles=max_miles,
        sort_by=sort_by,
        center_found=center is not None,
    )

    form = orm.BlockView(blocks=blocks)
    title = "Nearby Special Events"
    callback_id = actions.NEARBY_EVENTS_CALLBACK_ID

    if loading_id:
        # Opened via loading-modal mechanism (e.g. from a Slack message button with loading=True)
        form.update_modal(
            client=client,
            view_id=loading_id,
            title_text=title,
            callback_id=callback_id,
            submit_button_text="None",
        )
    elif existing_view_id and action_id == actions.NEARBY_EVENTS_OPEN:
        # Button clicked while inside another modal → push as sub-modal
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text=title,
            callback_id=callback_id,
            new_or_add="add",
            submit_button_text="None",
        )
    elif existing_view_id:
        # Filter dispatch action or HC action from within the nearby events modal → update in place
        form.update_modal(
            client=client,
            view_id=existing_view_id,
            title_text=title,
            callback_id=callback_id,
            submit_button_text="None",
        )
    else:
        # Direct message button click with no existing modal → open new modal
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text=title,
            callback_id=callback_id,
            new_or_add="new",
            submit_button_text="None",
        )


def handle_nearby_events_hc_action(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    """HC or Un-HC on a nearby region's special event, then refresh the modal."""
    from features.calendar.event_preblast import post_hc_thread_reply

    action_id = safe_get(body, "actions", 0, "action_id")
    action_value = json.loads(safe_get(body, "actions", 0, "value") or "{}")
    event_instance_id = safe_convert(action_value.get("event_instance_id"), int)
    region_org_id = safe_convert(action_value.get("region_org_id"), int)

    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
    user = get_user(slack_user_id, region_record, client, logger)
    user_id = user.user_id if user else None

    is_hc = action_id == actions.NEARBY_EVENTS_HC

    if is_hc:
        try:
            DbManager.create_record(
                Attendance(
                    event_instance_id=event_instance_id,
                    user_id=user_id,
                    attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=1)],
                    is_planned=True,
                )
            )
        except Exception as e:
            logger.error(f"Error creating HC attendance for nearby event {event_instance_id}: {e}")
    else:
        try:
            DbManager.delete_records(
                cls=Attendance,
                filters=[
                    Attendance.event_instance_id == event_instance_id,
                    Attendance.user_id == user_id,
                    Attendance.is_planned,
                    Attendance.attendance_x_attendance_types.any(Attendance_x_AttendanceType.attendance_type_id == 1),
                ],
                joinedloads=[Attendance.attendance_x_attendance_types],
            )
        except Exception as e:
            logger.error(f"Error deleting HC attendance for nearby event {event_instance_id}: {e}")

    # Post HC announcement to the target region's preblast thread
    if region_org_id:
        try:
            target_settings = _get_target_settings(region_org_id)
            if target_settings and target_settings.bot_token:
                event_record: EventInstance = DbManager.get(
                    EventInstance, event_instance_id, joinedloads=[EventInstance.org]
                )
                if event_record and event_record.preblast_ts:
                    preblast_channel = _get_event_preblast_channel(target_settings, event_record)
                    target_client = WebClient(token=target_settings.bot_token)
                    post_hc_thread_reply(
                        client=target_client,
                        logger=logger,
                        region_record=target_settings,
                        preblast_channel=preblast_channel,
                        preblast_ts=str(event_record.preblast_ts),
                        slack_user_id=slack_user_id,
                        is_hc=is_hc,
                        event_instance_id=event_instance_id,
                    )
        except Exception as e:
            logger.error(f"Error posting HC announcement to target region for event {event_instance_id}: {e}")

    # Refresh the modal with updated HC state
    build_nearby_events_modal(body, client, logger, context, region_record)
