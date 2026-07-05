"""
Achievement management feature module.

This module provides:
- Achievement configuration (enable/disable, channel selection)
- Create, edit, delete custom achievements for a region
- Manual achievement tagging
"""

import copy
import json
from datetime import datetime
from logging import Logger
from typing import Any, Dict, List, Optional

import pytz
from f3_data_models.models import (
    Achievement,
    Achievement_Cadence,
    Achievement_x_User,
    EventTag,
    EventType,
    SlackSpace,
)
from f3_data_models.utils import DbManager
from slack_sdk.models.blocks import (
    ContextBlock,
    DividerBlock,
    HeaderBlock,
    InputBlock,
    SectionBlock,
)
from slack_sdk.models.blocks.basic_components import MarkdownTextObject, Option, PlainTextObject
from slack_sdk.models.blocks.block_elements import (
    ButtonElement,
    ChannelSelectElement,
    CheckboxesElement,
    NumberInputElement,
    OverflowMenuElement,
    PlainTextInputElement,
    RadioButtonsElement,
    StaticMultiSelectElement,
    StaticSelectElement,
)
from slack_sdk.web import WebClient
from sqlalchemy import or_

from utilities.builders import add_loading_form
from utilities.constants import ACHIEVEMENTS_ALPHA_TESTING_ORG_IDS
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    current_date_cst,
    get_user,
    safe_convert,
    safe_get,
    update_local_region_records,
)
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

# =============================================================================
# Action IDs
# =============================================================================
# Config modal
ACHIEVEMENT_CONFIG_CALLBACK_ID = "achievement-config-id"
ACHIEVEMENT_CONFIG_ENABLE = "achievement-config-enable"
ACHIEVEMENT_CONFIG_CHANNEL = "achievement-config-channel"
ACHIEVEMENT_CONFIG_SEND_OPTION = "achievement-config-send-option"
ACHIEVEMENT_CONFIG_NEW_BTN = "achievement-config-new-btn"
ACHIEVEMENT_CONFIG_MANAGE_BTN = "achievement-config-manage-btn"
ACHIEVEMENT_CONFIG_ACHIEVEMENTS_LIST = "achievement-config-list"

# New/Edit achievement modal
ACHIEVEMENT_NEW_CALLBACK_ID = "achievement-new-id"
ACHIEVEMENT_NEW_NAME = "achievement-new-name"
ACHIEVEMENT_NEW_DESCRIPTION = "achievement-new-description"
ACHIEVEMENT_NEW_IMAGE = "achievement-new-image"
ACHIEVEMENT_NEW_AUTO_MANUAL = "achievement-new-auto-manual"
ACHIEVEMENT_NEW_PERIOD = "achievement-new-period"
ACHIEVEMENT_NEW_METRIC = "achievement-new-metric"
ACHIEVEMENT_NEW_THRESHOLD = "achievement-new-threshold"
ACHIEVEMENT_NEW_FILTER_INCLUDE_CATEGORY = "achievement-new-filter-inc-cat"
ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TYPE = "achievement-new-filter-inc-type"
ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TAG = "achievement-new-filter-inc-tag"
ACHIEVEMENT_NEW_FILTER_EXCLUDE_CATEGORY = "achievement-new-filter-exc-cat"
ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TYPE = "achievement-new-filter-exc-type"
ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TAG = "achievement-new-filter-exc-tag"

# Manage achievements modal
ACHIEVEMENT_MANAGE_CALLBACK_ID = "achievement-manage-id"
ACHIEVEMENT_MANAGE_OVERFLOW = "achievement-manage-overflow"

# Tag achievement modal (manual tagging)
ACHIEVEMENT_TAG_CALLBACK_ID = "achievement-tag-id"
ACHIEVEMENT_TAG_SELECT = "achievement-tag-select"
ACHIEVEMENT_TAG_PAX = "achievement-tag-pax"
ACHIEVEMENT_TAG_DATE = "achievement-tag-date"


