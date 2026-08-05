import copy
import random
from logging import Logger

from f3_data_models.models import Org, SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from utilities import constants
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    safe_get,
    update_local_region_records,
)
from utilities.slack import actions, forms


def build_welcome_config_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    welcome_message_config_form = copy.deepcopy(forms.WELCOME_MESSAGE_CONFIG_FORM)

    welcome_message_config_form.set_initial_values(
        {
            actions.WELCOME_DM_TEMPLATE: region_record.welcome_dm_template,
            actions.WELCOME_DM_ENABLE: "enable" if region_record.welcome_dm_enable else "disable",
            actions.WELCOME_CHANNEL: region_record.welcome_channel or "",
            actions.WELCOME_CHANNEL_ENABLE: "enable" if region_record.welcome_channel_enable else "disable",
        }
    )

    welcome_message_config_form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        callback_id=actions.WELCOME_MESSAGE_CONFIG_CALLBACK_ID,
        title_text="Welcomebot Settings",
        new_or_add="add",
    )


# eventually will not need this when we take out the /config-welcome-message command
def build_welcome_message_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    update_view_id = safe_get(body, actions.LOADING_ID)
    welcome_message_config_form = copy.deepcopy(forms.WELCOME_MESSAGE_CONFIG_FORM)

    welcome_message_config_form.set_initial_values(
        {
            actions.WELCOME_DM_TEMPLATE: region_record.welcome_dm_template,
            actions.WELCOME_DM_ENABLE: "enable" if region_record.welcome_dm_enable else "disable",
            actions.WELCOME_CHANNEL: region_record.welcome_channel or "",
            actions.WELCOME_CHANNEL_ENABLE: "enable" if region_record.welcome_channel_enable else "disable",
        }
    )

    welcome_message_config_form.update_modal(
        client=client,
        view_id=update_view_id,
        callback_id=actions.WELCOME_MESSAGE_CONFIG_CALLBACK_ID,
        title_text="Welcomebot Settings",
        parent_metadata=None,
    )


def handle_welcome_message_config_post(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    welcome_config_data = forms.WELCOME_MESSAGE_CONFIG_FORM.get_selected_values(body)

    region_record.welcome_dm_enable = 1 if safe_get(welcome_config_data, actions.WELCOME_DM_ENABLE) == "enable" else 0
    region_record.welcome_dm_template = safe_get(welcome_config_data, actions.WELCOME_DM_TEMPLATE) or ""
    region_record.welcome_channel_enable = (
        1 if safe_get(welcome_config_data, actions.WELCOME_CHANNEL_ENABLE) == "enable" else 0
    )
    region_record.welcome_channel = safe_get(welcome_config_data, actions.WELCOME_CHANNEL) or ""

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )

    update_local_region_records()


def handle_team_join(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    welcome_channel = region_record.welcome_channel
    workspace_name = region_record.workspace_name
    user_id = safe_get(body, "event", "user", "id")

    if region_record.welcome_dm_enable:
        client.chat_postMessage(channel=user_id, blocks=[region_record.welcome_dm_template], text="Welcome!")
    if region_record.welcome_channel_enable:
        if region_record.org_id:
            org_record = DbManager.get(Org, region_record.org_id)
            org_name = org_record.name if org_record else workspace_name
        else:
            org_name = workspace_name
        client.chat_postMessage(
            channel=welcome_channel,
            text=random.choice(constants.WELCOME_MESSAGE_TEMPLATES).format(user=f"<@{user_id}>", region=org_name),
        )
