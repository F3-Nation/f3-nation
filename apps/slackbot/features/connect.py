import os
import ssl
from logging import Logger

from f3_data_models.models import Org, Org_x_SlackSpace, Role, Role_x_User_x_Org, SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.models.blocks import (
    ActionsBlock,
    HeaderBlock,
    InputBlock,
    RichTextBlock,
    RichTextListElement,
    RichTextSectionElement,
    SectionBlock,
)
from slack_sdk.models.blocks.block_elements import (
    ButtonElement,
    DatePickerElement,
    ExternalDataSelectElement,
    PlainTextInputElement,
)
from slack_sdk.models.views import View, ViewState
from slack_sdk.web import WebClient

# from features.calendar.series import create_events
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    get_region_record,
    get_user,
    safe_get,
    update_local_region_records,
)
from utilities.slack.actions import LOADING_ID

CONNECT_EXISTING_REGION = "connect_existing_region"
CREATE_NEW_REGION = "create_new_region"
CONNECT_EXISTING_REGION_CALLBACK_ID = "connect_existing_region"
CREATE_NEW_REGION_CALLBACK_ID = "create_new_region"
SELECT_REGION = "select_region"
NEW_REGION_NAME = "new_region_name"
STARFISH_EXISTING_REGION = "connect_region_starfish"
SEARCH_REGION = "search_region"
MIGRATION_DATE = "connect_migration_date"
APPROVE_CONNECTION = "approve_connection"
DENY_CONNECTION = "deny_connection"


def build_connect_options_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    # Create the form
    # should start with text saying "Connect your workspace to a F3 region"
    # then two buttons: "Connect to an existing region" and "Create a new region"
    form: View = View(
        type="modal",
        title="Connect your workspace",
        blocks=[
            SectionBlock(
                text="This Slack workspace is not currently connected to a F3 region. Please select an option below to request a connection.",  # noqa
            ),
            ActionsBlock(
                elements=[
                    ButtonElement(
                        text="Connect to an existing region",
                        action_id=CONNECT_EXISTING_REGION,
                    ),
                    # ButtonElement(
                    #     text="Create a new region",
                    #     action_id=CREATE_NEW_REGION,
                    # ),
                    # ButtonElement(
                    #     text="Starfish from an exisiting region",
                    #     action_id=STARFISH_EXISTING_REGION,
                    # ),
                ]
            ),
        ],
    )
    if safe_get(body, LOADING_ID):
        client.views_update(view_id=safe_get(body, LOADING_ID), view=form)
    else:
        client.views_push(trigger_id=safe_get(body, "trigger_id"), view=form)
    # client.views_push(interactivity_pointer=safe_get(body, "trigger_id"), view=form)


