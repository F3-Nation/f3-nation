import copy
import json
from datetime import datetime, timedelta
from logging import Logger

from f3_data_models.models import Day_Of_Week, Event_Cadence
from slack_sdk.web import WebClient

from application.ao.service import AoService
from application.event_tag.service import EventTagService
from application.event_type.service import EventTypeService
from application.location.service import LocationService
from application.series import SeriesData
from application.series.service import SeriesService
from infrastructure.api_client import (
    get_api_ao_repository,
    get_api_event_tag_repository,
    get_api_event_type_repository,
    get_api_location_repository,
    get_api_series_repository,
)
from utilities import constants
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form
from utilities.database.orm import SlackSettings
from utilities.helper_functions import (
    MapUpdateData,
    _parse_view_private_metadata,
    get_location_display_name,
    safe_convert,
    safe_get,
    trigger_map_revalidation,
)
from utilities.slack import actions, orm

META_DO_NOT_SEND_AUTO_PREBLASTS = "do_not_send_auto_preblasts"
META_EXCLUDE_FROM_PAX_VAULT = "exclude_from_pax_vault"


# ---------------------------------------------------------------------------
# Composition root
# ---------------------------------------------------------------------------


def _build_series_service() -> SeriesService:
    return SeriesService(repository=get_api_series_repository())


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


def manage_series(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action = safe_get(body, "actions", 0, "selected_option", "value")

    if action == "add":
        build_series_add_form(body, client, logger, context, region_record, loading_form=True)
    elif action == "edit":
        build_series_list_form(body, client, logger, context, region_record, loading_form=True)


def build_series_add_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    edit_event: SeriesData | None = None,
    new_preblast: bool = False,
    loading_form: bool = False,
):
    metadata = _parse_view_private_metadata(body)
    series_service = _build_series_service()

    if safe_get(metadata, "series_id"):
        edit_event = series_service.get_by_id(metadata["series_id"])
        parent_metadata = metadata
    else:
        parent_metadata = {"series_id": edit_event.id} if edit_event else {}

    if loading_form:
        update_view_id = add_loading_form(body, client, new_or_add="add")
    else:
        update_view_id = None

    title_text = "Edit a Series" if edit_event else "Add a Series"
    form = copy.deepcopy(SERIES_FORM)
    parent_metadata.update({"is_series": "True"})

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
            actions.CALENDAR_ADD_SERIES_AO: orm.as_selector_options(
                names=[ao.name for ao in aos],
                values=[str(ao.id) for ao in aos],
            ),
            actions.CALENDAR_ADD_EVENT_AO: orm.as_selector_options(
                names=[ao.name for ao in aos],
                values=[str(ao.id) for ao in aos],
            ),
            actions.CALENDAR_ADD_SERIES_LOCATION: orm.as_selector_options(
                names=[get_location_display_name(loc) for loc in locations],
                values=[str(loc.id) for loc in locations],
            ),
            actions.CALENDAR_ADD_SERIES_TYPE: orm.as_selector_options(
                names=[et.name for et in event_types],
                values=[str(et.id) for et in event_types],
            ),
            actions.CALENDAR_ADD_SERIES_TAG: orm.as_selector_options(
                names=[tag.name for tag in event_tags],
                values=[str(tag.id) for tag in event_tags],
            ),
        }
    )

    if edit_event:
        form.delete_block(actions.CALENDAR_ADD_SERIES_DOW)
        form.delete_block(actions.CALENDAR_ADD_SERIES_FREQUENCY)
        form.delete_block(actions.CALENDAR_ADD_SERIES_INTERVAL)
        form.delete_block(actions.CALENDAR_ADD_SERIES_INDEX)
        form.delete_block(actions.CALENDAR_ADD_SERIES_START_DATE)
        form.delete_block(actions.CALENDAR_ADD_SERIES_END_DATE)
        initial_values = {
            actions.CALENDAR_ADD_SERIES_NAME: edit_event.name,
            actions.CALENDAR_ADD_SERIES_DESCRIPTION: edit_event.description,
            actions.CALENDAR_ADD_SERIES_AO: str(edit_event.org_id),
            actions.CALENDAR_ADD_EVENT_AO: str(edit_event.org_id),
            actions.CALENDAR_ADD_SERIES_LOCATION: safe_convert(edit_event.location_id, str),
            actions.CALENDAR_ADD_SERIES_TYPE: str(edit_event.event_type_ids[0]) if edit_event.event_type_ids else None,
            actions.CALENDAR_ADD_SERIES_START_TIME: safe_convert(edit_event.start_time, lambda t: t[:2] + ":" + t[2:]),
            actions.CALENDAR_ADD_SERIES_END_TIME: safe_convert(edit_event.end_time, lambda t: t[:2] + ":" + t[2:]),
        }

        options = []
        if safe_get(edit_event, "is_private"):
            options.append("private")
        if safe_get(edit_event, "meta") and safe_get(edit_event.meta, META_EXCLUDE_FROM_PAX_VAULT):
            options.append("exclude_from_pax_vault")
        if safe_get(edit_event, "meta") and safe_get(edit_event.meta, META_DO_NOT_SEND_AUTO_PREBLASTS):
            options.append("no_auto_preblasts")
        if safe_get(edit_event, "highlight"):
            options.append("highlight")
        if options:
            initial_values[actions.CALENDAR_ADD_SERIES_OPTIONS] = options

        # NOTE: event_tag_ids will always be empty when fetched from the API -
        # the F3 Nation API does not return event tags for event (series) records.
        if edit_event.event_tag_ids:
            initial_values[actions.CALENDAR_ADD_SERIES_TAG] = [
                str(edit_event.event_tag_ids[0])
            ]  # TODO: handle multiple event tags
    else:
        initial_values = {
            actions.CALENDAR_ADD_SERIES_START_DATE: datetime.now().strftime("%Y-%m-%d"),
            actions.CALENDAR_ADD_SERIES_FREQUENCY: Event_Cadence.weekly.name,
            actions.CALENDAR_ADD_SERIES_INTERVAL: "1",
            actions.CALENDAR_ADD_SERIES_INDEX: "1",
        }

    # Triggered when the AO is selected - defaults are loaded for the location
    action_id = safe_get(body, "actions", 0, "action_id")
    if action_id in (actions.CALENDAR_ADD_SERIES_AO, actions.CALENDAR_ADD_EVENT_AO):
        form_data = SERIES_FORM.get_selected_values(body)
        ao = ao_service.get_ao_by_id(safe_convert(safe_get(form_data, action_id), int))
        if ao and ao.default_location_id:
            initial_values[actions.CALENDAR_ADD_SERIES_LOCATION] = str(ao.default_location_id)

        form.set_initial_values(initial_values)
        form.update_modal(
            client=client,
            view_id=safe_get(body, "view", "id"),
            callback_id=actions.ADD_SERIES_CALLBACK_ID,
            title_text=title_text,
            parent_metadata=parent_metadata,
        )
    elif update_view_id:
        form.set_initial_values(initial_values)
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.ADD_SERIES_CALLBACK_ID,
            title_text=title_text,
            parent_metadata=parent_metadata,
        )
    else:
        form.set_initial_values(initial_values)
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text=title_text,
            callback_id=actions.ADD_SERIES_CALLBACK_ID,
            new_or_add="add",
            parent_metadata=parent_metadata,
        )


