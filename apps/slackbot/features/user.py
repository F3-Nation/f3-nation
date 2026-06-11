import copy
import os
from logging import Logger

from f3_data_models.models import SlackUser, User
from f3_data_models.utils import DbManager
from slack_sdk import WebClient

from utilities.database.orm import SlackSettings
from utilities.helper_functions import get_user, safe_convert, safe_get, upload_files_to_storage
from utilities.slack import actions
from utilities.slack.orm import (
    ActionsBlock,
    BlockView,
    ButtonElement,
    CheckboxInputElement,
    ContextBlock,
    ContextElement,
    DatepickerElement,
    DividerBlock,
    ExternalSelectElement,
    FileInputElement,
    HeaderBlock,
    ImageBlock,
    InputBlock,
    PlainTextInputElement,
    as_selector_options,
)

USER_FORM_USERNAME = "user_name"
USER_FORM_HOME_REGION = "user_home_region"
USER_FORM_IMAGE = "user_image"
USER_FORM_IMAGE_UPLOAD = "user_image_upload"
USER_FORM_ID = "user_form_id"
USER_FORM_EMERGENCY_CONTACT = "user_emergency_contact"
USER_FORM_EMERGENCY_CONTACT_PHONE = "user_emergency_contact_phone"
USER_FORM_EMERGENCY_CONTACT_NOTES = "user_emergency_contact_notes"
IGNORE_EVENT = "user_ignore_event"
USER_FORM_START_DATE = "user_start_date"
USER_META_START_DATE = "start_date_override"
USER_EMERGENCY_INFO_SHARING = "user_emergency_info_dr_sharing"
USER_FORM_BROUGHT_BY = "user_brought_by"
USER_META_BROUGHT_BY = "brought_by"
USER_FORM_F3_NAME_ORIGIN = "user_f3_name_origin"
USER_META_F3_NAME_ORIGIN = "f3_name_origin"
USER_FORM_F3_WHY = "user_f3_why"
USER_META_F3_WHY = "my_f3_why"


def build_user_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form = copy.deepcopy(FORM)

    slack_user: SlackUser = get_user(
        safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger
    )
    user = DbManager.get(User, slack_user.user_id, joinedloads=[User.home_region_org])

    initial_values = {
        USER_FORM_USERNAME: user.f3_name,
        USER_FORM_EMERGENCY_CONTACT: user.emergency_contact,
        USER_FORM_EMERGENCY_CONTACT_PHONE: user.emergency_phone,
        USER_FORM_EMERGENCY_CONTACT_NOTES: user.emergency_notes,
        USER_FORM_START_DATE: user.meta.get(USER_META_START_DATE) if user.meta else None,
        USER_EMERGENCY_INFO_SHARING: "enabled" if safe_get(user.meta, USER_EMERGENCY_INFO_SHARING) else None,
        USER_FORM_F3_NAME_ORIGIN: safe_get(user.meta, USER_META_F3_NAME_ORIGIN) if user.meta else None,
        USER_FORM_F3_WHY: safe_get(user.meta, USER_META_F3_WHY) if user.meta else None,
    }
    brought_by_id = safe_convert(safe_get(user.meta, USER_META_BROUGHT_BY) if user.meta else None, int)
    if brought_by_id:
        brought_by_user = DbManager.get(User, brought_by_id, joinedloads=[User.home_region_org])
        if brought_by_user:
            display_name = brought_by_user.f3_name
            if brought_by_user.home_region_org:
                display_name += f" ({brought_by_user.home_region_org.name})"
            initial_values[USER_FORM_BROUGHT_BY] = {
                "text": display_name,
                "value": str(brought_by_user.id),
            }
    if user.home_region_id:
        initial_values[USER_FORM_HOME_REGION] = {
            "text": user.home_region_org.name,
            "value": str(user.home_region_id),
        }
    if user.avatar_url:
        initial_values[USER_FORM_IMAGE] = user.avatar_url
    else:
        form.delete_block(USER_FORM_IMAGE)
    form.set_initial_values(initial_values)

    if os.getenv("STATS_URL") is None:
        form.blocks.pop(3)
    else:
        action_block_index = next(i for i, block in enumerate(form.blocks) if isinstance(block, ActionsBlock))
        stats_url = f"{os.getenv('STATS_URL')}/stats/pax/{user.id}"
        form.blocks[action_block_index].elements[0].url = stats_url

    try:
        if safe_get(body, actions.LOADING_ID):
            form.update_modal(
                client=client,
                view_id=safe_get(body, actions.LOADING_ID),
                title_text="User Settings",
                callback_id=USER_FORM_ID,
            )
        else:
            form.post_modal(
                client=client,
                trigger_id=safe_get(body, "trigger_id"),
                title_text="User Settings",
                callback_id=USER_FORM_ID,
                new_or_add="add",
            )
    except Exception as e:
        # try loading again without the image block in case the issue is with loading the user's avatar
        logger.error(f"Error posting user form: {e}, retrying without image block")
        form.delete_block(USER_FORM_IMAGE)
        if safe_get(body, actions.LOADING_ID):
            form.update_modal(
                client=client,
                view_id=safe_get(body, actions.LOADING_ID),
                title_text="User Settings",
                callback_id=USER_FORM_ID,
            )
        else:
            form.post_modal(
                client=client,
                trigger_id=safe_get(body, "trigger_id"),
                title_text="User Settings",
                callback_id=USER_FORM_ID,
                new_or_add="add",
            )


