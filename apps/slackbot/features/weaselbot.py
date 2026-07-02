"""
Weaselbot configuration module.

NOTE: Achievement tagging functionality has been moved to features/achievements.py.
This module now only handles Kotter Reports configuration and legacy achievement settings.
For new achievement functionality, use the achievements module.
"""

import copy
from logging import Logger

from f3_data_models.models import (
    Achievement,
    SlackSpace,
)
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient
from sqlalchemy import or_
from sqlalchemy.exc import ProgrammingError

from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    safe_convert,
    safe_get,
    update_local_region_records,
)
from utilities.slack import actions, forms


# =============================================================================
# DEPRECATED: Use features.achievements.build_tag_achievement_form instead
# =============================================================================
def build_achievement_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """
    DEPRECATED: This function is kept for backwards compatibility.
    Use features.achievements.build_tag_achievement_form instead.
    """
    from features.achievements import build_tag_achievement_form

    return build_tag_achievement_form(body, client, logger, context, region_record)


# =============================================================================
# DEPRECATED: Use features.achievements.handle_tag_achievement instead
# =============================================================================
def handle_achievements_tag(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """
    DEPRECATED: This function is kept for backwards compatibility.
    Use features.achievements.handle_tag_achievement instead.
    """
    from features.achievements import handle_tag_achievement

    return handle_tag_achievement(body, client, logger, context, region_record)


def build_config_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    # paxminer_schema = region_record.paxminer_schema
    # update_view_id = safe_get(body, actions.LOADING_ID)
    config_form = copy.deepcopy(forms.WEASELBOT_CONFIG_FORM)
    callback_id = actions.WEASELBOT_CONFIG_CALLBACK_ID
    trigger_id = safe_get(body, "trigger_id")

    try:
        weaselbot_achievements = DbManager.find_records(
            Achievement,
            [or_(Achievement.specific_org_id == region_record.org_id, Achievement.specific_org_id.is_(None))],
        )
    except ProgrammingError:
        weaselbot_achievements = None

    if not weaselbot_achievements:
        config_form = copy.deepcopy(forms.NO_WEASELBOT_CONFIG_FORM)
        config_form.post_modal(
            client=client,
            trigger_id=trigger_id,
            callback_id=callback_id,
            new_or_add="add",
            title_text="Achievement Settings",
            submit_button_text="None",
        )
    else:
        initial_features = []
        if region_record.send_achievements:
            initial_features.append("achievements")
        if region_record.send_aoq_reports:
            initial_features.append("kotter_reports")

        config_form.set_initial_values(
            {
                actions.WEASELBOT_ENABLE_FEATURES: initial_features,
                actions.WEASELBOT_ACHIEVEMENT_CHANNEL: region_record.achievement_channel,
                actions.WEASELBOT_KOTTER_CHANNEL: region_record.default_siteq,
                actions.WEASELBOT_KOTTER_WEEKS: region_record.NO_POST_THRESHOLD,
                actions.WEASELBOT_KOTTER_REMOVE_WEEKS: region_record.REMINDER_WEEKS,
                actions.WEASELBOT_HOME_AO_WEEKS: region_record.HOME_AO_CAPTURE,
                actions.WEASELBOT_Q_WEEKS: region_record.NO_Q_THRESHOLD_WEEKS,
                actions.WEASELBOT_Q_POSTS: region_record.NO_Q_THRESHOLD_POSTS,
            }
        )

        config_form.post_modal(
            client=client,
            trigger_id=trigger_id,
            callback_id=callback_id,
            new_or_add="add",
            title_text="Achievement Settings",
        )


def handle_config_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    config_data = forms.WEASELBOT_CONFIG_FORM.get_selected_values(body)

    region_record.send_achievements = (
        1 if "achievements" in safe_get(config_data, actions.WEASELBOT_ENABLE_FEATURES) else 0
    )
    region_record.send_aoq_reports = (
        1 if "kotter_reports" in safe_get(config_data, actions.WEASELBOT_ENABLE_FEATURES) else 0
    )
    region_record.achievement_channel = safe_get(config_data, actions.WEASELBOT_ACHIEVEMENT_CHANNEL)
    region_record.default_siteq = safe_get(config_data, actions.WEASELBOT_KOTTER_CHANNEL)
    region_record.NO_POST_THRESHOLD = safe_convert(safe_get(config_data, actions.WEASELBOT_KOTTER_WEEKS), int)
    region_record.REMINDER_WEEKS = safe_convert(safe_get(config_data, actions.WEASELBOT_KOTTER_REMOVE_WEEKS), int)
    region_record.HOME_AO_CAPTURE = safe_convert(safe_get(config_data, actions.WEASELBOT_HOME_AO_WEEKS), int)
    region_record.NO_Q_THRESHOLD_WEEKS = safe_convert(safe_get(config_data, actions.WEASELBOT_Q_WEEKS), int)
    region_record.NO_Q_THRESHOLD_POSTS = safe_convert(safe_get(config_data, actions.WEASELBOT_Q_POSTS), int)

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )
    update_local_region_records()
