import json
import os
from logging import Logger

from slack_sdk.models.blocks import ActionsBlock, ButtonElement, SectionBlock
from slack_sdk.web import WebClient

from features.user import IGNORE_EVENT
from utilities.database.orm import SlackSettings
from utilities.helper_functions import get_user, safe_get
from utilities.slack import actions


def build_help_menu(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    with open(os.path.join(os.path.dirname(os.path.dirname(__file__)), "utilities", "default_help.json")) as f:
        default_help_text = json.load(f)

    existing_view = body.get("view", {})

    button_block = ActionsBlock(
        elements=[
            ButtonElement(
                text=":calendar: Open Calendar",
                action_id=actions.OPEN_CALENDAR_BUTTON,
            ),
            ButtonElement(
                text=":memo: Create Preblast",
                action_id=actions.PREBLAST_NEW_BUTTON,
            ),
        ]
    ).to_dict()

    if default_help_text:  # TODO: customize per region in the future
        view = {
            "type": "modal",
            "title": {"type": "plain_text", "text": "Help Menu"},
            "close": {"type": "plain_text", "text": "Close"},
            "blocks": [button_block, default_help_text],
        }
        if existing_view:
            client.views_update(view_id=existing_view.get("id"), view=view)
        else:
            client.views_open(trigger_id=body.get("trigger_id"), view=view)


def handle_app_mention(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    slack_user_id = body["event"]["user"]
    user_id = safe_get(get_user(slack_user_id, region_record, client, logger), "user_id")
    blocks = [
        SectionBlock(
            text="Hi there! Looking for me? :wave:\n\nHere are some things I can help you with:",
        ),
        ActionsBlock(
            elements=[
                ButtonElement(
                    text=":calendar: Open Calendar",
                    action_id=actions.OPEN_CALENDAR_BUTTON,
                ),
                ButtonElement(
                    text=":memo: Create Preblast",
                    action_id=actions.PREBLAST_NEW_BUTTON,
                ),
                ButtonElement(
                    text=":question: Help Menu",
                    action_id=actions.CONFIG_HELP_MENU,
                ),
                ButtonElement(
                    text=":gear: Settings",
                    action_id=actions.SETTINGS_BUTTON,
                ),
            ]
        ),
    ]
    if user_id:
        blocks[1].elements.append(
            ButtonElement(
                text=":bar_chart: My Stats :link:",
                url=f"{os.getenv('STATS_URL')}/stats/pax/{user_id}",
                action=IGNORE_EVENT,
            )
        )
    try:
        client.chat_postEphemeral(
            channel=body["event"]["channel"],
            user=body["event"]["user"],
            text="Hi there! Looking for me? :wave:",
            blocks=blocks,
        )
    except Exception as e:
        logger.error(f"Error handling app mention: {e}")
