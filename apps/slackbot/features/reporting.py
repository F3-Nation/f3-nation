import copy
from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.models import blocks
from slack_sdk.web import WebClient

from features.weekly_report_flags import MANAGE_WEEKLY_FLAGS
from scripts.weekly_reporting import (
    DEFAULT_WEEKLY_DAY,
    DEFAULT_WEEKLY_FREQUENCY,
    DEFAULT_WEEKLY_HOUR_CST,
    DEFAULT_WEEKLY_INTRO_TEMPLATE,
    DEFAULT_WEEKLY_SECTIONS,
    DEFAULT_WEEKLY_SUMMARY_METRICS,
    FLAGS_SECTION_HEADER,
    FNGS_SECTION_HEADER,
    TOP_AO_POSTS_SECTION_HEADER,
    TOP_POSTERS_SECTION_HEADER,
    TOP_QS_SECTION_HEADER,
    WEEKLY_REPORT_FREQUENCY_OPTIONS,
    WEEKLY_REPORT_SECTION_OPTIONS,
    WEEKLY_SECTION_SUMMARY,
    WEEKLY_SUMMARY_METRIC_OPTIONS,
)
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_convert, safe_get
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

MONTHLY_REPORTS_ENABLED = "monthly_reports_enabled"
REGION_REPORTING_CHANNEL = "region_reporting_channel"
REPORTING_CALLBACK_ID = "reporting_settings"
MONTHLY_REPORT_OPTIONS = {
    "monthly_summary": "Region Monthly Summary",
    "ao_monthly_summary": "AO Monthly Summary",
}
RUN_MONTHLY_REPORTS_NOW = "run_monthly_reports_now"

WEEKLY_REPORT_ENABLED = "weekly_report_enabled"
WEEKLY_REPORT_FREQUENCY = "weekly_report_frequency"
WEEKLY_REPORT_SECTIONS = "weekly_report_sections"
WEEKLY_REPORT_SUMMARY_ENABLED = "weekly_report_summary_enabled"
WEEKLY_REPORT_SUMMARY_METRICS = "weekly_report_summary_metrics"
WEEKLY_REPORT_DAY = "weekly_report_day"
WEEKLY_REPORT_HOUR = "weekly_report_hour"
WEEKLY_REPORT_DESTINATION = "weekly_report_destination"
WEEKLY_REPORT_TEMPLATE = "weekly_report_template"
WEEKLY_REPORT_FNGS_HEADER = "weekly_report_fngs_header"
WEEKLY_REPORT_TOP_AO_POSTS_HEADER = "weekly_report_top_ao_posts_header"
WEEKLY_REPORT_TOP_POSTERS_HEADER = "weekly_report_top_posters_header"
WEEKLY_REPORT_TOP_QS_HEADER = "weekly_report_top_qs_header"
WEEKLY_REPORT_FLAGS_HEADER = "weekly_report_flags_header"
RUN_WEEKLY_REPORT_NOW = "run_weekly_report_now"

# "Summary numbers" is shown as its own Yes/No toggle (not a checkbox in
# WEEKLY_REPORT_SECTIONS) so it sits directly above the per-metric breakdown it controls.
NON_SUMMARY_SECTION_OPTIONS = {
    key: label for key, label in WEEKLY_REPORT_SECTION_OPTIONS.items() if key != WEEKLY_SECTION_SUMMARY
}

