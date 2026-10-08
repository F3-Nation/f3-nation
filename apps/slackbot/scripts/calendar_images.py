import os
import sys
from typing import List

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

import hashlib
import json
import random
import re
import shutil
from copy import deepcopy
from datetime import UTC, datetime, timedelta
from math import isnan
from numbers import Real

import pytz
from f3_data_models.models import (
    Attendance,
    Attendance_x_AttendanceType,
    EventInstance,
    EventTag,
    EventTag_x_EventInstance,
    EventType,
    EventType_x_EventInstance,
    Location,
    Org,
    Org_Type,
    Org_x_SlackSpace,
    Series_Exception,
    SlackSpace,
    User,
)

# import dataframe_image as dfi
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.models import blocks
from sqlalchemy import and_, func, or_, select
from sqlalchemy.orm import aliased

from utilities.constants import (
    EVENT_TAG_COLORS,
    GCP_IMAGE_URL,
    LOCAL_DEVELOPMENT,
    MAX_CALENDAR_WEEKS,
    S3_IMAGE_URL,
    WEEK_ALT_TEXT,
    WEEK_LABELS,
)
from utilities.helper_functions import current_date_cst, safe_convert, safe_get, update_local_region_records
from utilities.slack import actions

DB_SCHEMA = os.getenv("DATABASE_SCHEMA", "f3_staging")
CALENDAR_IMAGE_TIMESTAMP_FORMAT = "%Y%m%dT%H%M%S%fZ"
CALENDAR_IMAGE_V1_PATTERN = re.compile(
    r"(?P<region_id>[1-9][0-9]*)-(?P<week>current|next|third)-v1-"
    r"(?P<generated_at>[0-9]{8}T[0-9]{12}Z)-(?P<fingerprint>[0-9a-f]{64})-[a-z]{10}\.png"
)


def parse_calendar_image_filename(
    filename, region_id: int, week: str, query_started_at: datetime
) -> tuple[datetime, str] | None:
    """Read metadata only from this region/week's valid, non-future v1 filename."""
    if not isinstance(filename, str):
        return None
    match = CALENDAR_IMAGE_V1_PATTERN.fullmatch(filename)
    if match is None or match["region_id"] != str(region_id) or match["week"] != week:
        return None
    try:
        generated_at = datetime.strptime(match["generated_at"], CALENDAR_IMAGE_TIMESTAMP_FORMAT).replace(tzinfo=UTC)
    except ValueError:
        return None
    if generated_at > query_started_at:
        return None
    return generated_at, match["fingerprint"]


def calendar_image_is_safe_to_delete(filename, region_id: int, week: str, query_started_at: datetime) -> bool:
    if not isinstance(filename, str) or region_id <= 0 or week not in WEEK_LABELS:
        return False
    return (
        re.fullmatch(rf"{region_id}-{week}-[a-z]{{10}}\.png", filename) is not None
        or parse_calendar_image_filename(filename, region_id, week, query_started_at) is not None
    )


def time_int_to_str(time: int) -> str:
    return f"{time // 100:02d}{time % 100:02d}"


def _normalize_label_value(value) -> str:
    if value is None or type(value).__name__ in {"NAType", "NaTType"}:
        return ""
    if isinstance(value, Real) and not isinstance(value, bool):
        if isnan(value):
            return ""
        if float(value).is_integer():
            return str(int(value))
    return str(value)


def _normalize_label_series(series):
    return series.map(_normalize_label_value)


def _normalize_event_time_value(value) -> str:
    if value is None or type(value).__name__ in {"NAType", "NaTType"}:
        return ""
    if isinstance(value, Real) and not isinstance(value, bool):
        if isnan(value):
            return ""
        return time_int_to_str(int(value))
    return str(value)


def _calendar_time_sort_key(value: str) -> str:
    return "9999" if value == "" else value