def handle_series_add(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    metadata = _parse_view_private_metadata(body)
    form_data = SERIES_FORM.get_selected_values(body)
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    end_date = safe_get(form_data, actions.CALENDAR_ADD_SERIES_END_DATE)  # "YYYY-MM-DD" string or None

    start_time_str = safe_get(form_data, actions.CALENDAR_ADD_SERIES_START_TIME)
    start_time = datetime.strptime(start_time_str, "%H:%M").strftime("%H%M") if start_time_str else None

    if safe_get(form_data, actions.CALENDAR_ADD_SERIES_END_TIME):
        end_time: str = safe_get(form_data, actions.CALENDAR_ADD_SERIES_END_TIME).replace(":", "")
    elif start_time_str:
        end_time = (datetime.strptime(start_time_str, "%H:%M") + timedelta(hours=1)).strftime("%H%M")
    else:
        end_time = None

    # Slack won't return the selection for location and event type after being defaulted, so we need the initial value
    view_blocks = safe_get(body, "view", "blocks")
    location_block = [block for block in view_blocks if block["block_id"] == actions.CALENDAR_ADD_SERIES_LOCATION][0]
    location_initial_value = safe_get(location_block, "element", "initial_option", "value")
    location_id = form_data.get(actions.CALENDAR_ADD_SERIES_LOCATION) or location_initial_value
    event_type_block = [block for block in view_blocks if block["block_id"] == actions.CALENDAR_ADD_SERIES_TYPE][0]
    event_type_initial_value = safe_get(event_type_block, "element", "initial_option", "value")
    event_type_id = form_data.get(actions.CALENDAR_ADD_SERIES_TYPE) or event_type_initial_value

    location_id = safe_convert(location_id, int)
    event_type_id = safe_convert(event_type_id, int)
    org_id = safe_convert(
        safe_get(form_data, actions.CALENDAR_ADD_SERIES_AO) or safe_get(form_data, actions.CALENDAR_ADD_EVENT_AO), int
    )
    event_tag_id = safe_convert(safe_get(form_data, actions.CALENDAR_ADD_SERIES_TAG, 0), int)
    recurrence_interval = safe_convert(safe_get(form_data, actions.CALENDAR_ADD_SERIES_INTERVAL), int)
    index_within_interval = safe_convert(safe_get(form_data, actions.CALENDAR_ADD_SERIES_INDEX), int)

    selected_options = safe_get(form_data, actions.CALENDAR_ADD_SERIES_OPTIONS) or []
    is_private = "private" in selected_options
    exclude_from_pax_vault = "exclude_from_pax_vault" in selected_options
    do_not_send_auto_preblasts = "no_auto_preblasts" in selected_options
    highlight = "highlight" in selected_options

    series_service = _build_series_service()
    ao_service = _build_ao_service()
    event_type_service = _build_event_type_service()

    if safe_get(form_data, actions.CALENDAR_ADD_SERIES_NAME):
        series_name = safe_get(form_data, actions.CALENDAR_ADD_SERIES_NAME)
    else:
        ao = ao_service.get_ao_by_id(org_id)
        event_type = event_type_service.get_event_type_by_id(event_type_id) if event_type_id else None
        series_name = f"{ao.name if ao else ''} {event_type.name if event_type else ''}".strip()

    day_of_weeks = safe_get(form_data, actions.CALENDAR_ADD_SERIES_DOW)

    if safe_get(metadata, "series_id"):
        series_id = int(metadata["series_id"])
        existing_series = series_service.get_by_id(series_id)
        merged_meta = dict(safe_get(existing_series, "meta") or {})
        if exclude_from_pax_vault:
            merged_meta[META_EXCLUDE_FROM_PAX_VAULT] = True
        else:
            merged_meta.pop(META_EXCLUDE_FROM_PAX_VAULT, None)
        if do_not_send_auto_preblasts:
            merged_meta[META_DO_NOT_SEND_AUTO_PREBLASTS] = True
        else:
            merged_meta.pop(META_DO_NOT_SEND_AUTO_PREBLASTS, None)

        series_service.update_series(
            series_id=series_id,
            region_id=region_record.org_id,
            ao_id=org_id,
            name=series_name,
            # start_date is not shown in the edit form; preserve from existing record
            start_date=existing_series.start_date,
            start_time=start_time,
            end_time=end_time,
            description=safe_get(form_data, actions.CALENDAR_ADD_SERIES_DESCRIPTION),
            location_id=location_id,
            # end_date is not shown in the edit form; preserve from existing record
            end_date=existing_series.end_date,
            event_type_ids=[event_type_id] if event_type_id else [],
            event_tag_ids=[event_tag_id] if event_tag_id else [],
            is_active=True,
            is_private=is_private,
            highlight=highlight,
            meta=merged_meta or None,
        )
        # The API cascade automatically updates all future EventInstances; no local update needed.
        body["actions"] = [{"action_id": actions.CALENDAR_MANAGE_SERIES}]
        build_series_list_form(
            body, client, logger, context, region_record, update_view_id=safe_get(body, "view", "previous_view_id")
        )
        trigger_map_revalidation(action="map.updated", map_update_data=MapUpdateData(eventId=metadata["series_id"]))
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":pencil2: Series edited: {series_name} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )

    else:
        meta: dict = {}
        if exclude_from_pax_vault:
            meta[META_EXCLUDE_FROM_PAX_VAULT] = True
        if do_not_send_auto_preblasts:
            meta[META_DO_NOT_SEND_AUTO_PREBLASTS] = True

        created_series = []
        for dow in day_of_weeks:
            created = series_service.create_series(
                region_id=region_record.org_id,
                ao_id=org_id,
                name=series_name,
                start_date=safe_get(form_data, actions.CALENDAR_ADD_SERIES_START_DATE),
                start_time=start_time,
                end_time=end_time,
                day_of_week=dow,
                description=safe_get(form_data, actions.CALENDAR_ADD_SERIES_DESCRIPTION),
                location_id=location_id,
                end_date=end_date,
                recurrence_pattern=safe_get(form_data, actions.CALENDAR_ADD_SERIES_FREQUENCY),
                recurrence_interval=recurrence_interval,
                index_within_interval=index_within_interval,
                event_type_ids=[event_type_id] if event_type_id else [],
                event_tag_ids=[event_tag_id] if event_tag_id else [],
                is_active=True,
                is_private=is_private,
                highlight=highlight,
                meta=meta or None,
            )
            created_series.append(created)
        # The API cascade automatically creates all future EventInstances; no local create needed.
        for record in created_series:
            trigger_map_revalidation(action="map.created", map_update_data=MapUpdateData(eventId=record.id))
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":heavy_plus_sign: Series created: {series_name} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )


def build_series_list_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id=None,
    loading_form: bool = False,
):
    if loading_form:
        update_view_id = add_loading_form(body, client, new_or_add="add")

    filter_org = region_record.org_id
    filter_values = {}
    if safe_get(body, "actions", 0, "action_id") in [
        actions.CALENDAR_MANAGE_SERIES_AO,
    ]:
        filter_values = orm.BlockView(blocks=copy.deepcopy(SERIES_LIST_FILTERS)).get_selected_values(body)
        update_view_id = safe_get(body, "view", "id")
        if safe_get(filter_values, actions.CALENDAR_MANAGE_SERIES_AO):
            filter_org = safe_convert(safe_get(filter_values, actions.CALENDAR_MANAGE_SERIES_AO), int)

    title_text = "Delete or Edit a Series"
    confirm_text = "Are you sure you want to edit / delete this series? This cannot be undone. Also, editing or deleting a series will also edit or delete all future events associated with the series."  # noqa

    series_service = _build_series_service()
    ao_service = _build_ao_service()

    if filter_org == region_record.org_id:
        records = series_service.get_region_series(region_record.org_id)
    else:
        records = series_service.get_region_series(region_record.org_id, ao_id=filter_org)

    ao_orgs = ao_service.get_region_aos(region_record.org_id)

    form = orm.BlockView(blocks=copy.deepcopy(SERIES_LIST_FILTERS))
    form.set_options(
        {
            actions.CALENDAR_MANAGE_SERIES_AO: orm.as_selector_options(
                names=[ao.name for ao in ao_orgs],
                values=[str(ao.id) for ao in ao_orgs],
            ),
        }
    )
    form.set_initial_values(
        {
            actions.CALENDAR_MANAGE_SERIES_AO: safe_get(filter_values, actions.CALENDAR_MANAGE_SERIES_AO),
        }
    )

    for s in records:
        label = f"{s.name} ({(s.day_of_week or '').capitalize()} @ {s.start_time})"[:50]

        form.blocks.append(
            orm.SectionBlock(
                label=label,
                action=f"{actions.SERIES_EDIT_DELETE}_{s.id}",
                element=orm.StaticSelectElement(
                    placeholder="Edit or Delete",
                    options=orm.as_selector_options(names=["Edit", "Delete"]),
                    confirm=orm.ConfirmObject(
                        title="Are you sure?",
                        text=confirm_text,
                        confirm="Yes, I'm sure",
                        deny="Whups, never mind",
                    ),
                ),
            )
        )
    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.EDIT_DELETE_SERIES_CALLBACK_ID,
            title_text=title_text,
            submit_button_text="None",
        )