WEEKDAY_NAMES = ["Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday", "Sunday"]


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
    if region_record.reporting_ao_monthly_summary_enabled:
        monthly_options.append("ao_monthly_summary")

    weekly_sections = (
        region_record.weekly_report_sections
        if region_record.weekly_report_sections is not None
        else DEFAULT_WEEKLY_SECTIONS
    )
    weekly_summary_metrics = (
        region_record.weekly_report_summary_metrics
        if region_record.weekly_report_summary_metrics is not None
        else DEFAULT_WEEKLY_SUMMARY_METRICS
    )
    weekly_day = region_record.weekly_report_day if region_record.weekly_report_day is not None else DEFAULT_WEEKLY_DAY
    weekly_hour = (
        region_record.weekly_report_hour_cst
        if region_record.weekly_report_hour_cst is not None
        else DEFAULT_WEEKLY_HOUR_CST
    )

    form.set_initial_values(
        {
            MONTHLY_REPORTS_ENABLED: monthly_options,
            REGION_REPORTING_CHANNEL: region_record.reporting_region_channel,
            WEEKLY_REPORT_ENABLED: "yes" if region_record.weekly_report_enabled else "no",
            WEEKLY_REPORT_FREQUENCY: region_record.weekly_report_frequency or DEFAULT_WEEKLY_FREQUENCY,
            WEEKLY_REPORT_SECTIONS: weekly_sections,
            WEEKLY_REPORT_SUMMARY_ENABLED: "yes" if WEEKLY_SECTION_SUMMARY in weekly_sections else "no",
            WEEKLY_REPORT_SUMMARY_METRICS: weekly_summary_metrics,
            WEEKLY_REPORT_DAY: str(weekly_day),
            WEEKLY_REPORT_HOUR: str(weekly_hour),
            WEEKLY_REPORT_DESTINATION: region_record.weekly_report_destination
            or region_record.reporting_region_channel,
            WEEKLY_REPORT_TEMPLATE: region_record.weekly_report_intro_template or DEFAULT_WEEKLY_INTRO_TEMPLATE,
            WEEKLY_REPORT_FNGS_HEADER: region_record.weekly_report_fngs_header or FNGS_SECTION_HEADER,
            WEEKLY_REPORT_TOP_AO_POSTS_HEADER: region_record.weekly_report_top_ao_posts_header
            or TOP_AO_POSTS_SECTION_HEADER,
            WEEKLY_REPORT_TOP_POSTERS_HEADER: region_record.weekly_report_top_posters_header
            or TOP_POSTERS_SECTION_HEADER,
            WEEKLY_REPORT_TOP_QS_HEADER: region_record.weekly_report_top_qs_header or TOP_QS_SECTION_HEADER,
            WEEKLY_REPORT_FLAGS_HEADER: region_record.weekly_report_flags_header or FLAGS_SECTION_HEADER,
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
    region_record.reporting_ao_monthly_summary_enabled = "ao_monthly_summary" in selected_reports
    region_record.reporting_region_channel = form_data.get(REGION_REPORTING_CHANNEL)

    region_record.weekly_report_enabled = form_data.get(WEEKLY_REPORT_ENABLED) == "yes"
    region_record.weekly_report_frequency = form_data.get(WEEKLY_REPORT_FREQUENCY) or DEFAULT_WEEKLY_FREQUENCY
    selected_sections = form_data.get(WEEKLY_REPORT_SECTIONS) or []
    if form_data.get(WEEKLY_REPORT_SUMMARY_ENABLED) == "yes":
        selected_sections = [WEEKLY_SECTION_SUMMARY] + selected_sections
    region_record.weekly_report_sections = selected_sections
    region_record.weekly_report_summary_metrics = form_data.get(WEEKLY_REPORT_SUMMARY_METRICS) or []
    region_record.weekly_report_day = safe_convert(form_data.get(WEEKLY_REPORT_DAY), int, default=DEFAULT_WEEKLY_DAY)
    region_record.weekly_report_hour_cst = safe_convert(
        form_data.get(WEEKLY_REPORT_HOUR), int, default=DEFAULT_WEEKLY_HOUR_CST
    )
    region_record.weekly_report_destination = form_data.get(WEEKLY_REPORT_DESTINATION)
    region_record.weekly_report_intro_template = form_data.get(WEEKLY_REPORT_TEMPLATE)
    region_record.weekly_report_fngs_header = form_data.get(WEEKLY_REPORT_FNGS_HEADER)
    region_record.weekly_report_top_ao_posts_header = form_data.get(WEEKLY_REPORT_TOP_AO_POSTS_HEADER)
    region_record.weekly_report_top_posters_header = form_data.get(WEEKLY_REPORT_TOP_POSTERS_HEADER)
    region_record.weekly_report_top_qs_header = form_data.get(WEEKLY_REPORT_TOP_QS_HEADER)
    region_record.weekly_report_flags_header = form_data.get(WEEKLY_REPORT_FLAGS_HEADER)

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
        blocks.DividerBlock(),
        blocks.HeaderBlock(text="Weekly Report Settings"),
        blocks.InputBlock(
            label="Send Weekly Report",
            element=blocks.RadioButtonsElement(
                action_id=WEEKLY_REPORT_ENABLED,
                options=as_selector_options(names=["Yes", "No"], values=["yes", "no"]),
            ),
            optional=False,
            block_id=WEEKLY_REPORT_ENABLED,
        ),
        blocks.InputBlock(
            label="Include Summary Numbers",
            element=blocks.RadioButtonsElement(
                action_id=WEEKLY_REPORT_SUMMARY_ENABLED,
                options=as_selector_options(names=["Yes", "No"], values=["yes", "no"]),
            ),
            optional=False,
            block_id=WEEKLY_REPORT_SUMMARY_ENABLED,
        ),
        blocks.InputBlock(
            label="Summary Numbers",
            element=blocks.CheckboxesElement(
                action_id=WEEKLY_REPORT_SUMMARY_METRICS,
                options=as_selector_options(
                    names=list(WEEKLY_SUMMARY_METRIC_OPTIONS.values()),
                    values=list(WEEKLY_SUMMARY_METRIC_OPTIONS.keys()),
                ),
            ),
            optional=True,
            block_id=WEEKLY_REPORT_SUMMARY_METRICS,
            hint="Only applies if 'Include Summary Numbers' above is set to Yes. Choose which "
            "individual numbers appear.",
        ),
        blocks.InputBlock(
            label="Other Weekly Report Sections",
            element=blocks.CheckboxesElement(
                action_id=WEEKLY_REPORT_SECTIONS,
                options=as_selector_options(
                    names=list(NON_SUMMARY_SECTION_OPTIONS.values()),
                    values=list(NON_SUMMARY_SECTION_OPTIONS.keys()),
                ),
            ),
            optional=True,
            block_id=WEEKLY_REPORT_SECTIONS,
            hint="Only the checked sections will be included in the weekly report.",
        ),
        blocks.ActionsBlock(
            elements=[
                blocks.ButtonElement(
                    text="Manage Trophies",
                    action_id=MANAGE_WEEKLY_FLAGS,
                    value="manage",
                )
            ]
        ),
        blocks.ContextBlock(
            elements=[
                blocks.MarkdownTextObject(
                    text="Add, edit, or remove named trophies (Ghost Flag, Pirate Flag, HIM Belt, ...). "
                    "Only shown in the report if 'Trophies' is checked above."
                )
            ]
        ),
        blocks.InputBlock(
            label="Frequency",
            element=blocks.RadioButtonsElement(
                action_id=WEEKLY_REPORT_FREQUENCY,
                options=as_selector_options(
                    names=list(WEEKLY_REPORT_FREQUENCY_OPTIONS.values()),
                    values=list(WEEKLY_REPORT_FREQUENCY_OPTIONS.keys()),
                ),
            ),
            optional=False,
            block_id=WEEKLY_REPORT_FREQUENCY,
            hint="'Every Other Week' sends on the same calendar weeks region-wide and covers the "
            "full 14 days since the last report.",
        ),
        blocks.InputBlock(
            label="Send Day",
            element=blocks.StaticSelectElement(
                action_id=WEEKLY_REPORT_DAY,
                options=as_selector_options(names=WEEKDAY_NAMES, values=[str(i) for i in range(7)]),
            ),
            optional=False,
            block_id=WEEKLY_REPORT_DAY,
        ),
        blocks.InputBlock(
            label="Send Time (CST)",
            element=blocks.StaticSelectElement(
                action_id=WEEKLY_REPORT_HOUR,
                options=as_selector_options(names=[f"{h}:00" for h in range(24)], values=[str(h) for h in range(24)]),
            ),
            optional=False,
            block_id=WEEKLY_REPORT_HOUR,
        ),
        blocks.InputBlock(
            label="Send To",
            element=blocks.ConversationSelectElement(
                action_id=WEEKLY_REPORT_DESTINATION,
                placeholder="Select a channel or user",
            ),
            optional=True,
            block_id=WEEKLY_REPORT_DESTINATION,
            hint="Select a channel to post in, or a user to send as a direct message. "
            "Falls back to the Region Reporting Channel if not set.",
        ),
        blocks.InputBlock(
            label="Summary Header Text",
            element=blocks.PlainTextInputElement(
                action_id=WEEKLY_REPORT_TEMPLATE,
                multiline=True,
                placeholder="Intro text shown above the summary numbers",
            ),
            optional=True,
            block_id=WEEKLY_REPORT_TEMPLATE,
        ),
        blocks.ContextBlock(
            elements=[
                blocks.MarkdownTextObject(
                    text="Shown above whichever 'Summary Numbers' you checked, each on its own line. "
                    "Advanced: supports placeholders — `{total_events}`, `{ao_count}`, `{unique_qs}`, "
                    "`{fng_count}`, `{avg_pax}`, `{avg_pax_record}`, `{unique_pax}`, `{unique_pax_record}` — "
                    "if you want to reference a number in your own wording instead."
                )
            ]
        ),
        blocks.InputBlock(
            label="New Guys Header Text",
            element=blocks.PlainTextInputElement(action_id=WEEKLY_REPORT_FNGS_HEADER),
            optional=True,
            block_id=WEEKLY_REPORT_FNGS_HEADER,
        ),
        blocks.InputBlock(
            label="Top AO Posts Header Text",
            element=blocks.PlainTextInputElement(action_id=WEEKLY_REPORT_TOP_AO_POSTS_HEADER),
            optional=True,
            block_id=WEEKLY_REPORT_TOP_AO_POSTS_HEADER,
        ),
        blocks.InputBlock(
            label="Top Posters Header Text",
            element=blocks.PlainTextInputElement(action_id=WEEKLY_REPORT_TOP_POSTERS_HEADER),
            optional=True,
            block_id=WEEKLY_REPORT_TOP_POSTERS_HEADER,
        ),
        blocks.InputBlock(
            label="Top Qs Header Text",
            element=blocks.PlainTextInputElement(action_id=WEEKLY_REPORT_TOP_QS_HEADER),
            optional=True,
            block_id=WEEKLY_REPORT_TOP_QS_HEADER,
        ),
        blocks.InputBlock(
            label="Trophies Header Text",
            element=blocks.PlainTextInputElement(action_id=WEEKLY_REPORT_FLAGS_HEADER),
            optional=True,
            block_id=WEEKLY_REPORT_FLAGS_HEADER,
        ),
        blocks.ContextBlock(
            elements=[
                blocks.MarkdownTextObject(
                    text="Each header above is shown above its section's list (only if that section is "
                    "checked and has data). Use `*bold*` for bold text. Stick to standard Slack emoji "
                    "(e.g. `:fire:`) rather than region-specific custom emoji, since not every "
                    "workspace has the same custom emoji uploaded. The report covers the 7 (or 14, "
                    "for biweekly) full days ending the day before it is sent."
                )
            ]
        ),
        blocks.ActionsBlock(
            elements=[
                blocks.ButtonElement(
                    text="Send Weekly Report Now",
                    action_id=RUN_WEEKLY_REPORT_NOW,
                    value="run",
                )
            ]
        ),
        blocks.ContextBlock(
            elements=[
                blocks.MarkdownTextObject(
                    text="'Send Weekly Report Now' uses the last *saved* settings — submit the form first "
                    "if you have made changes."
                )
            ]
        ),
    ]
)