def _prepare_calendar_labels(df):
    q_name_missing = df["q_name"].isna()
    event_tag_mask = df["event_tag"].notnull()

    for label_column in (
        "q_name",
        "event_acronym",
        "event_tag",
    ):
        df.loc[:, label_column] = _normalize_label_series(df[label_column])
    df.loc[:, "event_time"] = df["start_time"].map(_normalize_event_time_value)
    df.loc[q_name_missing, "q_name"] = "OPEN!"
    df.loc[:, "q_name"] = df["q_name"].str.replace(r"\s\(([\s\S]*?\))", "", regex=True)

    # if pax_count is not null then second line is pax_count otherwise event_acronym + event_time # noqa
    df.loc[:, "label"] = df["q_name"] + "\n" + df["event_acronym"] + " " + df["event_time"]
    df.loc[df["pax_count"].notna(), "label"] = (
        df["q_name"] + "\nPAX: " + df["pax_count"].astype(str).str.replace(".0", "")
    )

    df.loc[event_tag_mask, "label"] = df["q_name"] + "\n" + df["event_tag"] + "\n" + df["event_time"]
    df.loc[(df["pax_count"].notna()) & event_tag_mask, "label"] = (
        df["q_name"] + "\n" + df["event_tag"] + "\nPAX: " + df["pax_count"].astype(str).str.replace(".0", "")
    )


def highlight_cells(s, color_dicts):
    import pandas as pd

    highlight_cells_list = []
    for cell in s:
        cell_str = str(cell)
        tags = cell_str.split("\n")
        found = False
        if tags:
            for tag in tags:
                if tag in color_dicts["region"].keys():
                    highlight_cells_list.append(f"background-color: {EVENT_TAG_COLORS[color_dicts['region'][tag]][0]}")
                    found = True
                    break
                elif tag in color_dicts["nation_not_black"].keys():
                    highlight_cells_list.append(
                        f"background-color: {EVENT_TAG_COLORS[color_dicts['nation_not_black'][tag]][0]}"
                    )
                    found = True
                    break
                elif tag in color_dicts["nation_black"].keys():
                    highlight_cells_list.append(
                        f"background-color: {EVENT_TAG_COLORS[color_dicts['nation_black'][tag]][0]}"
                    )
                    found = True
                    break
                elif tag in color_dicts["generic"].keys():
                    highlight_cells_list.append(f"background-color: {EVENT_TAG_COLORS[color_dicts['generic'][tag]][0]}")
                    found = True
                    break
        if not found:
            highlight_cells_list.append("background-color: #000000")
    return pd.Series(highlight_cells_list)


def set_text_color(s, color_dicts):
    text_color_list = []
    for cell in s:
        cell_str = str(cell)
        tags = cell_str.split("\n")
        found = False
        if tags:
            for tag in tags:
                if tag in color_dicts["region"].keys():
                    text_color_list.append(f"color: {EVENT_TAG_COLORS[color_dicts['region'][tag]][1]}")
                    found = True
                    break
                elif tag in color_dicts["nation_not_black"].keys():
                    text_color_list.append(f"color: {EVENT_TAG_COLORS[color_dicts['nation_not_black'][tag]][1]}")
                    found = True
                    break
                elif tag in color_dicts["nation_black"].keys():
                    text_color_list.append(f"color: {EVENT_TAG_COLORS[color_dicts['nation_black'][tag]][1]}")
                    found = True
                    break
                elif tag in color_dicts["generic"].keys():
                    text_color_list.append(f"color: {EVENT_TAG_COLORS[color_dicts['generic'][tag]][1]}")
                    found = True
                    break
        if not found:
            text_color_list.append("color: #F0FFFF")
    return text_color_list


