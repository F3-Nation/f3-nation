import copy
from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from features.calendar import event_instance, event_tag, event_type
from utilities.constants import EVENT_TAG_COLORS
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_convert, safe_get
from utilities.slack import actions, orm

CALENDAR_CONFIG_POST_CALENDAR_IMAGE = "calendar_config_post_calendar_image"
CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL = "calendar_config_calendar_image_channel"
CALENDAR_CONFIG_Q_LINEUP_METHOD = "calendar_config_q_lineup_method"
CALENDAR_CONFIG_Q_LINEUP_CHANNEL = "calendar_config_q_lineup_channel"
CALENDAR_CONFIG_Q_LINEUP_DAY = "calendar_config_q_lineup_day"
CALENDAR_CONFIG_Q_LINEUP_TIME = "calendar_config_q_lineup_time"
CALENDAR_CONFIG_GROUP_BY_OPTION = "calendar_config_group_by_option"
CALENDAR_CONFIG_OPEN_EVENT_COLOR = "calendar_config_open_event_color"


def build_calendar_config_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form = copy.deepcopy(CALENDAR_CONFIG_FORM)
    form.update_modal(  # TODO: add a "back to main menu" button?
        client=client,
        view_id=safe_get(body, "view", "id"),
        title_text="Calendar Settings",
        callback_id=actions.CALENDAR_CONFIG_CALLBACK_ID,
        submit_button_text="None",
    )


def build_calendar_general_config_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form = copy.deepcopy(CALENDAR_CONFIG_GENERAL_FORM)
    q_lineups_time = (
        f"{str(region_record.send_q_lineups_hour_cst).zfill(2)}:00"
        if region_record.send_q_lineups_hour_cst
        else "17:00"
    )
    form.set_initial_values(
        {
            CALENDAR_CONFIG_GROUP_BY_OPTION: region_record.calendar_group_by_option or "ao",
            CALENDAR_CONFIG_OPEN_EVENT_COLOR: region_record.open_event_color or "Green",
            actions.CALENDAR_CONFIG_Q_LINEUP: "yes" if region_record.send_q_lineups else "no",
            CALENDAR_CONFIG_Q_LINEUP_METHOD: region_record.send_q_lineups_method or "yes_per_ao",
            CALENDAR_CONFIG_Q_LINEUP_CHANNEL: region_record.send_q_lineups_channel,
            CALENDAR_CONFIG_POST_CALENDAR_IMAGE: "yes" if region_record.q_image_posting_enabled else "no",
            CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL: region_record.q_image_posting_channel,
            CALENDAR_CONFIG_Q_LINEUP_DAY: safe_convert(region_record.send_q_lineups_day, str) or "6",
            CALENDAR_CONFIG_Q_LINEUP_TIME: q_lineups_time,
        }
    )
    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Calendar Settings",
        callback_id=actions.CALENDAR_CONFIG_GENERAL_CALLBACK_ID,
        new_or_add="add",
    )


def handle_calendar_config_general(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form = copy.deepcopy(CALENDAR_CONFIG_GENERAL_FORM)
    values = form.get_selected_values(body)
    region_record.calendar_group_by_option = safe_get(values, CALENDAR_CONFIG_GROUP_BY_OPTION)
    region_record.send_q_lineups = safe_get(values, actions.CALENDAR_CONFIG_Q_LINEUP) == "yes"
    region_record.send_q_lineups_method = safe_get(values, CALENDAR_CONFIG_Q_LINEUP_METHOD)
    region_record.send_q_lineups_channel = safe_get(values, CALENDAR_CONFIG_Q_LINEUP_CHANNEL)
    region_record.q_image_posting_enabled = safe_get(values, CALENDAR_CONFIG_POST_CALENDAR_IMAGE) == "yes"
    region_record.q_image_posting_channel = safe_get(values, CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL)
    region_record.open_event_color = safe_get(values, CALENDAR_CONFIG_OPEN_EVENT_COLOR)
    region_record.send_q_lineups_day = safe_convert(safe_get(values, CALENDAR_CONFIG_Q_LINEUP_DAY), int)
    send_q_lineups_time = safe_convert(safe_get(values, CALENDAR_CONFIG_Q_LINEUP_TIME), str)
    region_record.send_q_lineups_hour_cst = (
        safe_convert(send_q_lineups_time.split(":")[0], int) if send_q_lineups_time else 17
    )
    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )


CALENDAR_CONFIG_GENERAL_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Send Q Lineups",
            action=actions.CALENDAR_CONFIG_Q_LINEUP,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(
                    names=["Yes", "No"],
                    values=["yes", "no"],
                ),
                initial_value="yes",
            ),
            optional=False,
        ),
        orm.InputBlock(
            label="How should they be sent?",
            action=CALENDAR_CONFIG_Q_LINEUP_METHOD,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(
                    names=["One Per AO", "One For All AOs"],
                    values=["yes_per_ao", "yes_for_all"],
                ),
                initial_value="yes",
            ),
            optional=True,
            hint="This setting only applies if 'Send Q Lineups' is set to 'Yes'.",
        ),
        orm.InputBlock(
            label="Region Q Lineup Channel",
            action=CALENDAR_CONFIG_Q_LINEUP_CHANNEL,
            element=orm.ChannelsSelectElement(placeholder="Select a channel"),
            optional=True,
            hint="This setting only applies if 'Send Q Lineups' is set to 'Yes' and 'How should they be sent?' is set to 'One For All AOs'.",  # noqa
        ),
        orm.InputBlock(
            label="Region Q Lineup Day",
            action=CALENDAR_CONFIG_Q_LINEUP_DAY,
            element=orm.StaticSelectElement(
                options=orm.as_selector_options(
                    names=["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"],
                    values=["0", "1", "2", "3", "4", "5", "6"],
                ),
                initial_value="6",
            ),
            optional=False,
        ),
        orm.InputBlock(
            label="Region Q Lineup Time (CST)",
            action=CALENDAR_CONFIG_Q_LINEUP_TIME,
            element=orm.TimepickerElement(initial_value="17:00"),
            optional=False,
            hint="These settings only applies if 'Send Q Lineups' is set to 'Yes'.",
        ),
        orm.DividerBlock(),
        orm.InputBlock(
            label="Post Calendar Image",
            action=CALENDAR_CONFIG_POST_CALENDAR_IMAGE,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(
                    names=["Yes", "No"],
                    values=["yes", "no"],
                ),
                initial_value="no",
            ),
            optional=False,
        ),
        orm.InputBlock(
            label="Calendar Image Channel",
            action=CALENDAR_CONFIG_CALENDAR_IMAGE_CHANNEL,
            element=orm.ChannelsSelectElement(placeholder="Select a channel"),
            optional=True,
        ),
        orm.InputBlock(
            label="Group Calendar By Option",
            action=CALENDAR_CONFIG_GROUP_BY_OPTION,
            element=orm.RadioButtonsElement(
                options=orm.as_selector_options(
                    names=["AO", "Location"],
                    values=["ao", "location"],
                ),
                initial_value="ao",
            ),
            optional=False,
            hint="This setting controls how events are grouped on calendar images and on `/f3-calendar`.",
        ),
        orm.InputBlock(
            label="Open Event Color",
            action=CALENDAR_CONFIG_OPEN_EVENT_COLOR,
            element=orm.StaticSelectElement(
                options=orm.as_selector_options(
                    names=[c for c in EVENT_TAG_COLORS.keys() if c != "Closed"],
                    values=[c for c in EVENT_TAG_COLORS.keys() if c != "Closed"],
                ),
                initial_value="Green",
            ),
            optional=False,
            hint="Color used for open events on the calendar image.",
        ),
    ]
)

CALENDAR_CONFIG_FORM = orm.BlockView(
    blocks=[
        orm.ActionsBlock(
            elements=[
                orm.ButtonElement(
                    label=":gear: General Calendar Settings",
                    action=actions.CALENDAR_CONFIG_GENERAL,
                    value="edit",
                )
            ],
        ),
        orm.SectionBlock(
            label=":round_pushpin: Manage Locations",
            action=actions.CALENDAR_MANAGE_LOCATIONS,
            element=orm.OverflowElement(
                options=orm.as_selector_options(
                    names=["Add Location", "Edit or Deactivate Locations"],
                    values=["add", "edit"],
                ),
            ),
        ),
        orm.SectionBlock(
            label=":world_map: Manage AOs",
            action=actions.CALENDAR_MANAGE_AOS,
            element=orm.OverflowElement(
                options=orm.as_selector_options(
                    names=["Add AO", "Edit or Deactivate AOs"],
                    values=["add", "edit"],
                ),
            ),
        ),
        orm.SectionBlock(
            label=":spiral_calendar_pad: Manage Series",
            action=actions.CALENDAR_MANAGE_SERIES,
            element=orm.OverflowElement(
                options=orm.as_selector_options(
                    names=["Add Series", "Edit or Deactivate Series"],
                    values=["add", "edit"],
                ),
            ),
        ),
        orm.SectionBlock(
            label=":date: Manage Single Events",
            action=event_instance.CALENDAR_MANAGE_EVENT_INSTANCE,
            element=orm.OverflowElement(
                options=orm.as_selector_options(
                    names=["Add Single Event", "Edit or Deactivate Single Events"],
                    values=["add", "edit"],
                ),
            ),
        ),
        orm.SectionBlock(
            label=":runner: Manage Event Types",
            action=event_type.CALENDAR_MANAGE_EVENT_TYPES,
            element=orm.OverflowElement(
                options=orm.as_selector_options(
                    names=["Add Event Type", "Edit or Deactivate Event Types"],
                    values=["add", "edit"],
                ),
            ),
        ),
        orm.SectionBlock(
            label=":label: Manage Event Tags",
            action=event_tag.CALENDAR_MANAGE_EVENT_TAGS,
            element=orm.OverflowElement(
                options=orm.as_selector_options(
                    names=["Add Event Tag", "Edit or Delete Event Tags"],
                    values=["add", "edit"],
                ),
            ),
        ),
    ]
)
