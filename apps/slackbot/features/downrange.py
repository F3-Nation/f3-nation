import copy
import json
import ssl
from logging import Logger

from f3_data_models.models import Org, Org_x_SlackSpace, SlackSpace, User
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from utilities.constants import ALL_USERS_ARE_ADMINS
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import get_admin_users
from utilities.helper_functions import (
    REGION_RECORDS,
    get_user,
    safe_convert,
    safe_get,
    update_local_region_records,
)
from utilities.slack import actions
from utilities.slack.orm import (
    ActionsBlock,
    BlockView,
    ButtonElement,
    ChannelsSelectElement,
    ContextBlock,
    ContextElement,
    DividerBlock,
    ExternalSelectElement,
    HeaderBlock,
    InputBlock,
    PlainTextInputElement,
    RadioButtonsElement,
    SectionBlock,
    as_selector_options,
)

# ──────────────────────────────────────────────────────────────────────────────
# Private helpers
# ──────────────────────────────────────────────────────────────────────────────


def _is_admin(body: dict, region_record: SlackSettings, client: WebClient, logger: Logger) -> bool:
    if ALL_USERS_ARE_ADMINS:
        return True
    if not region_record.org_id:
        return False
    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    slack_user = get_user(user_id, region_record, client, logger)
    admin_users = get_admin_users(region_record.org_id, region_record.team_id)
    return any(
        u[0].id == slack_user.user_id for u in admin_users if u[1] and u[1].slack_id and u[1].slack_id != "USLACKBOT"
    )


def _get_target_region_info(org_id: int, logger: Logger) -> tuple:
    """Return (team_id, bot_token, SlackSettings) for a region org, or (None, None, None) if not on Slack."""
    ox = DbManager.find_first_record(Org_x_SlackSpace, [Org_x_SlackSpace.org_id == org_id])
    if not ox:
        return None, None, None
    slack_space = DbManager.get(SlackSpace, ox.slack_space_id)
    if not slack_space:
        return None, None, None
    team_id = slack_space.team_id
    bot_token = slack_space.bot_token
    settings = REGION_RECORDS.get(team_id)
    if not settings and slack_space.settings:
        try:
            settings = SlackSettings(**slack_space.settings)
        except Exception as e:
            logger.warning(f"Could not load SlackSettings for team {team_id}: {e}")
    return team_id, bot_token, settings


def _build_form_base(selected_org_id: int = None, selected_org_name: str = None) -> BlockView:
    """Build a fresh BlockView containing just the region search input."""
    return BlockView(
        blocks=[
            SectionBlock(label="*Search for a region*"),
            ActionsBlock(
                elements=[
                    ExternalSelectElement(
                        placeholder="Type to search for a region...",
                        action=actions.DOWNRANGE_REGION_SELECT,
                        min_query_length=2,
                        initial_value=(
                            {"text": selected_org_name, "value": str(selected_org_id)}
                            if selected_org_id and selected_org_name
                            else None
                        ),
                    ),
                ]
            ),
            DividerBlock(),
            ActionsBlock(
                elements=[
                    ButtonElement(
                        label=":world_map: Nearby Special Events",
                        action=actions.NEARBY_EVENTS_OPEN,
                    ),
                ]
            ),
        ]
    )


def _build_contact_info_blocks(org) -> list:
    """Return display blocks showing available contact info for an Org. Returns [] if none set."""
    if not org:
        return []
    lines = []
    if org.website:
        lines.append(f"\u2022 *Website:* <{org.website}|{org.website}>")
    if org.email:
        lines.append(f"\u2022 *Email:* {org.email}")
    if org.twitter:
        lines.append(f"\u2022 *Twitter:* {org.twitter}")
    if org.facebook:
        lines.append(f"\u2022 *Facebook:* {org.facebook}")
    if org.instagram:
        lines.append(f"\u2022 *Instagram:* {org.instagram}")
    if not lines:
        return []
    return [SectionBlock(label=":phone: *Contact Information*\n" + "\n".join(lines))]


