import copy
from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    safe_get,
    update_local_region_records,
)
from utilities.slack import actions, forms
from utilities.slack import orm as slack_orm


def build_custom_field_menu(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id: str = None,
) -> None:
    """Iterates through the custom fields and builds a menu to enable/disable and add/edit/delete them.

    Args:
        client (WebClient): Slack webclient
        region_record (Region): Region record
        trigger_id (str): The event's trigger id
        callback_id (str): The event's callback id
    """
    trigger_id = safe_get(body, "trigger_id")

    blocks = []
    custom_fields = region_record.custom_fields or {}
    # if region_record.custom_fields is None:
    #     custom_fields = {
    #         "Event Type": {
    #             "name": "Event Type",
    #             "type": "Dropdown",
    #             "options": ["Bootcamp", "QSource", "Rucking", "2nd F"],
    #             "enabled": False,
    #         }
    #     }
    #     region_record.custom_fields = custom_fields
    #     DbManager.update_records(
    #         cls=SlackSpace,
    #         filters=[SlackSpace.team_id == region_record.team_id],
    #         fields={SlackSpace.settings: region_record.__dict__},
    #     )
    #     update_local_region_records()

    for custom_field in custom_fields.values():
        label = f"Name: {custom_field['name']}\nType: {custom_field['type']}"
        if custom_field["type"] == "Dropdown":
            label += f"\nOptions: {', '.join(custom_field['options'])}"

        blocks.extend(
            [
                slack_orm.InputBlock(
                    element=slack_orm.RadioButtonsElement(
                        options=slack_orm.as_selector_options(
                            names=["Enabled", "Disabled"],
                            values=["enable", "disable"],
                        ),
                        initial_value="enable" if custom_field["enabled"] else "disable",
                    ),
                    action=f"{actions.CUSTOM_FIELD_ENABLE}_{custom_field['name']}",
                    label=label,
                    optional=False,
                ),
                slack_orm.ActionsBlock(
                    elements=[
                        slack_orm.ButtonElement(
                            label="Edit field",
                            action=actions.CUSTOM_FIELD_EDIT,
                            value=custom_field["name"],
                        ),
                        slack_orm.ButtonElement(
                            label="Delete field",
                            action=actions.CUSTOM_FIELD_DELETE,
                            value=custom_field["name"],
                        ),
                    ],
                ),
                slack_orm.DividerBlock(),
            ]
        )

    blocks.append(
        slack_orm.ActionsBlock(
            elements=[
                slack_orm.ButtonElement(
                    label="New custom field",
                    action=actions.CUSTOM_FIELD_ADD,
                ),
            ],
        )
    )
    view = slack_orm.BlockView(blocks=blocks)
    if update_view_id:
        view.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.CUSTOM_FIELD_MENU_CALLBACK_ID,
            title_text="Custom Backblast fields",
        )
    else:
        view.post_modal(
            client=client,
            trigger_id=trigger_id,
            callback_id=actions.CUSTOM_FIELD_MENU_CALLBACK_ID,
            title_text="Custom Backblast fields",
            new_or_add="add",
        )


def build_custom_field_add_edit(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
) -> None:
    """Builds a form to add or edit a custom field.

    Args:
        client (WebClient): Slack webclient
        region_record (Region): Region record
        trigger_id (str): The event's trigger id
        callback_id (str): The event's callback id
        custom_field_name (str): The name of the custom field to edit
    """
    trigger_id = safe_get(body, "trigger_id")
    if safe_get(body, "actions", 0, "action_id") == actions.CUSTOM_FIELD_EDIT:
        custom_field_name = safe_get(body, "actions", 0, "value")
    else:
        custom_field_name = None

    custom_field_form = copy.deepcopy(forms.CUSTOM_FIELD_ADD_EDIT_FORM)
    custom_field = safe_get(region_record.custom_fields, custom_field_name or "")

    if custom_field:
        custom_field_form.set_initial_values(
            {
                actions.CUSTOM_FIELD_ADD_NAME: custom_field["name"],
                actions.CUSTOM_FIELD_ADD_TYPE: custom_field["type"],
                actions.CUSTOM_FIELD_ADD_OPTIONS: (
                    ",".join(custom_field["options"]) if custom_field["type"] == "Dropdown" else " "
                ),
            }
        )
        action_text = "Edit"
    else:
        action_text = "Add"

    custom_field_form.post_modal(
        client=client,
        trigger_id=trigger_id,
        callback_id=actions.CUSTOM_FIELD_ADD_CALLBACK_ID,
        title_text=f"{action_text} custom field",
        submit_button_text=f"{action_text} field",
        notify_on_close=True,
        new_or_add="add",
    )


def handle_custom_field_delete(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    trigger_id: str,
):
    custom_fields: dict = region_record.custom_fields or {}
    custom_fields.pop(safe_get(body, "actions", 0, "value"))
    build_custom_field_menu(
        body=body,
        client=client,
        logger=logger,
        context=context,
        region_record=region_record,
        update_view_id=safe_get(body, "view", "id"),
    )


def delete_custom_field(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    custom_field_name = safe_get(body, "actions", 0, "value")
    view_id = safe_get(body, "container", "view_id")

    custom_fields: dict = region_record.custom_fields
    custom_fields.pop(custom_field_name)
    region_record.custom_fields = custom_fields
    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )
    update_local_region_records()
    build_custom_field_menu(body, client, logger, context, region_record, update_view_id=view_id)


def handle_custom_field_add(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    config_data = forms.CUSTOM_FIELD_ADD_EDIT_FORM.get_selected_values(body)

    custom_field_name = safe_get(config_data, actions.CUSTOM_FIELD_ADD_NAME)
    custom_field_type = safe_get(config_data, actions.CUSTOM_FIELD_ADD_TYPE)
    custom_field_options: str = safe_get(config_data, actions.CUSTOM_FIELD_ADD_OPTIONS)
    # trim whitespace from options
    custom_field_options = custom_field_options.strip() if custom_field_options else ""

    custom_fields = region_record.custom_fields or {}
    custom_fields[custom_field_name] = {
        "name": custom_field_name,
        "type": custom_field_type,
        "options": custom_field_options.split(",") if custom_field_options else [],
        "enabled": True,
    }

    if custom_field_type == "Dropdown" and not custom_field_options:
        client.chat_postMessage(
            channel=safe_get(body, "user", "id"),
            text="Please provide a name and options for the custom field.",
        )
        return
    else:
        region_record.custom_fields = custom_fields
        DbManager.update_records(
            cls=SlackSpace,
            filters=[SlackSpace.team_id == region_record.team_id],
            fields={SlackSpace.settings: region_record.__dict__},
        )
        update_local_region_records()

    previous_view_id = safe_get(body, "view", "previous_view_id")
    build_custom_field_menu(body, client, logger, context, region_record, update_view_id=previous_view_id)


def handle_custom_field_menu(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    custom_fields = region_record.custom_fields or {}

    selected_values: dict = safe_get(body, "view", "state", "values")

    for key, value in selected_values.items():
        if key[: len(actions.CUSTOM_FIELD_ENABLE)] == actions.CUSTOM_FIELD_ENABLE:
            custom_fields[key[len(actions.CUSTOM_FIELD_ENABLE) + 1 :]]["enabled"] = (
                value[key]["selected_option"]["value"] == "enable"
            )
    region_record.custom_fields = custom_fields

    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )
    update_local_region_records()
