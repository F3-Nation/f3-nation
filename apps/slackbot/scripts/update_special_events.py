import os
import ssl
import sys
from datetime import timedelta

from slack_sdk import WebClient

from utilities.helper_functions import current_date_cst

sys.path.append(os.path.join(os.path.dirname(__file__), ".."))

from typing import List

from f3_data_models.models import (
    EventInstance,
    Org,
    Org_Type,
)
from f3_data_models.utils import DbManager

from utilities.database.orm import SlackSettings
from utilities.slack import orm

# TODO: future option for this to live on a Canvas?!?


def create_special_events_blocks(events: List[EventInstance], slack_settings: SlackSettings) -> List[dict]:
    blocks: List[orm.BaseBlock] = []
    for i, event in enumerate(events):
        text = (
            f"*{i + 1}. {event.name}*\n{event.start_date.strftime('%A, %B %d')} - {event.start_time}\n{event.org.name}"  # noqa
        )

        if event.preblast_ts:
            # TODO: need to make this work for region-level events
            if slack_settings.default_preblast_destination == "specified_channel":
                channel_id = slack_settings.preblast_destination_channel
            else:
                channel_id = event.org.meta.get("slack_channel_id")

            if channel_id:
                text += f"\n<slack://channel?team={slack_settings.team_id}&id={channel_id}&ts={event.preblast_ts}|Click here to go to the preblast thread!>"  # noqa
        blocks.append(
            orm.SectionBlock(
                label=text,
                # TODO: add HC button?
            )
        )
    blocks = [block.as_form_field() for block in blocks]
    return blocks


def update_special_events():
    regions: List[Org] = DbManager.find_records(
        cls=Org, filters=[Org.org_type == Org_Type.region], joinedloads=[Org.slack_space]
    )

    for region in regions:
        slack_settings = SlackSettings(**region.slack_space.settings)
        if slack_settings.special_events_enabled:
            number_of_days = slack_settings.special_events_post_days or 30
            events: List[EventInstance] = DbManager.find_records(
                cls=EventInstance,
                filters=[
                    (EventInstance.org_id == region.id or EventInstance.org.has(Org.parent_id == region.id)),
                    EventInstance.start_date >= current_date_cst(),
                    EventInstance.start_date <= current_date_cst() + timedelta(days=number_of_days),
                    EventInstance.is_active,
                    EventInstance.highlight,
                ],
                joinedloads=[EventInstance.org],
            )
            if events and slack_settings.special_events_channel:
                blocks = create_special_events_blocks(events, slack_settings)
                ssl_context = ssl.create_default_context()
                ssl_context.check_hostname = False
                ssl_context.verify_mode = ssl.CERT_NONE
                WebClient(token=slack_settings.bot_token, ssl=ssl_context).chat_postMessage(
                    channel=slack_settings.special_events_channel,
                    text=f"Upcoming events for {region.name}:",
                    blocks=blocks,
                )


if __name__ == "__main__":
    update_special_events()
