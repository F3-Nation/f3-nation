"""Remind an FNG's battle buddy and whoever brought him when he still hasn't joined Slack after /fng."""

import html
import logging
import os
import sys
from datetime import datetime, time, timedelta

import pytz
from f3_data_models.models import Org_x_SlackSpace, SlackSpace, SlackUser, User
from f3_data_models.utils import DbManager, session_scope
from slack_sdk import WebClient
from sqlalchemy import cast, func, literal
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import Session

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from features.fng import (
    FNG_META_BATTLE_BUDDY,
    dm_fng_contacts,
    fng_contact_ids,
    fng_display_name,
    fng_reminder_days,
)
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get

REMINDER_HOUR = 17  # US/Central, same as the home region nudge
MAX_REMINDERS = 3
CATCH_UP_DAYS = 7  # a reminder that couldn't be delivered on its day, the last one included, is retried daily this long
FNG_META_REMINDERS_SENT = "fng_reminders_sent"  # {contact's user id (str): reminders he has received}

logger = logging.getLogger(__name__)


def send_fng_reminders(force: bool = False):
    now = datetime.now(pytz.timezone("US/Central"))
    if not force and now.hour != REMINDER_HOUR:
        return

    spaces: list[tuple[SlackSpace, Org_x_SlackSpace]] = DbManager.find_join_records2(
        SlackSpace, Org_x_SlackSpace, filters=[True]
    )
    sent = 0
    for space, org_x_space in spaces:
        # One region's bad settings or outage must not cost every region after it its reminders.
        try:
            sent += _remind_space(space, org_x_space, now)
        except Exception as exc:
            logger.error(
                "fng.reminders_region_failed error_type=%s",
                type(exc).__name__,
                extra={
                    "json_fields": {
                        "event": "fng.reminders_region_failed",
                        "team_id": space.team_id,
                        "error_type": type(exc).__name__,
                    }
                },
            )
    print(f"FNG reminders complete. Sent {sent} DMs.")


def _remind_space(space: SlackSpace, org_x_space: Org_x_SlackSpace, now: datetime) -> int:
    settings = SlackSettings(**space.settings)
    interval = fng_reminder_days(settings)
    if not interval or not settings.bot_token:
        return 0
    # Reminders are due on day N, 2N and 3N after /fng created him, plus the catch-up window for a failed one.
    # Counted in Central calendar days, like `days` below, so the last catch-up day is whole whatever time he was
    # created.
    cutoff_day = now.date() - timedelta(days=interval * MAX_REMINDERS + CATCH_UP_DAYS)
    central = pytz.timezone("US/Central")
    cutoff = central.localize(datetime.combine(cutoff_day, time.min)).astimezone(pytz.utc).replace(tzinfo=None)
    fngs = DbManager.find_records(User, filters=[User.home_region_id == org_x_space.org_id, User.created >= cutoff])
    client = WebClient(token=settings.bot_token)
    sent = 0
    for fng in fngs:
        try:
            sent += _remind_fng(client, space, settings, interval, fng, now)
        except Exception as exc:
            logger.error(
                "fng.reminder_failed error_type=%s",
                type(exc).__name__,
                extra={
                    "json_fields": {
                        "event": "fng.reminder_failed",
                        "team_id": space.team_id,
                        "user_id": fng.id,
                        "error_type": type(exc).__name__,
                    }
                },
            )
    return sent


def save_reminders_sent(session: Session, user_id: int, received: dict[str, int]) -> None:
    """Sets only the reminder counts in ``User.meta``, merging in the database, so the rest of ``meta`` is left as
    stored. Only this job writes the key, so replacing it whole is safe."""
    session.query(User).filter(User.id == user_id).update(
        {
            # meta can be SQL NULL or JSON null (how the ORM stores None); either would turn the merge into NULL or
            # an array.
            User.meta: func.coalesce(func.nullif(User.meta, cast(literal("null"), JSONB)), literal({}, JSONB)).op("||")(
                literal({FNG_META_REMINDERS_SENT: received}, JSONB)
            )
        },
        synchronize_session=False,
    )


def _remind_fng(
    client: WebClient, space: SlackSpace, settings: SlackSettings, interval: int, fng: User, now: datetime
) -> int:
    if not safe_get(fng.meta, FNG_META_BATTLE_BUDDY):
        return 0
    days = (now.date() - pytz.utc.localize(fng.created).astimezone(now.tzinfo).date()).days
    # Comparing against the count each contact already received, not the exact day, means a rerun sends nothing, a
    # missed or failed run catches up the next day (once, even if several were missed), and a contact whose DM
    # failed is retried without repeating it to the one who got it.
    due = min(days // interval, MAX_REMINDERS)
    if not _contacts_behind(fng, due):
        return 0
    if DbManager.find_first_record(
        SlackUser, filters=[SlackUser.user_id == fng.id, SlackUser.slack_team_id == space.team_id]
    ):
        return 0  # he joined
    # A forced run during the scheduled one, or a redelivered run, would otherwise read the same counts and DM
    # everyone twice. His row stays locked until the counts are saved, and a run that finds it locked skips him: the
    # run holding it is sending his reminder, and any other holder only delays it to the next day's catch-up. Skipping
    # instead of waiting keeps a held lock from stalling the hourly scripts that run after this one.
    with session_scope() as session:
        locked = session.query(User).filter(User.id == fng.id).with_for_update(skip_locked=True).one_or_none()
        if locked is None:
            return 0
        return _send_reminder(session, client, space, settings, locked, days, due)


def _contacts_behind(fng: User, due: int) -> list[int]:
    received = safe_get(fng.meta, FNG_META_REMINDERS_SENT) or {}
    return [user_id for user_id in fng_contact_ids(fng) if received.get(str(user_id), 0) < due]


def _send_reminder(
    session: Session, client: WebClient, space: SlackSpace, settings: SlackSettings, fng: User, days: int, due: int
) -> int:
    behind = _contacts_behind(fng, due)
    if not behind:
        return 0
    received = safe_get(fng.meta, FNG_META_REMINDERS_SENT) or {}
    contact = html.escape(" · ".join(filter(None, (fng.phone, fng.email))), quote=False)
    text = f"*{fng_display_name(fng)}* hasn't joined Slack with the email from /fng yet, {days} days later."
    text += f" A text or call from you might help: {contact}." if contact else " A text from you might help."
    if settings.downrange_invite_link:
        text += f" Here's the invite link to send him: {settings.downrange_invite_link}"
    if due == MAX_REMINDERS:
        text += " This is the last reminder."
    delivered = dm_fng_contacts(client, space.team_id, fng, text, logger, contact_ids=behind)
    if delivered:
        received = {**received, **{str(user_id): due for user_id in delivered}}
        save_reminders_sent(session, fng.id, received)
    else:
        logger.warning(
            "fng.reminder_undeliverable",
            extra={
                "json_fields": {
                    "event": "fng.reminder_undeliverable",
                    "team_id": space.team_id,
                    "user_id": fng.id,
                    "due": due,
                }
            },
        )
    return len(delivered)


if __name__ == "__main__":
    send_fng_reminders(force=True)
