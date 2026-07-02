import copy
from datetime import datetime
from logging import Logger

from f3_data_models.models import Org, SlackUser, User
from f3_data_models.utils import DbManager
from slack_sdk import WebClient

from utilities.builders import add_loading_form
from utilities.database.orm import SlackSettings
from utilities.helper_functions import get_user, safe_get
from utilities.sendmail import send_via_sendgrid
from utilities.slack import actions
from utilities.slack.orm import (
    BlockView,
    ContextBlock,
    ContextElement,
    DividerBlock,
    ExternalSelectElement,
    HeaderBlock,
    InputBlock,
    SectionBlock,
    UsersSelectElement,
)

# Action IDs
EMERGENCY_SEARCH_FORM_ID = "emergency_search_form_id"
EMERGENCY_LOCAL_USER_SELECT = "emergency_local_user_select"
EMERGENCY_DR_USER_SELECT = "emergency_dr_user_select"
EMERGENCY_INFO_CALLBACK_ID = "emergency_info_callback_id"

# Meta key for DR sharing (used in user.meta)
USER_EMERGENCY_INFO_DR_SHARING = "user_emergency_info_dr_sharing"


def build_emergency_search_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Build the emergency info search modal with local and external user selectors."""
    form = copy.deepcopy(EMERGENCY_SEARCH_FORM)

    if safe_get(body, actions.LOADING_ID):
        form.update_modal(
            client=client,
            view_id=safe_get(body, actions.LOADING_ID),
            title_text="Emergency Info",
            callback_id=EMERGENCY_SEARCH_FORM_ID,
            submit_button_text="None",
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Emergency Info",
            callback_id=EMERGENCY_SEARCH_FORM_ID,
            new_or_add="add",
            submit_button_text="None",
        )


def handle_local_user_select(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Handle selection of a local Slack user to view their emergency info."""
    selected_user_id = safe_get(body, "actions", 0, "selected_user")
    if not selected_user_id:
        return

    # Get the SlackUser and associated User record
    slack_user: SlackUser = get_user(selected_user_id, region_record, client, logger)
    if not slack_user or not slack_user.user_id:
        _show_error_modal(client, body, "User not found in the system.")
        return

    user = DbManager.get(User, slack_user.user_id)
    if not user:
        _show_error_modal(client, body, "User record not found.")
        return

    _show_emergency_info_modal(client, body, user, is_local=True, region_record=region_record, logger=logger)


