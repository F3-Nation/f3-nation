import copy
import json
from logging import Logger

from slack_sdk.models.blocks import InputBlock, SectionBlock
from slack_sdk.models.blocks.basic_components import PlainTextObject
from slack_sdk.models.blocks.block_elements import NumberInputElement, PlainTextInputElement, StaticSelectElement
from slack_sdk.web import WebClient

from application.location import LocationData
from application.location.service import LocationService
from infrastructure.api_client import get_api_location_repository
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    MapUpdateData,
    get_location_display_name,
    safe_convert,
    safe_get,
    trigger_map_revalidation,
)
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

# ---------------------------------------------------------------------------
# Action / callback ID constants (feature-local)
# ---------------------------------------------------------------------------
CALENDAR_MANAGE_LOCATIONS = "calendar-manage-locations"
CALENDAR_ADD_AO_NEW_LOCATION = "calendar-add-ao-new-location"
LOCATION_EDIT_DELETE = "location-edit-delete"
ADD_LOCATION_CALLBACK_ID = "add-location-id"
EDIT_DELETE_LOCATION_CALLBACK_ID = "edit-delete-location-id"
_LOCATION_NOTICE = "location-notice"

# Form field IDs
_LOCATION_NAME = "calendar_add_location_name"
_LOCATION_DESCRIPTION = "calendar_add_location_description"
_LOCATION_LAT = "calendar_add_location_lat"
_LOCATION_LON = "calendar_add_location_lon"
_LOCATION_STREET = "calendar-add-location-street"
_LOCATION_STREET2 = "calendar-add-location-street2"
_LOCATION_CITY = "calendar-add-location-city"
_LOCATION_STATE = "calendar-add-location-state"
_LOCATION_ZIP = "calendar-add-location-zip"
_LOCATION_COUNTRY = "calendar-add-location-country"

# ---------------------------------------------------------------------------
# Composition root
# ---------------------------------------------------------------------------


def _build_location_service() -> LocationService:
    """Build the location service using the production API-backed repository."""
    return LocationService(repository=get_api_location_repository())


# ---------------------------------------------------------------------------
# Form template (module-level, deepcopied before use)
# ---------------------------------------------------------------------------

