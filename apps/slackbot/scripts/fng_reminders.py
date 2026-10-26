"""Remind an FNG's battle buddy and whoever brought him when he still hasn't joined Slack after /fng."""

import html
import logging
import os
import sys
from datetime import datetime, timedelta

import pytz
from f3_data_models.models import Org_x_SlackSpace, SlackSpace, SlackUser, User
from f3_data_models.utils import DbManager
from slack_sdk import WebClient

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from features.fng import FNG_META_BATTLE_BUDDY, dm_fng_contacts, fng_display_name, fng_reminder_days
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get

REMINDER_HOUR = 17  # US/Central, same as the home region nudge
MAX_REMINDERS = 3

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
        settings = SlackSettings(**space.settings)
        interval = fng_reminder_days(settings)
        if not interval or not settings.bot_token:
            continue
        # The schedule comes from when /fng created him, so nothing needs storing: remind on day N, 2N and 3N.
        cutoff = datetime.now(pytz.utc).replace(tzinfo=None) - timedelta(days=interval * MAX_REMINDERS + 1)
        fngs = DbManager.find_records(User, filters=[User.home_region_id == org_x_space.org_id, User.created >= cutoff])
        client = WebClient(token=settings.bot_token)
        for fng in fngs:
            if not safe_get(fng.meta, FNG_META_BATTLE_BUDDY):
                continue
            days = (now.date() - pytz.utc.localize(fng.created).astimezone(now.tzinfo).date()).days
            if days <= 0 or days % interval or days // interval > MAX_REMINDERS:
                continue
            if DbManager.find_first_record(
                SlackUser, filters=[SlackUser.user_id == fng.id, SlackUser.slack_team_id == space.team_id]
            ):
                continue  # he joined
            contact = html.escape(" · ".join(filter(None, (fng.phone, fng.email))), quote=False)
            text = f"*{fng_display_name(fng)}* still hasn't joined Slack, {days} days after /fng."
            text += f" A text or call from you might help: {contact}." if contact else " A text from you might help."
            if settings.downrange_invite_link:
                text += f" Here's the invite link to send him: {settings.downrange_invite_link}"
            if days // interval == MAX_REMINDERS:
                text += " This is the last reminder."
            sent += dm_fng_contacts(client, space.team_id, fng, text, logger)
    print(f"FNG reminders complete. Sent {sent} DMs.")


if __name__ == "__main__":
    send_fng_reminders(force=True)
