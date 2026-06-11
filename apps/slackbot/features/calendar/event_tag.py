import copy
import json
from logging import Logger

from slack_sdk.models.blocks import (
    ContextBlock,
    InputBlock,
    SectionBlock,
)
from slack_sdk.models.blocks.basic_components import PlainTextObject
from slack_sdk.models.blocks.block_elements import PlainTextInputElement, StaticSelectElement
from slack_sdk.web import WebClient

from application.event_tag import EventTagData
from application.event_tag.service import EventTagService
from infrastructure.api_client import get_api_event_tag_repository
from utilities.bot_logger import post_bot_log
from utilities.builders import add_loading_form
from utilities.constants import EVENT_TAG_COLORS
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_convert, safe_get
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

# Action IDs
CALENDAR_MANAGE_EVENT_TAGS = "calendar-manage-event-tags"
CALENDAR_ADD_EVENT_TAG_NEW = "calendar-add-event-tag-new"
CALENDAR_ADD_EVENT_TAG_COLOR = "calendar-add-event-tag-color"
EVENT_TAG_EDIT_DELETE = "event-tag-edit-delete"
CALENDAR_ADD_EVENT_TAG_CALLBACK_ID = "calendar-add-event-tag-id"
EDIT_DELETE_AO_CALLBACK_ID = "edit-delete-ao-id"
CALENDAR_EVENT_TAG_COLORS_IN_USE = "calendar-event-tag-colors-in-use"
CALENDAR_EVENT_TAG_NOTICE = "calendar-event-tag-notice"


def _build_event_tag_service() -> EventTagService:
    """Build the event-tag service using the production API-backed repository."""
    return EventTagService(repository=get_api_event_tag_repository())


class EventTagViews:
    """
    A class for building Slack modal views related to event tags.
    """

    @staticmethod
    def build_add_tag_modal(org_tags: list[EventTagData]) -> SdkBlockView:
        """
        Constructs the modal for adding a new org-specific event tag.
        """
        form = copy.deepcopy(EVENT_TAG_FORM)
        color_list = [f"{e.name} - {e.color}" for e in org_tags]
        if color_block := form.get_block(CALENDAR_EVENT_TAG_COLORS_IN_USE):
            color_block.text.text = f"Colors already in use: \n - {'\n - '.join(color_list)}"
        return form

    @staticmethod
    def build_edit_tag_modal(tag_to_edit: EventTagData, org_tags: list[EventTagData]) -> SdkBlockView:
        """
        Constructs the modal for editing an existing event tag.
        """
        form = copy.deepcopy(EVENT_TAG_FORM)
        form.set_initial_values(
            {
                CALENDAR_ADD_EVENT_TAG_NEW: tag_to_edit.name,
                CALENDAR_ADD_EVENT_TAG_COLOR: tag_to_edit.color,
            }
        )

        # Find the input block for the tag name and change its label
        if name_input_block := form.get_block(CALENDAR_ADD_EVENT_TAG_NEW):
            name_input_block.label.text = "Edit Event Tag"
            name_input_block.element.placeholder.text = "Edit Event Tag"

        # Update the list of colors in use
        color_list = [f"{e.name} - {e.color}" for e in org_tags]
        if color_block := form.get_block(CALENDAR_EVENT_TAG_COLORS_IN_USE):
            color_block.text.text = f"Colors already in use: \n - {'\n - '.join(color_list)}"

        return form

    @staticmethod
    def build_tag_list_modal(org_tags: list[EventTagData], notice_text: str | None = None) -> SdkBlockView:
        """
        Constructs the modal that lists an organization's event tags, with options to edit or delete them.
        """
        blocks = []

        if notice_text:
            blocks.append(
                SectionBlock(
                    text=PlainTextObject(text=notice_text),
                    block_id=CALENDAR_EVENT_TAG_NOTICE,
                )
            )

        blocks.extend(
            [
                SectionBlock(
                    text=s.name,
                    block_id=f"{EVENT_TAG_EDIT_DELETE}_{s.id}",
                    accessory=StaticSelectElement(
                        placeholder="Edit",  # TODO: Change to "Edit / Delete"
                        options=as_selector_options(names=["Edit", "Delete"]),
                        # confirm=ConfirmObject(
                        #     title="Are you sure?",
                        #     text="Are you sure you want to edit / delete this Event Tag? This cannot be undone.",
                        #     confirm="Yes, I'm sure",
                        #     deny="Whups, never mind",
                        # ),
                        action_id=f"{EVENT_TAG_EDIT_DELETE}_{s.id}",
                    ),
                )
                for s in org_tags
            ]
        )
        blocks.append(
            ContextBlock(
                elements=[PlainTextObject(text="Only custom event tags can be edited or deleted.")],
            )
        )
        return SdkBlockView(blocks=blocks)


