"""
Native Slack SDK modal views for the preblast feature.

Uses ``SdkBlockView`` (wrapping ``slack_sdk.models.blocks.*``) instead of the
legacy ``utilities.slack.orm`` module for all new preblast modals.
"""

from __future__ import annotations

from typing import Any, Iterable

from slack_sdk.models.blocks import InputBlock, SectionBlock
from slack_sdk.models.blocks.block_elements import (
    ChannelSelectElement,
    FileInputElement,
    PlainTextInputElement,
    RadioButtonsElement,
    RichTextInputElement,
    StaticMultiSelectElement,
    StaticSelectElement,
    TimePickerElement,
    UserMultiSelectElement,
)
from slack_sdk.models.blocks.basic_components import PlainTextObject, MarkdownTextObject

from application.event_instance import EventInstanceData
from application.preblast import PREBLAST_CHANNEL_META_KEY, PreblastEventTypeData
from application.preblast.service import PreblastService
from utilities.slack import actions
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

# ---------------------------------------------------------------------------
# Feature-local action IDs for SDK-only blocks
# ---------------------------------------------------------------------------
PREBLAST_CHANNEL_SELECTOR = "preblast_channel_selector"
PREBLAST_CHANNEL_SELECTOR_HINT = "preblast_channel_selector_hint"


# ---------------------------------------------------------------------------
# Modal view builders
# ---------------------------------------------------------------------------