# =============================================================================
# Service Class - Business Logic
# =============================================================================
class AchievementService:
    """Service class for achievement business logic."""

    @staticmethod
    def get_all_achievements(org_id: int) -> List[Achievement]:
        """Get all active achievements (region-specific + global)."""
        return DbManager.find_records(
            Achievement,
            filters=[
                Achievement.is_active,
                or_(Achievement.specific_org_id == org_id, Achievement.specific_org_id.is_(None)),
            ],
        )

    @staticmethod
    def get_region_achievements(org_id: int) -> List[Achievement]:
        """Get only region-specific achievements."""
        return DbManager.find_records(
            Achievement,
            filters=[
                Achievement.is_active,
                Achievement.specific_org_id == org_id,
            ],
        )

    @staticmethod
    def get_achievement(achievement_id: int) -> Achievement:
        """Get a single achievement by ID."""
        return DbManager.get(Achievement, achievement_id)

    @staticmethod
    def create_achievement(
        name: str,
        org_id: int,
        description: Optional[str] = None,
        image_url: Optional[str] = None,
        auto_award: bool = False,
        auto_cadence: Optional[Achievement_Cadence] = None,
        auto_threshold: Optional[int] = None,
        auto_threshold_type: Optional[str] = None,
        auto_filters: Optional[Dict[str, Any]] = None,
    ) -> Achievement:
        """Create a new region-specific achievement."""
        achievement = Achievement(
            name=name,
            description=description,
            image_url=image_url,
            specific_org_id=org_id,
            auto_award=auto_award,
            auto_cadence=auto_cadence,
            auto_threshold=auto_threshold,
            auto_threshold_type=auto_threshold_type,
            auto_filters=auto_filters or {},
        )
        return DbManager.create_record(achievement)

    @staticmethod
    def update_achievement(
        achievement_id: int,
        name: Optional[str] = None,
        description: Optional[str] = None,
        image_url: Optional[str] = None,
        auto_award: Optional[bool] = None,
        auto_cadence: Optional[Achievement_Cadence] = None,
        auto_threshold: Optional[int] = None,
        auto_threshold_type: Optional[str] = None,
        auto_filters: Optional[Dict[str, Any]] = None,
    ) -> None:
        """Update an existing achievement."""
        fields = {}
        if name is not None:
            fields[Achievement.name] = name
        if description is not None:
            fields[Achievement.description] = description
        if image_url is not None:
            fields[Achievement.image_url] = image_url
        if auto_award is not None:
            fields[Achievement.auto_award] = auto_award
        if auto_cadence is not None:
            fields[Achievement.auto_cadence] = auto_cadence
        if auto_threshold is not None:
            fields[Achievement.auto_threshold] = auto_threshold
        if auto_threshold_type is not None:
            fields[Achievement.auto_threshold_type] = auto_threshold_type
        if auto_filters is not None:
            fields[Achievement.auto_filters] = auto_filters

        if fields:
            DbManager.update_record(Achievement, achievement_id, fields)

    @staticmethod
    def delete_achievement(achievement_id: int) -> None:
        """Soft-delete an achievement by setting is_active = False."""
        DbManager.update_record(Achievement, achievement_id, {Achievement.is_active: False})

    @staticmethod
    def get_event_types(org_id: int) -> List[EventType]:
        """Get all event types for the org."""
        return DbManager.find_records(
            EventType,
            filters=[
                EventType.is_active,
                or_(EventType.specific_org_id == org_id, EventType.specific_org_id.is_(None)),
            ],
        )

    @staticmethod
    def get_event_tags(org_id: int) -> List[EventTag]:
        """Get all event tags for the org."""
        return DbManager.find_records(
            EventTag,
            filters=[
                EventTag.is_active,
                or_(EventTag.specific_org_id == org_id, EventTag.specific_org_id.is_(None)),
            ],
        )

    @staticmethod
    def tag_achievement(
        user_id: int,
        achievement_id: int,
        date_awarded: datetime,
        award_year: Optional[int] = -1,
        award_period: Optional[int] = -1,
    ) -> Achievement_x_User:
        """Tag a user with an achievement."""
        return DbManager.create_record(
            Achievement_x_User(
                user_id=user_id,
                date_awarded=date_awarded,
                achievement_id=achievement_id,
                award_year=award_year,
                award_period=award_period,
            )
        )

    @staticmethod
    def get_user_achievements_for_year(user_ids: List[int], year: int) -> List[Achievement_x_User]:
        """Get all achievements for users in a given year."""
        return DbManager.find_records(
            Achievement_x_User,
            filters=[
                Achievement_x_User.user_id.in_(user_ids),
                Achievement_x_User.date_awarded >= datetime(year, 1, 1),
                Achievement_x_User.date_awarded <= datetime(year, 12, 31),
            ],
        )


