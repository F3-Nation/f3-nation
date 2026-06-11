import copy
import json
from logging import Logger

import requests
from slack_sdk.models.blocks import ImageBlock, InputBlock, SectionBlock
from slack_sdk.models.blocks.basic_components import ConfirmObject, PlainTextObject
from slack_sdk.models.blocks.block_elements import (
    ChannelSelectElement,
    FileInputElement,
    PlainTextInputElement,
    StaticSelectElement,
)
from slack_sdk.web import WebClient

from application.ao import AoData
from application.ao.service import AoService
from application.location import LocationData
from application.location.service import LocationService
from infrastructure.api_client import get_api_ao_repository, get_api_location_repository
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    MapUpdateData,
    get_location_display_name,
    safe_convert,
    safe_get,
    sort_by_name,
    trigger_map_revalidation,
    upload_files_to_storage,
)
from utilities.slack import actions
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

# ---------------------------------------------------------------------------
# Composition root
# ---------------------------------------------------------------------------


def _build_ao_service() -> AoService:
    """Build the AO service using the production API-backed repository."""
    return AoService(repository=get_api_ao_repository())


def _build_location_service() -> LocationService:
    """Build the location service using the production API-backed repository."""
    return LocationService(repository=get_api_location_repository())


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


class AoViews:
    """Pure Slack UI construction for AOs — no I/O."""

    @staticmethod
    def build_add_ao_modal(locations: list[LocationData]) -> SdkBlockView:
        """Return the add-AO form with dynamic location options populated."""
        form = copy.deepcopy(AO_FORM)
        location_options = as_selector_options(
            names=[get_location_display_name(loc) for loc in locations],
            values=[str(loc.id) for loc in locations],
        )
        if location_block := form.get_block(actions.CALENDAR_ADD_AO_LOCATION):
            location_block.element.options = location_options
        return form

    @staticmethod
    def build_edit_ao_modal(ao: AoData, locations: list[LocationData]) -> SdkBlockView:
        """Return the add-AO form pre-filled with *ao*'s existing data."""
        form = AoViews.build_add_ao_modal(locations)

        slack_id = safe_get(ao.meta, "slack_channel_id") if ao.meta else None
        initial_values: dict = {actions.CALENDAR_ADD_AO_NAME: ao.name}
        if ao.description:
            initial_values[actions.CALENDAR_ADD_AO_DESCRIPTION] = ao.description
        if slack_id:
            initial_values[actions.CALENDAR_ADD_AO_CHANNEL] = slack_id
        form.set_initial_values(initial_values)

        if ao.default_location_id:
            form.set_initial_values({actions.CALENDAR_ADD_AO_LOCATION: str(ao.default_location_id)})

        return form

    @staticmethod
    def build_ao_list_modal(aos: list[AoData]) -> SdkBlockView:
        """Return the list modal showing all AOs with edit/delete controls."""
        if not aos:
            return SdkBlockView(
                blocks=[SectionBlock(text="No AOs found. Please add an AO first.", block_id="ao-notice")]
            )
        blocks = [
            SectionBlock(
                text=a.name,
                block_id=f"{actions.AO_EDIT_DELETE}_{a.id}",
                accessory=StaticSelectElement(
                    placeholder="Edit or Delete",
                    options=as_selector_options(names=["Edit", "Delete"]),
                    confirm=ConfirmObject(
                        title="Are you sure?",
                        text=(
                            "Are you sure you want to edit / delete this AO? "
                            "This cannot be undone. Deleting an AO will also "
                            "delete all associated series and events."
                        ),
                        confirm="Yes, I'm sure",
                        deny="Whups, never mind",
                    ),
                    action_id=f"{actions.AO_EDIT_DELETE}_{a.id}",
                ),
            )
            for a in aos
        ]
        return SdkBlockView(blocks=blocks)


# ---------------------------------------------------------------------------
# Handler functions
# ---------------------------------------------------------------------------


def manage_aos(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action = safe_get(body, "actions", 0, "selected_option", "value")

    if action == "add":
        update_view_id = add_loading_form(body, client, new_or_add="add")
        locations = _build_location_service().get_org_locations(region_record.org_id)
        locations.sort(key=sort_by_name(lambda x: x.name))
        form = AoViews.build_add_ao_modal(locations)
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text="Add an AO",
            callback_id=actions.ADD_AO_CALLBACK_ID,
        )
    elif action == "edit":
        ao_service = _build_ao_service()
        aos = ao_service.get_region_aos(region_record.org_id)
        aos.sort(key=sort_by_name(lambda x: x.name))
        form = AoViews.build_ao_list_modal(aos)
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Edit or Delete an AO",
            callback_id=actions.EDIT_DELETE_AO_CALLBACK_ID,
            submit_button_text="None",
            new_or_add="add",
        )


