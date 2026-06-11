import copy
from datetime import datetime, timedelta
from logging import Logger

from f3_data_models.models import Attendance, Attendance_x_AttendanceType
from f3_data_models.utils import DbManager
from slack_sdk.web import WebClient

from application.ao.service import AoService
from application.event_instance import EventInstanceData
from application.event_instance.service import EventInstanceService
from application.event_tag.service import EventTagService
from application.event_type.service import EventTypeService
from application.location.service import LocationService
from features.calendar import event_preblast
from infrastructure.api_client import (
    get_api_ao_repository,
    get_api_event_instance_repository,
    get_api_event_tag_repository,
    get_api_event_type_repository,
    get_api_location_repository,
)
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    _parse_view_private_metadata,
    current_date_cst,
    get_location_display_name,
    get_user,
    parse_rich_block,
    replace_user_channel_ids,
    safe_convert,
    safe_get,
)
from utilities.slack import actions, orm

# ---------------------------------------------------------------------------
# Action / callback ID constants (feature-local)
# ---------------------------------------------------------------------------
CALENDAR_ADD_EVENT_INSTANCE_PREBLAST = "calendar_add_event_instance_preblast"
CALENDAR_ADD_EVENT_INSTANCE_AO = "calendar_add_event_instance_ao"
CALENDAR_ADD_EVENT_INSTANCE_LOCATION = "calendar_add_event_instance_location"
CALENDAR_ADD_EVENT_INSTANCE_TYPE = "calendar_add_event_instance_type"
CALENDAR_ADD_EVENT_INSTANCE_TAG = "calendar_add_event_instance_tag"
CALENDAR_ADD_EVENT_INSTANCE_START_DATE = "calendar_add_event_instance_start_date"
CALENDAR_ADD_EVENT_INSTANCE_END_DATE = "calendar_add_event_instance_end_date"
CALENDAR_ADD_EVENT_INSTANCE_START_TIME = "calendar_add_event_instance_start_time"
CALENDAR_ADD_EVENT_INSTANCE_END_TIME = "calendar_add_event_instance_end_time"
CALENDAR_ADD_EVENT_INSTANCE_NAME = "calendar_add_event_instance_name"
CALENDAR_ADD_EVENT_INSTANCE_HIGHLIGHT = "calendar_add_event_instance_highlight"
CALENDAR_ADD_EVENT_INSTANCE_DOW = "calendar_add_event_instance_dow"
CALENDAR_ADD_EVENT_AO = "calendar_add_event_ao"
CALENDAR_ADD_EVENT_INSTANCE_FREQUENCY = "calendar_add_event_instance_frequency"
CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION = "calendar_add_event_instance_description"
CALENDAR_ADD_EVENT_INSTANCE_OPTIONS = "calendar_add_event_instance_options"
ADD_EVENT_INSTANCE_CALLBACK_ID = "add_event_instance_callback_id"
CALENDAR_MANAGE_EVENT_INSTANCE = "calendar_manage_event_instance"
EDIT_DELETE_EVENT_INSTANCE_CALLBACK_ID = "edit_delete_event_instance_callback_id"
CALENDAR_MANAGE_EVENT_INSTANCE_AO = "calendar_manage_event_instance_ao"
CALENDAR_MANAGE_EVENT_INSTANCE_DATE = "calendar_manage_event_instance_date"
EVENT_CLOSE_REASON = "event_close_reason"
EVENT_CLOSE_CALLBACK_ID = "event_close_callback_id"

META_DO_NOT_SEND_AUTO_PREBLASTS = "do_not_send_auto_preblasts"
META_EXCLUDE_FROM_PAX_VAULT = "exclude_from_pax_vault"


# ---------------------------------------------------------------------------
# Composition root
# ---------------------------------------------------------------------------


def _build_event_instance_service() -> EventInstanceService:
    """Build the event-instance service using the production API-backed repository."""
    return EventInstanceService(repository=get_api_event_instance_repository())


def _build_ao_service() -> AoService:
    return AoService(repository=get_api_ao_repository())


def _build_location_service() -> LocationService:
    return LocationService(repository=get_api_location_repository())


def _build_event_type_service() -> EventTypeService:
    return EventTypeService(repository=get_api_event_type_repository())


def _build_event_tag_service() -> EventTagService:
    return EventTagService(repository=get_api_event_tag_repository())


# ---------------------------------------------------------------------------
# Handlers
# ---------------------------------------------------------------------------


