import copy
from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.models import blocks
from slack_sdk.web import WebClient

from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

MONTHLY_REPORTS_ENABLED = "monthly_reports_enabled"
REGION_REPORTING_CHANNEL = "region_reporting_channel"
REPORTING_CALLBACK_ID = "reporting_settings"
MONTHLY_REPORT_OPTIONS = {
    "monthly_summary": "Region Monthly Summary",
    # "region_leaderboard": "Region Leaderboard",
    "ao_monthly_summary": "AO Monthly Summary",
    # "ao_leaderboard": "AO Leaderboard",
}
RUN_MONTHLY_REPORTS_NOW = "run_monthly_reports_now"


def build_reporting_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form = copy.deepcopy(FORM)

    monthly_options = []
    if region_record.reporting_region_monthly_summary_enabled:
        monthly_options.append("monthly_summary")
    # if region_record.reporting_region_leaderboard_enabled:
    #     monthly_options.append("region_leaderboard")
    if region_record.reporting_ao_monthly_summary_enabled:
        monthly_options.append("ao_monthly_summary")
    # if region_record.reporting_ao_leaderboard_enabled:
    #     monthly_options.append("ao_leaderboard")

    form.set_initial_values(
        {
            MONTHLY_REPORTS_ENABLED: monthly_options,
            REGION_REPORTING_CHANNEL: region_record.reporting_region_channel,
        }
    )

    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Reporting Settings",
        callback_id=REPORTING_CALLBACK_ID,
        new_or_add="add",
    )


def handle_reporting_edit(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = FORM.get_selected_values(body)

    selected_reports = form_data.get(MONTHLY_REPORTS_ENABLED) or []
    region_record.reporting_region_monthly_summary_enabled = "monthly_summary" in selected_reports
    # region_record.reporting_region_leaderboard_enabled = "region_leaderboard" in selected_reports
    region_record.reporting_ao_monthly_summary_enabled = "ao_monthly_summary" in selected_reports
    # region_record.reporting_ao_leaderboard_enabled = "ao_leaderboard" in selected_reports
    region_record.reporting_region_channel = form_data.get(REGION_REPORTING_CHANNEL)

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )


FORM = SdkBlockView(
    blocks=[
        blocks.HeaderBlock(text="Monthly Report Settings"),
        blocks.InputBlock(
            label="Reports Enabled",
            element=blocks.CheckboxesElement(
                action_id=MONTHLY_REPORTS_ENABLED,
                options=as_selector_options(
                    names=list(MONTHLY_REPORT_OPTIONS.values()), values=list(MONTHLY_REPORT_OPTIONS.keys())
                ),
            ),
            optional=True,
            block_id=MONTHLY_REPORTS_ENABLED,
        ),
        # blocks.ActionsBlock(
        #     elements=[
        #         blocks.ButtonElement(
        #             text="Run Monthly Reports Now", action_id=RUN_MONTHLY_REPORTS_NOW, style="primary"
        #         ),
        #     ],
        # ),
        blocks.ContextBlock(
            elements=[
                blocks.MarkdownTextObject(text="Monthly reports are automatically sent on the 2nd of each month.")
            ]
        ),
        blocks.InputBlock(
            label="Region Reporting Channel",
            element=blocks.ChannelSelectElement(
                action_id=REGION_REPORTING_CHANNEL,
                placeholder="Select a channel",
            ),
            optional=True,
            block_id=REGION_REPORTING_CHANNEL,
            hint="Must be selected for reports to be sent",
        ),
    ]
)
