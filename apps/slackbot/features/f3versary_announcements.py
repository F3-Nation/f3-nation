import copy
from logging import Logger

from f3_data_models.models import F3versaryAnnouncementSetting, Org_x_SlackSpace, SlackSpace
from f3_data_models.utils import get_session
from slack_sdk.web import WebClient
from sqlalchemy import func
from sqlalchemy.dialects.postgresql import insert

from utilities import constants
from utilities.builders import update_submission_wait_view
from utilities.constants import ALL_USERS_ARE_ADMINS
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import get_admin_users
from utilities.helper_functions import get_user, safe_get
from utilities.slack import actions, orm

DEFAULT_LEAD_DAYS = 14
MIN_LEAD_DAYS = 0
MAX_LEAD_DAYS = 30


def _is_authorized_region_admin(body: dict, client: WebClient, logger: Logger, region_record: SlackSettings) -> bool:
    """Bind this settings action to the same region-admin context as Bot Management."""
    if not isinstance(region_record.org_id, int) or region_record.org_id <= 0:
        return False
    if ALL_USERS_ARE_ADMINS:
        return True

    slack_user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    if not slack_user_id:
        return False
    slack_user = get_user(slack_user_id, region_record, client, logger)
    return any(
        user[0].id == slack_user.user_id for user in get_admin_users(region_record.org_id, region_record.team_id)
    )


def _resolve_setting_scope(session, region_record: SlackSettings) -> tuple[int, int] | None:
    """Use the server-side region and verify its workspace link before any read or write."""
    org_id = region_record.org_id
    if not isinstance(org_id, int) or org_id <= 0 or not region_record.team_id:
        return None

    linked_space = (
        session.query(SlackSpace.id)
        .join(Org_x_SlackSpace, Org_x_SlackSpace.slack_space_id == SlackSpace.id)
        .filter(SlackSpace.team_id == region_record.team_id, Org_x_SlackSpace.org_id == org_id)
        .one_or_none()
    )
    return (linked_space[0], org_id) if linked_space else None


def _load_f3versary_settings(region_record: SlackSettings) -> dict | None:
    """Read the region-specific row, never the stale workspace settings cache."""
    with get_session() as session:
        scope = _resolve_setting_scope(session, region_record)
        if scope is None:
            return None
        setting = (
            session.query(F3versaryAnnouncementSetting)
            .filter(
                F3versaryAnnouncementSetting.slack_space_id == scope[0],
                F3versaryAnnouncementSetting.org_id == scope[1],
            )
            .one_or_none()
        )
        return {
            "enabled": bool(setting.enabled) if setting else False,
            "channel": setting.channel if setting else None,
            "lead_days": setting.lead_days if setting else DEFAULT_LEAD_DAYS,
        }


def _save_f3versary_settings(region_record: SlackSettings, enabled: bool, channel: str | None, lead_days: int) -> bool:
    """Upsert one region's independent row without rewriting SlackSpace.settings."""
    with get_session() as session:
        scope = _resolve_setting_scope(session, region_record)
        if scope is None:
            return False

        statement = insert(F3versaryAnnouncementSetting).values(
            slack_space_id=scope[0], org_id=scope[1], enabled=enabled, channel=channel, lead_days=lead_days
        )
        statement = statement.on_conflict_do_update(
            index_elements=[
                F3versaryAnnouncementSetting.slack_space_id,
                F3versaryAnnouncementSetting.org_id,
            ],
            set_={"enabled": enabled, "channel": channel, "lead_days": lead_days, "updated_at": func.now()},
        )
        session.execute(statement)
        session.commit()
        return True


def build_f3versary_announcements_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form = copy.deepcopy(F3VERSARY_ANNOUNCEMENTS_FORM)
    authorized = _is_authorized_region_admin(body, client, logger, region_record)
    settings = _load_f3versary_settings(region_record) if authorized else None
    if settings is None:
        logger.warning("F3versary settings unavailable: unauthorized admin or unlinked region")
        client.views_open(
            trigger_id=safe_get(body, "trigger_id"),
            view={
                "type": "modal",
                "title": {"type": "plain_text", "text": "F3versary Announcements"},
                "close": {"type": "plain_text", "text": "Close"},
                "blocks": [
                    {
                        "type": "section",
                        "text": {"type": "mrkdwn", "text": "F3versary settings are unavailable for this region."},
                    }
                ],
            },
        )
        return

    form.set_initial_values(
        {
            actions.F3VERSARY_ANNOUNCEMENTS_ENABLED: ["enable"] if settings["enabled"] else [],
            actions.F3VERSARY_ANNOUNCEMENTS_CHANNEL: settings["channel"],
            actions.F3VERSARY_ANNOUNCEMENTS_LEAD_DAYS: str(settings["lead_days"]),
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
    submission_view_id = safe_get(body, "submission_view_id") or safe_get(body, "view", "id")
    if not _is_authorized_region_admin(body, client, logger, region_record):
        update_submission_wait_view(
            client=client,
            title="Not authorized",
            text="F3versary settings are unavailable for this region.",
            level=constants.AlertLevel.ERROR,
            logger=logger,
            view_id=submission_view_id,
        )
        return

    form_data = F3VERSARY_ANNOUNCEMENTS_FORM.get_selected_values(body)
    enabled = "enable" in (safe_get(form_data, actions.F3VERSARY_ANNOUNCEMENTS_ENABLED) or [])
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

    if not _save_f3versary_settings(region_record, enabled, channel, lead_days):
        update_submission_wait_view(
            client=client,
            title="Region unavailable",
            text="This region is not linked to the Slack workspace. No settings were saved.",
            level=constants.AlertLevel.ERROR,
            logger=logger,
            view_id=submission_view_id,
        )
        return

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
            optional=True,
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