def manage_event_instances(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action = safe_get(body, "actions", 0, "selected_option", "value")

    if action == "add":
        build_event_instance_add_form(body, client, logger, context, region_record, loading_form=True)
    elif action == "edit":
        build_event_instance_list_form(body, client, logger, context, region_record, loading_form=True)


def build_event_instance_add_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    edit_event_instance: EventInstanceData | None = None,
    new_preblast: bool = False,
    loading_form: bool = False,
):
    parent_metadata = (
        {"event_instance_id": edit_event_instance.id} if edit_event_instance else _parse_view_private_metadata(body)
    )
    view_metadata = _parse_view_private_metadata(body)

    if loading_form:
        update_view_id = add_loading_form(body, client, new_or_add="add")
    else:
        update_view_id = None

    title_text = "Add an Event"
    form = copy.deepcopy(INSTANCE_FORM)
    if new_preblast or (safe_get(view_metadata, "is_preblast") == "True"):
        # Add a preblast block if this is a new event
        form.blocks.insert(
            -1,
            orm.InputBlock(
                label="Preblast",
                action=CALENDAR_ADD_EVENT_INSTANCE_PREBLAST,
                element=orm.RichTextInputElement(placeholder="Give us an event preview!"),
                optional=False,
            ),
        )
        parent_metadata.update({"is_preblast": "True"})

    ao_service = _build_ao_service()
    location_service = _build_location_service()
    event_type_service = _build_event_type_service()
    event_tag_service = _build_event_tag_service()

    aos = ao_service.get_region_aos(region_record.org_id)
    locations = location_service.get_org_locations(region_record.org_id)
    event_types = event_type_service.get_all_event_types_for_org(region_record.org_id)
    event_tags = event_tag_service.get_all_tags_for_org(region_record.org_id)

    form.set_options(
        {
            CALENDAR_ADD_EVENT_INSTANCE_AO: orm.as_selector_options(
                names=[ao.name for ao in aos],
                values=[str(ao.id) for ao in aos],
            ),
            CALENDAR_ADD_EVENT_INSTANCE_LOCATION: orm.as_selector_options(
                names=[get_location_display_name(loc) for loc in locations],
                values=[str(loc.id) for loc in locations],
            ),
            CALENDAR_ADD_EVENT_INSTANCE_TYPE: orm.as_selector_options(
                names=[et.name for et in event_types],
                values=[str(et.id) for et in event_types],
            ),
            CALENDAR_ADD_EVENT_INSTANCE_TAG: orm.as_selector_options(
                names=[tag.name for tag in event_tags],
                values=[str(tag.id) for tag in event_tags],
            ),
        }
    )

    initial_values = {}

    if edit_event_instance:
        initial_values = {
            CALENDAR_ADD_EVENT_INSTANCE_NAME: edit_event_instance.name,
            CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION: edit_event_instance.description,
            CALENDAR_ADD_EVENT_INSTANCE_AO: str(edit_event_instance.org_id),
            CALENDAR_ADD_EVENT_INSTANCE_LOCATION: safe_convert(edit_event_instance.location_id, str),
            CALENDAR_ADD_EVENT_INSTANCE_TYPE: str(edit_event_instance.event_type_ids[0])
            if edit_event_instance.event_type_ids
            else None,  # TODO: handle multiple event types
            CALENDAR_ADD_EVENT_INSTANCE_START_DATE: safe_convert(
                edit_event_instance.start_date, datetime.strftime, ["%Y-%m-%d"]
            ),
            CALENDAR_ADD_EVENT_INSTANCE_START_TIME: safe_convert(
                edit_event_instance.start_time, lambda t: t[:2] + ":" + t[2:]
            ),
            CALENDAR_ADD_EVENT_INSTANCE_END_TIME: safe_convert(
                edit_event_instance.end_time, lambda t: t[:2] + ":" + t[2:]
            ),
        }

        options = []
        if edit_event_instance.is_private:
            options.append("private")
        if safe_get(edit_event_instance.meta, META_EXCLUDE_FROM_PAX_VAULT):
            options.append("exclude_from_pax_vault")
        if safe_get(edit_event_instance.meta, META_DO_NOT_SEND_AUTO_PREBLASTS):
            options.append("no_auto_preblasts")
        if edit_event_instance.highlight:
            options.append("highlight")
        if options:
            initial_values[CALENDAR_ADD_EVENT_INSTANCE_OPTIONS] = options
        if edit_event_instance.event_tag_ids:
            initial_values[CALENDAR_ADD_EVENT_INSTANCE_TAG] = [
                str(edit_event_instance.event_tag_ids[0])
            ]  # TODO: handle multiple event tags

    # This is triggered when the AO is selected — defaults are loaded for the location
    action_id = safe_get(body, "actions", 0, "action_id")
    if action_id == CALENDAR_ADD_EVENT_INSTANCE_AO:
        form_data = INSTANCE_FORM.get_selected_values(body)
        ao_id = safe_convert(safe_get(form_data, action_id), int)
        if ao_id:
            ao = ao_service.get_ao_by_id(ao_id)
            if ao and ao.default_location_id:
                initial_values[CALENDAR_ADD_EVENT_INSTANCE_LOCATION] = str(ao.default_location_id)

        form.set_initial_values(initial_values)
        form.update_modal(
            client=client,
            view_id=safe_get(body, "view", "id"),
            callback_id=ADD_EVENT_INSTANCE_CALLBACK_ID,
            title_text=title_text,
            parent_metadata=parent_metadata,
        )
    elif update_view_id:
        form.set_initial_values(initial_values)
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=ADD_EVENT_INSTANCE_CALLBACK_ID,
            title_text=title_text,
            parent_metadata=parent_metadata,
        )
    else:
        form.set_initial_values(initial_values)
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text=title_text,
            callback_id=ADD_EVENT_INSTANCE_CALLBACK_ID,
            new_or_add="add",
            parent_metadata=parent_metadata,
        )


