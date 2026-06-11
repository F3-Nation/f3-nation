import copy
import os
from logging import Logger

from cryptography.fernet import Fernet
from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from features import db_admin
from utilities import constants
from utilities.constants import ALL_USERS_ARE_ADMINS
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import get_admin_users, make_user_admin
from utilities.helper_functions import (
    get_user,
    safe_convert,
    safe_get,
    update_local_region_records,
)
from utilities.slack import actions, forms


def build_config_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    user_id = safe_get(body, "user_id") or safe_get(body, "user", "id")
    update_view_id = safe_get(body, actions.LOADING_ID)
    if body.get("text") == os.environ.get("DB_ADMIN_PASSWORD"):
        db_admin.build_db_admin_form(body, client, logger, context, region_record, update_view_id)
    else:
        if ALL_USERS_ARE_ADMINS:
            user_is_admin = True
        else:
            slack_user = get_user(user_id, region_record, client, logger)
            # user_permissions = [p.name for p in get_user_permission_list(slack_user.user_id, region_record.org_id)]
            # user_is_admin = constants.PERMISSIONS[constants.ALL_PERMISSIONS] in user_permissions
            admin_users = get_admin_users(region_record.org_id, region_record.team_id)
            user_is_admin = any(u[0].id == slack_user.user_id for u in admin_users)

        if user_is_admin:
            config_form = copy.deepcopy(forms.CONFIG_FORM)
            if region_record.org_id in constants.ACHIEVEMENTS_ALPHA_TESTING_ORG_IDS:
                config_form.blocks[0].elements.append(copy.deepcopy(forms.ACHIEVEMENT_BUTTON))
        else:
            if region_record.org_id is None:
                config_form = copy.deepcopy(forms.CONFIG_NO_ORG_FORM)
            elif len(admin_users) == 0:
                make_user_admin(region_record.org_id, slack_user.user_id)
                config_form = copy.deepcopy(forms.CONFIG_FORM)
            else:
                config_form = copy.deepcopy(forms.CONFIG_NO_PERMISSIONS_FORM)
                config_form.blocks[1].label += " Your region's admin users are: "
                user_labels = []
                for admin_user in admin_users:
                    if admin_user[1]:
                        user_labels.append(f" <@{admin_user[1].slack_id}>")
                    else:
                        user_labels.append(admin_user[0].f3_name or "")
                config_form.blocks[1].label += ", ".join(user_labels)

        config_form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.CONFIG_CALLBACK_ID,
            title_text="F3 Nation Settings",
            submit_button_text="None",
        )


def build_config_email_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    config_form = copy.deepcopy(forms.CONFIG_EMAIL_FORM)

    if region_record.email_password:
        fernet = Fernet(os.environ[constants.PASSWORD_ENCRYPT_KEY].encode())
        email_password_decrypted = fernet.decrypt(region_record.email_password.encode()).decode()
    else:
        email_password_decrypted = "SamplePassword123!"

    config_form.set_initial_values(
        {
            actions.CONFIG_EMAIL_ENABLE: "enable" if region_record.email_enabled == 1 else "disable",
            actions.CONFIG_EMAIL_SHOW_OPTION: "yes" if region_record.email_option_show == 1 else "no",
            actions.CONFIG_EMAIL_FROM: region_record.email_user or "example_sender@gmail.com",
            actions.CONFIG_EMAIL_TO: region_record.email_to or "example_destination@gmail.com",
            actions.CONFIG_EMAIL_SERVER: region_record.email_server or "smtp.gmail.com",
            actions.CONFIG_EMAIL_PORT: str(region_record.email_server_port or 587),
            actions.CONFIG_EMAIL_PASSWORD: email_password_decrypted,
            actions.CONFIG_POSTIE_ENABLE: "yes" if region_record.postie_format == 1 else "no",
        }
    )

    config_form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        callback_id=actions.CONFIG_EMAIL_CALLBACK_ID,
        title_text="Email Settings",
        new_or_add="add",
    )


def build_config_general_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    config_form = copy.deepcopy(forms.CONFIG_GENERAL_FORM)

    config_form.set_initial_values(
        {
            actions.CONFIG_EDITING_LOCKED: "yes" if region_record.editing_locked == 1 else "no",
            actions.CONFIG_DEFAULT_DESTINATION: region_record.default_backblast_destination
            or constants.CONFIG_DESTINATION_AO["value"],
            actions.CONFIG_DESTINATION_CHANNEL: region_record.backblast_destination_channel,
            actions.CONFIG_DEFAULT_PREBLAST_DESTINATION: region_record.default_preblast_destination
            or constants.CONFIG_DESTINATION_AO["value"],
            actions.CONFIG_PREBLAST_DESTINATION_CHANNEL: region_record.preblast_destination_channel,
            actions.CONFIG_BACKBLAST_MOLESKINE_TEMPLATE: region_record.backblast_moleskin_template
            or constants.DEFAULT_BACKBLAST_MOLESKINE_TEMPLATE,
            actions.CONFIG_PREBLAST_MOLESKINE_TEMPLATE: region_record.preblast_moleskin_template
            or constants.DEFAULT_PREBLAST_MOLESKINE_TEMPLATE,
            actions.CONFIG_ENABLE_STRAVA: "enable" if region_record.strava_enabled == 1 else "disable",
            actions.CONFIG_PREBLAST_REMINDER_DAYS: region_record.preblast_reminder_days,
            actions.CONFIG_BACKBLAST_REMINDER_DAYS: region_record.backblast_reminder_days,
            actions.CONFIG_AUTOMATED_PREBLAST: region_record.automated_preblast_option or "q_only",
            actions.CONFIG_AUTOMATED_PREBLAST_TIME: f"{str(region_record.automated_preblast_hour_cst).zfill(2)}:00"
            if region_record.automated_preblast_hour_cst is not None
            else "12:00",
            actions.CONFIG_SCHEDULED_PREBLAST_TIME: f"{str(region_record.scheduled_preblast_hour_cst).zfill(2)}:00"
            if region_record.scheduled_preblast_hour_cst is not None
            else "12:00",
            actions.CONFIG_PREBLAST_REMINDER_TIME: f"{str(region_record.preblast_reminder_hour_cst).zfill(2)}:00"
            if region_record.preblast_reminder_hour_cst is not None
            else "10:00",
            actions.CONFIG_HC_ANNOUNCE_OPTION: region_record.hc_announce_option or "off",
            actions.CONFIG_HC_ANNOUNCE_TARGETS: region_record.hc_announce_targets or "both",
            actions.CONFIG_BOT_LOG_CHANNEL: region_record.bot_log_channel,
        }
    )

    config_form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        callback_id=actions.CONFIG_GENERAL_CALLBACK_ID,
        title_text="General Settings",
        new_or_add="add",
    )