def _build_region_info_blocks(
    has_slack: bool,
    target_settings,
    target_team_id: str,
    target_bot_token: str,
    target_org_id: int,
    selected_org_name: str,
    requester_bot_token: str,
    requester_user_id: str,
    requester_name: str,
    requester_region_name: str,
    requester_email: str = "",
    org=None,
) -> list:
    """Return the dynamic info blocks shown after a region is selected."""
    blocks = [DividerBlock()]

    if not has_slack:
        blocks.append(SectionBlock(label=f"*{selected_org_name}* is not known to be on Slack."))
        blocks.extend(_build_contact_info_blocks(org))
        return blocks

    payload = json.dumps(
        {
            "target_team_id": target_team_id,
            "target_bot_token": target_bot_token,
            "target_org_id": target_org_id,
            "target_org_name": selected_org_name,
            "requester_bot_token": requester_bot_token,
            "requester_user_id": requester_user_id,
            "requester_name": requester_name,
            "requester_region_name": requester_region_name,
            "requester_email": requester_email,
        }
    )

    if (
        target_settings
        and target_settings.downrange_invite_sharing == "proactive"
        and target_settings.downrange_invite_link
    ):
        blocks.append(
            SectionBlock(label=f":white_check_mark: *{selected_org_name}* is on Slack! Here is their invite link:")
        )
        blocks.append(SectionBlock(label=target_settings.downrange_invite_link))
        blocks.append(
            ContextBlock(
                element=ContextElement(
                    initial_value="If this link doesn't work, you can still request an invite from the region admins below."  # noqa: E501
                )
            )
        )
        blocks.append(
            ActionsBlock(
                elements=[
                    ButtonElement(
                        label=":envelope: Request Invite Instead",
                        action=actions.DOWNRANGE_INVITE_REQUEST_BUTTON,
                        value=payload,
                    ),
                ]
            )
        )
    elif target_settings and target_settings.downrange_invite_sharing == "direct_email":
        blocks.append(
            SectionBlock(
                label=f":email: *{selected_org_name}* is on Slack! They accept invite requests via direct email."
            )
        )
        blocks.append(
            ContextBlock(
                element=ContextElement(
                    initial_value=(
                        f"Your email address ({requester_email or 'on file with Slack'}) will be shared "
                        "with their admins so they can send you a direct Slack invite."
                    )
                )
            )
        )
        blocks.append(
            InputBlock(
                label="Introduction",
                action=actions.DOWNRANGE_INTRO_TEXT,
                element=PlainTextInputElement(
                    placeholder="Your F3 name, home region, why you want to join...",
                    multiline=True,
                ),
                optional=True,
            )
        )
        blocks.append(
            ActionsBlock(
                elements=[
                    ButtonElement(
                        label=":envelope: Send Request for Invite",
                        action=actions.DOWNRANGE_INVITE_REQUEST_BUTTON,
                        value=payload,
                    ),
                ]
            )
        )
    else:
        blocks.append(
            SectionBlock(
                label=f":airplane: *{selected_org_name}* is on Slack! You can request an invite from their admins."
            )
        )
        blocks.append(
            InputBlock(
                label="Introduction",
                action=actions.DOWNRANGE_INTRO_TEXT,
                element=PlainTextInputElement(
                    placeholder="Your F3 name, home region, why you want to join...",
                    multiline=True,
                ),
                optional=True,
            )
        )
        blocks.append(
            ActionsBlock(
                elements=[
                    ButtonElement(
                        label=":envelope: Send Request for Invite",
                        action=actions.DOWNRANGE_INVITE_REQUEST_BUTTON,
                        value=payload,
                    ),
                ]
            )
        )
    blocks.extend(_build_contact_info_blocks(org))
    return blocks


def _get_radio_value(state_values: dict, block_id: str):
    return safe_get(state_values, block_id, block_id, "selected_option", "value")


def _get_text_value(state_values: dict, block_id: str):
    return safe_get(state_values, block_id, block_id, "value")


def _get_channel_value(state_values: dict, block_id: str):
    return safe_get(state_values, block_id, block_id, "selected_channel")


def _ssl_context():
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