# =============================================================================
# Views Class - Slack UI Construction
# =============================================================================
class AchievementViews:
    """Class for building Slack modal views related to achievements."""

    @staticmethod
    def build_config_modal(
        region_record: SlackSettings,
        achievements: List[Achievement],
    ) -> SdkBlockView:
        """Build the main achievement configuration modal."""
        # Build achievement list text
        if achievements:
            achievement_lines = []
            for a in achievements:
                scope = "🌐 Global" if a.specific_org_id is None else "📍 Region"
                mode = "Auto" if a.auto_award else "Manual"
                description = f": _{a.description}_" if a.description else ""
                achievement_lines.append(f"• *{a.name}* ({scope}, {mode}){description}")
            achievement_list_text = "\n".join(achievement_lines)
        else:
            achievement_list_text = "_No achievements configured_"

        blocks = [
            InputBlock(
                label=PlainTextObject(text="Enable Achievement Reporting"),
                element=RadioButtonsElement(
                    options=as_selector_options(
                        names=["Enabled", "Disabled"],
                        values=["enabled", "disabled"],
                    ),
                    action_id=ACHIEVEMENT_CONFIG_ENABLE,
                ),
                block_id=ACHIEVEMENT_CONFIG_ENABLE,
                optional=False,
            ),
            InputBlock(
                label=PlainTextObject(text="Achievement Reporting Channel"),
                element=ChannelSelectElement(
                    placeholder=PlainTextObject(text="Select a channel..."),
                    action_id=ACHIEVEMENT_CONFIG_CHANNEL,
                ),
                block_id=ACHIEVEMENT_CONFIG_CHANNEL,
                optional=True,
                hint=PlainTextObject(text="Channel where achievement announcements will be posted"),
            ),
            InputBlock(
                label=PlainTextObject(text="How should achievements be posted?"),
                element=RadioButtonsElement(
                    options=[
                        Option(
                            text=PlainTextObject(text="Post each achievement individually"),
                            value="post_individually",
                            description=PlainTextObject(
                                text="Warning! This can generate a lot of notifications in the achievement channel"
                            ),
                        ),
                        Option(
                            text=PlainTextObject(text="Post a daily summary"),
                            value="post_summary",
                            description=PlainTextObject(
                                text="This will post a single summary of all the achievements earned each day"
                            ),
                        ),
                        Option(
                            text=PlainTextObject(text="Let PAX know individually"),
                            value="send_in_dms_only",
                            description=PlainTextObject(text="The achievement channel will not be used"),
                        ),
                    ],
                    action_id=ACHIEVEMENT_CONFIG_SEND_OPTION,
                ),
                block_id=ACHIEVEMENT_CONFIG_SEND_OPTION,
                optional=False,
            ),
            DividerBlock(),
            SectionBlock(
                text=MarkdownTextObject(text="*Manage Region Achievements*"),
                accessory=ButtonElement(
                    text=PlainTextObject(text="➕ New Achievement"),
                    action_id=ACHIEVEMENT_CONFIG_NEW_BTN,
                ),
            ),
            SectionBlock(
                text=MarkdownTextObject(text="_Edit or delete region-specific achievements_"),
                accessory=ButtonElement(
                    text=PlainTextObject(text="✏️ Edit/Delete"),
                    action_id=ACHIEVEMENT_CONFIG_MANAGE_BTN,
                ),
            ),
            DividerBlock(),
            HeaderBlock(text=PlainTextObject(text="Active Achievements")),
            SectionBlock(
                text=MarkdownTextObject(text=achievement_list_text),
                block_id=ACHIEVEMENT_CONFIG_ACHIEVEMENTS_LIST,
            ),
        ]

        form = SdkBlockView(blocks=blocks)

        # Set initial values
        initial_values = {
            ACHIEVEMENT_CONFIG_ENABLE: "enabled" if region_record.send_achievements else "disabled",
            ACHIEVEMENT_CONFIG_SEND_OPTION: region_record.achievement_send_option or "post_summary",
        }
        if region_record.achievement_channel:
            initial_values[ACHIEVEMENT_CONFIG_CHANNEL] = region_record.achievement_channel

        form.set_initial_values(initial_values)

        return form

    @staticmethod
    def build_new_achievement_modal(
        org_id: int,
        event_types: List[EventType],
        event_tags: List[EventTag],
        edit_achievement: Optional[Achievement] = None,
    ) -> SdkBlockView:
        """Build the new/edit achievement modal."""
        # Period options
        period_options = as_selector_options(
            names=["Week", "Month", "Quarter", "Year", "Lifetime"],
            values=["weekly", "monthly", "quarterly", "yearly", "lifetime"],
        )

        # Metric options
        metric_options = as_selector_options(
            names=["Posts (attendance count)", "Qs (times as Q)", "Unique AOs"],
            values=["posts", "qs", "unique_aos"],
        )

        # Category options
        category_options = as_selector_options(
            names=["1st F (Fitness)", "2nd F (Fellowship)", "3rd F (Faith)"],
            values=["first_f", "second_f", "third_f"],
        )

        # Event type options
        event_type_options = as_selector_options(
            names=[et.name for et in event_types] if event_types else ["No event types"],
            values=[str(et.id) for et in event_types] if event_types else ["none"],
        )

        # Event tag options
        event_tag_options = as_selector_options(
            names=[et.name for et in event_tags] if event_tags else ["No event tags"],
            values=[str(et.id) for et in event_tags] if event_tags else ["none"],
        )

        blocks = [
            InputBlock(
                label=PlainTextObject(text="Achievement Name"),
                element=PlainTextInputElement(
                    placeholder=PlainTextObject(text="Enter achievement name..."),
                    action_id=ACHIEVEMENT_NEW_NAME,
                    max_length=100,
                ),
                block_id=ACHIEVEMENT_NEW_NAME,
                optional=False,
            ),
            InputBlock(
                label=PlainTextObject(text="Description"),
                element=PlainTextInputElement(
                    placeholder=PlainTextObject(text="Enter description..."),
                    action_id=ACHIEVEMENT_NEW_DESCRIPTION,
                    multiline=True,
                    max_length=500,
                ),
                block_id=ACHIEVEMENT_NEW_DESCRIPTION,
                optional=True,
            ),
            InputBlock(
                label=PlainTextObject(text="Achievement Image URL"),
                element=PlainTextInputElement(
                    placeholder=PlainTextObject(text="https://example.com/image.png"),
                    action_id=ACHIEVEMENT_NEW_IMAGE,
                ),
                block_id=ACHIEVEMENT_NEW_IMAGE,
                optional=True,
                hint=PlainTextObject(text="URL to an image for this achievement"),
            ),
            InputBlock(
                label=PlainTextObject(text="Award Mode"),
                element=RadioButtonsElement(
                    options=as_selector_options(
                        names=["Automatic (based on metrics)", "Manual (tagged by users)"],
                        values=["auto", "manual"],
                    ),
                    action_id=ACHIEVEMENT_NEW_AUTO_MANUAL,
                ),
                block_id=ACHIEVEMENT_NEW_AUTO_MANUAL,
                optional=False,
            ),
            DividerBlock(),
            HeaderBlock(text=PlainTextObject(text="Auto-Award Settings")),
            ContextBlock(
                elements=[PlainTextObject(text="Configure these settings if using automatic awards")],
            ),
            InputBlock(
                label=PlainTextObject(text="Period"),
                element=StaticSelectElement(
                    placeholder=PlainTextObject(text="Select period..."),
                    options=period_options,
                    action_id=ACHIEVEMENT_NEW_PERIOD,
                ),
                block_id=ACHIEVEMENT_NEW_PERIOD,
                optional=True,
            ),
            InputBlock(
                label=PlainTextObject(text="Metric"),
                element=StaticSelectElement(
                    placeholder=PlainTextObject(text="Select metric..."),
                    options=metric_options,
                    action_id=ACHIEVEMENT_NEW_METRIC,
                ),
                block_id=ACHIEVEMENT_NEW_METRIC,
                optional=True,
            ),
            InputBlock(
                label=PlainTextObject(text="Threshold"),
                element=NumberInputElement(
                    placeholder=PlainTextObject(text="Enter threshold..."),
                    is_decimal_allowed=False,
                    action_id=ACHIEVEMENT_NEW_THRESHOLD,
                ),
                block_id=ACHIEVEMENT_NEW_THRESHOLD,
                optional=True,
                hint=PlainTextObject(text="Minimum value to earn this achievement"),
            ),
            DividerBlock(),
            HeaderBlock(text=PlainTextObject(text="Filter Settings (Include)")),
            ContextBlock(
                elements=[PlainTextObject(text="Only count events matching these criteria")],
            ),
            InputBlock(
                label=PlainTextObject(text="Include Categories"),
                element=CheckboxesElement(
                    options=category_options,
                    action_id=ACHIEVEMENT_NEW_FILTER_INCLUDE_CATEGORY,
                ),
                block_id=ACHIEVEMENT_NEW_FILTER_INCLUDE_CATEGORY,
                optional=True,
            ),
            InputBlock(
                label=PlainTextObject(text="Include Event Types"),
                element=StaticMultiSelectElement(
                    placeholder=PlainTextObject(text="Select event types..."),
                    options=event_type_options,
                    action_id=ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TYPE,
                ),
                block_id=ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TYPE,
                optional=True,
            ),
            InputBlock(
                label=PlainTextObject(text="Include Event Tags"),
                element=StaticMultiSelectElement(
                    placeholder=PlainTextObject(text="Select event tags..."),
                    options=event_tag_options,
                    action_id=ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TAG,
                ),
                block_id=ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TAG,
                optional=True,
            ),
            DividerBlock(),
            HeaderBlock(text=PlainTextObject(text="Filter Settings (Exclude)")),
            ContextBlock(
                elements=[PlainTextObject(text="Exclude events matching these criteria")],
            ),
            InputBlock(
                label=PlainTextObject(text="Exclude Categories"),
                element=CheckboxesElement(
                    options=category_options,
                    action_id=ACHIEVEMENT_NEW_FILTER_EXCLUDE_CATEGORY,
                ),
                block_id=ACHIEVEMENT_NEW_FILTER_EXCLUDE_CATEGORY,
                optional=True,
            ),
            InputBlock(
                label=PlainTextObject(text="Exclude Event Types"),
                element=StaticMultiSelectElement(
                    placeholder=PlainTextObject(text="Select event types..."),
                    options=event_type_options,
                    action_id=ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TYPE,
                ),
                block_id=ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TYPE,
                optional=True,
            ),
            InputBlock(
                label=PlainTextObject(text="Exclude Event Tags"),
                element=StaticMultiSelectElement(
                    placeholder=PlainTextObject(text="Select event tags..."),
                    options=event_tag_options,
                    action_id=ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TAG,
                ),
                block_id=ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TAG,
                optional=True,
            ),
        ]

        form = SdkBlockView(blocks=blocks)

        # Pre-populate if editing
        if edit_achievement:
            initial_values = {
                ACHIEVEMENT_NEW_NAME: edit_achievement.name,
                ACHIEVEMENT_NEW_AUTO_MANUAL: "auto" if edit_achievement.auto_award else "manual",
            }
            if edit_achievement.description:
                initial_values[ACHIEVEMENT_NEW_DESCRIPTION] = edit_achievement.description
            if edit_achievement.image_url:
                initial_values[ACHIEVEMENT_NEW_IMAGE] = edit_achievement.image_url
            if edit_achievement.auto_cadence:
                initial_values[ACHIEVEMENT_NEW_PERIOD] = edit_achievement.auto_cadence.name.lower()
            if edit_achievement.auto_threshold_type:
                initial_values[ACHIEVEMENT_NEW_METRIC] = edit_achievement.auto_threshold_type.lower()
            if edit_achievement.auto_threshold:
                initial_values[ACHIEVEMENT_NEW_THRESHOLD] = edit_achievement.auto_threshold

            # Parse filters
            filters = edit_achievement.auto_filters or {}
            includes = filters.get("include") or []
            excludes = filters.get("exclude") or []

            for inc in includes:
                if isinstance(inc, dict):
                    if "event_category" in inc:
                        initial_values[ACHIEVEMENT_NEW_FILTER_INCLUDE_CATEGORY] = inc["event_category"]
                    if "event_type_id" in inc:
                        initial_values[ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TYPE] = [
                            str(x) for x in inc["event_type_id"]
                        ]
                    if "event_tag_id" in inc:
                        initial_values[ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TAG] = [str(x) for x in inc["event_tag_id"]]

            for exc in excludes:
                if isinstance(exc, dict):
                    if "event_category" in exc:
                        initial_values[ACHIEVEMENT_NEW_FILTER_EXCLUDE_CATEGORY] = exc["event_category"]
                    if "event_type_id" in exc:
                        initial_values[ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TYPE] = [
                            str(x) for x in exc["event_type_id"]
                        ]
                    if "event_tag_id" in exc:
                        initial_values[ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TAG] = [str(x) for x in exc["event_tag_id"]]

            form.set_initial_values(initial_values)

        return form

    @staticmethod
    def build_manage_modal(achievements: List[Achievement]) -> SdkBlockView:
        """Build the manage achievements modal with overflow menus."""
        blocks = [
            ContextBlock(
                elements=[PlainTextObject(text="Only region-specific achievements can be edited or deleted.")],
            ),
        ]

        if not achievements:
            blocks.append(
                SectionBlock(
                    text=MarkdownTextObject(text="_No region-specific achievements found._"),
                ),
            )
        else:
            for achievement in achievements:
                mode = "🤖 Auto" if achievement.auto_award else "👤 Manual"
                blocks.append(
                    SectionBlock(
                        text=MarkdownTextObject(text=f"*{achievement.name}*\n{mode}"),
                        block_id=f"{ACHIEVEMENT_MANAGE_OVERFLOW}_{achievement.id}",
                        accessory=OverflowMenuElement(
                            options=[
                                Option(text="Edit Achievement", value=f"edit_{achievement.id}"),
                                Option(text="Delete Achievement", value=f"delete_{achievement.id}"),
                            ],
                            action_id=f"{ACHIEVEMENT_MANAGE_OVERFLOW}_{achievement.id}",
                        ),
                    ),
                )

        return SdkBlockView(blocks=blocks)

    @staticmethod
    def build_tag_modal(achievements: List[Achievement]) -> SdkBlockView:
        """Build the manual achievement tagging modal."""
        achievement_options = as_selector_options(
            names=[a.name for a in achievements] if achievements else ["No achievements available"],
            values=[str(a.id) for a in achievements] if achievements else ["none"],
            descriptions=[a.description for a in achievements] if achievements else None,
        )

        blocks = [
            InputBlock(
                label=PlainTextObject(text="Achievement"),
                element=StaticSelectElement(
                    placeholder=PlainTextObject(text="Select the achievement..."),
                    options=achievement_options,
                    action_id=ACHIEVEMENT_TAG_SELECT,
                ),
                block_id=ACHIEVEMENT_TAG_SELECT,
                optional=False,
                hint=PlainTextObject(
                    text="If you don't see the achievement you're looking for, talk to your Weasel Shaker / Tech Q!"
                ),
            ),
            InputBlock(
                label=PlainTextObject(text="Select the PAX"),
                element=StaticMultiSelectElement(
                    placeholder=PlainTextObject(text="Select the PAX..."),
                    action_id=ACHIEVEMENT_TAG_PAX,
                ),
                block_id=ACHIEVEMENT_TAG_PAX,
                optional=False,
            ),
            InputBlock(
                label=PlainTextObject(text="Achievement Date"),
                element=StaticSelectElement(
                    placeholder=PlainTextObject(text="Select the date..."),
                    action_id=ACHIEVEMENT_TAG_DATE,
                ),
                block_id=ACHIEVEMENT_TAG_DATE,
                optional=False,
                hint=PlainTextObject(
                    text="Use a date in the period the achievement was earned, as some can be earned multiple times."
                ),
            ),
        ]

        return SdkBlockView(blocks=blocks)


