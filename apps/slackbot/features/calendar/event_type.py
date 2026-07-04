import copy
import json
from logging import Logger

from slack_sdk.models.blocks import ContextBlock, InputBlock, SectionBlock
from slack_sdk.models.blocks.basic_components import MarkdownTextObject, PlainTextObject
from slack_sdk.models.blocks.block_elements import PlainTextInputElement, StaticSelectElement
from slack_sdk.web import WebClient

from application.event_type import EventTypeData
from application.event_type.service import EventTypeService
from infrastructure.api_client import get_api_event_type_repository
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_convert, safe_get
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

# ---------------------------------------------------------------------------
# Action / callback ID constants (feature-local)
# ---------------------------------------------------------------------------
CALENDAR_MANAGE_EVENT_TYPES = "calendar-manage-event-types"
CALENDAR_ADD_EVENT_TYPE_NEW = "calendar-add-event-type-new"
CALENDAR_ADD_EVENT_TYPE_CATEGORY = "calendar-add-event-type-category"
CALENDAR_ADD_EVENT_TYPE_ACRONYM = "calendar-add-event-type-acronym"
CALENDAR_ADD_EVENT_TYPE_LIST = "calendar-add-event-type-list"
CALENDAR_ADD_EVENT_TYPE_CALLBACK_ID = "calendar-add-event-type-id"
EVENT_TYPE_EDIT_DELETE = "event-type-edit-delete"
EDIT_DELETE_EVENT_TYPE_CALLBACK_ID = "edit-delete-event-type-id"
_EVENT_TYPE_NOTE = "event-type-note"

# ---------------------------------------------------------------------------
# Static data
# ---------------------------------------------------------------------------
_CATEGORY_LABELS = ["First F", "Second F", "Third F"]
_CATEGORY_VALUES = ["first_f", "second_f", "third_f"]


# ---------------------------------------------------------------------------
# Composition root
# ---------------------------------------------------------------------------


def _build_event_type_service() -> EventTypeService:
    """Build the event-type service using the production API-backed repository."""
    return EventTypeService(repository=get_api_event_type_repository())


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


class EventTypeViews:
    """Pure Slack UI construction for event types — no I/O."""

    @staticmethod
    def build_add_type_modal(all_org_types: list[EventTypeData]) -> SdkBlockView:
        """Modal for creating a new org-specific event type."""
        form = copy.deepcopy(EVENT_TYPE_FORM)
        EventTypeViews._update_type_list_block(form, all_org_types)
        return form

    @staticmethod
    def build_edit_type_modal(edit_event_type: EventTypeData, all_org_types: list[EventTypeData]) -> SdkBlockView:
        """Modal pre-filled with an existing event type's data for editing."""
        form = copy.deepcopy(EVENT_TYPE_FORM)
        form.set_initial_values(
            {
                CALENDAR_ADD_EVENT_TYPE_NEW: edit_event_type.name,
                CALENDAR_ADD_EVENT_TYPE_CATEGORY: edit_event_type.event_category or "",
                CALENDAR_ADD_EVENT_TYPE_ACRONYM: edit_event_type.acronym or "",
            }
        )
        form.delete_block(_EVENT_TYPE_NOTE)
        if name_block := form.get_block(CALENDAR_ADD_EVENT_TYPE_NEW):
            name_block.label.text = "Edit Event Type"
            name_block.element.placeholder.text = "Edit Event Type"
        EventTypeViews._update_type_list_block(form, all_org_types)
        return form

    @staticmethod
    def build_type_list_modal(org_types: list[EventTypeData]) -> SdkBlockView:
        """List modal showing org-specific event types with edit/delete controls."""
        blocks = [
            ContextBlock(
                elements=[PlainTextObject(text="Only region-specific event types can be edited or deleted.")],
            )
        ]
        blocks.extend(
            SectionBlock(
                text=MarkdownTextObject(text=f"*{t.name}*: {t.acronym or ''}"),
                block_id=f"{EVENT_TYPE_EDIT_DELETE}_{t.id}",
                accessory=StaticSelectElement(
                    placeholder="Edit or Delete",
                    options=as_selector_options(names=["Edit", "Delete"]),
                    action_id=f"{EVENT_TYPE_EDIT_DELETE}_{t.id}",
                ),
            )
            for t in org_types
        )
        return SdkBlockView(blocks=blocks)

    @staticmethod
    def _update_type_list_block(form: SdkBlockView, all_org_types: list[EventTypeData]) -> None:
        type_labels = [f" - {t.name}: {t.acronym or ''}" for t in all_org_types]
        if list_block := form.get_block(CALENDAR_ADD_EVENT_TYPE_LIST):
            list_block.text.text = "Event types in use:\n\n" + "\n".join(type_labels)


# ---------------------------------------------------------------------------
# Handler functions
# ---------------------------------------------------------------------------


