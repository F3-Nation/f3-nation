import copy
import os
import ssl
from logging import Logger

from alembic import command, config, script
from alembic.runtime import migration
from f3_data_models.models import Org, Org_Type, Org_x_SlackSpace, Role, Role_x_User_x_Org, SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient
from sqlalchemy import engine

# from features.calendar.series import create_events
from scripts.calendar_images import generate_calendar_images
from scripts.q_lineups import send_lineups
from scripts.update_slack_users import update_slack_users
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import get_admin_users
from utilities.helper_functions import (
    MapUpdateData,
    # current_date_cst,
    get_region_record,
    get_user,
    safe_convert,
    safe_get,
    trigger_map_revalidation,
)
from utilities.slack import actions, orm


def check_current_head(alembic_cfg: config.Config, connectable: engine.Engine) -> bool:
    # type: (config.Config, engine.Engine) -> bool
    directory = script.ScriptDirectory.from_config(alembic_cfg)
    with connectable.begin() as connection:
        context = migration.MigrationContext.configure(connection)
        return set(context.get_current_heads()) == set(directory.get_heads())


def build_db_admin_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id: str = None,
    message: str = None,
):
    update_view_id = update_view_id or safe_get(body, actions.LOADING_ID)
    if body.get("text") == os.environ.get("DB_ADMIN_PASSWORD") or message:
        form = copy.deepcopy(DB_ADMIN_FORM)
        # form.blocks[-1].label = message or " "
    else:
        form = copy.deepcopy(DB_WRONG_PASSWORD_FORM)

    form.update_modal(
        client=client,
        view_id=update_view_id,
        callback_id=actions.DB_ADMIN_CALLBACK_ID,
        title_text="DB Admin",
        submit_button_text="Send Announcement",
    )


