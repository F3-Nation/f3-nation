import argparse
import os
import sys
from collections import defaultdict
from datetime import datetime, timedelta
from logging import Logger
from typing import Optional

import pytz
from f3_data_models.models import Attendance, EventInstance, Org, Org_x_SlackSpace, SlackSpace, SlackUser, User
from f3_data_models.utils import DbManager, get_session
from slack_sdk import WebClient
from slack_sdk.errors import SlackApiError
from sqlalchemy import case, func

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get
from utilities.slack import actions, orm

# --- Configuration via environment variables ---
NUDGE_DAY = int(os.getenv("HOME_REGION_NUDGE_DAY", "21"))
NUDGE_HOUR = int(os.getenv("HOME_REGION_NUDGE_HOUR", "17"))
PCT_THRESHOLD_30 = float(os.getenv("HOME_REGION_NUDGE_PCT_30", "0.70"))
PCT_THRESHOLD_90 = float(os.getenv("HOME_REGION_NUDGE_PCT_90", "0.50"))
MIN_POSTS_30 = int(os.getenv("HOME_REGION_NUDGE_MIN_30", "4"))
MIN_POSTS_90 = int(os.getenv("HOME_REGION_NUDGE_MIN_90", "8"))

USER_META_NUDGE_OPT_OUT = "home_region_nudge_opt_out"

MSG_TEMPLATE = (
    "Hey {f3_name}! Your home region is set to *{home_region_name}*, but it looks like you've been "
    "posting a lot in *{other_region_name}* lately. Would you like to switch your home region?"
)
MSG_SWITCHED = "Done! Your home region has been switched to *{new_region_name}*. Enjoy posting there!"
MSG_DISMISSED = "No problem! Your home region remains unchanged."
MSG_OPT_OUT = "Got it! We won't send you reminders about this again."


def _build_dm_blocks(f3_name: str, home_region_name: str, other_region_name: str, new_region_id: int) -> list:
    msg = MSG_TEMPLATE.format(
        f3_name=f3_name,
        home_region_name=home_region_name,
        other_region_name=other_region_name,
    )
    blocks = [
        orm.SectionBlock(label=msg),
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(
                    label="Yes, switch!",
                    value=str(new_region_id),
                    style="primary",
                    action=actions.HOME_REGION_NUDGE_SWITCH_BUTTON,
                ),
                orm.ButtonElement(
                    label="No, keep current",
                    value="dismiss",
                    action=actions.HOME_REGION_NUDGE_DISMISS_BUTTON,
                ),
                orm.ButtonElement(
                    label="No, don't ask again",
                    value="opt_out",
                    action=actions.HOME_REGION_NUDGE_OPT_OUT_BUTTON,
                ),
            ]
        ),
    ]
    return [b.as_form_field() for b in blocks]


def send_home_region_nudges(force: bool = False):
    current_time = datetime.now(pytz.timezone("US/Central"))
    if not force and (current_time.day != NUDGE_DAY or current_time.hour != NUDGE_HOUR):
        return

    print("Pulling home region nudge activity data...")
    cutoff_90 = (datetime.now() - timedelta(days=90)).date()
    cutoff_30 = (datetime.now() - timedelta(days=30)).date()

    # Derive region_id: if the org is already a region use its id, otherwise use parent_id (AO -> region)
    region_id_case = case(
        (Org.org_type == "region", Org.id),
        else_=Org.parent_id,
    )

    with get_session() as session:
        rows = (
            session.query(
                User.id.label("user_id"),
                User.home_region_id.label("home_region_id"),
                region_id_case.label("region_id"),
                func.sum(
                    case(
                        (EventInstance.start_date >= cutoff_30, 1),
                        else_=0,
                    )
                ).label("posts_30"),
                func.count(Attendance.id).label("posts_90"),
            )
            .select_from(Attendance)
            .join(User, User.id == Attendance.user_id)
            .join(EventInstance, EventInstance.id == Attendance.event_instance_id)
            .join(Org, Org.id == EventInstance.org_id)
            .filter(
                Attendance.is_planned == False,  # noqa: E712
                EventInstance.start_date >= cutoff_90,
                User.home_region_id.isnot(None),
            )
            .group_by(User.id, User.home_region_id, region_id_case)
            .all()
        )

    # Group rows by user_id
    user_rows: dict[int, list] = defaultdict(list)
    for row in rows:
        if row.region_id is None:
            continue
        user_rows[row.user_id].append(row)

    # Build Slack client lookup: org_id -> team_id, team_id -> SlackSettings
    slack_space_records: list[tuple[SlackSpace, Org_x_SlackSpace]] = DbManager.find_join_records2(
        SlackSpace,
        Org_x_SlackSpace,
        filters=[True],
    )
    org_to_team_id: dict[int, str] = {}
    team_id_to_settings: dict[str, SlackSettings] = {}
    for ss, oxss in slack_space_records:
        settings = SlackSettings(**ss.settings)
        org_to_team_id[oxss.org_id] = ss.team_id
        team_id_to_settings[ss.team_id] = settings

    # Cache all region names upfront to avoid repeated DB calls
    all_regions: list[Org] = DbManager.find_records(Org, filters=[Org.org_type == "region"])
    region_names: dict[int, str] = {r.id: r.name for r in all_regions}

    print(f"Found {len(user_rows)} users with recent activity. Checking qualification...")
    sent_count = 0

    for user_id, activity_rows in user_rows.items():
        home_region_id = activity_rows[0].home_region_id
        total_90 = sum(r.posts_90 for r in activity_rows)
        total_30 = sum(r.posts_30 for r in activity_rows)

        # Posts in regions other than the user's home region
        other_rows = [r for r in activity_rows if r.region_id != home_region_id]
        if not other_rows:
            continue

        # Top non-home region by 90-day post count
        top_other_region_id = max(other_rows, key=lambda r: r.posts_90).region_id

        other_90 = sum(r.posts_90 for r in other_rows if r.region_id == top_other_region_id)
        other_30 = sum(r.posts_30 for r in other_rows if r.region_id == top_other_region_id)

        qualifies_30 = total_30 >= MIN_POSTS_30 and (other_30 / max(total_30, 1)) >= PCT_THRESHOLD_30
        qualifies_90 = (
            total_90 >= MIN_POSTS_90
            and (other_90 / max(total_90, 1)) >= PCT_THRESHOLD_90
            and (other_30 / max(total_30, 1)) >= 0.30
        )  # Ensure at least 30% in last 30 days to avoid nudging users who have recently switched

        if not qualifies_30 and not qualifies_90:
            continue

        user_record = DbManager.get(User, user_id)
        if not user_record:
            continue
        if safe_get(user_record.meta, USER_META_NUDGE_OPT_OUT):
            continue

        team_id = org_to_team_id.get(home_region_id)
        if not team_id:
            print(f"No Slack workspace found for region {home_region_id}, skipping user {user_id}")
            continue

        settings = team_id_to_settings.get(team_id)
        if not settings or not settings.bot_token:
            print(f"No bot token for team {team_id}, skipping user {user_id}")
            continue

        slack_user = DbManager.find_first_record(
            SlackUser,
            filters=[SlackUser.user_id == user_id, SlackUser.slack_team_id == team_id],
        )
        if not slack_user:
            print(f"No Slack user found for user {user_id} in team {team_id}, skipping")
            continue

        home_region_name = region_names.get(home_region_id, f"Region {home_region_id}")
        other_region_name = region_names.get(top_other_region_id, f"Region {top_other_region_id}")
        f3_name = user_record.f3_name or slack_user.user_name or "PAX"

        blocks = _build_dm_blocks(
            f3_name=f3_name,
            home_region_name=home_region_name,
            other_region_name=other_region_name,
            new_region_id=top_other_region_id,
        )
        plain_text = (
            f"Hey {f3_name}! Your home region is set to {home_region_name}, but it looks like "
            f"you post a lot in {other_region_name}. Would you like to switch your home region?"
        )

        client = WebClient(token=settings.bot_token)
        try:
            client.chat_postMessage(
                channel=slack_user.slack_id,
                text=plain_text,
                blocks=blocks,
            )
            sent_count += 1
        except SlackApiError as e:
            print(f"Error sending DM to user {user_id} ({slack_user.slack_id}): {e.response['error']}")

    print(f"Home region nudge complete. Sent {sent_count} DMs.")


