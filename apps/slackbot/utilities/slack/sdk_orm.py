import json
from typing import Any, Dict, List

from slack_sdk.models.blocks import Block, ImageBlock, InputBlock, SectionBlock
from slack_sdk.models.blocks.basic_components import Option
from slack_sdk.models.views import View

# slack_sdk.models.composition_objects.Option
from utilities.constants import ENABLE_DEBUGGING
from utilities.helper_functions import safe_get
from utilities.slack import actions


def as_selector_options(names: List[str], values: List[str] = None, descriptions: List[str] = None) -> List[Option]:
    """Helper to create a list of Option objects from a list of names and values."""
    options = []
    for i, name in enumerate(names):
        value = values[i] if values else name
        description = descriptions[i] if descriptions else None
        options.append(Option(text=name, value=value, description=description))
    if not options:
        options.append(Option(text="No options available", value="none"))
    return options


class SdkBlockView:
    """
    A wrapper for building Slack views using slack_sdk.models objects.
    This provides similar functionality to the custom BlockView but uses the
    official slack_sdk components as the base.
    """

    def __init__(self, blocks: List[Block]):
        self.blocks = blocks

    def delete_block(self, block_id: str):
        """Removes a block from the view by its block_id."""
        self.blocks = [b for b in self.blocks if getattr(b, "block_id", None) != block_id]

    def add_block(self, block: Block):
        """Adds a block to the view."""
        self.blocks.append(block)

    def get_block(self, block_id: str) -> Block | None:
        """Finds a block in the view by its block_id."""
        for block in self.blocks:
            if getattr(block, "block_id", None) == block_id:
                return block
        return None

    def set_initial_values(self, values: dict):
        """
        Sets initial values for elements within the blocks.
        NOTE: This has limited support and works best with InputBlocks.
        """
        for block in self.blocks:
            if isinstance(block, InputBlock) and block.block_id in values:
                if hasattr(block.element, "initial_value"):
                    if block.element.type == "number_input":
                        if isinstance(values[block.block_id], str):
                            try:
                                values[block.block_id] = float(values[block.block_id])
                            except ValueError:
                                values[block.block_id] = 0.0
                        if block.element.is_decimal_allowed:
                            values[block.block_id] = round(values[block.block_id], 4)
                        else:
                            values[block.block_id] = int(values[block.block_id])
                    block.element.initial_value = str(values[block.block_id])
                elif block.element.type in ["multi_static_select", "checkboxes"]:
                    block.element.initial_options = []
                    for value in values[block.block_id]:
                        selected_option = next((x for x in block.element.options if x.value == value), None)
                        if selected_option:
                            block.element.initial_options.append(selected_option)
                elif block.element.type in ["static_select", "radio_buttons"]:
                    selected_option = next(
                        (x for x in block.element.options if x.value == values[block.block_id]), None
                    )
                    if selected_option:
                        block.element.initial_option = selected_option
                elif block.element.type == "external_select":
                    block.element.initial_option = {
                        "text": {"type": "plain_text", "text": values[block.block_id].get("text", "")},
                        "value": values[block.block_id].get("value", ""),
                    }
                elif block.element.type == "multi_external_select":
                    for value in values[block.block_id]:
                        block.element.initial_options.append(
                            {
                                "text": {"type": "plain_text", "text": value.get("text", "")},
                                "value": value.get("value", ""),
                            }
                        )
                elif block.element.type == "channels_select":
                    block.element.initial_channel = values[block.block_id]
                elif block.element.type == "multi_channels_select":
                    block.element.initial_channels = values[block.block_id]
                elif block.element.type == "conversations_select":
                    block.element.initial_conversation = values[block.block_id]
                elif block.element.type == "multi_conversations_select":
                    block.element.initial_conversations = values[block.block_id]
                elif block.element.type == "datepicker":
                    block.element.initial_date = values[block.block_id]
                elif block.element.type == "timepicker":
                    block.element.initial_time = values[block.block_id]
                elif block.element.type == "users_select":
                    block.element.initial_user = values[block.block_id]
                elif block.element.type == "multi_users_select":
                    block.element.initial_users = values[block.block_id]
                # TODO: Add support for context block
            elif isinstance(block, SectionBlock) and block.block_id in values:
                if hasattr(block.text, "text"):
                    block.text.text = values[block.block_id]
            elif isinstance(block, ImageBlock) and block.block_id in values:
                block.image_url = values[block.block_id]

    def set_options(self, options: Dict[str, List[Option]]):
        """
        Sets options for select elements within the blocks.
        """
        for block in self.blocks:
            if isinstance(block, InputBlock) and block.block_id in options:
                if hasattr(block.element, "options"):
                    option_list = options[block.block_id]
                    for option in option_list:
                        if option.label is not None:
                            option.label = option.label[:75]
                        if option.description:
                            option.description = option.description[:75]
                    block.element.options = option_list

    def to_dict_list(self) -> List[dict]:
        """Serializes all blocks to a list of dictionaries."""
        return [b.to_dict() for b in self.blocks]

    def get_selected_values(self, body: dict) -> dict:
        """
        Parses the selected values from a view_submission payload.
        This is based on the structure of `view.state.values`.
        """
        values = safe_get(body, "view", "state", "values")
        if not values:
            return {}

        selected_values = {}
        for block_id, block_values in values.items():
            for _, state in block_values.items():
                element_type = state.get("type")
                value = None
                if element_type in [
                    "plain_text_input",
                    "email_text_input",
                    "url_text_input",
                    "number_input",
                    "datepicker",
                    "timepicker",
                ]:
                    value = state.get("value")
                elif element_type in ["users_select", "conversations_select", "channels_select"]:
                    value = (
                        state.get("selected_user")
                        or state.get("selected_conversation")
                        or state.get("selected_channel")
                    )
                elif element_type in ["multi_users_select", "multi_conversations_select", "multi_channels_select"]:
                    value = (
                        state.get("selected_users")
                        or state.get("selected_conversations")
                        or state.get("selected_channels")
                    )
                elif element_type in ["static_select", "external_select", "radio_buttons"]:
                    if state.get("selected_option"):
                        value = state.get("selected_option", {}).get("value")
                elif element_type in ["multi_static_select", "multi_external_select", "checkboxes"]:
                    value = [o.get("value") for o in state.get("selected_options", [])]
                elif element_type == "rich_text_input":
                    value = state.get("rich_text_value")
                elif element_type == "file_input":
                    value = state.get("files")

                selected_values[block_id] = value
        return selected_values

    def post_modal(
        self,
        client: Any,
        trigger_id: str,
        title_text: str,
        callback_id: str,
        submit_button_text: str = "Submit",
        parent_metadata: dict = None,
        close_button_text: str = "Close",
        notify_on_close: bool = False,
        new_or_add: str = "new",
    ) -> dict:
        """Posts the view as a new modal."""
        view = View(
            type="modal",
            callback_id=callback_id,
            title=title_text,
            close=close_button_text,
            notify_on_close=notify_on_close,
            blocks=self.blocks,
            submit=submit_button_text if submit_button_text and submit_button_text.lower() != "none" else None,
        )
        if parent_metadata:
            view.private_metadata = json.dumps(parent_metadata)

        if ENABLE_DEBUGGING:
            view.external_id = actions.DEBUG_FORM_EXTERNAL_ID
            return client.views_update(external_id=actions.DEBUG_FORM_EXTERNAL_ID, view=view.to_dict())
        elif new_or_add == "new":
            return client.views_open(trigger_id=trigger_id, view=view.to_dict())
        elif new_or_add == "add":
            return client.views_push(trigger_id=trigger_id, view=view.to_dict())

    def update_modal(
        self,
        client: Any,
        view_id: str,
        title_text: str,
        callback_id: str,
        submit_button_text: str = "Submit",
        parent_metadata: dict = None,
        close_button_text: str = "Close",
        notify_on_close: bool = False,
        external_id: str = None,
    ):
        """Updates an existing modal view."""
        view = View(
            type="modal",
            callback_id=callback_id,
            title=title_text,
            close=close_button_text,
            notify_on_close=notify_on_close,
            blocks=self.blocks,
            submit=submit_button_text if submit_button_text and submit_button_text.lower() != "none" else None,
        )
        if parent_metadata:
            view.private_metadata = json.dumps(parent_metadata)

        try:
            if ENABLE_DEBUGGING:
                view.external_id = actions.DEBUG_FORM_EXTERNAL_ID
                return client.views_update(external_id=actions.DEBUG_FORM_EXTERNAL_ID, view=view.to_dict())
            elif external_id:
                return client.views_update(external_id=external_id, view=view.to_dict())
            else:
                return client.views_update(view_id=view_id, view=view.to_dict())
        except Exception as e:
            # TODO: handle "not found" errors; post new instead of update?
            print(f"Failed to update modal: {e}")
