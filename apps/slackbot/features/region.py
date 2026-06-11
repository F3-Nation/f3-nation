import copy
import re
from logging import Logger

import requests
from f3_data_models.models import Org, Role, Role_x_User_x_Org, SlackUser
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from features import connect
from utilities.database.orm import SlackSettings
from utilities.database.special_queries import get_admin_users
from utilities.helper_functions import get_user, safe_get, upload_files_to_storage
from utilities.slack import actions, orm


def build_region_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
):
    form = copy.deepcopy(REGION_FORM)
    org_record: Org = DbManager.get(Org, region_record.org_id)
    org_meta = org_record.meta if org_record else {}

    if not org_record:
        connect.build_connect_options_form(body, client, logger, context)
    else:
        # Get current admin users, only those with slack ids
        admin_users = get_admin_users(region_record.org_id, slack_team_id=region_record.team_id)
        admin_user_ids = [u[1].slack_id for u in admin_users if safe_get(u[1], "slack_id")]
        print("Admin user ids:", admin_user_ids)
        print("Admin users:", admin_users)

        if safe_get(org_meta, actions.REGION_DEFAULT_PV_FILTERS):
            full_pv_filter_url = f"https://pax-vault.f3nation.com/stats/region/{org_record.id}?{org_meta[actions.REGION_DEFAULT_PV_FILTERS]}"
        else:
            full_pv_filter_url = f"https://pax-vault.f3nation.com/stats/region/{org_record.id}"

        form.set_initial_values(
            {
                actions.REGION_NAME: org_record.name,
                actions.REGION_DESCRIPTION: org_record.description,
                actions.REGION_LOGO: org_record.logo_url,
                actions.REGION_DEFAULT_PV_FILTERS: full_pv_filter_url,
                actions.REGION_WEBSITE: org_record.website,
                actions.REGION_EMAIL: org_record.email,
                actions.REGION_TWITTER: org_record.twitter,
                actions.REGION_FACEBOOK: org_record.facebook,
                actions.REGION_INSTAGRAM: org_record.instagram,
                actions.REGION_ADMINS: admin_user_ids,
            }
        )

        if org_record.logo_url:
            try:
                if requests.head(org_record.logo_url).status_code == 200:
                    form.blocks.insert(2, orm.ImageBlock(image_url=org_record.logo_url, alt_text="Region Logo"))
            except requests.RequestException as e:
                logger.error(f"Error fetching region logo: {e}")

        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Edit Region",
            callback_id=actions.REGION_CALLBACK_ID,
            new_or_add="add",
        )