def handle_user_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = FORM.get_selected_values(body)
    slack_user: SlackUser = get_user(
        safe_get(body, "user", "id") or safe_get(body, "user_id"), region_record, client, logger
    )
    if slack_user.user_id:
        user = DbManager.get(User, slack_user.user_id)
        if user:
            metadata = user.meta or {}
            metadata[USER_EMERGENCY_INFO_SHARING] = "enabled" in form_data.get(USER_EMERGENCY_INFO_SHARING, [])
            metadata[USER_META_START_DATE] = safe_get(form_data, USER_FORM_START_DATE)
            metadata[USER_META_BROUGHT_BY] = safe_convert(safe_get(form_data, USER_FORM_BROUGHT_BY), int)
            metadata[USER_META_F3_NAME_ORIGIN] = safe_get(form_data, USER_FORM_F3_NAME_ORIGIN)
            metadata[USER_META_F3_WHY] = safe_get(form_data, USER_FORM_F3_WHY)
            update_fields = {
                User.f3_name: safe_get(form_data, USER_FORM_USERNAME),
                User.home_region_id: safe_get(form_data, USER_FORM_HOME_REGION),
                User.emergency_contact: safe_get(form_data, USER_FORM_EMERGENCY_CONTACT),
                User.emergency_phone: safe_get(form_data, USER_FORM_EMERGENCY_CONTACT_PHONE),
                User.emergency_notes: safe_get(form_data, USER_FORM_EMERGENCY_CONTACT_NOTES),
                User.meta: metadata,
            }

            file = safe_get(form_data, USER_FORM_IMAGE_UPLOAD, 0)
            if file:
                file_list, file_send_list, file_ids, low_rez_file_ids = upload_files_to_storage(
                    [file],
                    client=client,
                    logger=logger,
                    bucket_name="user-avatars",
                    file_name=str(slack_user.user_id),
                    enforce_png=True,
                )
                update_fields[User.avatar_url] = file_list[0]

            DbManager.update_record(User, slack_user.user_id, update_fields)


FORM = BlockView(
    blocks=[
        InputBlock(
            label="Username",
            action=USER_FORM_USERNAME,
            element=PlainTextInputElement(placeholder="Enter your username"),
            optional=False,
            hint="This is the username that will be used to identify globally. Do not include your home region",
        ),
        InputBlock(
            label="Home Region",
            action=USER_FORM_HOME_REGION,
            element=ExternalSelectElement(placeholder="Select a new home region"),
            optional=False,
            hint="This is the region you will be associated with. You can change this at any time.",
        ),
        ImageBlock(action=USER_FORM_IMAGE, image_url="https://example.com/image.png", alt_text="User Image"),
        ContextBlock(
            element=ContextElement(
                initial_value="This avatar is used in the Nation dashboard and can be different from your Slack avatar."
            )
        ),
        InputBlock(
            label="New Profile Picture",
            action=USER_FORM_IMAGE_UPLOAD,
            element=FileInputElement(
                max_files=1,
                filetypes=[
                    "png",
                    "jpg",
                    "heic",
                    "bmp",
                ],
            ),
            optional=True,
        ),
        DividerBlock(),
        InputBlock(
            label="Start Date Override",
            action=USER_FORM_START_DATE,
            element=DatepickerElement(placeholder="Select your start date"),
            optional=True,
            hint="This only needs to be filled if you need to override your official start date for any reason.",
        ),
        InputBlock(
            label="Who brought you to F3?",
            action=USER_FORM_BROUGHT_BY,
            element=ExternalSelectElement(placeholder="Type to search..."),
            optional=True,
            hint="Select the PAX who introduced you to F3. To filter by home region, include the region in parentheses after their name, e.g. 'money (wash)' -> Moneyball (WashMo).",  # noqa: E501
        ),
        ActionsBlock(
            elements=[
                ButtonElement(
                    label=":bar_chart: My Stats :link:",
                    url=os.getenv("STATS_URL"),
                    action=IGNORE_EVENT,
                ),
            ]
        ),
        DividerBlock(),
        HeaderBlock(label="Emergency Contact Information"),
        InputBlock(
            label="Enable Downrange Access?",
            action=USER_EMERGENCY_INFO_SHARING,
            element=CheckboxInputElement(
                options=as_selector_options(
                    names=["Enable"],
                    values=["enabled"],
                )
            ),
            optional=True,
            hint="If enabled, users can search for your info from other Slack workspaces.",
        ),
        InputBlock(
            label="Emergency Contact",
            action=USER_FORM_EMERGENCY_CONTACT,
            element=PlainTextInputElement(placeholder="Enter an emergency contact name"),
            optional=True,
        ),
        InputBlock(
            label="Emergency Contact Phone",
            action=USER_FORM_EMERGENCY_CONTACT_PHONE,
            element=PlainTextInputElement(placeholder="Enter an emergency contact phone number"),
            optional=True,
        ),
        InputBlock(
            label="Emergency Contact Notes",
            action=USER_FORM_EMERGENCY_CONTACT_NOTES,
            element=PlainTextInputElement(
                placeholder="Enter any notes in case of an emergency (e.g., allergies, medical conditions)",
                multiline=True,
            ),
            optional=True,
        ),
        DividerBlock(),
        InputBlock(
            label="What is the origin of your F3 name?",
            action=USER_FORM_F3_NAME_ORIGIN,
            element=PlainTextInputElement(
                placeholder="Tell us the story behind your F3 name...",
                multiline=True,
            ),
            optional=True,
        ),
        InputBlock(
            label="What is your why?",
            action=USER_FORM_F3_WHY,
            element=PlainTextInputElement(
                placeholder="Share what drives you to post in the gloom...",
                multiline=True,
            ),
            optional=True,
        ),
    ]
)
