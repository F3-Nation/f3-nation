"""
/fng: a battle buddy signs up a new PAX after his first workout.

The bot creates the FNG's F3 Nation user (home region = this region, ``meta.brought_by`` = the buddy),
and emails him the region's Slack invite link. The welcome post is left to the existing
``team_join`` handler, which fires when he actually joins Slack (posting here too would welcome him twice).
"""

import html
import uuid
from logging import Logger

from f3_data_models.models import Org, User
from f3_data_models.utils import DbManager
from slack_sdk.errors import SlackApiError
from slack_sdk.web import WebClient

from features.user import USER_META_BROUGHT_BY
from utilities import constants
from utilities.builders import update_submission_wait_view
from utilities.constants import AlertLevel
from utilities.database.orm import SlackSettings
from utilities.helper_functions import get_user, safe_get
from utilities.sendmail import send_via_sendgrid
from utilities.slack import actions
from utilities.slack.orm import (
    BlockView,
    ContextBlock,
    ContextElement,
    EmailInputElement,
    InputBlock,
    PlainTextInputElement,
)

FNG_CALLBACK_ID = "fng-form"
FNG_FIRST_NAME = "fng_first_name"
FNG_LAST_NAME = "fng_last_name"
FNG_F3_NAME = "fng_f3_name"
FNG_EMAIL = "fng_email"
FNG_PHONE = "fng_phone"


def build_fng_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    blocks = [
        InputBlock(label="First name", action=FNG_FIRST_NAME, optional=False, element=PlainTextInputElement()),
        InputBlock(label="Last name", action=FNG_LAST_NAME, optional=False, element=PlainTextInputElement()),
        InputBlock(
            label="F3 name",
            action=FNG_F3_NAME,
            element=PlainTextInputElement(),
            hint="Leave blank if he hasn't been named yet.",
        ),
        InputBlock(
            label="Email",
            action=FNG_EMAIL,
            optional=False,
            element=EmailInputElement(),
            hint="He'll get the Slack invite here, so double-check it.",
        ),
        InputBlock(label="Cell phone", action=FNG_PHONE, element=PlainTextInputElement()),
        ContextBlock(
            element=ContextElement(
                initial_value="This creates his F3 Nation profile, emails him the Slack invite "
                "and lists you as the PAX who brought him. He's welcomed in Slack once he joins."
            )
        ),
    ]

    BlockView(blocks=blocks).update_modal(
        client=client,
        view_id=safe_get(body, actions.LOADING_ID),
        title_text="Add an FNG",
        callback_id=FNG_CALLBACK_ID,
        submit_button_text="Create",
        close_button_text="Cancel",
    )


def handle_fng_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    values = safe_get(body, "view", "state", "values") or {}

    def text(action: str) -> str | None:
        value = safe_get(values, action, action, "value")
        return value.strip() if isinstance(value, str) and value.strip() else None

    first_name, last_name, f3_name = text(FNG_FIRST_NAME), text(FNG_LAST_NAME), text(FNG_F3_NAME)
    email = (text(FNG_EMAIL) or "").lower()
    phone = text(FNG_PHONE)
    display_name = f"{first_name} {(last_name or '')[:1]}."
    if f3_name:
        display_name = f"{f3_name} ({display_name})"
    display_name = html.escape(display_name, quote=False)  # Slack mrkdwn: neutralize <!channel> and friends

    def done(level: AlertLevel, message: str):
        update_submission_wait_view(
            client=client,
            logger=logger,
            title="Add an FNG",
            level=level,
            text=message,
            view_id=safe_get(body, "submission_view_id"),
        )

    if not region_record.org_id:
        done(AlertLevel.ERROR, "This workspace isn't linked to an F3 Nation region yet.")
        return
    if not (first_name and last_name and email):
        done(AlertLevel.ERROR, "First name, last name and email can't be blank.")
        return

    if not constants.is_production_deployment():
        # Like create_user: keep real contact details out of Staging/local and never email the real person.
        email, phone = f"dev.staging-email-sink+fng-{uuid.uuid4().hex}@f3nation.com", None

    # Create-only: an existing user (maybe from another region) is left exactly as he is.
    existing = safe_get(DbManager.find_records(User, filters=[User.email == email]), 0)
    if not existing:
        try:
            buddy = get_user(safe_get(body, "user", "id"), region_record, client, logger)
            buddy_user_id = safe_get(buddy, "user_id")
            DbManager.create_record(
                User(
                    email=email,
                    first_name=first_name,
                    last_name=last_name,
                    f3_name=f3_name,
                    phone=phone,
                    home_region_id=region_record.org_id,
                    meta={USER_META_BROUGHT_BY: buddy_user_id} if buddy_user_id else {},
                )
            )
        except Exception as exc:
            logger.error("fng.create_user_failed error=%s", type(exc).__name__)  # the message can carry PII
            done(AlertLevel.ERROR, "I couldn't create his F3 Nation profile, so nothing was sent. Please try again.")
            return

    region = safe_get(DbManager.get(Org, region_record.org_id), "name") or region_record.workspace_name or "F3"
    # An existing user may still need this region's Slack invite, but greet him by his profile name, not a typed one.
    greet = safe_get(existing, "first_name") if existing else first_name
    emailed = _send_welcome_email(email, greet, region, region_record.downrange_invite_link)

    lines = [
        f"*{display_name}* already had an F3 Nation profile, so I left it as is."
        if existing
        else f"Created *{display_name}*'s F3 Nation profile."
    ]
    if emailed:
        lines.append("I emailed him the Slack invite.")
    elif region_record.downrange_invite_link:
        # The result alert caps at 200 chars, which can cut off the link; a DM can't, and it's easy to forward.
        try:
            client.chat_postMessage(
                channel=safe_get(body, "user", "id"),
                text=f"I couldn't email *{display_name}* his Slack invite. "
                f"Please text him this link: {region_record.downrange_invite_link}",
            )
            lines.append("I couldn't email him, so I DMed you his invite link to text him.")
        except SlackApiError as exc:
            logger.warning("fng.invite_dm_failed error=%s", exc.response.get("error"))
            lines.append(f"I couldn't email him; please text him {region_record.downrange_invite_link}")
    else:
        lines.append("No invite link is set in /f3-nation-settings > Downrange, so no email went out.")
    done(AlertLevel.SUCCESS if emailed else AlertLevel.WARNING, " ".join(lines))


def _send_welcome_email(email: str, first_name: str | None, region: str, invite_link: str | None) -> bool:
    if not invite_link:
        return False
    region, link = html.escape(region), html.escape(invite_link)
    greeting = f", {html.escape(first_name)}" if first_name else ""
    return send_via_sendgrid(
        to_email=email,
        subject=f"Welcome to {region}",
        html_content=f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <p>Welcome to {region}{greeting}!</p>
        <p>We use Slack to coordinate workouts, post backblasts and stay in touch.
        <a href="{link}">Join us here</a>, using this email address so we can link your account.</p>
        <p>See you in the gloom.</p>
    </body>
    </html>
    """,
        from_email="F3 Nation Slackbot Support <support.slackbot@f3nation.com>",
    )