def handle_connect_options(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action_id = safe_get(body, "actions", 0, "action_id")
    if action_id == CONNECT_EXISTING_REGION:
        build_existing_region_form(body, client, logger, context)
    elif action_id == CREATE_NEW_REGION:
        build_new_region_form(body, client, logger, context)
    elif not action_id:
        if safe_get(body, "view", "callback_id") == CONNECT_EXISTING_REGION_CALLBACK_ID:
            handle_existing_region_selection(body, client, logger, context)
        else:
            build_connect_options_form(body, client, logger, context)
    elif action_id == SEARCH_REGION:
        build_existing_region_form(body, client, logger, context)


def build_existing_region_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form: View = View(
        type="modal",
        callback_id=CONNECT_EXISTING_REGION_CALLBACK_ID,
        title="Connect existing region",
        blocks=[
            InputBlock(
                label="Search for a region",
                block_id=SELECT_REGION,
                element=ExternalDataSelectElement(
                    action_id=SELECT_REGION,
                    placeholder="Start typing to search...",
                    min_query_length=3,
                ),
                optional=False,
            ),
            InputBlock(
                label="Start Date",
                block_id=MIGRATION_DATE,
                element=DatePickerElement(
                    action_id=MIGRATION_DATE,
                    placeholder="Select a start date",
                ),
                optional=False,
                hint="Event instances will be created for this day forward in the system.",  # noqa
            ),
            SectionBlock(
                text="If your region is not appearing in the search, it's likely because it hasn't been set up yet. Please submit a new region request at https://f3nation.com/start-region. Once your Expansion Q has reached out and approved your request, you can come back here to connect the app.",  # noqa
            ),
        ],
        submit="Request Connection",
    )

    client.views_update(view_id=safe_get(body, "view", "id"), view=form)


def build_new_region_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form: View = View(
        type="modal",
        callback_id=CREATE_NEW_REGION_CALLBACK_ID,
        title="Create a new region",
        blocks=[
            InputBlock(
                label="Region Name",
                block_id=NEW_REGION_NAME,
                element=PlainTextInputElement(
                    placeholder="Enter the region name",
                    action_id=NEW_REGION_NAME,
                ),
            ),
        ],
        submit="Request Creation",
    )
    client.views_update(view_id=safe_get(body, "view", "id"), view=form)


def handle_existing_region_selection(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    state = ViewState(**safe_get(body, "view", "state"))
    region_select = state.values.get(SELECT_REGION).get(SELECT_REGION)
    date_select = state.values.get(MIGRATION_DATE).get(MIGRATION_DATE)
    user_info = client.users_info(user=safe_get(body, "user", "id"))
    user_name = safe_get(user_info, "user", "profile", "display_name") or safe_get(user_info, "user", "name")
    team_id = safe_get(body, "team", "id")
    region_record = region_record or get_region_record(team_id, body, context, client, logger)
    blocks = [
        HeaderBlock(text="Region Connection Request"),
        RichTextBlock(
            elements=[
                RichTextListElement(
                    style="bullet",
                    indent=0,
                    elements=[
                        RichTextSectionElement(
                            elements=[
                                {
                                    "type": "text",
                                    "text": f"Region: {region_select.selected_option.get('text').get('text')}",
                                }
                            ]
                        ),
                        RichTextSectionElement(
                            elements=[
                                {
                                    "type": "text",
                                    "text": f"Workspace Domain: {safe_get(body, 'team', 'domain')}",
                                }
                            ]
                        ),
                        RichTextSectionElement(
                            elements=[
                                {
                                    "type": "text",
                                    "text": f"Requestor: {user_name}",
                                }
                            ]
                        ),
                        RichTextSectionElement(
                            elements=[
                                {
                                    "type": "text",
                                    "text": f"PAXMiner Region: {region_record.paxminer_schema or 'No PAXMiner connection'}",  # noqa
                                }
                            ]
                        ),
                        RichTextSectionElement(
                            elements=[
                                {
                                    "type": "text",
                                    "text": f"Selected Migration Date: {date_select.selected_date}",
                                }
                            ]
                        ),
                    ],
                ),
            ]
        ),
        ActionsBlock(
            elements=[
                ButtonElement(
                    text="Approve",
                    action_id=APPROVE_CONNECTION,
                    value=region_select.selected_option.get("value"),
                    style="primary",
                ),
                ButtonElement(
                    text="Deny",
                    action_id=DENY_CONNECTION,
                    value=region_select.selected_option.get("value"),
                    style="danger",
                ),
            ]
        ),
    ]
    metadata = {
        "event_type": "region_connection_request",
        "event_payload": {
            "user_id": safe_get(body, "user", "id"),
            "requestor_bot_token": region_record.bot_token,
            "region_id": region_select.selected_option.get("value"),
            "region_name": region_select.selected_option.get("text").get("text"),
            "migration_date": date_select.selected_date,
            "team_id": team_id,
        },
    }  # noqa
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    if os.environ.get("ADMIN_BOT_TOKEN") and os.environ.get("ADMIN_CHANNEL_ID"):
        try:
            send_client = WebClient(token=os.environ.get("ADMIN_BOT_TOKEN"), ssl=ssl_context)
            send_client.chat_postMessage(
                channel=os.environ.get("ADMIN_CHANNEL_ID"),
                text="Region Connection Request",
                blocks=blocks,
                metadata=metadata,
            )
        except Exception as e:
            logger.error(f"Error sending region connection request: {e}")


def handle_new_region_creation(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    state = ViewState(**safe_get(body, "view", "state"))
    region_name = state.values.get(NEW_REGION_NAME).get(NEW_REGION_NAME)
    print(f"Creating new region with name {region_name.value}")


def handle_approve_connection(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    metadata = safe_get(body, "message", "metadata") or {}
    metadata = metadata.get("event_payload") or {}
    team_id = metadata.get("team_id")
    org_record = DbManager.get(Org, metadata.get("region_id"))

    # Connect the slack space to the new org
    if team_id:
        slack_space_record = DbManager.find_first_record(SlackSpace, [SlackSpace.team_id == team_id])
        region_record = get_region_record(team_id, body, context, client, logger)
        if slack_space_record:
            connect_record = Org_x_SlackSpace(
                org_id=org_record.id,
                slack_space_id=slack_space_record.id,
            )
            DbManager.create_record(connect_record)
        # Update the slack space record with the new org
        region_record.org_id = org_record.id
        region_record.migration_date = metadata.get("migration_date")
        DbManager.update_records(
            cls=SlackSpace,
            filters=[SlackSpace.team_id == region_record.team_id],
            fields={SlackSpace.settings: region_record.__dict__},
        )
    # Make the current user an admin of the new org
    slack_user_id = metadata.get("user_id")
    user_id = get_user(slack_user_id, region_record, client, logger).user_id
    admin_role_id = DbManager.find_first_record(Role, filters=[Role.name == "admin"]).id
    try:
        DbManager.create_record(
            Role_x_User_x_Org(
                user_id=user_id,
                org_id=org_record.id,
                role_id=admin_role_id,
            )
        )
    except Exception:
        logger.info("Requestor is already an admin of this org, skipping creation of admin role.")
    # Create events from the migration date forward
    # event_records = DbManager.find_records(
    #     Event,
    #     filters=[
    #         Event.is_active,
    #         or_(Event.org_id == region_record.org_id, Event.org.has(Org.parent_id == region_record.org_id)),
    #         or_(Event.end_date >= current_date_cst(), Event.end_date.is_(None)),
    #     ],
    #     joinedloads="all",
    # )
    # start_date = (
    #     safe_convert(metadata.get("migration_date"), datetime.strptime, args=["%Y-%m-%d"]) or datetime.now()
    # ).date()
    # create_events(event_records, clear_first=True, start_date=start_date)

    blocks = [
        HeaderBlock(text="Region Connection Request Approved"),
        SectionBlock(
            text=f"Your region connection request was approved by the F3 Nation Admins! Your slack space is now connected to {metadata.get('region_name')}. Events have been created starting on {metadata.get('migration_date')}, and your PAX can start signing up to Q through the `/f3-calendar` command."  # noqa
        ),
    ]
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    if metadata.get("user_id") and metadata.get("requestor_bot_token"):
        try:
            send_client = WebClient(token=metadata.get("requestor_bot_token"), ssl=ssl_context)
            send_client.chat_postMessage(
                channel=metadata.get("user_id"),
                text="Region Connection Request Approved",
                blocks=blocks,
            )
        except Exception as e:
            logger.error(f"Error sending region connection approval: {e}")

    # Update the original admin message to remove action buttons and indicate completion
    try:
        channel_id = (
            safe_get(body, "container", "channel_id")
            or safe_get(body, "channel", "id")
            or safe_get(body, "channel", "channel_id")
        )
        message_ts = safe_get(body, "container", "message_ts") or safe_get(body, "message", "ts")

        if channel_id and message_ts and os.environ.get("ADMIN_BOT_TOKEN"):
            admin_blocks = [
                HeaderBlock(text="Region Connection Request - Approved"),
                SectionBlock(
                    text=(
                        f"Approved by <@{safe_get(body, 'user', 'id')}>. "
                        f"This request is complete. Region: {metadata.get('region_name')} | "
                        f"Migration Date: {metadata.get('migration_date')}"
                    )
                ),
            ]
            admin_client = WebClient(token=os.environ.get("ADMIN_BOT_TOKEN"), ssl=ssl_context)
            admin_client.chat_update(
                channel=channel_id,
                ts=message_ts,
                text="Region Connection Request - Approved",
                blocks=admin_blocks,
            )
    except Exception as e:
        logger.error(f"Error updating original admin message: {e}")

    update_local_region_records()


def handle_deny_connection(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    metadata = safe_get(body, "message", "metadata") or {}
    metadata = metadata.get("event_payload") or {}
    blocks = [
        HeaderBlock(text="Region Connection Request Denied"),
        SectionBlock(
            text="Your region connection request was denied by the F3 Nation Admins. Please reach out to it@f3nation.com for more information."  # noqa
        ),
    ]
    ssl_context = ssl.create_default_context()
    ssl_context.check_hostname = False
    ssl_context.verify_mode = ssl.CERT_NONE
    if metadata.get("user_id") and metadata.get("requestor_bot_token"):
        try:
            send_client = WebClient(token=metadata.get("requestor_bot_token"), ssl=ssl_context)
            send_client.chat_postMessage(
                channel=metadata.get("user_id"),
                text="Region Connection Request Denied",
                blocks=blocks,
            )
        except Exception as e:
            logger.error(f"Error sending region connection denial: {e}")