def handle_db_admin_upgrade(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    alembic_cfg = config.Config("alembic.ini")
    command.upgrade(alembic_cfg, "head")
    view_id = safe_get(body, "view", "id")
    body["text"] = os.environ.get("DB_ADMIN_PASSWORD")
    build_db_admin_form(
        body, client, logger, context, region_record, update_view_id=view_id, message="Database upgraded!"
    )


def handle_db_admin_reset(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    alembic_cfg = config.Config("alembic.ini")
    command.downgrade(alembic_cfg, "base")
    command.upgrade(alembic_cfg, "head")
    view_id = safe_get(body, "view", "id")
    body["text"] = os.environ.get("DB_ADMIN_PASSWORD")
    build_db_admin_form(body, client, logger, context, region_record, update_view_id=view_id, message="Database reset!")


def handle_calendar_image_refresh(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    generate_calendar_images(force=True)


def handle_slack_user_refresh(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    update_slack_users(force=True)


def handle_make_admin(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    slack_user_id = safe_get(body, "user", "id")
    user = get_user(slack_user_id, region_record, client, logger)
    DbManager.create_record(
        Role_x_User_x_Org(
            user_id=user.user_id,
            org_id=region_record.org_id,
            role_id=1,
        )
    )


def handle_ao_lineups(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    send_lineups(force=True)


def handle_preblast_reminders(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    from scripts.preblast_reminders import send_preblast_reminders

    send_preblast_reminders()


def handle_backblast_reminders(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    from scripts.backblast_reminders import send_backblast_reminders

    send_backblast_reminders(force=True)


# def handle_generate_instances(
#     body: dict,
#     client: WebClient,
#     logger: Logger,
#     context: dict,
#     region_record: SlackSettings,
# ):
#     event_records = DbManager.find_records(
#         Event,
#         filters=[
#             Event.is_active,
#             or_(Event.org_id == region_record.org_id, Event.org.has(Org.parent_id == region_record.org_id)),
#             or_(Event.end_date >= current_date_cst(), Event.end_date.is_(None)),
#         ],
#         joinedloads="all",
#     )
#     start_date = (
#         safe_convert(region_record.migration_date, datetime.strptime, args=["%Y-%m-%d"]) or datetime.now()
#     ).date()
#     create_events(event_records, clear_first=True, start_date=start_date)


def handle_trigger_map_revalidation(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    action = "map.updated"
    update_data = MapUpdateData(
        eventId=42,
    )
    success = trigger_map_revalidation(
        action=action,
        map_update_data=update_data,
    )
    msg = "Map revalidation triggered successfully." if success else "Failed to trigger map revalidation."
    form = copy.deepcopy(DB_ADMIN_FORM)
    form.blocks.append(orm.SectionBlock(label=msg))
    form.update_modal(
        client=client,
        view_id=safe_get(body, "view", "id"),
        callback_id=actions.DB_ADMIN_CALLBACK_ID,
        title_text="DB Admin",
        submit_button_text="Send Announcement",
    )


def handle_make_org(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    team_id = safe_get(body, "team", "id") or safe_get(body, "team_id")
    region_record: SlackSettings = get_region_record(team_id, body, context, client, logger)
    # Create a new region org record
    org_record: Org = DbManager.create_record(
        Org(
            org_type=Org_Type.region,
            name="My Region",
            is_active=True,
        )
    )
    # Connect the new org to the Slack space
    if team_id:
        slack_space_record = DbManager.find_first_record(SlackSpace, [SlackSpace.team_id == team_id])
        if slack_space_record:
            connect_record = Org_x_SlackSpace(
                org_id=org_record.id,
                slack_space_id=slack_space_record.id,
            )
            DbManager.create_record(connect_record)
        # Update the slack space record with the new org
        region_record.org_id = org_record.id
        DbManager.update_records(
            cls=SlackSpace,
            filters=[SlackSpace.team_id == region_record.team_id],
            fields={SlackSpace.settings: region_record.__dict__},
        )
    # Make the current user an admin of the new org
    slack_user_id = safe_get(body, "user", "id")
    user_id = get_user(slack_user_id, region_record, client, logger).user_id
    admin_role_id = DbManager.find_first_record(Role, filters=[Role.name == "admin"]).id
    DbManager.create_record(
        Role_x_User_x_Org(
            user_id=user_id,
            org_id=org_record.id,
            role_id=admin_role_id,
        )
    )


def handle_update_bot_token(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    bot_token = safe_get(context, "bot_token")

    if bot_token:
        region_record.bot_token = bot_token
        DbManager.update_records(
            cls=SlackSpace,
            filters=[SlackSpace.team_id == region_record.team_id],
            fields={
                SlackSpace.bot_token: bot_token,
                SlackSpace.settings: region_record.__dict__,
            },
        )


def handle_send_admin_announcement(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    announcement_text = safe_get(
        body, "view", "state", "values", actions.DB_ADMIN_TEXT, actions.DB_ADMIN_TEXT, "rich_text_value"
    )
    if announcement_text:
        records = DbManager.find_join_records2(
            SlackSpace,
            Org_x_SlackSpace,
            filters=[True],
        )
        for record in records:
            slack_space = record[0]
            org_x_slack_space = record[1]
            admin_users = get_admin_users(org_x_slack_space.org_id, slack_space.team_id)
            slack_admin_ids = {safe_get(u, 1, "slack_id") for u in admin_users if safe_get(u, 1, "slack_id")}
            for slack_user_id in slack_admin_ids:
                try:
                    ssl_context = ssl.create_default_context()
                    ssl_context.check_hostname = False
                    ssl_context.verify_mode = ssl.CERT_NONE
                    slack_client = WebClient(slack_space.settings.get("bot_token"), ssl=ssl_context)
                    slack_client.chat_postMessage(
                        channel=slack_user_id,
                        blocks=[announcement_text],
                        text="Admin Announcement",
                    )
                except Exception as e:
                    logger.error(
                        f"Failed to send admin announcement to {slack_user_id} in {slack_space.workspace_name}: {e}"  # noqa: E501
                    )


def build_long_run_task_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form = orm.BlockView(
        blocks=[
            orm.InputBlock(
                action=actions.DB_ADMIN_LONG_RUN_SECONDS,
                label="Task Duration (seconds)",
                element=orm.NumberInputElement(
                    initial_value=5,
                ),
            ),
        ]
    )

    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Long Run Task",
        submit_button_text="Start Task",
        callback_id=actions.DB_ADMIN_LONG_RUN_CALLBACK_ID,
        new_or_add="add",
    )


def handle_refresh_cache(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    from utilities.helper_functions import update_local_region_records, update_local_slack_users

    update_local_region_records()
    update_local_slack_users()


def handle_auto_preblast_send(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    from scripts.auto_preblast_send import send_automated_preblasts

    send_automated_preblasts(force=True)


def handle_long_run_task(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form_data = DB_ADMIN_FORM.get_selected_values(body)
    duration_seconds = safe_convert(
        safe_get(form_data, actions.DB_ADMIN_LONG_RUN_SECONDS),
        int,
        default=5,
    )
    import time

    client.chat_postMessage(
        channel=safe_get(body, "user", "id"),
        text=f"Starting long run task for {duration_seconds} seconds...",
    )
    time.sleep(duration_seconds)
    client.chat_postMessage(
        channel=safe_get(body, "user", "id"),
        text="Long run task complete.",
    )


DB_ADMIN_FORM = orm.BlockView(
    blocks=[
        orm.ActionsBlock(
            elements=[
                # orm.ButtonElement(
                #     label="AO Lineups",
                #     action=actions.SECRET_MENU_AO_LINEUPS,
                # ),
                # orm.ButtonElement(
                #     label="Preblast Reminders",
                #     action=actions.SECRET_MENU_PREBLAST_REMINDERS,
                # ),
                # orm.ButtonElement(
                #     label="Backblast Reminders",
                #     action=actions.SECRET_MENU_BACKBLAST_REMINDERS,
                # ),
                orm.ButtonElement(
                    label="Trigger Map Revalidation",
                    action=actions.SECRET_MENU_TRIGGER_MAP_REVALIDATION,
                ),
                # orm.ButtonElement(
                #     label="Refresh Slack Users",
                #     action=actions.SECRET_MENU_REFRESH_SLACK_USERS,
                # ),
                orm.ButtonElement(
                    label="Update Bot Token",
                    action=actions.SECRET_MENU_UPDATE_BOT_TOKEN,
                ),
                # orm.ButtonElement(
                #     label="Test long run task",
                #     action=actions.SECRET_MENU_LONG_RUN,
                # ),
                # orm.ButtonElement(
                #     label="Send Auto Preblasts",
                #     action=actions.SECRET_MENU_SEND_AUTO_PREBLASTS,
                # ),
                orm.ButtonElement(
                    label="Refresh Cache",
                    action=actions.SECRET_MENU_REFRESH_CACHE,
                ),
            ],
        ),
        orm.InputBlock(
            action=actions.DB_ADMIN_TEXT,
            label="Announcement Text",
            element=orm.RichTextInputElement(
                placeholder="Enter the announcement text here.",
            ),
        ),
    ]
)

DB_WRONG_PASSWORD_FORM = orm.BlockView(
    blocks=[
        orm.SectionBlock(
            action=actions.DB_ADMIN_TEXT,
            label="Wrong password.",
        ),
    ]
)