def handle_series_edit_delete(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    series_id = safe_convert(safe_get(body, "actions", 0, "action_id").split("_")[1], int)
    action = safe_get(body, "actions", 0, "selected_option", "value")
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    if action == "Edit":
        series = _build_series_service().get_by_id(series_id)
        build_series_add_form(body, client, logger, context, region_record, edit_event=series, loading_form=True)
    elif action == "Delete":
        series = _build_series_service().get_by_id(series_id)
        _build_series_service().delete_series(series_id)
        # The API cascade automatically soft-deletes all future EventInstances; no local update needed.
        trigger_map_revalidation(action="map.deleted", map_update_data=MapUpdateData(eventId=series_id))
        body["view"]["private_metadata"] = json.dumps({"is_series": "True"})
        build_series_list_form(
            body, client, logger, context, region_record, update_view_id=safe_get(body, "view", "id")
        )
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":wastebasket: Series deleted: {series.name if series else series_id} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )


SERIES_FORM = orm.BlockView(
    blocks=[
        orm.InputBlock(
            label="AO",
            action=actions.CALENDAR_ADD_SERIES_AO,
            element=orm.StaticSelectElement(placeholder="Select an AO"),
            dispatch_action=True,
            optional=False,
        ),
        orm.InputBlock(
            label="Default Location",
            action=actions.CALENDAR_ADD_SERIES_LOCATION,
            element=orm.StaticSelectElement(placeholder="Select the default location"),
            optional=True,
        ),
        orm.InputBlock(
            label="Default Event Type",
            action=actions.CALENDAR_ADD_SERIES_TYPE,
            element=orm.StaticSelectElement(placeholder="Select the event type"),
            optional=False,
        ),
        orm.InputBlock(
            label="Default Event Tag",
            action=actions.CALENDAR_ADD_SERIES_TAG,
            element=orm.MultiStaticSelectElement(placeholder="Select the event tag", max_selected_items=1),
            optional=True,
        ),
        orm.InputBlock(
            label="Start Date",
            action=actions.CALENDAR_ADD_SERIES_START_DATE,
            element=orm.DatepickerElement(placeholder="Enter the start date"),
            optional=False,
        ),
        orm.InputBlock(
            label="End Date",
            action=actions.CALENDAR_ADD_SERIES_END_DATE,
            element=orm.DatepickerElement(placeholder="Enter the end date"),
            hint="If no end date is provided, the series will continue indefinitely.",
        ),
        orm.InputBlock(
            label="Start Time",
            action=actions.CALENDAR_ADD_SERIES_START_TIME,
            element=orm.TimepickerElement(placeholder="Enter the start time"),
            optional=False,
        ),
        orm.InputBlock(
            label="End Time",
            action=actions.CALENDAR_ADD_SERIES_END_TIME,
            element=orm.TimepickerElement(placeholder="Enter the end time"),
            hint="If no end time is provided, the event will be defaulted to be one hour long.",
        ),
        orm.InputBlock(
            label="Day(s) of the Week",
            action=actions.CALENDAR_ADD_SERIES_DOW,
            element=orm.CheckboxInputElement(
                options=orm.as_selector_options(
                    names=[d.name.capitalize() for d in Day_Of_Week],
                    values=[d.name for d in Day_Of_Week],
                ),
            ),
            optional=False,
        ),
        orm.InputBlock(
            "Interval",
            action=actions.CALENDAR_ADD_SERIES_INTERVAL,
            element=orm.StaticSelectElement(
                placeholder="Select the interval",
                options=orm.as_selector_options(**constants.INTERVAL_OPTIONS),
                initial_value="1",
            ),
            optional=False,
        ),
        orm.InputBlock(
            label="Series Frequency",
            action=actions.CALENDAR_ADD_SERIES_FREQUENCY,
            element=orm.StaticSelectElement(
                placeholder="Select the frequency",
                options=orm.as_selector_options(names=["Week", "Month"], values=[p.name for p in Event_Cadence]),
                initial_value=Event_Cadence.weekly.name,
            ),
            optional=False,
        ),
        orm.InputBlock(
            label="Which week of the month?",
            action=actions.CALENDAR_ADD_SERIES_INDEX,
            element=orm.StaticSelectElement(
                placeholder="Select the week",
                options=orm.as_selector_options(**constants.WEEK_INDEX_OPTIONS),
                initial_value="1",
            ),
            optional=False,
            hint="Only relevant if Month is selected above. Select 'Last' for the last occurrence of the day in the month.",  # noqa
        ),
        orm.InputBlock(
            label="Series Name",
            action=actions.CALENDAR_ADD_SERIES_NAME,
            element=orm.PlainTextInputElement(placeholder="Enter the series name"),
            hint="If left blank, will default to the AO name + event type.",
        ),
        orm.InputBlock(
            label="Description",
            action=actions.CALENDAR_ADD_SERIES_DESCRIPTION,
            element=orm.PlainTextInputElement(
                placeholder="Enter a description",
                multiline=True,
            ),
            optional=True,
        ),
        orm.InputBlock(
            label="Options",
            action=actions.CALENDAR_ADD_SERIES_OPTIONS,
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
                        "Hides series from Maps and Region Pages.",
                        "Can still be queried from BigQuery or custom dashboards.",
                        "Opts this series out of automated preblasts.",
                        "Shown in the calendar image channel if enabled.",
                    ],
                ),
            ),
            optional=True,
        ),
    ]
)

SERIES_LIST_FILTERS = [
    orm.InputBlock(
        label="AO Filter",
        action=actions.CALENDAR_MANAGE_SERIES_AO,
        element=orm.StaticSelectElement(
            placeholder="Select an AO",
        ),
        optional=True,
        dispatch_action=True,
    ),
]