LOCATION_FORM = SdkBlockView(
    blocks=[
        InputBlock(
            label=PlainTextObject(text="Location Name"),
            block_id=_LOCATION_NAME,
            element=PlainTextInputElement(
                action_id=_LOCATION_NAME,
                placeholder=PlainTextObject(text="ie Central Park - Main Entrance"),
            ),
            optional=False,
            hint=PlainTextObject(
                text="Use the actual name of the location, ie park name, etc. "
                "You will define the F3 AO name when you create AOs."
            ),
        ),
        InputBlock(
            label=PlainTextObject(text="Description"),
            block_id=_LOCATION_DESCRIPTION,
            element=PlainTextInputElement(
                action_id=_LOCATION_DESCRIPTION,
                placeholder=PlainTextObject(
                    text="Notes about the meetup spot, ie 'Meet at the flagpole near the entrance'"
                ),
                multiline=True,
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Latitude"),
            block_id=_LOCATION_LAT,
            element=NumberInputElement(
                action_id=_LOCATION_LAT,
                placeholder=PlainTextObject(text="ie 34.0522"),
                min_value="-90",
                max_value="90",
                is_decimal_allowed=True,
            ),
            optional=False,
        ),
        InputBlock(
            label=PlainTextObject(text="Longitude"),
            block_id=_LOCATION_LON,
            element=NumberInputElement(
                action_id=_LOCATION_LON,
                placeholder=PlainTextObject(text="ie -118.2437"),
                min_value="-180",
                max_value="180",
                is_decimal_allowed=True,
            ),
            optional=False,
        ),
        InputBlock(
            label=PlainTextObject(text="Location Street Address"),
            block_id=_LOCATION_STREET,
            element=PlainTextInputElement(
                action_id=_LOCATION_STREET,
                placeholder=PlainTextObject(text="ie 123 Main St."),
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Location Address Line 2"),
            block_id=_LOCATION_STREET2,
            element=PlainTextInputElement(
                action_id=_LOCATION_STREET2,
                placeholder=PlainTextObject(text="ie Suite 200"),
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Location City"),
            block_id=_LOCATION_CITY,
            element=PlainTextInputElement(
                action_id=_LOCATION_CITY,
                placeholder=PlainTextObject(text="ie Los Angeles"),
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Location State"),
            block_id=_LOCATION_STATE,
            element=PlainTextInputElement(
                action_id=_LOCATION_STATE,
                placeholder=PlainTextObject(text="ie CA"),
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Location Zip"),
            block_id=_LOCATION_ZIP,
            element=PlainTextInputElement(
                action_id=_LOCATION_ZIP,
                placeholder=PlainTextObject(text="ie 90210"),
            ),
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Location Country"),
            block_id=_LOCATION_COUNTRY,
            element=PlainTextInputElement(
                action_id=_LOCATION_COUNTRY,
                placeholder=PlainTextObject(text="ie USA"),
            ),
            optional=True,
            hint=PlainTextObject(text="If outside the US, please enter the country name."),
        ),
    ]
)


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


class LocationViews:
    """Pure Slack UI construction for locations — no I/O."""

    @staticmethod
    def build_add_modal() -> SdkBlockView:
        """Return a blank add-location form."""
        return copy.deepcopy(LOCATION_FORM)

    @staticmethod
    def build_edit_modal(location: LocationData) -> SdkBlockView:
        """Return the add-location form pre-filled with *location*'s data."""
        form = copy.deepcopy(LOCATION_FORM)
        initial: dict = {_LOCATION_NAME: location.name}
        if location.description:
            initial[_LOCATION_DESCRIPTION] = location.description
        if location.latitude is not None:
            initial[_LOCATION_LAT] = location.latitude
        if location.longitude is not None:
            initial[_LOCATION_LON] = location.longitude
        if location.address_street:
            initial[_LOCATION_STREET] = location.address_street
        if location.address_street2:
            initial[_LOCATION_STREET2] = location.address_street2
        if location.address_city:
            initial[_LOCATION_CITY] = location.address_city
        if location.address_state:
            initial[_LOCATION_STATE] = location.address_state
        if location.address_zip:
            initial[_LOCATION_ZIP] = location.address_zip
        if location.address_country:
            initial[_LOCATION_COUNTRY] = location.address_country
        form.set_initial_values(initial)
        return form

    @staticmethod
    def build_list_modal(locations: list[LocationData], notice_text: str | None = None) -> SdkBlockView:
        """Return a modal listing locations with edit/delete controls."""
        blocks = []
        if len(locations) == 0:
            notice_text = "No locations found. Please add a location to create AOs with a meetup spot."

        if notice_text:
            blocks.append(
                SectionBlock(
                    text=PlainTextObject(text=notice_text),
                    block_id=_LOCATION_NOTICE,
                )
            )
        blocks.extend(
            [
                SectionBlock(
                    text=PlainTextObject(text=get_location_display_name(loc)),
                    block_id=f"{LOCATION_EDIT_DELETE}_{loc.id}",
                    accessory=StaticSelectElement(
                        placeholder="Edit or Delete",
                        options=as_selector_options(names=["Edit", "Delete"]),
                        action_id=f"{LOCATION_EDIT_DELETE}_{loc.id}",
                    ),
                )
                for loc in locations
            ]
        )
        return SdkBlockView(blocks=blocks)


# ---------------------------------------------------------------------------
# Handler functions
# ---------------------------------------------------------------------------


def manage_locations(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action = safe_get(body, "actions", 0, "selected_option", "value")

    if action == "add":
        build_location_add_form(body, client, logger, context, region_record, loading_form=True)
    elif action == "edit":
        _build_location_list_form(body, client, logger, context, region_record)


def build_location_add_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    edit_location: LocationData | None = None,
    loading_form: bool = False,
    update_view_id: str | None = None,
):
    """Build and display the add/edit location modal.

    This function is also registered directly as an action handler in routing.py
    for the CALENDAR_ADD_AO_NEW_LOCATION action (opening a location form from
    within the AO creation flow).
    """
    if loading_form and not update_view_id:
        update_view_id = add_loading_form(body, client, new_or_add="add")

    action_id = safe_get(body, "actions", 0, "action_id")
    views = LocationViews()

    if edit_location:
        form = views.build_edit_modal(edit_location)
        title_text = "Edit Location"
    else:
        form = views.build_add_modal()
        title_text = "Add a Location"

    # Build private_metadata to carry context back to the submit handler.
    parent_metadata: dict = {}
    if action_id == CALENDAR_ADD_AO_NEW_LOCATION:
        from features.calendar import ao

        parent_metadata["update_view_id"] = safe_get(body, "view", "id")
        form_data = ao.AO_FORM.get_selected_values(body)
        parent_metadata.update(form_data)
    if edit_location:
        parent_metadata["location_id"] = edit_location.id

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text=title_text,
            callback_id=ADD_LOCATION_CALLBACK_ID,
            parent_metadata=parent_metadata,
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text=title_text,
            callback_id=ADD_LOCATION_CALLBACK_ID,
            new_or_add="add",
            parent_metadata=parent_metadata,
        )


def handle_location_add(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = LOCATION_FORM.get_selected_values(body)
    metadata = safe_convert(safe_get(body, "view", "private_metadata"), json.loads)
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    latitude = safe_convert(safe_get(form_data, _LOCATION_LAT), float)
    longitude = safe_convert(safe_get(form_data, _LOCATION_LON), float)

    service = _build_location_service()

    location_id = safe_get(metadata, "location_id")
    if location_id:
        service.update_location(
            location_id=int(location_id),
            name=safe_get(form_data, _LOCATION_NAME),
            org_id=region_record.org_id,
            description=safe_get(form_data, _LOCATION_DESCRIPTION),
            latitude=latitude,
            longitude=longitude,
            address_street=safe_get(form_data, _LOCATION_STREET),
            address_street2=safe_get(form_data, _LOCATION_STREET2),
            address_city=safe_get(form_data, _LOCATION_CITY),
            address_state=safe_get(form_data, _LOCATION_STATE),
            address_zip=safe_get(form_data, _LOCATION_ZIP),
            address_country=safe_get(form_data, _LOCATION_COUNTRY),
        )
        trigger_map_revalidation(action="map.updated", map_update_data=MapUpdateData(locationId=int(location_id)))
        created_location_id = int(location_id)
    else:
        new_location = service.create_location(
            name=safe_get(form_data, _LOCATION_NAME),
            org_id=region_record.org_id,
            description=safe_get(form_data, _LOCATION_DESCRIPTION),
            latitude=latitude,
            longitude=longitude,
            address_street=safe_get(form_data, _LOCATION_STREET),
            address_street2=safe_get(form_data, _LOCATION_STREET2),
            address_city=safe_get(form_data, _LOCATION_CITY),
            address_state=safe_get(form_data, _LOCATION_STATE),
            address_zip=safe_get(form_data, _LOCATION_ZIP),
            address_country=safe_get(form_data, _LOCATION_COUNTRY),
        )
        trigger_map_revalidation(action="map.created", map_update_data=MapUpdateData(locationId=new_location.id))
        created_location_id = new_location.id

    if safe_get(metadata, "update_view_id"):
        from features.calendar import ao
        from utilities.slack import actions as slack_actions

        update_metadata = {
            slack_actions.CALENDAR_ADD_AO_NAME: safe_get(metadata, slack_actions.CALENDAR_ADD_AO_NAME),
            slack_actions.CALENDAR_ADD_AO_DESCRIPTION: safe_get(metadata, slack_actions.CALENDAR_ADD_AO_DESCRIPTION),
            slack_actions.CALENDAR_ADD_AO_CHANNEL: safe_get(metadata, slack_actions.CALENDAR_ADD_AO_CHANNEL),
            slack_actions.CALENDAR_ADD_AO_LOCATION: str(created_location_id),
            slack_actions.CALENDAR_ADD_AO_TYPE: safe_get(metadata, slack_actions.CALENDAR_ADD_AO_TYPE),
        }
        ao.build_ao_add_form(
            body,
            client,
            logger,
            context,
            region_record,
            update_view_id=metadata["update_view_id"],
            update_metadata=update_metadata,
        )

    action_text = (
        f":pencil2: Location edited: {safe_get(form_data, _LOCATION_NAME)} by <@{slack_user_id or 'app'}>"
        if location_id
        else f":heavy_plus_sign: Location created: {safe_get(form_data, _LOCATION_NAME)} by <@{slack_user_id or 'app'}>"
    )
    post_bot_log(client=client, region_record=region_record, text=action_text, logger=logger)


def handle_location_edit_delete(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    action_id = safe_get(body, "actions", 0, "action_id") or ""
    location_id = safe_convert(action_id.split("_")[1] if "_" in action_id else None, int)
    action = safe_get(body, "actions", 0, "selected_option", "value")
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    if action not in ("Edit", "Delete") or location_id is None:
        return

    service = _build_location_service()

    if action == "Edit":
        location = service.get_location_by_id(location_id)
        if location is None:
            return
        build_location_add_form(
            body,
            client,
            logger,
            context,
            region_record,
            edit_location=location,
            loading_form=True,
        )
    elif action == "Delete":
        locations = service.get_org_locations(region_record.org_id)
        deleted_name = next((get_location_display_name(loc) for loc in locations if loc.id == location_id), "selected")
        service.delete_location(location_id)
        trigger_map_revalidation(action="map.deleted", map_update_data=MapUpdateData(locationId=location_id))
        remaining = [loc for loc in locations if loc.id != location_id]
        remaining.sort(key=lambda loc: get_location_display_name(loc).lower())
        views = LocationViews()
        form = views.build_list_modal(remaining, notice_text=f"The {deleted_name} location has been deleted.")
        form.update_modal(
            client=client,
            view_id=safe_get(body, "view", "id"),
            title_text="Edit/Delete a Location",
            callback_id=EDIT_DELETE_LOCATION_CALLBACK_ID,
            submit_button_text="None",
        )
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":wastebasket: Location deleted: {deleted_name} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )


def _build_location_list_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    service = _build_location_service()
    locations = service.get_org_locations(region_record.org_id)
    locations.sort(key=lambda loc: get_location_display_name(loc).lower())

    views = LocationViews()
    form = views.build_list_modal(locations)
    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        title_text="Edit/Delete a Location",
        callback_id=EDIT_DELETE_LOCATION_CALLBACK_ID,
        submit_button_text="None",
        new_or_add="add",
    )