class PreblastViews:
    """Native Slack SDK modal builders for the preblast feature.

    All methods return ``SdkBlockView`` instances.  No Slack SDK calls are
    made inside this class — the caller is responsible for posting/updating
    the view via ``SdkBlockView.post_modal`` / ``update_modal``.
    """

    @staticmethod
    def build_preblast_form(
        event: EventInstanceData,
        locations: Iterable[dict[str, Any]],
        event_tags: Iterable[dict[str, Any]],
        event_types: Iterable[PreblastEventTypeData],
        preblast_service: PreblastService,
        *,
        default_channel_id: str | None = None,
        existing_preblast_ts: int | float | None = None,
        preblast_moleskin_template: Any | None = None,
    ) -> SdkBlockView:
        """Build the editable preblast form modal as an ``SdkBlockView``.

        Parameters
        ----------
        event:
            The event instance being pre-blasted.
        locations:
            Iterable of location dicts (must have ``id`` and ``name`` keys).
        event_tags:
            Iterable of event tag dicts (must have ``id`` and ``name`` keys).
        event_types:
            Iterable of ``PreblastEventTypeData`` used for channel-selector
            eligibility checks.
        preblast_service:
            Service for eligibility checks, channel resolution, etc.
        default_channel_id:
            The region/AO default channel.
        existing_preblast_ts:
            When set, the form is for an already-posted preblast (edit mode).
        """
        blocks: list = []

        # ── Title ────────────────────────────────────────────────────────
        blocks.append(
            InputBlock(
                label="Title",
                element=PlainTextInputElement(action_id=actions.EVENT_PREBLAST_TITLE, placeholder="Event Title"),
                hint="Studies show that fun titles generate 42% more HC's!",
                optional=False,
                block_id=actions.EVENT_PREBLAST_TITLE,
            )
        )

        # ── Location ─────────────────────────────────────────────────────
        loc_options = as_selector_options(
            names=[str(loc.get("name", loc.get("id", ""))) for loc in locations],
            values=[str(loc["id"]) for loc in locations if "id" in loc],
        )
        blocks.append(
            InputBlock(
                label="Location",
                element=StaticSelectElement(action_id=actions.EVENT_PREBLAST_LOCATION, placeholder="Select a location", options=loc_options),
                optional=False,
                block_id=actions.EVENT_PREBLAST_LOCATION,
            )
        )

        # ── Start Time ───────────────────────────────────────────────────
        blocks.append(
            InputBlock(
                label="Start Time",
                element=TimePickerElement(action_id=actions.EVENT_PREBLAST_START_TIME, placeholder="Select start time"),
                optional=False,
                block_id=actions.EVENT_PREBLAST_START_TIME,
            )
        )

        # ── Co-Qs ────────────────────────────────────────────────────────
        blocks.append(
            InputBlock(
                label="Co-Qs",
                element=UserMultiSelectElement(action_id=actions.EVENT_PREBLAST_COQS, placeholder="Select Co-Qs"),
                optional=True,
                block_id=actions.EVENT_PREBLAST_COQS,
            )
        )

        # ── Event Tag ────────────────────────────────────────────────────
        tag_options = as_selector_options(
            names=[str(tag.get("name", tag.get("id", ""))) for tag in event_tags if tag.get("name") != "Open"],
            values=[str(tag["id"]) for tag in event_tags if tag.get("name") != "Open" and "id" in tag],
        )
        blocks.append(
            InputBlock(
                label="Event Tag",
                element=StaticMultiSelectElement(
                    action_id=actions.EVENT_PREBLAST_TAG,
                    placeholder="Select Event Tag",
                    options=tag_options,
                    max_selected_items=1,
                ),
                optional=True,
                block_id=actions.EVENT_PREBLAST_TAG,
            )
        )

        # ── Preblast rich text ───────────────────────────────────────────
        blocks.append(
            InputBlock(
                label="Preblast",
                element=RichTextInputElement(action_id=actions.EVENT_PREBLAST_MOLESKINE_EDIT, placeholder="Give us an event preview!"),
                optional=False,
                block_id=actions.EVENT_PREBLAST_MOLESKINE_EDIT,
            )
        )

        # ── Preblast Image ───────────────────────────────────────────────
        blocks.append(
            InputBlock(
                label="Preblast Image",
                element=FileInputElement(
                    action_id=actions.EVENT_PREBLAST_IMAGE,
                    filetypes=["jpg", "jpeg", "png", "gif"],
                    max_files=1,
                ),
                optional=True,
                hint="Missing images from iOS? HEICs are a pain, write Tim Cook and tell him to stop using proprietary formats that break everything",
                block_id=actions.EVENT_PREBLAST_IMAGE,
            )
        )

        # ── Channel selector (conditionally shown) ──────────────────────
        show_channel_selector = False
        selected_channel: str | None = None
        if default_channel_id:
            if preblast_service.is_channel_selector_eligible(event, event_types):
                show_channel_selector = True
                selection = preblast_service.resolve_destination_channel(event, default_channel_id)
                selected_channel = selection.desired_channel_id or default_channel_id

        if show_channel_selector:
            channel_block = InputBlock(
                label="Preblast Destination Channel",
                element=ChannelSelectElement(action_id=PREBLAST_CHANNEL_SELECTOR, placeholder="Select a channel..."),
                optional=True,
                block_id=PREBLAST_CHANNEL_SELECTOR,
            )
            blocks.append(channel_block)
        elif default_channel_id:
            blocks.append(
                SectionBlock(
                    text=MarkdownTextObject(text=f"Preblast will be posted in <#{default_channel_id}>"),
                    block_id=PREBLAST_CHANNEL_SELECTOR_HINT,
                )
            )

        # ── Send options / update mode (dynamic) ───────────────────────
        # When the preblast has NOT been posted and a channel exists:
        #   show "Send now" / "Send a day before the event" radio.
        # When the preblast HAS been posted and a channel exists:
        #   show "Update preblast" / "Repost preblast" radio.
        # When no channel: show a notice that it won't be posted.
        is_posted = existing_preblast_ts is not None
        if not default_channel_id:
            blocks.append(
                SectionBlock(
                    text=MarkdownTextObject(
                        text=(
                            "A slack channel has not been set for this AO or region, so this will not be posted. "
                            "An admin can set the channel for the AO through Calendar Settings -> Manage AOs or "
                            "for the region through Backblast & Preblast Settings."
                        )
                    ),
                    block_id="preblast_no_channel_notice",
                )
            )
        elif is_posted:
            blocks.append(
                InputBlock(
                    label="How would you like to update the preblast?",
                    element=RadioButtonsElement(
                        action_id=actions.EVENT_PREBLAST_UPDATE_MODE,
                        options=as_selector_options(names=["Update preblast", "Repost preblast"]),
                        initial_option=as_selector_options(names=["Update preblast"])[0],
                    ),
                    optional=False,
                    block_id=actions.EVENT_PREBLAST_UPDATE_MODE,
                )
            )
        else:
            # Not posted yet — show send options
            # Default to "Send a day before" if event is >1 day away, else "Send now"
            from datetime import date

            schedule_default = "Send now"
            if event.start_date:
                today = date.today()
                if event.start_date > today and (event.start_date - today).days > 1:
                    schedule_default = "Send a day before the event"
            send_options = as_selector_options(
                names=["Send now", "Send a day before the event"],
            )
            initial_option = next(
                (o for o in send_options if o.value == schedule_default),
                send_options[0],
            )
            blocks.append(
                InputBlock(
                    label="When would you like to send the preblast?",
                    element=RadioButtonsElement(
                        action_id=actions.EVENT_PREBLAST_SEND_OPTIONS,
                        options=send_options,
                        initial_option=initial_option,
                    ),
                    optional=False,
                    block_id=actions.EVENT_PREBLAST_SEND_OPTIONS,
                )
            )

        form = SdkBlockView(blocks=blocks)

        # ── Populate initial values ─────────────────────────────────────
        initial_values: dict[str, Any] = {}
        if event.name:
            initial_values[actions.EVENT_PREBLAST_TITLE] = event.name
        if event.start_time:
            initial_values[actions.EVENT_PREBLAST_START_TIME] = f"{event.start_time[:2]}:{event.start_time[2:]}"
        if event.preblast_rich:
            initial_values[actions.EVENT_PREBLAST_MOLESKINE_EDIT] = event.preblast_rich
        elif preblast_moleskin_template:
            initial_values[actions.EVENT_PREBLAST_MOLESKINE_EDIT] = preblast_moleskin_template
        if event.location_id:
            initial_values[actions.EVENT_PREBLAST_LOCATION] = str(event.location_id)
        if event.event_tag_ids:
            initial_values[actions.EVENT_PREBLAST_TAG] = [str(tid) for tid in event.event_tag_ids[:1]]

        # Channel selector initial value
        if show_channel_selector and selected_channel:
            initial_values[PREBLAST_CHANNEL_SELECTOR] = selected_channel

        if initial_values:
            form.set_initial_values(initial_values)

        return form

    @staticmethod
    def build_select_form(
        upcoming_events: list[EventInstanceData],
        *,
        max_buttons: int = 4,
    ) -> SdkBlockView:
        """Build the event-selector modal showing the user's upcoming Qs."""
        blocks: list = []

        if upcoming_events:
            blocks.append(
                SectionBlock(
                    text=PlainTextObject(text=":point_up: *Select From Upcoming Qs:*"),
                    block_id="preblast_select_header",
                )
            )

            event_lines = "\n".join(
                f"• {r.start_date} {r.name or 'Untitled'}"
                for r in upcoming_events[:max_buttons]
            )
            blocks.append(
                SectionBlock(
                    text=PlainTextObject(text=event_lines),
                    block_id="preblast_select_list",
                )
            )
        else:
            blocks.append(
                SectionBlock(
                    text=PlainTextObject(
                        text="Looks like you are caught up! You have no upcoming Qs that have not already been posted for."
                    ),
                    block_id="preblast_select_empty",
                )
            )

        return SdkBlockView(blocks=blocks)