# =============================================================================
# Handler Functions
# =============================================================================
def build_config_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Build and display the achievement configuration modal."""
    trigger_id = safe_get(body, "trigger_id")

    if region_record.org_id not in ACHIEVEMENTS_ALPHA_TESTING_ORG_IDS:
        form = SdkBlockView(
            blocks=[
                SectionBlock(
                    text=MarkdownTextObject(
                        text=":construction: This feature is currently in alpha testing, coming soon to all regions! :construction:"  # noqa E501
                    ),
                ),
            ]
        )
        submit = "None"
    else:
        service = AchievementService()
        views = AchievementViews()

        achievements = service.get_all_achievements(region_record.org_id)
        form = views.build_config_modal(region_record, achievements)
        submit = "Submit"

    form.post_modal(
        client=client,
        trigger_id=trigger_id,
        title_text="Achievement Settings",
        callback_id=ACHIEVEMENT_CONFIG_CALLBACK_ID,
        new_or_add="add",
        submit_button_text=submit,
    )


def handle_config_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Handle the achievement configuration form submission."""
    form = AchievementViews.build_config_modal(region_record, [])
    form_data = form.get_selected_values(body)

    # Update settings
    region_record.send_achievements = 1 if form_data.get(ACHIEVEMENT_CONFIG_ENABLE) == "enabled" else 0
    region_record.achievement_channel = form_data.get(ACHIEVEMENT_CONFIG_CHANNEL)
    region_record.achievement_send_option = form_data.get(ACHIEVEMENT_CONFIG_SEND_OPTION) or "post_summary"

    # Save to database
    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )
    update_local_region_records()