def handle_event_instance_add(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    metadata = _parse_view_private_metadata(body)
    form = copy.deepcopy(INSTANCE_FORM)
    if safe_get(metadata, "is_preblast") == "True":
        form.blocks.insert(
            -1,
            orm.InputBlock(
                label="Preblast",
                action=CALENDAR_ADD_EVENT_INSTANCE_PREBLAST,
                element=orm.RichTextInputElement(placeholder="Give us an event preview!"),
                optional=False,
            ),
        )
    form_data = form.get_selected_values(body)
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    selected_options = safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_OPTIONS) or []
    is_private = "private" in selected_options
    exclude_from_pax_vault = "exclude_from_pax_vault" in selected_options
    do_not_send_auto_preblasts = "no_auto_preblasts" in selected_options
    highlight = "highlight" in selected_options

    # Build / merge meta dict
    service = _build_event_instance_service()
    if safe_get(metadata, "event_instance_id"):
        existing = service.get_by_id(int(metadata["event_instance_id"]))
        merged_meta = dict(safe_get(existing, "meta") or {}) if existing else {}
    else:
        merged_meta = {}

    if exclude_from_pax_vault:
        merged_meta[META_EXCLUDE_FROM_PAX_VAULT] = True
    else:
        merged_meta.pop(META_EXCLUDE_FROM_PAX_VAULT, None)
    if do_not_send_auto_preblasts:
        merged_meta[META_DO_NOT_SEND_AUTO_PREBLASTS] = True
    else:
        merged_meta.pop(META_DO_NOT_SEND_AUTO_PREBLASTS, None)

    # Resolve end time
    if safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_END_TIME):
        end_time: str = safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_END_TIME).replace(":", "")
    else:
        end_time = (
            datetime.strptime(safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_START_TIME), "%H:%M") + timedelta(hours=1)
        ).strftime("%H%M")

    # Slack won't return the selection for location and event type after being defaulted
    view_blocks = safe_get(body, "view", "blocks")
    location_block = [block for block in view_blocks if block["block_id"] == CALENDAR_ADD_EVENT_INSTANCE_LOCATION][0]
    location_initial_value = safe_get(location_block, "element", "initial_option", "value")
    location_id = form_data.get(CALENDAR_ADD_EVENT_INSTANCE_LOCATION) or location_initial_value
    event_type_block = [block for block in view_blocks if block["block_id"] == CALENDAR_ADD_EVENT_INSTANCE_TYPE][0]
    event_type_initial_value = safe_get(event_type_block, "element", "initial_option", "value")
    event_type_id = form_data.get(CALENDAR_ADD_EVENT_INSTANCE_TYPE) or event_type_initial_value

    # Apply int conversion to all values if not null
    location_id = safe_convert(location_id, int)
    event_type_id = safe_convert(event_type_id, int)
    org_id = (
        safe_convert(
            safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_AO) or safe_get(form_data, CALENDAR_ADD_EVENT_AO),
            int,
        )
        or region_record.org_id
    )
    event_tag_id = safe_convert(safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_TAG, 0), int)
    event_tag_ids = [event_tag_id] if event_tag_id else []

    # Default event name to AO + event type if not provided
    if safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_NAME):
        event_instance_name = safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_NAME)
    else:
        ao_service = _build_ao_service()
        event_type_service = _build_event_type_service()
        ao = ao_service.get_ao_by_id(org_id)
        et = event_type_service.get_event_type_by_id(event_type_id) if event_type_id else None
        event_instance_name = f"{ao.name if ao else ''} {et.name if et else ''}".strip()

    # Build preblast plain text from rich text block if provided
    preblast_text: str | None = None
    preblast_rich = safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_PREBLAST)
    if preblast_rich:
        preblast_text = replace_user_channel_ids(
            parse_rich_block(preblast_rich),
            region_record,
            client,
            logger,
        )

    start_date = datetime.strptime(safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_START_DATE), "%Y-%m-%d").date()
    start_time = datetime.strptime(safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_START_TIME), "%H:%M").strftime(
        "%H%M"
    )

    if safe_get(metadata, "event_instance_id"):
        record = service.update_instance(
            instance_id=int(metadata["event_instance_id"]),
            name=event_instance_name,
            org_id=org_id,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            description=safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION),
            location_id=location_id,
            event_type_ids=[event_type_id] if event_type_id else [],
            event_tag_ids=event_tag_ids,
            is_active=True,
            is_private=is_private,
            meta=merged_meta,
            highlight=highlight,
            preblast_rich=preblast_rich,
            preblast=preblast_text,
        )
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":pencil2: Event edited: {event_instance_name} on {start_date} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )
    else:
        record = service.create_instance(
            name=event_instance_name,
            org_id=org_id,
            start_date=start_date,
            start_time=start_time,
            end_time=end_time,
            description=safe_get(form_data, CALENDAR_ADD_EVENT_INSTANCE_DESCRIPTION),
            location_id=location_id,
            event_type_ids=[event_type_id] if event_type_id else [],
            event_tag_ids=event_tag_ids,
            is_active=True,
            is_private=is_private,
            meta=merged_meta,
            highlight=highlight,
            preblast_rich=preblast_rich,
            preblast=preblast_text,
        )
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":heavy_plus_sign: Event created: {event_instance_name} on {start_date} by <@{slack_user_id or 'app'}>",  # noqa: E501
            logger=logger,
        )

    if safe_get(metadata, "is_preblast") == "True":
        # If this is for a new unscheduled event, set attendance and post the preblast
        slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")
        DbManager.create_record(
            Attendance(
                event_instance_id=record.id,
                user_id=get_user(slack_user_id, region_record, client, logger).user_id,
                is_planned=True,
                attendance_x_attendance_types=[Attendance_x_AttendanceType(attendance_type_id=2)],  # 2 = Q
            )
        )
        event_preblast.send_preblast(body, client, logger, context, region_record, record.id)