def handle_ao_add(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = AO_FORM.get_selected_values(body)
    metadata = safe_convert(safe_get(body, "view", "private_metadata"), json.loads) or {}
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    name = safe_get(form_data, actions.CALENDAR_ADD_AO_NAME)
    description = safe_get(form_data, actions.CALENDAR_ADD_AO_DESCRIPTION)
    slack_channel_id = safe_get(form_data, actions.CALENDAR_ADD_AO_CHANNEL)
    default_location_id = safe_get(form_data, actions.CALENDAR_ADD_AO_LOCATION)
    parent_id = region_record.org_id

    ao_service = _build_ao_service()

    if safe_get(metadata, "ao_id"):
        ao_id = metadata["ao_id"]
        ao_service.update_ao(
            ao_id=ao_id,
            parent_id=parent_id,
            name=name,
            description=description,
            slack_channel_id=slack_channel_id,
            default_location_id=default_location_id,
        )
        map_action = "map.updated"
        org_id = ao_id
        action_text = "edited"
    else:
        ao_data = ao_service.create_ao(
            parent_id=parent_id,
            name=name,
            description=description,
            slack_channel_id=slack_channel_id,
            default_location_id=default_location_id,
        )
        map_action = "map.created"
        org_id = ao_data.id
        action_text = "created"

    file = safe_get(form_data, actions.CALENDAR_ADD_AO_LOGO, 0)
    if file:
        file_list, _, _, _ = upload_files_to_storage(
            files=[file],
            logger=logger,
            client=client,
            enforce_square=True,
            max_height=512,
            bucket_name="org-logos",
            file_name=str(org_id),
            enforce_png=True,
        )
        logo_url = safe_get(file_list, 0)
        if logo_url:
            ao_service.update_ao(
                ao_id=org_id,
                parent_id=parent_id,
                name=name,
                description=description,
                slack_channel_id=slack_channel_id,
                default_location_id=default_location_id,
                logo_url=logo_url,
            )

    trigger_map_revalidation(action=map_action, map_update_data=MapUpdateData(orgId=org_id))

    action_text = (
        f":pencil2: AO edited: {name} by <@{slack_user_id or 'app'}>"
        if safe_get(metadata, "ao_id")
        else f":heavy_plus_sign: AO {action_text}: {name} by <@{slack_user_id or 'app'}>"
    )
    post_bot_log(client=client, region_record=region_record, text=action_text, logger=logger)


def build_ao_add_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    edit_ao: AoData = None,
    update_view_id: str = None,
    loading_form: bool = False,
):
    """Build and open/update the add-AO modal.

    Called by ``handle_ao_edit_delete`` when editing an existing AO.
    The ``loading_form`` path pushes a loading placeholder first, then
    replaces it with the real form.
    """
    if loading_form:
        update_view_id = add_loading_form(body, client, new_or_add="add")

    locations = _build_location_service().get_org_locations(region_record.org_id)
    locations.sort(key=sort_by_name(lambda x: x.name))

    if edit_ao:
        form = AoViews.build_edit_ao_modal(edit_ao, locations)
        if edit_ao.logo_url:
            try:
                if requests.head(edit_ao.logo_url).status_code == 200:
                    form.blocks.insert(5, ImageBlock(image_url=edit_ao.logo_url, alt_text="AO Logo"))
            except requests.RequestException as e:
                logger.error(f"Error fetching AO logo: {e}")
        title_text = "Edit AO"
        parent_metadata = {"ao_id": edit_ao.id}
    else:
        form = AoViews.build_add_ao_modal(locations)
        title_text = "Add an AO"
        parent_metadata = {}

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text=title_text,
            callback_id=actions.ADD_AO_CALLBACK_ID,
            parent_metadata=parent_metadata,
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text=title_text,
            callback_id=actions.ADD_AO_CALLBACK_ID,
            new_or_add="add",
            parent_metadata=parent_metadata,
        )


def handle_ao_edit_delete(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action_id: str = safe_get(body, "actions", 0, "action_id") or ""
    ao_id = safe_convert(action_id.split("_")[1] if "_" in action_id else None, int)
    action = safe_get(body, "actions", 0, "selected_option", "value")
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    ao_service = _build_ao_service()

    if action == "Edit" and ao_id is not None:
        ao = ao_service.get_ao_by_id(ao_id)
        if ao:
            build_ao_add_form(body, client, logger, context, region_record, edit_ao=ao, loading_form=True)
    elif action == "Delete" and ao_id is not None:
        ao = ao_service.get_ao_by_id(ao_id)
        ao_service.delete_ao(ao_id)
        trigger_map_revalidation(action="map.deleted", map_update_data=MapUpdateData(orgId=ao_id))
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":wastebasket: AO deleted: {ao.name if ao else ao_id} by <@{slack_user_id}>",
            logger=logger,
        )


# ---------------------------------------------------------------------------
# Form template (module-level, deepcopied before use)
# ---------------------------------------------------------------------------

AO_FORM = SdkBlockView(
    blocks=[
        InputBlock(
            label=PlainTextObject(text="AO Title"),
            block_id=actions.CALENDAR_ADD_AO_NAME,
            element=PlainTextInputElement(
                action_id=actions.CALENDAR_ADD_AO_NAME,
                placeholder=PlainTextObject(text="Enter the AO name"),
            ),
            optional=False,
        ),
        InputBlock(
            label=PlainTextObject(text="Description"),
            block_id=actions.CALENDAR_ADD_AO_DESCRIPTION,
            element=PlainTextInputElement(
                action_id=actions.CALENDAR_ADD_AO_DESCRIPTION,
                placeholder=PlainTextObject(text="Enter a description for the AO"),
                multiline=True,
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Channel associated with this AO:"),
            block_id=actions.CALENDAR_ADD_AO_CHANNEL,
            element=ChannelSelectElement(
                action_id=actions.CALENDAR_ADD_AO_CHANNEL,
                placeholder=PlainTextObject(text="Select a channel"),
            ),
            optional=False,
        ),
        InputBlock(
            label=PlainTextObject(text="Default Location"),
            block_id=actions.CALENDAR_ADD_AO_LOCATION,
            element=StaticSelectElement(
                action_id=actions.CALENDAR_ADD_AO_LOCATION,
                placeholder=PlainTextObject(text="Select a location"),
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="AO Logo"),
            block_id=actions.CALENDAR_ADD_AO_LOGO,
            element=FileInputElement(
                action_id=actions.CALENDAR_ADD_AO_LOGO,
                max_files=1,
                filetypes=["png", "jpg", "heic", "bmp"],
            ),
            optional=True,
        ),
    ]
)
