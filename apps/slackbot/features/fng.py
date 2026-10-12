"""
/fng: a battle buddy signs up a new PAX after his first workout.

The bot creates the FNG's F3 Nation user (home region = this region, ``meta.brought_by`` = the buddy),
emails him the region's Slack invite link, and posts a welcome in the welcome channel.
"""

import html
from logging import Logger

from f3_data_models.models import Org, Org_Type, User
from f3_data_models.utils import DbManager
from slack_sdk.errors import SlackApiError
from slack_sdk.web import WebClient

from features.user import USER_META_BROUGHT_BY
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
    StaticSelectElement,
    as_selector_options,
)

FNG_CALLBACK_ID = "fng-form"
FNG_FIRST_NAME = "fng_first_name"
FNG_LAST_NAME = "fng_last_name"
FNG_F3_NAME = "fng_f3_name"
FNG_EMAIL = "fng_email"
FNG_PHONE = "fng_phone"
FNG_AO = "fng_ao"


def build_fng_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    aos = []
    if region_record.org_id:
        aos = DbManager.find_records(
            Org, filters=[Org.parent_id == region_record.org_id, Org.org_type == Org_Type.ao, Org.is_active.is_(True)]
        )
        aos = sorted(aos, key=lambda ao: ao.name.lower())[:100]  # static_select caps at 100 options

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
    ]
    if aos:
        blocks.append(
            InputBlock(
                label="AO of first post",
                action=FNG_AO,
                element=StaticSelectElement(
                    placeholder="Select an AO",
                    options=as_selector_options([ao.name for ao in aos], [str(ao.id) for ao in aos]),
                ),
            )
        )
    blocks.append(
        ContextBlock(
            element=ContextElement(
                initial_value="This creates his F3 Nation profile, emails him the Slack invite "
                "and lists you as the PAX who brought him."
            )
        )
    )

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
    ao_name = safe_get(values, FNG_AO, FNG_AO, "selected_option", "text", "text")
    display_name = f"{first_name} {(last_name or '')[:1]}."
    if f3_name:
        display_name = f"{f3_name} ({display_name})"

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

    # Create-only: an existing user (maybe from another region) is left exactly as he is.
    existing = safe_get(DbManager.find_records(User, filters=[User.email == email]), 0)
    if not existing:
        buddy = get_user(safe_get(body, "user", "id"), region_record, client, logger)
        buddy_user_id = safe_get(buddy, "user_id")
        DbManager.create_record(
            User(
                email=email,
                first_name=first_name,
                last_name=last_name,
                f3_name=f3_name,
                phone=text(FNG_PHONE),
                home_region_id=region_record.org_id,
                meta={USER_META_BROUGHT_BY: buddy_user_id} if buddy_user_id else {},
            )
        )

    region = safe_get(DbManager.get(Org, region_record.org_id), "name") or region_record.workspace_name or "F3"
    emailed = _send_welcome_email(email, first_name, region, region_record.downrange_invite_link)

    if region_record.welcome_channel_enable and region_record.welcome_channel:
        where = f"*{ao_name}*" if ao_name else region
        try:
            client.chat_postMessage(
                channel=region_record.welcome_channel,
                text=f":wave: Welcome FNG *{display_name}* to {where}! Brought by <@{safe_get(body, 'user', 'id')}>.",
            )
        except SlackApiError as exc:
            logger.warning("fng.welcome_post_failed error=%s", exc.response.get("error"))

    lines = [
        f"*{display_name}* already had an F3 Nation profile, so I left it as is."
        if existing
        else f"Created *{display_name}*'s F3 Nation profile."
    ]
    if emailed:
        lines.append("I emailed him the Slack invite.")
    elif region_record.downrange_invite_link:
        lines.append(f"I couldn't email him; please text him {region_record.downrange_invite_link}")
    else:
        lines.append("No invite link is set in /f3-nation-settings > Downrange, so no email went out.")
    done(AlertLevel.SUCCESS if emailed else AlertLevel.WARNING, " ".join(lines))


def _send_welcome_email(email: str, first_name: str, region: str, invite_link: str | None) -> bool:
    if not invite_link:
        return False
    region, link = html.escape(region), html.escape(invite_link)
    return send_via_sendgrid(
        to_email=email,
        subject=f"Welcome to {region}",
        html_content=f"""
    <html>
    <body style="font-family: Arial, sans-serif; line-height: 1.6; color: #333;">
        <p>Welcome to {region}, {html.escape(first_name)}!</p>
        <p>We use Slack to coordinate workouts, post backblasts and stay in touch.
        <a href="{link}">Join us here</a>, using this email address so we can link your account.</p>
        <p>See you in the gloom.</p>
    </body>
    </html>
    """,
        from_email="F3 Nation Slackbot Support <support.slackbot@f3nation.com>",
    )