def build_event_instance_list_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id=None,
    loading_form: bool = False,
):
    title_text = "Edit/Close/Delete Event"

    if loading_form:
        update_view_id = add_loading_form(body, client, new_or_add="add")

    start_date = current_date_cst()
    filter_ao_id = None
    filter_values = {}
    region_org_id = region_record.org_id

    if safe_get(body, "actions", 0, "action_id") in [
        CALENDAR_MANAGE_EVENT_INSTANCE_AO,
        CALENDAR_MANAGE_EVENT_INSTANCE_DATE,
    ]:
        filter_values = orm.BlockView(blocks=copy.deepcopy(EVENT_LIST_FILTERS)).get_selected_values(body)
        update_view_id = safe_get(body, "view", "id")
        if safe_get(filter_values, CALENDAR_MANAGE_EVENT_INSTANCE_AO):
            filter_ao_id = safe_convert(safe_get(filter_values, CALENDAR_MANAGE_EVENT_INSTANCE_AO), int)
        if safe_get(filter_values, CALENDAR_MANAGE_EVENT_INSTANCE_DATE):
            date_str = safe_get(filter_values, CALENDAR_MANAGE_EVENT_INSTANCE_DATE)
            start_date = datetime.strptime(date_str, "%Y-%m-%d").date()

    service = _build_event_instance_service()
    records = service.get_region_instances(
        region_org_id=region_org_id,
        start_date=start_date,
        ao_org_id=filter_ao_id,
    )

    ao_service = _build_ao_service()
    ao_orgs = ao_service.get_region_aos(region_record.org_id)

    form = orm.BlockView(blocks=copy.deepcopy(EVENT_LIST_FILTERS))
    form.set_options(
        {
            CALENDAR_MANAGE_EVENT_INSTANCE_AO: orm.as_selector_options(
                names=[ao.name for ao in ao_orgs],
                values=[str(ao.id) for ao in ao_orgs],
            ),
        }
    )
    form.set_initial_values(
        {
            CALENDAR_MANAGE_EVENT_INSTANCE_AO: safe_get(filter_values, CALENDAR_MANAGE_EVENT_INSTANCE_AO),
            CALENDAR_MANAGE_EVENT_INSTANCE_DATE: safe_get(filter_values, CALENDAR_MANAGE_EVENT_INSTANCE_DATE),
        }
    )

    for s in records:
        label = f"{s.name} ({s.start_date.strftime('%m/%d/%Y')})"[:50] if s.start_date else (s.name or "")[:50]
        if s.series_exception == "closed":
            label += " [CLOSED]"
            placeholder = "Reopen, Edit, or Delete"
            options = ["Reopen", "Edit", "Delete"]
            confirm_text = "Are you sure you want to reopen / edit / delete this event?"
        else:
            placeholder = "Edit, Close, or Delete"
            options = ["Edit", "Close", "Delete"]
            confirm_text = "Are you sure you want to edit / close / delete this event?"

        form.blocks.append(
            orm.SectionBlock(
                label=label,
                action=f"{actions.EVENT_INSTANCE_EDIT_DELETE}_{s.id}",
                element=orm.StaticSelectElement(
                    placeholder=placeholder,
                    options=orm.as_selector_options(names=options),
                    confirm=orm.ConfirmObject(
                        title="Are you sure?",
                        text=confirm_text,
                        confirm="Yes, I'm sure",
                        deny="Whups, never mind",
                    ),
                ),
            )
        )

    if not records:
        form.blocks.append(
            orm.SectionBlock(
                label="No upcoming events found.",
                action="event-instance-empty-notice",
            )
        )

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=EDIT_DELETE_EVENT_INSTANCE_CALLBACK_ID,
            title_text=title_text,
            submit_button_text="None",
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text=title_text,
            callback_id=EDIT_DELETE_EVENT_INSTANCE_CALLBACK_ID,
            submit_button_text="None",
            new_or_add="add",
        )