def handle_dr_user_select(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Handle selection of an external (downrange) user to view their emergency info."""
    selected_value = safe_get(body, "actions", 0, "selected_option", "value")
    if not selected_value:
        return

    try:
        user_id = int(selected_value)
    except (ValueError, TypeError):
        _show_error_modal(client, body, "Invalid user selection.")
        return

    user = DbManager.get(User, user_id)
    if not user:
        _show_error_modal(client, body, "User not found.")
        return

    # Check if user has opted into DR sharing
    dr_sharing_enabled = safe_get(user.meta, USER_EMERGENCY_INFO_DR_SHARING)
    if not dr_sharing_enabled:
        _show_error_modal(
            client,
            body,
            "This user has not enabled downrange emergency info sharing. "
            "Their emergency information cannot be accessed from outside their Slack workspace.",
        )
        return

    _show_emergency_info_modal(client, body, user, is_local=False, region_record=region_record, logger=logger)


def _show_emergency_info_modal(
    client: WebClient,
    body: dict,
    user: User,
    is_local: bool,
    region_record: SlackSettings,
    logger: Logger,
):
    update_view_id = add_loading_form(body, client, new_or_add="add")

    """Display the emergency information for a user."""
    # Send notification to the user whose info was accessed
    accessing_user = get_user(safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger)
    accessing_region_name = (
        safe_get(DbManager.get(Org, region_record.org_id), "name") if region_record.org_id else None
    ) or "Unknown Region"

    if accessing_user:
        accessing_user_name = accessing_user.user_name or "Unknown"
    else:
        accessing_user_name = safe_get(body, "user", "name") or safe_get(body, "user", "username") or "Unknown"

    _notify_user_of_access(user, accessing_user_name, is_local, accessing_region_name)

    blocks = [
        HeaderBlock(label=f"Emergency Info for {user.f3_name or 'Unknown'}").as_form_field(),
        DividerBlock().as_form_field(),
    ]

    # Emergency contact information
    if user.emergency_contact:
        blocks.append(
            SectionBlock(
                label=f"*Emergency Contact:* {user.emergency_contact}",
            ).as_form_field()
        )
    else:
        blocks.append(
            SectionBlock(
                label="*Emergency Contact:* _Not provided_",
            ).as_form_field()
        )

    if user.emergency_phone:
        blocks.append(
            SectionBlock(
                label=f"*Phone:* {user.emergency_phone}",
            ).as_form_field()
        )
    else:
        blocks.append(
            SectionBlock(
                label="*Phone:* _Not provided_",
            ).as_form_field()
        )

    if user.emergency_notes:
        blocks.append(
            SectionBlock(
                label=f"*Notes:* {user.emergency_notes}",
            ).as_form_field()
        )

    blocks.append(DividerBlock().as_form_field())
    blocks.append(
        ContextBlock(
            element=ContextElement(
                initial_value=":warning: The user has been emailed to let them know that their emergency information was accessed."  # noqa: E501
            )
        ).as_form_field()
    )

    client.views_update(
        view_id=update_view_id,
        view={
            "type": "modal",
            "callback_id": EMERGENCY_INFO_CALLBACK_ID,
            "title": {"type": "plain_text", "text": "Emergency Info"},
            "close": {"type": "plain_text", "text": "Close"},
            "blocks": blocks,
        },
    )


def _notify_user_of_access(user: User, accessing_user_name: str, is_local: bool, accessing_region_name: str):
    """Send email notification to user that their emergency info was accessed."""
    if not user.email:
        return

    access_type = "local Slack workspace" if is_local else f"downrange search from {accessing_region_name}"
    timestamp = datetime.now().strftime("%B %d, %Y at %I:%M %p UTC")

    html_content = f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <h2 style="color: #c41e3a;">Emergency Information Access Notification</h2>
        <p>Hello {user.f3_name or "PAX"},</p>
        <p>This is to notify you that your emergency contact information was accessed
        through the F3 Nation Slackbot.</p>
        <div style="background-color: #f5f5f5; padding: 15px; border-radius: 5px; margin: 20px 0;">
            <p><strong>Accessed by:</strong> {accessing_user_name}</p>
            <p><strong>Access method:</strong> {access_type}</p>
            <p><strong>Time:</strong> {timestamp}</p>
        </div>
        <p>If you did not expect this access or have concerns, please reach out to your local F3 leadership.</p>
        <p style="color: #666; font-size: 12px; margin-top: 30px;">
            This notification was sent because you have emergency contact information stored in the F3 Nation database.
            You can manage your emergency information settings through your Slack workspace's F3 Nation slackbot,
            using the `/f3-nation-settings` command.
        </p>
    </body>
    </html>
    """

    send_via_sendgrid(
        to_email=user.email,
        subject="F3 Nation - Your Emergency Information Was Accessed",
        html_content=html_content,
        from_email="F3 Nation Slackbot Support <support.slackbot@f3nation.com>",
    )


def _show_error_modal(client: WebClient, body: dict, message: str):
    """Display an error message in a modal."""
    client.views_push(
        trigger_id=safe_get(body, "trigger_id"),
        view={
            "type": "modal",
            "title": {"type": "plain_text", "text": "Error"},
            "close": {"type": "plain_text", "text": "Close"},
            "blocks": [
                {
                    "type": "section",
                    "text": {"type": "mrkdwn", "text": f":x: {message}"},
                }
            ],
        },
    )


EMERGENCY_SEARCH_FORM = BlockView(
    blocks=[
        HeaderBlock(label="Search for Emergency Info"),
        ContextBlock(
            element=ContextElement(
                initial_value=":warning: *Important:* The user will be emailed to let them know that their emergency "
                "information was accessed. Only use this feature in genuine emergency situations."
            )
        ),
        DividerBlock(),
        SectionBlock(label="*Option 1: Local Slack User*"),
        ContextBlock(element=ContextElement(initial_value="Search for a user in this Slack workspace.")),
        InputBlock(
            label="Select Local User",
            action=EMERGENCY_LOCAL_USER_SELECT,
            element=UsersSelectElement(placeholder="Select a user from this workspace"),
            optional=True,
            dispatch_action=True,
        ),
        DividerBlock(),
        SectionBlock(label="*Option 2: Downrange User Search*"),
        ContextBlock(
            element=ContextElement(
                initial_value="Search for users from other regions who have opted into downrange sharing. "
                "Start typing a user's F3 name to search."
            )
        ),
        InputBlock(
            label="Search External User",
            action=EMERGENCY_DR_USER_SELECT,
            element=ExternalSelectElement(
                placeholder="Type to search for a user by F3 name",
                min_query_length=2,
            ),
            optional=True,
            dispatch_action=True,
        ),
    ]
)