def build_new_achievement_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Build and display the new achievement modal."""
    update_view_id = add_loading_form(body, client, new_or_add="add")

    service = AchievementService()
    views = AchievementViews()

    event_types = service.get_event_types(region_record.org_id)
    event_tags = service.get_event_tags(region_record.org_id)

    form = views.build_new_achievement_modal(region_record.org_id, event_types, event_tags)

    form.update_modal(
        client=client,
        view_id=update_view_id,
        title_text="New Achievement",
        callback_id=ACHIEVEMENT_NEW_CALLBACK_ID,
    )


def build_edit_achievement_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    achievement_id: int,
):
    """Build and display the edit achievement modal."""
    update_view_id = add_loading_form(body, client, new_or_add="add")

    service = AchievementService()
    views = AchievementViews()

    achievement = service.get_achievement(achievement_id)
    event_types = service.get_event_types(region_record.org_id)
    event_tags = service.get_event_tags(region_record.org_id)

    form = views.build_new_achievement_modal(
        region_record.org_id, event_types, event_tags, edit_achievement=achievement
    )

    form.update_modal(
        client=client,
        view_id=update_view_id,
        title_text="Edit Achievement",
        callback_id=ACHIEVEMENT_NEW_CALLBACK_ID,
        parent_metadata={"edit_achievement_id": achievement_id},
    )


def handle_new_achievement_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Handle the new/edit achievement form submission."""
    service = AchievementService()

    # Create a dummy form to parse values
    form = SdkBlockView(blocks=[])
    form_data = form.get_selected_values(body)

    # Extract form values
    name = form_data.get(ACHIEVEMENT_NEW_NAME)
    description = form_data.get(ACHIEVEMENT_NEW_DESCRIPTION)
    image_url = form_data.get(ACHIEVEMENT_NEW_IMAGE)
    auto_manual = form_data.get(ACHIEVEMENT_NEW_AUTO_MANUAL)
    period = form_data.get(ACHIEVEMENT_NEW_PERIOD)
    metric = form_data.get(ACHIEVEMENT_NEW_METRIC)
    threshold = safe_convert(form_data.get(ACHIEVEMENT_NEW_THRESHOLD), int)

    # Build auto_filters
    auto_filters = {"include": [], "exclude": []}

    # Include filters
    include_categories = form_data.get(ACHIEVEMENT_NEW_FILTER_INCLUDE_CATEGORY) or []
    include_event_types = form_data.get(ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TYPE) or []
    include_event_tags = form_data.get(ACHIEVEMENT_NEW_FILTER_INCLUDE_EVENT_TAG) or []

    if include_categories:
        auto_filters["include"].append({"event_category": include_categories})
    if include_event_types and include_event_types != ["none"]:
        auto_filters["include"].append({"event_type_id": [int(x) for x in include_event_types]})
    if include_event_tags and include_event_tags != ["none"]:
        auto_filters["include"].append({"event_tag_id": [int(x) for x in include_event_tags]})

    # Exclude filters
    exclude_categories = form_data.get(ACHIEVEMENT_NEW_FILTER_EXCLUDE_CATEGORY) or []
    exclude_event_types = form_data.get(ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TYPE) or []
    exclude_event_tags = form_data.get(ACHIEVEMENT_NEW_FILTER_EXCLUDE_EVENT_TAG) or []

    if exclude_categories:
        auto_filters["exclude"].append({"event_category": exclude_categories})
    if exclude_event_types and exclude_event_types != ["none"]:
        auto_filters["exclude"].append({"event_type_id": [int(x) for x in exclude_event_types]})
    if exclude_event_tags and exclude_event_tags != ["none"]:
        auto_filters["exclude"].append({"event_tag_id": [int(x) for x in exclude_event_tags]})

    # Determine cadence
    auto_cadence = None
    if period:
        cadence_map = {
            "weekly": Achievement_Cadence.weekly,
            "monthly": Achievement_Cadence.monthly,
            "quarterly": Achievement_Cadence.quarterly,
            "yearly": Achievement_Cadence.yearly,
            "lifetime": Achievement_Cadence.lifetime,
        }
        auto_cadence = cadence_map.get(period)

    # Check if editing
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    edit_achievement_id = safe_convert(metadata.get("edit_achievement_id"), int)

    if edit_achievement_id:
        # Update existing
        service.update_achievement(
            achievement_id=edit_achievement_id,
            name=name,
            description=description,
            image_url=image_url,
            auto_award=(auto_manual == "auto"),
            auto_cadence=auto_cadence,
            auto_threshold=threshold,
            auto_threshold_type=metric,
            auto_filters=auto_filters if auto_manual == "auto" else None,
        )
    else:
        # Create new
        if name:
            service.create_achievement(
                name=name,
                org_id=region_record.org_id,
                description=description,
                image_url=image_url,
                auto_award=(auto_manual == "auto"),
                auto_cadence=auto_cadence,
                auto_threshold=threshold,
                auto_threshold_type=metric,
                auto_filters=auto_filters if auto_manual == "auto" else None,
            )