def handle_event_instance_edit_delete(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    event_instance_id = safe_convert(safe_get(body, "actions", 0, "action_id").split("_")[1], int)
    action = safe_get(body, "actions", 0, "selected_option", "value")
    user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    section_block_id = safe_get(body, "actions", 0, "block_id")
    section_block = next((b for b in safe_get(body, "view", "blocks") if b["block_id"] == section_block_id), None)
    event_title = safe_get(section_block, "text", "text") or "an event"

    service = _build_event_instance_service()

    if action == "Edit":
        print(f"Editing event instance ID: {event_instance_id}")
        event_instance = service.get_by_id(event_instance_id)
        print(f"Editing event instance: {event_instance}")
        build_event_instance_add_form(
            body, client, logger, context, region_record, edit_event_instance=event_instance, loading_form=True
        )
        action_text = None
    elif action == "Close":
        form = copy.deepcopy(EVENT_CLOSE_FORM)
        form.update_modal(
            client=client,
            view_id=safe_get(body, "view", "id"),
            callback_id=EVENT_CLOSE_CALLBACK_ID,
            title_text="Close Event",
            submit_button_text="Close Event",
            parent_metadata={"event_instance_id": event_instance_id},
            close_button_text="Cancel",
        )
        action_text = f":no_entry_sign: <@{user_id}> closed event: {event_title}"
    elif action == "Reopen":
        service.reopen_instance(event_instance_id)
        build_event_instance_list_form(
            body, client, logger, context, region_record, update_view_id=safe_get(body, "view", "id"), loading_form=True
        )
        action_text = f":white_check_mark: <@{user_id}> reopened event: {event_title}"
    elif action == "Delete":
        service.delete_instance(event_instance_id)
        build_event_instance_list_form(
            body, client, logger, context, region_record, update_view_id=safe_get(body, "view", "id"), loading_form=True
        )
        action_text = f":wastebasket: <@{user_id or 'app'}> deleted event: {event_title}"

    if action_text:
        post_bot_log(
            client=client,
            region_record=region_record,
            text=action_text,
            logger=logger,
        )


def handle_event_instance_close(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    metadata = _parse_view_private_metadata(body)
    event_instance_id = safe_get(metadata, "event_instance_id")
    close_reason = EVENT_CLOSE_FORM.get_selected_values(body).get(EVENT_CLOSE_REASON)

    service = _build_event_instance_service()
    service.close_instance(instance_id=event_instance_id, close_reason=close_reason)


# ---------------------------------------------------------------------------
# Forms
# ---------------------------------------------------------------------------

EVENT_CLOSE_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="Reason for Closing",
            action=EVENT_CLOSE_REASON,
            element=orm.PlainTextInputElement(placeholder="Enter the reason for closing this event"),
            optional=True,
            hint="This will be shown to map users.",
        )
    ]
)