def handle_region_edit(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = REGION_FORM.get_selected_values(body)

    file = safe_get(form_data, actions.REGION_LOGO, 0)
    if file:
        file_list, file_send_list, file_ids, low_rez_file_ids = upload_files_to_storage(
            files=[file],
            logger=logger,
            client=client,
            enforce_square=True,
            max_height=512,
            bucket_name="org-logos",
            file_name=str(region_record.org_id),
            enforce_png=True,
        )
        logo_url = file_list[0]
    else:
        logo_url = None

    email = safe_get(form_data, actions.REGION_EMAIL)
    if email and not re.match(r"[^@]+@[^@]+\.[^@]+", email):
        email = None

    website = safe_get(form_data, actions.REGION_WEBSITE) or ""
    if not re.match(
        r"https?://(?:www\.)?[-a-zA-Z0-9@:%._\+~#=]{2,256}\.[a-z]{2,6}\b([-a-zA-Z0-9@:%_\+.~#?&//=]*)", website
    ):
        website = None

    default_pv_filters = safe_get(form_data, actions.REGION_DEFAULT_PV_FILTERS)
    if default_pv_filters and not re.match(
        r"https?://pax-vault\.f3nation\.com/stats/region/\d+\?.+", default_pv_filters
    ):
        default_pv_filters = None
    else:
        default_pv_filters = default_pv_filters.split("?")[1] if default_pv_filters else None

    fields = {
        Org.name: safe_get(form_data, actions.REGION_NAME),
        Org.description: safe_get(form_data, actions.REGION_DESCRIPTION),
        Org.website: website,
        Org.email: email,
        Org.twitter: safe_get(form_data, actions.REGION_TWITTER),
        Org.facebook: safe_get(form_data, actions.REGION_FACEBOOK),
        Org.instagram: safe_get(form_data, actions.REGION_INSTAGRAM),
    }
    if logo_url:
        fields[Org.logo_url] = logo_url
    if default_pv_filters:
        org_record = DbManager.get(Org, region_record.org_id)
        org_meta = org_record.meta if org_record else {}
        org_meta[actions.REGION_DEFAULT_PV_FILTERS] = default_pv_filters
        fields[Org.meta] = org_meta

    DbManager.update_record(Org, region_record.org_id, fields)

    admin_users_slack = safe_get(form_data, actions.REGION_ADMINS)
    admin_users: list[SlackUser] = [get_user(user_id, region_record, client, logger) for user_id in admin_users_slack]
    admin_user_ids = [u.user_id for u in admin_users]
    admin_role_id = DbManager.find_first_record(Role, filters=[Role.name == "admin"]).id
    admin_records = [
        Role_x_User_x_Org(
            role_id=admin_role_id,
            org_id=region_record.org_id,
            user_id=user_id,
        )
        for user_id in admin_user_ids
        if user_id
    ]

    # pull existing admin users, only delete those that have slack users (other admins should be managed in maps)
    existing_admin_users = get_admin_users(region_record.org_id, slack_team_id=region_record.team_id)
    existing_admin_users_ids = [u[1].user_id for u in existing_admin_users if safe_get(u[1], "user_id")]
    DbManager.delete_records(
        Role_x_User_x_Org,
        filters=[
            Role_x_User_x_Org.org_id == region_record.org_id,
            Role_x_User_x_Org.role_id == admin_role_id,
            Role_x_User_x_Org.user_id.in_(existing_admin_users_ids),
        ],
    )
    DbManager.create_or_ignore(Role_x_User_x_Org, admin_records)


REGION_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Region Title",
            action=actions.REGION_NAME,
            element=orm.PlainTextInputElement(placeholder="Enter the Region name"),
            optional=False,
        ),
        orm.InputBlock(
            label="Region Description",
            action=actions.REGION_DESCRIPTION,
            element=orm.PlainTextInputElement(placeholder="Enter a description for the Region", multiline=True),
            optional=True,
        ),
        orm.InputBlock(
            label="Region Logo",
            action=actions.REGION_LOGO,
            optional=True,
            element=orm.FileInputElement(
                max_files=1,
                filetypes=[
                    "png",
                    "jpg",
                    "heic",
                    "bmp",
                ],
            ),
        ),
        orm.InputBlock(
            label="Region Admins",
            action=actions.REGION_ADMINS,
            element=orm.MultiUsersSelectElement(placeholder="Select the Region admins"),
            hint="These users will have admin permissions for the Region (modify schedules, backblasts, etc.)",
            optional=False,
        ),
        orm.InputBlock(
            label="Default PAX Vault Filters",
            action=actions.REGION_DEFAULT_PV_FILTERS,
            element=orm.PlainTextInputElement(),
            hint="Apply the filters you want defaulted in PV, then paste the URL here",
            optional=True,
        ),
        orm.InputBlock(
            label="Region Website",
            action=actions.REGION_WEBSITE,
            element=orm.PlainTextInputElement(placeholder="Enter the Region website"),
            optional=True,
        ),
        orm.InputBlock(
            label="Region email",
            action=actions.REGION_EMAIL,
            element=orm.EmailInputElement(placeholder="Enter the Region email"),
            optional=True,
        ),
        orm.InputBlock(
            label="Region Twitter",
            action=actions.REGION_TWITTER,
            element=orm.PlainTextInputElement(placeholder="Enter the Region Twitter"),
            optional=True,
        ),
        orm.InputBlock(
            label="Region Facebook",
            action=actions.REGION_FACEBOOK,
            element=orm.PlainTextInputElement(placeholder="Enter the Region Facebook"),
            optional=True,
        ),
        orm.InputBlock(
            label="Region Instagram",
            action=actions.REGION_INSTAGRAM,
            element=orm.PlainTextInputElement(placeholder="Enter the Region Instagram"),
            optional=True,
        ),
    ]
)