def _remove_week_image(
    slack_app_settings: dict,
    region_id: int,
    week: str,
    pending_deletions: list | None = None,
    query_started_at: datetime | None = None,
) -> bool:
    """Remove settings and queue file cleanup, including stable-file retries."""
    removed = f"calendar_image_{week}" in slack_app_settings
    stale_file = slack_app_settings.pop(f"calendar_image_{week}", None)
    if LOCAL_DEVELOPMENT:
        return removed
    query_started_at = query_started_at or datetime.now(UTC)
    stale_filenames = (
        [stale_file] if calendar_image_is_safe_to_delete(stale_file, region_id, week, query_started_at) else []
    )
    if DB_SCHEMA == "f3_prod":
        # Retry even when settings were cleared by an earlier successful commit.
        stale_filenames.append(f"{region_id}-{week}.png")
    if pending_deletions is not None:
        pending_deletions.extend(stale_filenames)
        return removed
    for filename in stale_filenames:
        try:
            os.remove(f"/mnt/calendar-images/{filename}")
        except FileNotFoundError:
            pass
        except Exception as e:
            print(f"Error deleting stale file {filename} from local storage: {e}")
    return removed


def remove_stale_week_images(
    slack_app_settings: dict,
    region_id: int,
    num_weeks: int,
    pending_deletions: list | None = None,
    query_started_at: datetime | None = None,
) -> bool:
    """Drop weeks a region no longer displays and indicate whether its Slack post needs refreshing."""
    removed = False
    for stale_week in WEEK_LABELS[num_weeks:]:
        removed = (
            _remove_week_image(slack_app_settings, region_id, stale_week, pending_deletions, query_started_at)
            or removed
        )
    return removed


def post_calendar_to_slack(slack_app_settings: dict, num_weeks: int, first_sunday_run: bool) -> None:
    print("Posting to Slack channel")
    client = WebClient(token=slack_app_settings["bot_token"])
    if LOCAL_DEVELOPMENT:
        IMAGE_URL = S3_IMAGE_URL
    else:
        IMAGE_URL = GCP_IMAGE_URL
    block_list = [blocks.HeaderBlock(text=":calendar: Q Calendar")]
    for week in WEEK_LABELS[:num_weeks]:
        image_name = slack_app_settings.get(f"calendar_image_{week}")
        if image_name:
            block_list.append(
                blocks.ImageBlock(
                    image_url=IMAGE_URL.format(
                        bucket="f3nation-calendar-images",
                        image_name=image_name,
                    ),
                    alt_text=WEEK_ALT_TEXT[week],
                )
            )
    block_list.append(
        blocks.ActionsBlock(
            elements=[
                blocks.ButtonElement(
                    text=":calendar: Open Full Calendar",
                    action_id=actions.OPEN_CALENDAR_BUTTON,
                ),
                blocks.ButtonElement(
                    text=":world_map: Nearby Special Events",
                    action_id=actions.NEARBY_EVENTS_OPEN,
                ),
            ]
        )
    )
    block_list.extend(create_special_events_blocks(slack_app_settings))
    try:
        if slack_app_settings.get("q_image_posting_ts") and (not first_sunday_run):
            try:
                response = client.chat_update(
                    channel=slack_app_settings["q_image_posting_channel"],
                    ts=slack_app_settings["q_image_posting_ts"],
                    blocks=block_list,
                    text="Q Sheet",
                )
                if not response["ok"]:
                    raise RuntimeError("Slack calendar update failed")
            except Exception as e:
                print(f"Error updating Slack message, posting new message: {e}")
                response = client.chat_postMessage(
                    channel=slack_app_settings["q_image_posting_channel"],
                    text="Q Sheet",
                    blocks=block_list,
                )
                if not response["ok"]:
                    raise RuntimeError("Slack calendar post failed") from e
                slack_app_settings["q_image_posting_ts"] = response["ts"]
        else:
            response = client.chat_postMessage(
                channel=slack_app_settings["q_image_posting_channel"],
                text="Q Sheet",
                blocks=block_list,
            )
            if not response["ok"]:
                raise RuntimeError("Slack calendar post failed")
            slack_app_settings["q_image_posting_ts"] = response["ts"]
    except Exception as e:
        print(f"Error posting to Slack channel: {e}")
        raise


def slack_posting_enabled(slack_app_settings: dict) -> bool:
    return bool(
        slack_app_settings.get("q_image_posting_enabled")
        and slack_app_settings.get("q_image_posting_channel")
        and slack_app_settings.get("bot_token")
    )