def handle_config_email_post(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    config_data = forms.CONFIG_EMAIL_FORM.get_selected_values(body)

    if safe_get(config_data, actions.CONFIG_EMAIL_ENABLE) == "enable":
        fernet = Fernet(os.environ[constants.PASSWORD_ENCRYPT_KEY].encode())
        email_password_decrypted = safe_get(config_data, actions.CONFIG_EMAIL_PASSWORD)
        if email_password_decrypted:
            email_password_encrypted = fernet.encrypt(
                safe_get(config_data, actions.CONFIG_EMAIL_PASSWORD).encode()
            ).decode()
        else:
            email_password_encrypted = None
    else:
        email_password_encrypted = None

    region_record.email_enabled = 1 if safe_get(config_data, actions.CONFIG_EMAIL_ENABLE) == "enable" else 0
    region_record.email_option_show = 1 if safe_get(config_data, actions.CONFIG_EMAIL_SHOW_OPTION) == "yes" else 0
    region_record.email_server = safe_get(config_data, actions.CONFIG_EMAIL_SERVER)
    region_record.email_server_port = safe_convert(safe_get(config_data, actions.CONFIG_EMAIL_PORT), int)
    region_record.email_user = safe_get(config_data, actions.CONFIG_EMAIL_FROM)
    region_record.email_to = safe_get(config_data, actions.CONFIG_EMAIL_TO)
    region_record.email_password = email_password_encrypted
    region_record.postie_format = 1 if safe_get(config_data, actions.CONFIG_POSTIE_ENABLE) == "yes" else 0

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )

    update_local_region_records()


def handle_config_general_post(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    config_data = forms.CONFIG_GENERAL_FORM.get_selected_values(body)

    region_record.editing_locked = 1 if safe_get(config_data, actions.CONFIG_EDITING_LOCKED) == "yes" else 0
    region_record.default_backblast_destination = safe_get(config_data, actions.CONFIG_DEFAULT_DESTINATION)
    region_record.backblast_destination_channel = safe_get(config_data, actions.CONFIG_DESTINATION_CHANNEL)
    region_record.default_preblast_destination = safe_get(config_data, actions.CONFIG_DEFAULT_PREBLAST_DESTINATION)
    region_record.preblast_destination_channel = safe_get(config_data, actions.CONFIG_PREBLAST_DESTINATION_CHANNEL)
    region_record.backblast_moleskin_template = safe_get(config_data, actions.CONFIG_BACKBLAST_MOLESKINE_TEMPLATE)
    region_record.preblast_moleskin_template = safe_get(config_data, actions.CONFIG_PREBLAST_MOLESKINE_TEMPLATE)
    region_record.strava_enabled = 1 if safe_get(config_data, actions.CONFIG_ENABLE_STRAVA) == "enable" else 0
    region_record.preblast_reminder_days = safe_convert(
        safe_get(config_data, actions.CONFIG_PREBLAST_REMINDER_DAYS), int
    )
    region_record.backblast_reminder_days = safe_convert(
        safe_get(config_data, actions.CONFIG_BACKBLAST_REMINDER_DAYS), int
    )
    region_record.automated_preblast_option = safe_get(config_data, actions.CONFIG_AUTOMATED_PREBLAST) or "q_only"
    region_record.automated_preblast_hour_cst = safe_convert(
        (safe_get(config_data, actions.CONFIG_AUTOMATED_PREBLAST_TIME) or "12:00").split(":")[0], int
    )
    region_record.scheduled_preblast_hour_cst = safe_convert(
        (safe_get(config_data, actions.CONFIG_SCHEDULED_PREBLAST_TIME) or "12:00").split(":")[0], int
    )
    region_record.preblast_reminder_hour_cst = safe_convert(
        (safe_get(config_data, actions.CONFIG_PREBLAST_REMINDER_TIME) or "10:00").split(":")[0], int
    )
    region_record.hc_announce_option = safe_get(config_data, actions.CONFIG_HC_ANNOUNCE_OPTION) or "off"
    region_record.hc_announce_targets = safe_get(config_data, actions.CONFIG_HC_ANNOUNCE_TARGETS) or "both"
    region_record.bot_log_channel = safe_get(config_data, actions.CONFIG_BOT_LOG_CHANNEL)

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )

    update_local_region_records()