INSTANCE_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="AO",
            action=CALENDAR_ADD_EVENT_INSTANCE_AO,
            element=orm.StaticSelectElement(placeholder="Select an AO"),
            dispatch_action=True,
            optional=False,
        ),
        orm.InputBlock(
            label="Location",
            action=CALENDAR_ADD_EVENT_INSTANCE_LOCATION,
            element=orm.StaticSelectElement(placeholder="Select the location"),
            optional=True,
        ),
        orm.InputBlock(
            label="Event Type",
            action=CALENDAR_ADD_EVENT_INSTANCE_TYPE,
            element=orm.StaticSelectElement(placeholder="Select the event type"),
            optional=False,
        ),
        orm.InputBlock(
            label="Event Tag",
            action=CALENDAR_ADD_EVENT_INSTANCE_TAG,
            element=orm.MultiStaticSelectElement(placeholder="Select the event tag", max_selected_items=1),
            optional=True,
        ),
        orm.InputBlock(
            label="Date",
            action=CALENDAR_ADD_EVENT_INSTANCE_START_DATE,
            element=orm.DatepickerElement(placeholder="Enter the start date"),
            optional=False,
        ),
        orm.InputBlock(
            label="Start Time",
            action=CALENDAR_ADD_EVENT_INSTANCE_START_TIME,
            element=orm.TimepickerElement(placeholder="Enter the start time"),
            optional=False,
        ),
        orm.InputBlock(
            label="End Time",
            action=CALENDAR_ADD_EVENT_INSTANCE_END_TIME,
            element=orm.TimepickerElement(placeholder="Enter the end time"),
            hint="If no end time is provided, the event will be defaulted to be one hour long.",
        ),
        orm.InputBlock(
            label="Event Name",
            action=CALENDAR_ADD_EVENT_INSTANCE_NAME,
            element=orm.PlainTextInputElement(placeholder="Enter the event name"),
            hint="If left blank, will default to the AO name + event type.",
        ),
        orm.InputBlock(
            label="Options",
            action=CALENDAR_ADD_EVENT_INSTANCE_OPTIONS,
            element=orm.CheckboxInputElement(
                options=orm.as_selector_options(
                    names=[
                        "Make event private",
                        "Exclude stats from PAX Vault",
                        "Do not send auto-preblasts",
                        "Highlight on Special Events List",
                    ],
                    values=[
                        "private",
                        "exclude_from_pax_vault",
                        "no_auto_preblasts",
                        "highlight",
                    ],
                    descriptions=[
                        "Hides event from Maps and Region Pages.",
                        "Can still be queried from BigQuery or custom dashboards.",
                        "Opts this event out of automated preblasts.",
                        "Shown in the calendar image channel if enabled.",
                    ],
                ),
            ),
            optional=True,
        ),
    ]
)

EVENT_LIST_FILTERS = [
    orm.InputBlock(
        label="AO Filter",
        action=CALENDAR_MANAGE_EVENT_INSTANCE_AO,
        element=orm.StaticSelectElement(
            placeholder="Select an AO",
        ),
        optional=True,
        dispatch_action=True,
    ),
    orm.InputBlock(
        label="Date Filter",
        action=CALENDAR_MANAGE_EVENT_INSTANCE_DATE,
        element=orm.DatepickerElement(
            placeholder="Select a date",
        ),
        optional=True,
        dispatch_action=True,
    ),
]
