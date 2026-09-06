import copy
from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from utilities import constants
from utilities.builders import update_submission_wait_view
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get, update_local_region_records
from utilities.slack import actions, orm

DEFAULT_LEAD_DAYS = 14
MIN_LEAD_DAYS = 0
MAX_LEAD_DAYS = 30


def build_f3versary_announcements_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form = copy.deepcopy(F3VERSARY_ANNOUNCEMENTS_FORM)
    lead_days = (
        region_record.f3versary_announcements_lead_days
        if region_record.f3versary_announcements_lead_days is not None
        else DEFAULT_LEAD_DAYS
    )
    form.set_initial_values(
        {
            actions.F3VERSARY_ANNOUNCEMENTS_ENABLED: (
                "enable" if region_record.f3versary_announcements_enabled else None
            ),
            actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: region_record.f3versary_announcements_channel,
            actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: str(lead_days),
        }
    )
    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="F3versary Announcements",
        callback_id=actions.F3VERSARY_ANNOUNCEMENTS_CALLBACK_ID,
        new_or_add="add",
    )


def handle_f3versary_announcements_edit(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form_data = F3VERSARY_ANNOUNCEMENTS_FORM.get_selected_values(body)
    submission_view_id = safe_get(body, "submission_view_id") or safe_get(body, "view", "id")
    enabled = safe_get(form_data, actions.F3VERSARY_ANNOUNCEMENTS_ENABLED) == "enable"
    channel = safe_get(form_data, actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL)
    raw_lead_days = safe_get(form_data, actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS)

    try:
        lead_days = int(raw_lead_days)
    except (TypeError, ValueError):
        lead_days = -1

    if not MIN_LEAD_DAYS <= lead_days <= MAX_LEAD_DAYS:
        update_submission_wait_view(
            client=client,
            title="Invalid lead time",
            text="Enter a whole number from 0 through 30 for the announcement lead time.",
            level=constants.AlertLevel.ERROR,
            logger=logger,
            view_id=submission_view_id,
        )
        return

    if enabled and not channel:
        update_submission_wait_view(
            client=client,
            title="Channel required",
            text="Select a destination channel before enabling F3versary Announcements.",
            level=constants.AlertLevel.ERROR,
            logger=logger,
            view_id=submission_view_id,
        )
        return

    region_record.f3versary_announcements_enabled = enabled
    region_record.f3versary_announcements_channel = channel
    region_record.f3versary_announcements_lead_days = lead_days

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )
    update_local_region_records()
    update_submission_wait_view(
        client=client,
        title="Complete!",
        text="F3versary Announcements settings saved successfully!",
        level=constants.AlertLevel.SUCCESS,
        logger=logger,
        view_id=submission_view_id,
    )


F3VERSARY_ANNOUNCEMENTS_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Enable F3versary Announcements",
            action=actions.F3VERSARY_ANNOUNCEMENTS_ENABLED,
            element=orm.CheckboxInputElement(options=orm.as_selector_options(["Enable"], ["enable"])),
            optional=False,
        ),
        orm.InputBlock(
            label="Announcement Channel",
            action=actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL,
            element=orm.ConversationsSelectElement(),
            optional=True,
            hint="The channel where daily F3versary announcements will be posted.",
        ),
        orm.InputBlock(
            label="Days Before the F3versary",
            action=actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS,
            element=orm.PlainTextInputElement(placeholder="Enter a whole number from 0 through 30"),
            optional=False,
            hint=(
                "Announcements run daily after 5:00 PM Central. "
                "Enter 0 for the anniversary date itself. Defaults to 14."
            ),
        ),
    ]
)