def _get_user_from_body(body: dict) -> tuple[Optional[User], Optional[SlackUser]]:
    """Look up User and SlackUser records from a Slack action body."""
    slack_user_id = safe_get(body, "user", "id")
    team_id = safe_get(body, "user", "team_id") or safe_get(body, "team", "id")
    if not slack_user_id or not team_id:
        return None, None
    slack_user = DbManager.find_first_record(
        SlackUser,
        filters=[SlackUser.slack_id == slack_user_id, SlackUser.slack_team_id == team_id],
    )
    if not slack_user:
        return None, None
    user_record = DbManager.get(User, slack_user.user_id)
    return user_record, slack_user


def handle_home_region_switch(body: dict, client: WebClient, logger: Logger, context: dict, region_record):
    """Handle the 'Yes, switch!' button — update the user's home_region_id."""
    new_region_id = int(body["actions"][0]["value"])
    user_record, _ = _get_user_from_body(body)
    if not user_record:
        logger.error("Could not find user for home region switch action")
        return

    region = DbManager.get(Org, new_region_id)
    region_name = region.name if region else f"Region {new_region_id}"
    DbManager.update_record(User, user_record.id, {User.home_region_id: new_region_id})

    msg = MSG_SWITCHED.format(new_region_name=region_name)
    try:
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text=msg,
            blocks=[orm.SectionBlock(label=msg).as_form_field()],
        )
    except Exception as e:
        logger.error(f"Error updating DM after home region switch: {e}")


def handle_home_region_dismiss(body: dict, client: WebClient, logger: Logger, context: dict, region_record):
    """Handle the 'No, keep current' button — update the DM and take no further action."""
    try:
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text=MSG_DISMISSED,
            blocks=[orm.SectionBlock(label=MSG_DISMISSED).as_form_field()],
        )
    except Exception as e:
        logger.error(f"Error updating DM after home region dismiss: {e}")


def handle_home_region_opt_out(body: dict, client: WebClient, logger: Logger, context: dict, region_record):
    """Handle the 'No, don't ask again' button — set opt-out flag and update the DM."""
    user_record, _ = _get_user_from_body(body)
    if not user_record:
        logger.error("Could not find user for home region opt-out action")
        return

    meta = user_record.meta or {}
    meta[USER_META_NUDGE_OPT_OUT] = True
    DbManager.update_record(User, user_record.id, {User.meta: meta})

    try:
        client.chat_update(
            channel=body["channel"]["id"],
            ts=body["message"]["ts"],
            text=MSG_OPT_OUT,
            blocks=[orm.SectionBlock(label=MSG_OPT_OUT).as_form_field()],
        )
    except Exception as e:
        logger.error(f"Error updating DM after home region opt-out: {e}")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description="Send home region nudge DMs to qualifying users")
    parser.add_argument("--force", action="store_true", help="Run regardless of day of month")
    args = parser.parse_args()
    send_home_region_nudges(force=args.force)
