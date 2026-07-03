import copy
from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_convert, safe_get, update_local_region_records
from utilities.slack import actions, orm


def build_special_settings_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form = copy.deepcopy(SPECIAL_EVENTS_FORM)
    form.set_initial_values(
        {
            actions.SPECIAL_EVENTS_ENABLED: "enable" if region_record.special_events_enabled else None,
            # actions.SPECIAL_EVENTS_CHANNEL: region_record.special_events_channel,
            actions.SPECIAL_EVENTS_POST_DAYS: str(region_record.special_events_post_days or 30),
            actions.SPECIAL_EVENTS_INFO_CANVAS_CHANNEL: region_record.canvas_channel,
        }
    )

    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Edit Region",
        callback_id=actions.SPECIAL_EVENTS_CALLBACK_ID,
        new_or_add="add",
    )


def handle_special_settings_edit(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form_data = SPECIAL_EVENTS_FORM.get_selected_values(body)

    region_record.special_events_enabled = safe_get(form_data, actions.SPECIAL_EVENTS_ENABLED, 0) == "enable"
    # region_record.special_events_channel = safe_get(form_data, actions.SPECIAL_EVENTS_CHANNEL)
    region_record.special_events_post_days = safe_convert(safe_get(form_data, actions.SPECIAL_EVENTS_POST_DAYS), int)
    region_record.canvas_channel = safe_get(form_data, actions.SPECIAL_EVENTS_INFO_CANVAS_CHANNEL)

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )

    update_local_region_records()


SPECIAL_EVENTS_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Enable Region Info Canvas",
            action=actions.SPECIAL_EVENTS_ENABLED,
            element=orm.CheckboxInputElement(options=orm.as_selector_options(["Enable"], ["enable"])),
            optional=False,
        ),
        # orm.InputBlock(
        #     label="Special Events Channel",
        #     action=actions.SPECIAL_EVENTS_CHANNEL,
        #     element=orm.ConversationsSelectElement(),
        #     optional=True,
        # ),
        orm.InputBlock(
            label="How far ahead should events be list?",
            action=actions.SPECIAL_EVENTS_POST_DAYS,
            element=orm.PlainTextInputElement(placeholder="Enter the number of days"),
            optional=True,
            hint="This is the number of days before the event that special events will be list on the canvas. Defaults to 30 days.",  # noqa
        ),
        orm.InputBlock(
            label="Region Info Canvas Channel",
            action=actions.SPECIAL_EVENTS_INFO_CANVAS_CHANNEL,
            element=orm.ConversationsSelectElement(),
            optional=True,
            hint="This is the channel where the region info canvas will be posted.",
        ),
    ]
)