def calendar_weeks_shown(slack_app_settings: dict) -> int:
    num_weeks = safe_convert(slack_app_settings.get("calendar_weeks_shown"), int) or 2
    return max(1, min(num_weeks, MAX_CALENDAR_WEEKS))


def calendar_image_is_stale(
    filename, region_id: int, week: str, max_changed: datetime, query_started_at: datetime, fingerprint: str
) -> bool:
    metadata = parse_calendar_image_filename(filename, region_id, week, query_started_at)
    if metadata is None:
        return True
    generated_at, saved_fingerprint = metadata
    # DB timestamp-without-timezone columns contain UTC values.
    if max_changed.tzinfo is None:
        max_changed = max_changed.replace(tzinfo=UTC)
    return max_changed > generated_at or saved_fingerprint != fingerprint


def generate_calendar_images(force: bool = False):
    import dataframe_image as dfi
    import pandas as pd

    with get_session() as session:
        tomorrow_day_of_week = (current_date_cst() + timedelta(days=1)).weekday()
        current_week_start = current_date_cst() + timedelta(days=-tomorrow_day_of_week + 1)
        overall_end = current_week_start + timedelta(weeks=MAX_CALENDAR_WEEKS)

        firstq_subquery = (
            select(
                Attendance.event_instance_id,
                Attendance.user_id,
                func.row_number()
                .over(partition_by=Attendance.event_instance_id, order_by=Attendance.created)
                .label("rn"),
            )
            .select_from(Attendance)
            .join(Attendance_x_AttendanceType, Attendance.id == Attendance_x_AttendanceType.attendance_id)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .filter(
                Attendance_x_AttendanceType.attendance_type_id == 2,
                EventInstance.start_date >= current_week_start,
                EventInstance.start_date < overall_end,
            )
            .alias()
        )

        attendance_subquery = (
            select(
                Attendance.event_instance_id,
                func.max(Attendance.updated).label("q_last_updated"),
            )
            .select_from(Attendance)
            .join(Attendance_x_AttendanceType, Attendance.id == Attendance_x_AttendanceType.attendance_id)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .filter(
                Attendance_x_AttendanceType.attendance_type_id == 2,
                EventInstance.start_date >= current_week_start,
                EventInstance.start_date < overall_end,
            )
            .group_by(Attendance.event_instance_id)
            .alias()
        )

        RegionOrg = aliased(Org)

        query = (
            session.query(
                EventInstance.start_date,
                EventInstance.start_time,
                EventInstance.updated.label("event_updated"),
                EventInstance.pax_count,
                EventInstance.series_exception,
                EventTag.name.label("event_tag"),
                EventTag.color.label("event_tag_color"),
                EventType.name.label("event_type"),
                EventType.acronym.label("event_acronym"),
                Org.name.label("ao_name"),
                Org.description.label("ao_description"),
                Org.parent_id.label("ao_parent_id"),
                User.f3_name.label("q_name"),
                Location.name.label("location_name"),
                Location.description.label("location_description"),
                Location.address_street.label("location_address_street"),
                attendance_subquery.c.q_last_updated,
                RegionOrg.name.label("region_name"),
                RegionOrg.id.label("region_id"),
            )
            .select_from(EventInstance)
            .outerjoin(EventTag_x_EventInstance, EventInstance.id == EventTag_x_EventInstance.event_instance_id)
            .outerjoin(EventTag, EventTag_x_EventInstance.event_tag_id == EventTag.id)
            .join(EventType_x_EventInstance, EventInstance.id == EventType_x_EventInstance.event_instance_id)
            .join(EventType, EventType_x_EventInstance.event_type_id == EventType.id)
            .join(Org, EventInstance.org_id == Org.id)
            .join(RegionOrg, RegionOrg.id == Org.parent_id)
            .outerjoin(Location, EventInstance.location_id == Location.id)
            .outerjoin(
                firstq_subquery,
                and_(EventInstance.id == firstq_subquery.c.event_instance_id, firstq_subquery.c.rn == 1),
            )
            .outerjoin(User, User.id == firstq_subquery.c.user_id)
            .outerjoin(attendance_subquery, EventInstance.id == attendance_subquery.c.event_instance_id)
            .filter(
                (EventInstance.start_date >= current_week_start),
                (EventInstance.start_date < overall_end),
                (EventInstance.is_active),
                # (EventInstance.series_id.is_not(None)),
                or_(EventTag.name.is_(None), EventTag.name != "Off-The-Books"),
            )
        )

        # Use the query start, not export completion: changes during rendering must
        # still trigger regeneration on the next run.
        generation_started_at = datetime.now(UTC)
        results = query.all()
        df_all = pd.DataFrame(results, columns=[column.key for column in query.statement.selected_columns])

        event_tags = session.query(EventTag).all()

        region_org_records = (
            session.query(Org, Org_x_SlackSpace, SlackSpace)
            .select_from(Org)
            .join(Org_x_SlackSpace, Org.id == Org_x_SlackSpace.org_id)
            .join(SlackSpace, Org_x_SlackSpace.slack_space_id == SlackSpace.id)
            .filter(Org.org_type == Org_Type.region)
            .all()
        )

        region_ids_with_events = {int(r) for r in df_all["region_id"].unique()} if not df_all.empty else set()

        for region_id in region_ids_with_events | {r[0].id for r in region_org_records}:
            try:
                df_full = df_all[df_all["region_id"] == region_id].copy()
                region_name = str(region_id)
                region_org_record = safe_get([r for r in region_org_records if r[0].id == region_id], 0)
                if region_org_record:
                    slack_app_settings: dict = deepcopy(region_org_record[2].settings)
                    pending_deletions = []
                    generated_backing_files = []
                    region_name = region_org_record[0].name
                    print(f"Running for {region_name}")

                    group_by_option = slack_app_settings.get("calendar_group_by_option") or "ao"
                    color_dict_region = {t.name: t.color for t in event_tags if t.specific_org_id == region_id}
                    color_dict_nation_not_black = {
                        t.name: t.color for t in event_tags if t.specific_org_id is None and t.color != "Black"
                    }
                    color_dict_nation_black = {
                        t.name: t.color for t in event_tags if t.specific_org_id is None and t.color == "Black"
                    }
                    color_dict_generic = {
                        "OPEN!": slack_app_settings.get("open_event_color") or "Green",
                        "CLOSED": "Closed",
                    }
                    all_color_dicts = {
                        "region": color_dict_region,
                        "nation_not_black": color_dict_nation_not_black,
                        "nation_black": color_dict_nation_black,
                        "generic": color_dict_generic,
                    }
                    num_weeks = calendar_weeks_shown(slack_app_settings)
                    calendar_updated = remove_stale_week_images(
                        slack_app_settings, region_id, num_weeks, pending_deletions, generation_started_at
                    )
                    now_cst = datetime.now(pytz.timezone("US/Central"))
                    first_sunday_run = now_cst.weekday() == 6 and now_cst.hour < 1

                    for week_index, week in enumerate(WEEK_LABELS[:num_weeks]):
                        week_start = current_week_start + timedelta(weeks=week_index)
                        week_end = week_start + timedelta(days=7)
                        df = df_full[(df_full["start_date"] >= week_start) & (df_full["start_date"] < week_end)].copy()
                        # Remove obsolete images instead of rendering empty calendars.
                        if df.empty:
                            calendar_updated = (
                                _remove_week_image(
                                    slack_app_settings, region_id, week, pending_deletions, generation_started_at
                                )
                                or calendar_updated
                            )
                            continue

                        max_event_updated = (
                            datetime(year=1900, month=1, day=1)
                            if df["event_updated"].isnull().all()
                            else df["event_updated"].max()
                        )
                        max_q_last_updated = (
                            datetime(year=1900, month=1, day=1)
                            if df["q_last_updated"].isnull().all()
                            else df["q_last_updated"].max()
                        )
                        max_changed = max(max_event_updated, max_q_last_updated)
                        # Hash rendering inputs, not timestamps or unused query metadata.
                        content = df.drop(
                            columns=[
                                "event_updated",
                                "q_last_updated",
                                "ao_parent_id",
                                "region_name",
                                "region_id",
                                "event_type",
                                "event_tag_color",
                            ]
                        )
                        # Sort serialized rows so database row order does not invalidate images.
                        # Include week boundaries so the displayed range rolls forward on Sundays.
                        fingerprint = hashlib.sha256(
                            (
                                str(week_start)
                                + str(week_end)
                                + str(group_by_option)
                                + json.dumps(all_color_dicts, sort_keys=True)
                                + repr(
                                    sorted(
                                        json.dumps(row, sort_keys=True)
                                        for row in json.loads(content.to_json(orient="records", date_format="iso"))
                                    )
                                )
                            ).encode()
                        ).hexdigest()
                        max_changed = datetime(year=1900, month=1, day=1) if pd.isnull(max_changed) else max_changed

                        if (
                            calendar_image_is_stale(
                                slack_app_settings.get(f"calendar_image_{week}"),
                                region_id,
                                week,
                                max_changed,
                                generation_started_at,
                                fingerprint,
                            )
                            or first_sunday_run
                            or LOCAL_DEVELOPMENT
                            or force
                        ):
                            # convert start_date from date to string
                            df.loc[:, "event_date"] = pd.to_datetime(df["start_date"])
                            df.loc[:, "event_date_fmt"] = df["event_date"].dt.strftime("%Y/%m/%d")
                            _prepare_calendar_labels(df)

                            # Override label for closed events
                            df.loc[df["series_exception"] == Series_Exception.closed, "label"] = "CLOSED"

                            if group_by_option == "ao":
                                df.loc[:, "AO\nLocation"] = (
                                    df["ao_name"].str.cat(df["ao_description"], sep="\n", na_rep="").str.rstrip("\n")
                                )
                                row_key_col = "AO\nLocation"
                                value_col = "label"
                                sort_key_col = "ao_name"
                            else:
                                # Create a readable location label similar to `get_location_display_name`.
                                location_name = df["location_name"].fillna("")
                                location_description = df["location_description"].fillna("")
                                location_address_street = df["location_address_street"].fillna("")

                                df.loc[:, "Location"] = location_name
                                desc_mask = (df["Location"] == "") & (location_description != "")
                                df.loc[desc_mask, "Location"] = location_description[desc_mask].str[:30]
                                street_mask = (df["Location"] == "") & (location_address_street != "")
                                df.loc[street_mask, "Location"] = location_address_street[street_mask].str[:30]
                                # Fallback to ao name if no location info is available
                                df.loc[df["Location"] == "", "Location"] = df["ao_name"]

                                # Include AO name in the cell now that the row header is the location.
                                df.loc[:, "cell_label"] = df["ao_name"] + "\n" + df["label"]
                                row_key_col = "Location"
                                value_col = "cell_label"
                                sort_key_col = "Location"

                            df.loc[:, "event_day_of_week"] = df["event_date"].dt.day_name()
                            df.to_csv(f"debug_{region_name}_{week}.csv", index=False)

                            # Combine cells for days within the chosen grouping (AO vs location).
                            df.sort_values(
                                [sort_key_col, "event_date", "event_time"],
                                key=lambda column: (
                                    column.map(_calendar_time_sort_key) if column.name == "event_time" else column
                                ),
                                ignore_index=True,
                                inplace=True,
                            )
                            prior_date = ""
                            prior_label = ""
                            prior_group_key = ""
                            include_list = []
                            for i in range(len(df)):
                                row2 = df.loc[i]
                                if (row2["event_date_fmt"] == prior_date) & (row2[sort_key_col] == prior_group_key):
                                    df.loc[i, value_col] = prior_label + "\n" + df.loc[i, value_col]
                                    prior_label = df.loc[i, value_col]
                                    include_list.append(False)
                                else:
                                    if prior_label != "":
                                        include_list.append(True)
                                    prior_date = row2["event_date_fmt"]
                                    prior_group_key = row2[sort_key_col]
                                    prior_label = row2[value_col]

                            include_list.append(True)

                            # filter out duplicate dates
                            df = df[include_list]

                            # Reshape to wide format by date
                            df2 = df.pivot(
                                index=row_key_col,
                                columns=["event_day_of_week", "event_date_fmt"],
                                values=value_col,
                            ).fillna("")

                            # Sort and enforce word wrap on labels
                            df2.sort_index(axis=1, level=["event_date_fmt"], inplace=True)
                            df2.columns = df2.columns.map("\n".join).str.strip("\n")
                            df2.reset_index(inplace=True)

                            # Take out "The " for sorting
                            grouping_sort_col = f"{row_key_col}2"
                            df2[grouping_sort_col] = df2[row_key_col].str.replace("The ", "")
                            df2.sort_values(by=[grouping_sort_col], axis=0, inplace=True)
                            df2.drop([grouping_sort_col], axis=1, inplace=True)
                            df2.reset_index(inplace=True, drop=True)

                            # Add timestamp footer row
                            now_cst = datetime.now(pytz.timezone("US/Central"))
                            timestamp_str = f"Last updated at {now_cst.strftime('%m/%d %I:%M %p')} CST"
                            footer_row = dict.fromkeys(df2.columns, "")
                            footer_row[row_key_col] = timestamp_str
                            df2 = pd.concat([df2, pd.DataFrame([footer_row])], ignore_index=True)

                            # Set CSS properties for th elements in dataframe
                            th_props = [
                                ("font-size", "15px"),
                                ("text-align", "center"),
                                ("font-weight", "bold"),
                                ("color", "#F0FFFF"),
                                ("background-color", "#000000"),
                                ("white-space", "pre-wrap"),
                                ("border", "1px solid #F0FFFF"),
                            ]

                            # Set CSS properties for td elements in dataframe
                            td_props = [
                                ("font-size", "15px"),
                                ("text-align", "center"),
                                ("white-space", "pre-wrap"),
                                # ('background-color', '#000000'),
                                # ("color", "#F0FFFF"),
                                ("border", "1px solid #F0FFFF"),
                            ]

                            # Set table styles
                            styles = [
                                {"selector": "th", "props": th_props},
                                {"selector": "td", "props": td_props},
                            ]

                            # set style and export png
                            # df_styled = df2.style.set_table_styles(styles).apply(highlight_cells).hide_index()
                            # apply styles, hide the index
                            df_styled = (
                                df2.style.set_table_styles(styles)
                                .apply(highlight_cells, color_dicts=all_color_dicts)
                                .hide(axis="index")
                            )
                            df_styled = df_styled.apply(set_text_color, color_dicts=all_color_dicts, axis=1)

                            # create calendar image
                            random_chars = "".join(random.choices("abcdefghijklmnopqrstuvwxyz", k=10))
                            filename = (
                                f"{region_id}-{week}-v1-"
                                f"{generation_started_at.strftime(CALENDAR_IMAGE_TIMESTAMP_FORMAT)}-"
                                f"{fingerprint}-{random_chars}.png"
                            )
                            filename_static = f"{region_id}-{week}.png"
                            if LOCAL_DEVELOPMENT:
                                dfi.export(df_styled, filename, table_conversion="playwright")
                                generated_backing_files.append((week, filename))
                            else:
                                dfi.export(df_styled, f"/mnt/calendar-images/{filename}", table_conversion="playwright")
                                generated_backing_files.append((week, filename))
                                if DB_SCHEMA == "f3_prod":
                                    shutil.copyfile(
                                        f"/mnt/calendar-images/{filename}", f"/mnt/calendar-images/{filename_static}"
                                    )

                            existing_file = slack_app_settings.get(f"calendar_image_{week}")
                            if not LOCAL_DEVELOPMENT and calendar_image_is_safe_to_delete(
                                existing_file, region_id, week, generation_started_at
                            ):
                                pending_deletions.append(existing_file)
                            slack_app_settings[f"calendar_image_{week}"] = filename
                            calendar_updated = True

                    if calendar_updated:
                        if slack_posting_enabled(slack_app_settings):
                            try:
                                post_calendar_to_slack(slack_app_settings, num_weeks, first_sunday_run)
                            except Exception:
                                # Only failed Slack posting permits discarding new exports.
                                # A later DB failure may leave Slack referencing these files.
                                for generated_week, new_file in generated_backing_files:
                                    if parse_calendar_image_filename(
                                        new_file, region_id, generated_week, generation_started_at
                                    ) is None or new_file in [
                                        region_org_record[2].settings.get(f"calendar_image_{label}")
                                        for label in WEEK_LABELS
                                    ]:
                                        continue
                                    try:
                                        os.remove(new_file if LOCAL_DEVELOPMENT else f"/mnt/calendar-images/{new_file}")
                                    except FileNotFoundError:
                                        pass
                                    except Exception as cleanup_error:
                                        print(f"Error deleting unposted calendar image: {cleanup_error}")
                                raise

                        print(f"Updating Slack app settings for region {region_name} with {slack_app_settings}")
                        session.query(SlackSpace).filter(SlackSpace.team_id == slack_app_settings["team_id"]).update(
                            {"settings": slack_app_settings}
                        )
                        session.commit()
                    # With no settings change, stable-file retries need no new commit.
                    for old_file in pending_deletions:
                        try:
                            os.remove(f"/mnt/calendar-images/{old_file}")
                        except FileNotFoundError:
                            pass
                        except Exception as e:
                            print(f"Error deleting old calendar image: {e}")

            except Exception as e:
                session.rollback()
                print(f"Error processing region {region_id}: {e}")

    update_local_region_records()