# Blocks for the admin settings section (appended below the search when user is admin)
DOWNRANGE_ADMIN_BLOCKS = [
    DividerBlock(),
    HeaderBlock(label=":lock: Admin: Downrange Settings"),
    InputBlock(
        label="Invite link sharing",
        action=actions.DOWNRANGE_INVITE_SHARING,
        element=RadioButtonsElement(
            initial_value="request_only",
            options=as_selector_options(
                names=["Share invite link proactively", "Require a request for invite", "Direct email invite"],
                values=["proactive", "request_only", "direct_email"],
            ),
        ),
        optional=False,
        hint=(
            "Proactive: any bot user can see your invite link directly. "
            "Request: users must request an invite, and you approve it. "
            "Direct email: the requester's email is shared with your admins so they can send a direct Slack invite."
        ),
    ),
    InputBlock(
        label="Slack invite link",
        action=actions.DOWNRANGE_INVITE_LINK,
        element=PlainTextInputElement(
            placeholder="https://join.slack.com/t/your-workspace/...",
        ),
        optional=True,
        hint=(
            "To get your invite link: Slack → Settings → Invitations → Invite people → Copy link. "
            "You can set the link to never expire. Even if you choose 'Require a request', you can "
            "pre-fill this so admins can approve requests with one click."
        ),
    ),
    DividerBlock(),
    InputBlock(
        label="Downrange backblast cross-posting",
        action=actions.DOWNRANGE_CHANNEL_POSTING,
        element=RadioButtonsElement(
            initial_value="off",
            options=as_selector_options(
                names=["Off", "Enabled"],
                values=["off", "enabled"],
            ),
        ),
        optional=False,
        hint=(
            "When enabled, backblasts posted in other regions that tag PAX from your region "
            "will be cross-posted to the channel below."
        ),
    ),
    InputBlock(
        label="Cross-post channel",
        action=actions.DOWNRANGE_CHANNEL,
        element=ChannelsSelectElement(placeholder="Select a channel..."),
        optional=True,
        hint="The channel in your workspace where downrange backblasts will be cross-posted.",
    ),
]


# ──────────────────────────────────────────────────────────────────────────────
# Public handlers
# ──────────────────────────────────────────────────────────────────────────────


def build_downrange_menu(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    update_view_id = safe_get(body, actions.LOADING_ID)
    is_admin_user = _is_admin(body, region_record, client, logger)

    form = _build_form_base()

    if is_admin_user:
        for block in copy.deepcopy(DOWNRANGE_ADMIN_BLOCKS):
            form.add_block(block)
        form.set_initial_values(
            {
                actions.DOWNRANGE_INVITE_SHARING: region_record.downrange_invite_sharing or "request_only",
                actions.DOWNRANGE_INVITE_LINK: region_record.downrange_invite_link or "",
                actions.DOWNRANGE_CHANNEL_POSTING: region_record.downrange_channel_posting or "off",
                actions.DOWNRANGE_CHANNEL: region_record.downrange_channel,
            }
        )
        submit_text = "Save Admin Settings"
    else:
        submit_text = "None"

    metadata = {"is_admin": is_admin_user}

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text="Downrange",
            callback_id=actions.DOWNRANGE_CALLBACK_ID,
            submit_button_text=submit_text,
            parent_metadata=metadata,
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Downrange",
            callback_id=actions.DOWNRANGE_CALLBACK_ID,
            new_or_add="add",
            submit_button_text=submit_text,
            parent_metadata=metadata,
        )