def build_manage_achievements_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Build and display the manage achievements modal."""
    service = AchievementService()
    views = AchievementViews()

    achievements = service.get_region_achievements(region_record.org_id)
    form = views.build_manage_modal(achievements)

    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Manage Achievements",
        callback_id=ACHIEVEMENT_MANAGE_CALLBACK_ID,
        submit_button_text="None",
        new_or_add="add",
    )


def handle_manage_overflow(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Handle overflow menu selection in manage achievements modal."""
    selected_value = safe_get(body, "actions", 0, "selected_option", "value")

    if not selected_value:
        return

    action_type, achievement_id_str = selected_value.split("_", 1)
    achievement_id = safe_convert(achievement_id_str, int)

    if action_type == "edit":
        build_edit_achievement_form(body, client, logger, context, region_record, achievement_id)
    elif action_type == "delete":
        service = AchievementService()
        service.delete_achievement(achievement_id)


# =============================================================================
# Tag Achievement Handlers (moved from weaselbot.py)
# =============================================================================
def build_tag_achievement_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Build and display the tag achievement modal."""
    from utilities.slack import actions as legacy_actions
    from utilities.slack import forms as legacy_forms
    from utilities.slack import orm as legacy_orm

    if region_record.org_id not in ACHIEVEMENTS_ALPHA_TESTING_ORG_IDS:
        form = SdkBlockView(
            blocks=[
                SectionBlock(
                    text=MarkdownTextObject(
                        text=":construction: This feature is currently in alpha testing, coming soon to all regions! :construction:"  # noqa E501
                    ),
                ),
            ]
        )
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Tag Achievements",
            callback_id=ACHIEVEMENT_TAG_CALLBACK_ID,
            new_or_add="add",
            submit_button_text="None",
        )
        return

    update_view_id = safe_get(body, legacy_actions.LOADING_ID)
    achievement_form = copy.deepcopy(legacy_forms.ACHIEVEMENT_FORM)
    callback_id = ACHIEVEMENT_TAG_CALLBACK_ID

    # Build achievement list
    service = AchievementService()
    achievement_list = service.get_all_achievements(region_record.org_id)

    if achievement_list:
        achievement_options = legacy_orm.as_selector_options(
            names=[achievement.name for achievement in achievement_list],
            values=[str(achievement.id) for achievement in achievement_list],
            descriptions=[achievement.description for achievement in achievement_list],
        )
    else:
        achievement_options = legacy_orm.as_selector_options(
            names=["No achievements available"],
            values=["None"],
        )

    achievement_form.set_initial_values(
        {
            legacy_actions.ACHIEVEMENT_DATE: datetime.now(pytz.timezone("US/Central")).strftime("%Y-%m-%d"),
        }
    )
    achievement_form.set_options(
        {
            legacy_actions.ACHIEVEMENT_SELECT: achievement_options,
        }
    )

    achievement_form.update_modal(
        client=client,
        view_id=update_view_id,
        callback_id=callback_id,
        title_text="Tag achievements",
    )


def handle_tag_achievement(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Handle the tag achievement form submission."""
    from utilities.slack import actions as legacy_actions
    from utilities.slack import forms as legacy_forms

    achievement_data = legacy_forms.ACHIEVEMENT_FORM.get_selected_values(body)
    achievement_pax_list = safe_get(achievement_data, legacy_actions.ACHIEVEMENT_PAX)
    achievement_slack_user_list = [get_user(pax, region_record, client, logger) for pax in achievement_pax_list]
    achievement_pax_list = [pax.user_id for pax in achievement_slack_user_list]
    achievement_id = safe_convert(safe_get(achievement_data, legacy_actions.ACHIEVEMENT_SELECT), int)
    achievement_date = datetime.strptime(safe_get(achievement_data, legacy_actions.ACHIEVEMENT_DATE), "%Y-%m-%d")

    service = AchievementService()
    achievement_info = service.get_achievement(achievement_id)
    achievement_name = achievement_info.name

    # Figure out which period this achievement falls into for the year (week, month, quarter, etc.) based on the achievement date # noqa
    achievement_year = achievement_date.year
    achievement_period = None
    if achievement_info.auto_cadence == Achievement_Cadence.weekly:
        achievement_period = achievement_date.isocalendar()[1]  # Week number
    elif achievement_info.auto_cadence == Achievement_Cadence.monthly:
        achievement_period = achievement_date.month
    elif achievement_info.auto_cadence == Achievement_Cadence.quarterly:
        achievement_period = (achievement_date.month - 1) // 3 + 1
    elif achievement_info.auto_cadence == Achievement_Cadence.yearly:
        achievement_period = 1  # All achievements in the same year fall into the same period
    elif achievement_info.auto_cadence == Achievement_Cadence.lifetime:
        achievement_period = 1  # Lifetime achievements don't have periods, but we can set it to 1 for consistency

    for pax in achievement_slack_user_list:
        service.tag_achievement(
            user_id=pax.user_id,
            achievement_id=achievement_id,
            date_awarded=current_date_cst(),
            award_year=achievement_year,
            award_period=achievement_period,
        )

    if region_record.send_achievements:
        achievement_description = achievement_info.description
        achievement_image_url = achievement_info.image_url

        if region_record.achievement_channel and region_record.achievement_send_option == "post_individually":
            for pax in achievement_slack_user_list:
                user_tag = f"<@{pax.slack_id}>"
                msg = f"🏆 *{achievement_name}*"
                if achievement_description:
                    msg += f"\n_{achievement_description}_"
                msg += f"\n\nEarned by {user_tag}!"
                if achievement_image_url:
                    msg += f"\n{achievement_image_url}"
                client.chat_postMessage(channel=region_record.achievement_channel, text=msg)
        elif region_record.achievement_channel and region_record.achievement_send_option == "post_summary":
            earners = ", ".join(f"<@{pax.slack_id}>" for pax in achievement_slack_user_list)
            desc = f": {achievement_description}" if achievement_description else ""
            msg = f"🏆 *{achievement_name}*{desc}\nEarned by {earners}"
            if achievement_image_url:
                msg += f"\n{achievement_image_url}"
            client.chat_postMessage(channel=region_record.achievement_channel, text=msg)
        elif region_record.achievement_send_option == "send_in_dms_only":
            for pax in achievement_slack_user_list:
                msg = f"🎉 Congratulations! You've earned an achievement!\n\n🏆 *{achievement_name}*"
                if achievement_description:
                    msg += f"\n_{achievement_description}_"
                if achievement_image_url:
                    msg += f"\n{achievement_image_url}"
                client.chat_postMessage(channel=pax.slack_id, text=msg)