def create_special_events_text(events: List[EventInstance], slack_settings_dict: dict, max_events: int = 10) -> str:
    text = ""
    special_days_out = slack_settings_dict.get("calendar_config_special_days_out")
    if special_days_out is not None:
        events = [e for e in events if (e.start_date - current_date_cst()).days <= special_days_out]

    for i, event in enumerate(events[:max_events]):
        text += f"{i + 1}. *{event.name}* - {event.start_date.strftime('%A, %B %d')} - {event.start_time} @ {event.org.name}\n"  # noqa

        if event.preblast_ts:
            # TODO: need to make this work for region-level events
            if slack_settings_dict.get("default_preblast_destination") == "specified_channel":
                channel_id = slack_settings_dict.get("preblast_destination_channel")
            else:
                channel_id = event.org.meta.get("slack_channel_id")

            if channel_id:
                text += f"<slack://channel?team={slack_settings_dict.get('team_id')}&id={channel_id}&ts={event.preblast_ts}|Click here to go to the preblast thread!>\n"  # noqa

    return text


def create_special_events_blocks(slack_settings_dict: dict) -> blocks.Block:
    blocks_list = []
    # list special events
    special_events: List[EventInstance] = DbManager.find_records(
        cls=EventInstance,
        filters=[
            or_(
                EventInstance.org_id == slack_settings_dict.get("org_id"),
                EventInstance.org.has(Org.parent_id == slack_settings_dict.get("org_id")),
            ),
            EventInstance.start_date >= current_date_cst(),
            EventInstance.is_active,
            EventInstance.highlight,
        ],
        joinedloads=[EventInstance.org],
    )
    # limit to 10 upcoming events
    special_events = sorted(special_events, key=lambda x: (x.start_date, x.start_time))[:10]
    if len(special_events) > 0:
        blocks_list.append(blocks.HeaderBlock(text=":tada: Special Events:"))
        msg = create_special_events_text(special_events, slack_settings_dict)
        blocks_list.append(blocks.SectionBlock(text=blocks.MarkdownTextObject(text=msg)))
    return blocks_list


if __name__ == "__main__":
    generate_calendar_images(force=True)