def manage_event_types(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action = safe_get(body, "actions", 0, "selected_option", "value")
    service = _build_event_type_service()
    views = EventTypeViews()

    if action == "add":
        update_view_id = add_loading_form(body, client, new_or_add="add")
        all_org_types = service.get_all_event_types_for_org(region_record.org_id)
        form = views.build_add_type_modal(all_org_types)
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text="Add an Event Type",
            callback_id=CALENDAR_ADD_EVENT_TYPE_CALLBACK_ID,
        )
    elif action == "edit":
        org_types = service.get_org_specific_event_types(region_record.org_id)
        form = views.build_type_list_modal(org_types)
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Edit/Delete Event Types",
            callback_id=EDIT_DELETE_EVENT_TYPE_CALLBACK_ID,
            submit_button_text="None",
            new_or_add="add",
        )


def handle_event_type_add(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = EVENT_TYPE_FORM.get_selected_values(body)
    event_type_name = form_data.get(CALENDAR_ADD_EVENT_TYPE_NEW)
    event_category = form_data.get(CALENDAR_ADD_EVENT_TYPE_CATEGORY)
    event_type_acronym = form_data.get(CALENDAR_ADD_EVENT_TYPE_ACRONYM)
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    edit_event_type_id = safe_convert(metadata.get("edit_event_type_id"), int)
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    service = _build_event_type_service()

    if edit_event_type_id:
        service.update_org_specific_type(
            edit_event_type_id,
            event_type_name or "",
            event_type_acronym or "",
            event_category or "",
        )
        display_acronym = event_type_acronym or (event_type_name[:2] if event_type_name else "")
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":pencil2: Event type edited: {event_type_name} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )
    elif event_type_name and event_category:
        display_acronym = event_type_acronym or event_type_name[:2]
        service.create_org_specific_type(
            event_type_name,
            display_acronym,
            event_category,
            region_record.org_id,
        )
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":heavy_plus_sign: Event type created: {event_type_name} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )


def handle_event_type_edit_delete(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    action_id = safe_get(body, "actions", 0, "action_id") or ""
    event_type_id = safe_convert(action_id.split("_")[-1] if "_" in action_id else None, int)
    action = safe_get(body, "actions", 0, "selected_option", "value")
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    if action in ("Edit", "Delete") and event_type_id is None:
        return

    service = _build_event_type_service()
    views = EventTypeViews()

    if action == "Edit":
        all_org_types = service.get_all_event_types_for_org(region_record.org_id)
        event_type = next((t for t in all_org_types if t.id == event_type_id), None)
        if event_type is None:
            return
        form = views.build_edit_type_modal(event_type, all_org_types)
        update_view_id = add_loading_form(body, client, new_or_add="add")
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text="Edit an Event Type",
            callback_id=CALENDAR_ADD_EVENT_TYPE_CALLBACK_ID,
            parent_metadata={"edit_event_type_id": event_type_id},
        )
    elif action == "Delete":
        event_type = next(
            (t for t in service.get_all_event_types_for_org(region_record.org_id) if t.id == event_type_id), None
        )
        service.delete_org_specific_type(event_type_id)
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":wastebasket: Event type deleted: {event_type.name if event_type else event_type_id} by <@{slack_user_id or 'app'}>",  # noqa: E501
            logger=logger,
        )


# ---------------------------------------------------------------------------
# Module-level form template (deepcopied before each use)
# ---------------------------------------------------------------------------

EVENT_TYPE_FORM = SdkBlockView(
    blocks=[
        SectionBlock(
            text=MarkdownTextObject(
                text="Note: Event Types are used to describe what you'll be doing at an event. "
                "They are different from Event Tags, which give context to an event without "
                "changing what you'll be doing (e.g. 'VQ', 'Convergence', etc.)."
            ),
            block_id=_EVENT_TYPE_NOTE,
        ),
        InputBlock(
            label=PlainTextObject(text="Create a new event type"),
            element=PlainTextInputElement(placeholder="New event type"),
            block_id=CALENDAR_ADD_EVENT_TYPE_NEW,
            optional=True,
        ),
        InputBlock(
            label=PlainTextObject(text="Select an event category"),
            element=StaticSelectElement(
                placeholder="Select an event category",
                options=as_selector_options(names=_CATEGORY_LABELS, values=_CATEGORY_VALUES),
            ),
            block_id=CALENDAR_ADD_EVENT_TYPE_CATEGORY,
            optional=True,
            hint=PlainTextObject(text="This is required for national aggregations (achievements, etc)."),
        ),
        InputBlock(
            label=PlainTextObject(text="Event type acronym"),
            element=PlainTextInputElement(placeholder="Two letter acronym", max_length=2),
            block_id=CALENDAR_ADD_EVENT_TYPE_ACRONYM,
            optional=True,
            hint=PlainTextObject(
                text="Used in the calendar view to save space. Defaults to first two letters of the name. Must be unique!"  # noqa: E501
            ),
        ),
        SectionBlock(
            text=MarkdownTextObject(text="Event types in use:\n\n"),
            block_id=CALENDAR_ADD_EVENT_TYPE_LIST,
        ),
    ]
)