def manage_event_tags(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    action = safe_get(body, "actions", 0, "selected_option", "value")
    service = _build_event_tag_service()
    views = EventTagViews()

    if action == "add":
        update_view_id = add_loading_form(body, client, new_or_add="add")
        org_tags = service.get_org_event_tags(region_record.org_id)
        form = views.build_add_tag_modal(org_tags)
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text="Add an Event Tag",
            callback_id=CALENDAR_ADD_EVENT_TAG_CALLBACK_ID,
        )
    elif action == "edit":
        org_tags = service.get_org_event_tags(region_record.org_id)
        form = views.build_tag_list_modal(org_tags)
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Edit/Delete Event Tags",
            callback_id=EDIT_DELETE_AO_CALLBACK_ID,
            submit_button_text="None",
            new_or_add="add",
        )


def handle_event_tag_add(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = EVENT_TAG_FORM.get_selected_values(body)
    event_tag_name = form_data.get(CALENDAR_ADD_EVENT_TAG_NEW)
    event_color = form_data.get(CALENDAR_ADD_EVENT_TAG_COLOR)
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    edit_event_tag_id = safe_convert(metadata.get("edit_event_tag_id"), int)
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    service = _build_event_tag_service()

    if event_tag_name and event_color:
        if edit_event_tag_id:
            service.update_org_specific_tag(edit_event_tag_id, event_tag_name, event_color)
            post_bot_log(
                client=client,
                region_record=region_record,
                text=f":pencil2: Event tag edited: {event_tag_name} ({event_color}) by <@{slack_user_id or 'app'}>",
                logger=logger,
            )
        else:
            service.create_org_specific_tag(event_tag_name, event_color, region_record.org_id)
            post_bot_log(
                client=client,
                region_record=region_record,
                text=f":heavy_plus_sign: Event tag created: {event_tag_name} ({event_color}) by <@{slack_user_id or 'app'}>",  # noqa: E501
                logger=logger,
            )


def handle_event_tag_edit_delete(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    action_id = safe_get(body, "actions", 0, "action_id") or ""
    event_tag_id = safe_convert(action_id.split("_")[1] if "_" in action_id else None, int)
    action = safe_get(body, "actions", 0, "selected_option", "value")
    slack_user_id = safe_get(body, "user", "id") or safe_get(body, "user_id")

    if action in ("Edit", "Delete") and event_tag_id is None:
        return

    service = _build_event_tag_service()
    views = EventTagViews()

    org_tags = service.get_org_event_tags(region_record.org_id)

    if action == "Edit":
        update_view_id = add_loading_form(body, client, new_or_add="add")
        event_tag = next((t for t in org_tags if t.id == event_tag_id), None)

        if event_tag is None:
            form = views.build_tag_list_modal(
                org_tags,
                notice_text="The selected event tag no longer exists. The list has been refreshed.",
            )
            form.update_modal(
                client=client,
                view_id=update_view_id,
                title_text="Edit/Delete Event Tags",
                callback_id=EDIT_DELETE_AO_CALLBACK_ID,
                submit_button_text="None",
            )
            return

        form = views.build_edit_tag_modal(event_tag, org_tags)
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text="Edit an Event Tag",
            callback_id=CALENDAR_ADD_EVENT_TAG_CALLBACK_ID,
            parent_metadata={"edit_event_tag_id": event_tag.id},
        )
    elif action == "Delete":
        deleted_tag_name = next((t.name for t in org_tags if t.id == event_tag_id), "selected")
        service.delete_org_specific_tag(event_tag_id)
        org_tags = [t for t in org_tags if t.id != event_tag_id]
        forms = views.build_tag_list_modal(org_tags, notice_text=f"The {deleted_tag_name} tag has been deleted.")
        forms.update_modal(
            client=client,
            view_id=safe_get(body, "view", "id"),
            title_text="Edit/Delete Event Tags",
            callback_id=EDIT_DELETE_AO_CALLBACK_ID,
            submit_button_text="None",
        )
        post_bot_log(
            client=client,
            region_record=region_record,
            text=f":wastebasket: Event tag deleted: {deleted_tag_name} by <@{slack_user_id or 'app'}>",
            logger=logger,
        )


EVENT_TAG_FORM = SdkBlockView(
    blocks=[
        SectionBlock(
            text=PlainTextObject(
                text="Note: Event tags are a way to add context about an event. They are different from Event Types, which are used to define the 'what you will do' of an event.",  # noqa
            ),
        ),
        InputBlock(
            label=PlainTextObject(text="Create a new event tag"),
            element=PlainTextInputElement(placeholder=PlainTextObject(text="New event tag")),
            block_id=CALENDAR_ADD_EVENT_TAG_NEW,
            optional=False,
        ),
        InputBlock(
            label=PlainTextObject(text="Event tag color"),
            element=StaticSelectElement(
                placeholder=PlainTextObject(text="Select a color"),
                options=as_selector_options(names=list(EVENT_TAG_COLORS.keys())),
            ),
            block_id=CALENDAR_ADD_EVENT_TAG_COLOR,
            optional=False,
            hint="This is the color that will be shown on the calendar",
        ),
        SectionBlock(text="Colors already in use:", block_id=CALENDAR_EVENT_TAG_COLORS_IN_USE),
    ]
)