def handle_region_select(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Dispatch-action handler: user selected a region from the ExternalSelectElement."""
    selected_option = safe_get(body, "actions", 0, "selected_option")
    if not selected_option:
        return

    selected_org_id = safe_convert(selected_option.get("value"), int)
    # selected_option.text is {"type": "plain_text", "text": "Region Name", "emoji": True}
    selected_org_name = safe_get(selected_option, "text", "text") or ""
    view_id = safe_get(body, "view", "id")
    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")

    private_metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    is_admin_user = private_metadata.get("is_admin", False)

    # Look up requester info
    requester_slack_user = get_user(user_id, region_record, client, logger)
    requester_name = requester_slack_user.user_name or "Unknown"
    requester_email = requester_slack_user.email or ""
    requester_region_name = None
    if requester_slack_user.user_id:
        requester_user = DbManager.get(User, requester_slack_user.user_id, joinedloads=[User.home_region_org])
        if requester_user and requester_user.home_region_org:
            requester_region_name = requester_user.home_region_org.name
    if not requester_region_name and region_record.org_id:
        region_org = DbManager.get(Org, region_record.org_id)
        requester_region_name = region_org.name if region_org else None

    # Look up target region
    target_team_id, target_bot_token, target_settings = _get_target_region_info(selected_org_id, logger)
    org = DbManager.get(Org, selected_org_id)

    # Rebuild the form with the selection preserved
    form = _build_form_base(selected_org_id=selected_org_id, selected_org_name=selected_org_name)

    # Add dynamic info blocks
    info_blocks = _build_region_info_blocks(
        has_slack=target_team_id is not None,
        target_settings=target_settings,
        target_team_id=target_team_id,
        target_bot_token=target_bot_token,
        target_org_id=selected_org_id,
        selected_org_name=selected_org_name,
        requester_bot_token=region_record.bot_token,
        requester_user_id=user_id,
        requester_name=requester_name,
        requester_region_name=requester_region_name,
        requester_email=requester_email,
        org=org,
    )
    for block in info_blocks:
        form.add_block(block)

    # Re-add admin section, restoring current form values
    if is_admin_user:
        current_values = safe_get(body, "view", "state", "values") or {}
        for block in copy.deepcopy(DOWNRANGE_ADMIN_BLOCKS):
            form.add_block(block)
        form.set_initial_values(
            {
                actions.DOWNRANGE_INVITE_SHARING: _get_radio_value(current_values, actions.DOWNRANGE_INVITE_SHARING)
                or region_record.downrange_invite_sharing
                or "request_only",
                actions.DOWNRANGE_INVITE_LINK: _get_text_value(current_values, actions.DOWNRANGE_INVITE_LINK)
                or region_record.downrange_invite_link
                or "",
                actions.DOWNRANGE_CHANNEL_POSTING: _get_radio_value(current_values, actions.DOWNRANGE_CHANNEL_POSTING)
                or region_record.downrange_channel_posting
                or "off",
                actions.DOWNRANGE_CHANNEL: _get_channel_value(current_values, actions.DOWNRANGE_CHANNEL)
                or region_record.downrange_channel,
            }
        )
        submit_text = "Save Admin Settings"
    else:
        submit_text = "Done"

    form.update_modal(
        client=client,
        view_id=view_id,
        title_text="Downrange",
        callback_id=actions.DOWNRANGE_CALLBACK_ID,
        submit_button_text=submit_text,
        parent_metadata=private_metadata,
    )


def handle_invite_request(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """User clicked 'Send Request for Invite'. DM the target region's admins."""
    action_value = json.loads(safe_get(body, "actions", 0, "value") or "{}")
    target_team_id = action_value.get("target_team_id")
    target_bot_token = action_value.get("target_bot_token")
    target_org_id = safe_convert(action_value.get("target_org_id"), int)
    target_org_name = action_value.get("target_org_name", "the region")
    requester_bot_token = action_value.get("requester_bot_token") or region_record.bot_token
    requester_user_id = action_value.get("requester_user_id") or safe_get(body, "user", "id")
    requester_name = action_value.get("requester_name", "Unknown")
    requester_region_name = action_value.get("requester_region_name", "Unknown")
    requester_email = action_value.get("requester_email", "")

    # Get intro text from form state (may be None)
    state_values = safe_get(body, "view", "state", "values") or {}
    intro_text = _get_text_value(state_values, actions.DOWNRANGE_INTRO_TEXT) or ""

    if not target_team_id or not target_bot_token:
        logger.error("handle_invite_request: missing target_team_id or target_bot_token")
        return

    if not target_org_id:
        logger.error("handle_invite_request: missing target_org_id")
        return

    # Find the target region's admin Slack users
    admin_users = get_admin_users(target_org_id, target_team_id)
    admin_slack_ids = [
        au[1].slack_id for au in admin_users if au[1] and au[1].slack_id and au[1].slack_id != "USLACKBOT"
    ]

    if not admin_slack_ids:
        # No admin Slack users found — show error via modal update
        error_form = BlockView(
            blocks=[
                SectionBlock(
                    label=f"Sorry, we couldn't find any admin users for *{target_org_name}* to send your request to. "
                    "Try reaching out to them through other channels."
                )
            ]
        )
        error_form.update_modal(
            client=client,
            view_id=safe_get(body, "view", "id"),
            title_text="Downrange",
            callback_id=actions.DOWNRANGE_CALLBACK_ID,
            submit_button_text="None",
        )
        return

    # Get the target region's current invite-sharing setting to determine DM format
    _, _, target_settings = _get_target_region_info(target_org_id, logger)
    is_direct_email = target_settings and target_settings.downrange_invite_sharing == "direct_email"

    # Build request message for target admins
    intro_section = f"\n\n*Their intro:*\n{intro_text}" if intro_text else ""
    metadata = {
        "event_type": "downrange_invite_request",
        "event_payload": {
            "requester_bot_token": requester_bot_token,
            "requester_user_id": requester_user_id,
            "requester_name": requester_name,
            "requester_region_name": requester_region_name,
            "target_org_name": target_org_name,
        },
    }

    if is_direct_email:
        dm_text = f"Downrange email invite request from {requester_name} ({requester_region_name})"
        message_text = (
            f":email: *Downrange Email Invite Request*\n"
            f"*{requester_name}* from *{requester_region_name}* would like to join your Slack workspace."
            f"{intro_section}\n\n*Their email:* `{requester_email}`"
        )
        request_blocks = [
            SectionBlock(label=message_text).as_form_field(),
            ContextBlock(
                element=ContextElement(
                    initial_value=(
                        "To invite them, go to your Slack workspace *Settings* \u2192 *Invite People* "
                        "and enter their email address above."
                    )
                )
            ).as_form_field(),
            ActionsBlock(
                elements=[
                    ButtonElement(
                        label=":white_check_mark: Mark as Invited",
                        action=actions.DOWNRANGE_INVITE_MARK_DONE_BUTTON,
                        style="primary",
                        value="done",
                    ),
                    ButtonElement(
                        label=":x: Deny",
                        action=actions.DOWNRANGE_INVITE_DENY_BUTTON,
                        style="danger",
                        value="deny",
                    ),
                ]
            ).as_form_field(),
        ]
    else:
        dm_text = f"Downrange invite request from {requester_name} ({requester_region_name})"
        message_text = (
            f":airplane: *Downrange Invite Request*\n"
            f"*{requester_name}* from *{requester_region_name}* would like to join your Slack workspace.{intro_section}"
        )
        request_blocks = [
            SectionBlock(label=message_text).as_form_field(),
            ActionsBlock(
                elements=[
                    ButtonElement(
                        label=":white_check_mark: Approve & Send Invite",
                        action=actions.DOWNRANGE_INVITE_APPROVE_BUTTON,
                        style="primary",
                        value="approve",
                    ),
                    ButtonElement(
                        label=":x: Deny",
                        action=actions.DOWNRANGE_INVITE_DENY_BUTTON,
                        style="danger",
                        value="deny",
                    ),
                ]
            ).as_form_field(),
            ContextBlock(
                element=ContextElement(
                    initial_value=(
                        "To set or update your workspace invite link, open `/f3-nation-settings` \u2192 Downrange \u2192 Admin settings."  # noqa: E501
                    )
                )
            ).as_form_field(),
        ]

    try:
        target_client = WebClient(token=target_bot_token, ssl=_ssl_context())
        dm = target_client.conversations_open(users=",".join(admin_slack_ids))
        dm_channel = safe_get(dm, "channel", "id")
        target_client.chat_postMessage(
            channel=dm_channel,
            text=dm_text,
            blocks=request_blocks,
            metadata=metadata,
        )
    except Exception as e:
        logger.error(f"handle_invite_request: error sending DM to target admins: {e}")
        return

    # Update the requester's modal to confirm the request was sent
    confirm_form = BlockView(
        blocks=[
            SectionBlock(
                label=f":white_check_mark: Your invite request has been sent to the admins of *{target_org_name}*! "
                "They'll DM you with an invite link once approved."
            )
        ]
    )
    confirm_form.update_modal(
        client=client,
        view_id=safe_get(body, "view", "id"),
        title_text="Downrange",
        callback_id=actions.DOWNRANGE_CALLBACK_ID,
        submit_button_text="None",
    )


def handle_invite_approve(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Admin clicked 'Approve & Send Invite'. Send the invite link to the requester."""
    metadata = safe_get(body, "message", "metadata", "event_payload") or {}
    requester_bot_token = metadata.get("requester_bot_token")
    requester_user_id = metadata.get("requester_user_id")
    requester_name = metadata.get("requester_name", "the requester")
    target_org_name = metadata.get("target_org_name", "our region")

    channel_id = safe_get(body, "channel", "id")
    message_ts = safe_get(body, "message", "ts")

    invite_link = region_record.downrange_invite_link

    if not invite_link:
        # Admin needs to set the invite link first
        try:
            client.chat_postEphemeral(
                channel=channel_id,
                user=safe_get(body, "user", "id"),
                text=(
                    ":warning: You haven't set an invite link yet. "
                    "Go to `/f3-nation-settings` → Downrange, enter your invite link, then come back and approve."
                ),
            )
        except Exception as e:
            logger.error(f"handle_invite_approve: error posting ephemeral: {e}")
        return

    # Build the approval DM blocks for the requester
    approve_blocks = [
        SectionBlock(
            label=f":tada: Your invite request to join *{target_org_name}* on Slack has been approved!"
        ).as_form_field(),
        SectionBlock(label=f"*Invite link:* {invite_link}").as_form_field(),
        ActionsBlock(
            elements=[
                ButtonElement(
                    label=":question: That link didn't work",
                    action=actions.DOWNRANGE_INVITE_LINK_BROKEN_BUTTON,
                    value=json.dumps(
                        {
                            "target_bot_token": region_record.bot_token,
                            "target_team_id": region_record.team_id,
                            "target_org_id": region_record.org_id,
                            "target_org_name": target_org_name,
                            "requester_name": requester_name,
                        }
                    ),
                ),
            ]
        ).as_form_field(),
    ]

    if not requester_bot_token or not requester_user_id:
        logger.error("handle_invite_approve: missing requester_bot_token or requester_user_id in metadata")
        return

    try:
        send_client = WebClient(token=requester_bot_token, ssl=_ssl_context())
        send_client.chat_postMessage(
            channel=requester_user_id,
            text=f"Your invite request to {target_org_name} has been approved!",
            blocks=approve_blocks,
        )
    except Exception as e:
        logger.error(f"handle_invite_approve: error sending invite to requester: {e}")
        return

    # Update the admin group DM to remove the action buttons
    if channel_id and message_ts:
        try:
            client.chat_update(
                channel=channel_id,
                ts=message_ts,
                text=f"Invite request from {requester_name} — *Approved* :white_check_mark:",
                blocks=[
                    SectionBlock(
                        label=f"Invite request from *{requester_name}* — *Approved* :white_check_mark: by <@{safe_get(body, 'user', 'id')}>"  # noqa: E501
                    ).as_form_field()
                ],
            )
        except Exception as e:
            logger.error(f"handle_invite_approve: error updating admin message: {e}")


def handle_invite_deny(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Admin clicked 'Deny'. Notify the requester politely."""
    metadata = safe_get(body, "message", "metadata", "event_payload") or {}
    requester_bot_token = metadata.get("requester_bot_token")
    requester_user_id = metadata.get("requester_user_id")
    requester_name = metadata.get("requester_name", "the requester")
    target_org_name = metadata.get("target_org_name", "our region")

    channel_id = safe_get(body, "channel", "id")
    message_ts = safe_get(body, "message", "ts")

    if not requester_bot_token or not requester_user_id:
        logger.error("handle_invite_deny: missing requester_bot_token or requester_user_id in metadata")
        return

    try:
        send_client = WebClient(token=requester_bot_token, ssl=_ssl_context())
        send_client.chat_postMessage(
            channel=requester_user_id,
            text=f"Your invite request to {target_org_name} was not approved at this time.",
            blocks=[
                SectionBlock(
                    label=f"Your invite request to join *{target_org_name}* on Slack was not approved at this time. "
                    "Feel free to reach out to them directly for more information."
                ).as_form_field()
            ],
        )
    except Exception as e:
        logger.error(f"handle_invite_deny: error sending denial to requester: {e}")
        return

    # Update the admin group DM
    if channel_id and message_ts:
        try:
            client.chat_update(
                channel=channel_id,
                ts=message_ts,
                text=f"Invite request from {requester_name} — *Denied* :x:",
                blocks=[
                    SectionBlock(
                        label=f"Invite request from *{requester_name}* — *Denied* :x: by <@{safe_get(body, 'user', 'id')}>"  # noqa: E501
                    ).as_form_field()
                ],
            )
        except Exception as e:
            logger.error(f"handle_invite_deny: error updating admin message: {e}")


def handle_invite_link_broken(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Requester clicked 'That link didn't work'. Notify the target region admins."""
    action_value = json.loads(safe_get(body, "actions", 0, "value") or "{}")
    target_bot_token = action_value.get("target_bot_token")
    target_team_id = action_value.get("target_team_id")
    target_org_id = safe_convert(action_value.get("target_org_id"), int)
    target_org_name = action_value.get("target_org_name", "the region")
    requester_name = action_value.get("requester_name", "A user")

    channel_id = safe_get(body, "channel", "id")
    requester_user_id = safe_get(body, "user", "id")

    # Notify the target region admins that the link didn't work
    if target_bot_token and target_team_id and target_org_id:
        admin_users = get_admin_users(target_org_id, target_team_id)
        admin_slack_ids = [
            au[1].slack_id for au in admin_users if au[1] and au[1].slack_id and au[1].slack_id != "USLACKBOT"
        ]
        if admin_slack_ids:
            try:
                target_client = WebClient(token=target_bot_token, ssl=_ssl_context())
                dm = target_client.conversations_open(users=",".join(admin_slack_ids))
                dm_channel = safe_get(dm, "channel", "id")
                target_client.chat_postMessage(
                    channel=dm_channel,
                    text=f":warning: {requester_name} reported that the invite link for {target_org_name} didn't work.",
                    blocks=[
                        SectionBlock(
                            label=f":warning: *{requester_name}* reported that the invite link you sent didn't work. "
                            "Please update your invite link in `/f3-nation-settings` → Downrange and send them a new one."  # noqa: E501
                        ).as_form_field()
                    ],
                )
            except Exception as e:
                logger.error(f"handle_invite_link_broken: error notifying target admins: {e}")

    # Tell the requester their report was sent and suggest next steps
    try:
        client.chat_postEphemeral(
            channel=channel_id,
            user=requester_user_id,
            text=(
                f"We've notified the admins of *{target_org_name}* that the link didn't work. "
                "They'll send you an updated link shortly."
            ),
        )
    except Exception as e:
        logger.error(f"handle_invite_link_broken: error notifying requester: {e}")


def handle_invite_mark_done(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    """Admin clicked 'Mark as Invited'. Update the DM and notify the requester to check their email."""
    metadata = safe_get(body, "message", "metadata", "event_payload") or {}
    requester_bot_token = metadata.get("requester_bot_token")
    requester_user_id = metadata.get("requester_user_id")
    requester_name = metadata.get("requester_name", "the requester")
    target_org_name = metadata.get("target_org_name", "our region")

    channel_id = safe_get(body, "channel", "id")
    message_ts = safe_get(body, "message", "ts")

    if not requester_bot_token or not requester_user_id:
        logger.error("handle_invite_mark_done: missing requester_bot_token or requester_user_id in metadata")
        return

    try:
        send_client = WebClient(token=requester_bot_token, ssl=_ssl_context())
        send_client.chat_postMessage(
            channel=requester_user_id,
            text=f"Your invite to {target_org_name} has been sent — check your email!",
            blocks=[
                SectionBlock(
                    label=f":email: The admins of *{target_org_name}* have sent you a direct email invite! "
                    "Check your email inbox for an invitation to join their Slack workspace."
                ).as_form_field()
            ],
        )
    except Exception as e:
        logger.error(f"handle_invite_mark_done: error notifying requester: {e}")
        return

    # Update the admin group DM to mark as handled
    if channel_id and message_ts:
        try:
            client.chat_update(
                channel=channel_id,
                ts=message_ts,
                text=f"Email invite request from {requester_name} — *Invited* :white_check_mark:",
                blocks=[
                    SectionBlock(
                        label=f"Email invite request from *{requester_name}* — *Invited* :white_check_mark: by <@{safe_get(body, 'user', 'id')}>"  # noqa: E501
                    ).as_form_field()
                ],
            )
        except Exception as e:
            logger.error(f"handle_invite_mark_done: error updating admin message: {e}")


def handle_downrange_settings(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Admin submitted the downrange settings form. Persist changes to SlackSettings."""
    private_metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    if not private_metadata.get("is_admin", False):
        return

    from f3_data_models.models import SlackSpace

    form_data = BlockView(blocks=copy.deepcopy(DOWNRANGE_ADMIN_BLOCKS)).get_selected_values(body)

    region_record.downrange_invite_sharing = safe_get(form_data, actions.DOWNRANGE_INVITE_SHARING) or "request_only"
    region_record.downrange_invite_link = safe_get(form_data, actions.DOWNRANGE_INVITE_LINK) or None
    region_record.downrange_channel_posting = safe_get(form_data, actions.DOWNRANGE_CHANNEL_POSTING) or "off"
    region_record.downrange_channel = safe_get(form_data, actions.DOWNRANGE_CHANNEL) or None

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )
    update_local_region_records()
