import json
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List

from slack_sdk.web import WebClient

from utilities.constants import ENABLE_DEBUGGING
from utilities.helper_functions import safe_get
from utilities.slack import actions


@dataclass
class BaseElement:
    placeholder: str = None
    initial_value: str = None

    def make_placeholder_field(self):
        return {"placeholder": {"type": "plain_text", "text": self.placeholder, "emoji": True}}

    def get_selected_value():
        return "Not yet implemented"


@dataclass
class BaseBlock:
    label: str = None
    action: str = None
    element: BaseElement = None

    def make_label_field(self, text=None):
        return {"type": "plain_text", "text": text or self.label or "", "emoji": True}

    def as_form_field(self, initial_value=None):
        raise Exception("Not Implemented")

    def get_selected_value(self, input_data, action):
        return "Not yet implemented"


@dataclass
class BaseAction:
    label: str
    action: str

    def make_label_field(self, text=None):
        return {"type": "plain_text", "text": text or self.label, "emoji": True}

    def as_form_field(self, initial_value=None):
        raise Exception("Not Implemented")


@dataclass
class InputBlock(BaseBlock):
    optional: bool = True
    element: BaseElement = None
    dispatch_action: bool = False
    hint: str = None

    def get_selected_value(self, input_data):
        return self.element.get_selected_value(input_data, self.action)

    def as_form_field(self):
        block = {
            "type": "input",
            "block_id": self.action,
            "optional": self.optional,
            "label": self.make_label_field(),
        }
        block.update({"element": self.element.as_form_field(action=self.action)})
        if self.dispatch_action:
            block.update({"dispatch_action": True})
        if self.hint:
            block.update({"hint": {"type": "plain_text", "text": self.hint, "emoji": True}})
        return block


@dataclass
class HeaderBlock(BaseBlock):
    def get_selected_value(self, input_data):
        return None

    def as_form_field(self):
        block = {
            "type": "header",
            "text": self.make_label_field(),
        }
        return block


@dataclass
class RichTextBlock(BaseBlock):
    label: Dict[str, Any] = None

    def get_selected_value(self, input_data):
        # TODO: it would be nice to get the markdown text from the input data
        return self.label

    def parse_rich_text(self, text: str) -> List[Dict[str, str]]:
        """Generates rich text block elements from a string, and parsing lists in markdown format to bullet blocks.

        Args:
            text (str): Message to parse

        Returns:
            List[Dict[str, str]]: A list of rich text block elements
        """
        if text == "":
            return [{"type": "rich_text_section", "elements": [{"type": "text", "text": " "}]}]
        msg = ""
        blocks = []
        line_list = []
        text_block = {"type": "text", "text": ""}
        list_block = {"type": "rich_text_list", "style": "bullet", "elements": []}
        lines = text.split("\n")
        matches = [line for line in lines if re.match(r"^\s*-\s", line)]

        for line in lines:
            if line not in matches:
                if len(line_list) > 0:
                    list_block_temp = list_block
                    list_block_temp["elements"] = [
                        {"type": "rich_text_section", "elements": [{"type": "text", "text": text}]}
                        for text in line_list
                    ]
                    blocks.append(list_block_temp)
                    line_list = []
                msg += line
                msg += "\n"
            else:
                if msg != "":
                    text_block_temp = text_block
                    text_block_temp["text"] = msg
                    blocks.append({"type": "rich_text_section", "elements": [text_block_temp]})
                    msg = ""

                line_list.append(line[3:])
        return blocks

    def as_form_field(self):
        block = self.label
        if self.action:
            block["block_id"] = self.action
        return self.label


@dataclass
class SectionBlock(BaseBlock):
    element: BaseElement = None

    def get_selected_value(self, input_data, **kwargs):
        return self.element.get_selected_value(input_data, self.action, **kwargs)

    def make_label_field(self, text=None):
        return {"type": "mrkdwn", "text": text or self.label or ""}

    def as_form_field(self):
        block = {"type": "section", "text": self.make_label_field()}
        if self.action:
            block["block_id"] = self.action
        if self.element:
            block.update({"accessory": self.element.as_form_field(action=self.action)})
        return block


@dataclass
class ButtonElement(BaseAction):
    style: str = None
    value: str = None
    confirm: object = None
    url: str = None

    def as_form_field(self, action: str = None):
        j = {
            "type": "button",
            "text": self.make_label_field(),
            "value": self.value or self.label,
        }
        if action or self.action:
            j["action_id"] = action or self.action
        if self.style:
            j["style"] = self.style
        if self.confirm:
            j["confirm"] = self.confirm
        if self.url:
            j["url"] = self.url
        if self.confirm:
            j["confirm"] = self.confirm.as_form_field()
        return j


@dataclass
class SelectorOption:
    name: str
    value: str
    description: str = None


def as_selector_options(names: List[str], values: List[str] = [], descriptions: List[str] = []) -> List[SelectorOption]:  # noqa: B006
    if values == [] and descriptions == []:
        selectors = [SelectorOption(name=x, value=x) for x in names]
    elif values == []:
        selectors = [
            SelectorOption(name=x, value=x, description=y[:75]) for x, y in zip(names, descriptions, strict=False)
        ]
    elif descriptions == []:
        selectors = [SelectorOption(name=x, value=y) for x, y in zip(names, values, strict=False)]
    else:
        selectors = [
            SelectorOption(name=x, value=y, description=z[:75])
            for x, y, z in zip(names, values, descriptions, strict=False)
        ]
    return selectors


@dataclass
class ConfirmObject:
    title: str
    text: str
    confirm: str
    deny: str
    style: str = None

    def as_form_field(self):
        r = {
            "title": {"type": "plain_text", "text": self.title[:100]},
            "text": {"type": "plain_text", "text": self.text[:300]},
            "confirm": {"type": "plain_text", "text": self.confirm[:30]},
            "deny": {"type": "plain_text", "text": self.deny[:30]},
        }
        if self.style:
            r["style"] = self.style
        return r


@dataclass
class StaticSelectElement(BaseElement):
    initial_value: str = None
    options: List[SelectorOption] = None
    confirm: ConfirmObject = None
    action: str = None

    # def with_options(self, options: List[SelectorOption]):
    #   return SelectorElement(self.label, self.action, options)

    def as_form_field(self, action: str = None):
        if not self.options:
            self.options = as_selector_options(["Default"])

        option_elements = [self.__make_option(o) for o in self.options]
        j = {"type": "static_select", "options": option_elements, "action_id": action or self.action}
        if self.placeholder:
            j.update(self.make_placeholder_field())

        initial_option = None
        if self.initial_value:
            initial_option = next((x for x in option_elements if x["value"] == self.initial_value), None)
            if initial_option:
                j["initial_option"] = initial_option

        if self.confirm:
            j["confirm"] = self.confirm.as_form_field()
        return j

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_option", "value")

    def __make_option(self, option: SelectorOption):
        j = {
            "text": {"type": "plain_text", "text": option.name, "emoji": True},
            "value": option.value,
        }
        if option.description:
            j["description"] = {"type": "plain_text", "text": option.description, "emoji": True}
        return j


@dataclass
class MultiStaticSelectElement(BaseElement):
    initial_value: List[str] = None
    options: List[SelectorOption] = None
    confirm: ConfirmObject = None
    action: str = None
    max_selected_items: int = None

    def as_form_field(self, action: str = None):
        if not self.options:
            self.options = as_selector_options(["Default"])

        option_elements = [self.__make_option(o) for o in self.options]
        j = {"type": "multi_static_select", "options": option_elements, "action_id": action or self.action}
        if self.placeholder:
            j.update(self.make_placeholder_field())

        initial_option = None
        if self.initial_value:
            j["initial_options"] = []
            for value in self.initial_value:
                initial_option = next((x for x in option_elements if x["value"] == value), None)
                if initial_option:
                    j["initial_options"].append(initial_option)

        if self.confirm:
            j["confirm"] = self.confirm.as_form_field()
        if self.max_selected_items:
            j["max_selected_items"] = self.max_selected_items
        return j

    def get_selected_value(self, input_data, action):
        return [o["value"] for o in (safe_get(input_data, action, action, "selected_options") or [])]

    def __make_option(self, option: SelectorOption):
        j = {
            "text": {"type": "plain_text", "text": option.name, "emoji": True},
            "value": option.value,
        }
        if option.description:
            j["description"] = {"type": "plain_text", "text": option.description, "emoji": True}
        return j


@dataclass
class MultiExternalSelectElement(BaseElement):
    initial_value: List[Dict] = None
    confirm: ConfirmObject = None
    action: str = None
    min_query_length: int = None
    max_selected_items: int = None

    def as_form_field(self, action: str = None):
        j = {"type": "multi_external_select", "action_id": action or self.action}
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.min_query_length:
            j.update({"min_query_length": self.min_query_length})
        if self.max_selected_items:
            j.update({"max_selected_items": self.max_selected_items})
        if self.initial_value:
            j["initial_options"] = []
            for option in self.initial_value:
                j["initial_options"].append(
                    {
                        "text": {"type": "plain_text", "text": option.get("text"), "emoji": True},
                        "value": option.get("value"),
                    }
                )
        if self.confirm:
            j.update({"confirm": self.confirm.as_form_field()})
        return j

    def get_selected_value(self, input_data, action):
        return [o["value"] for o in (safe_get(input_data, action, action, "selected_options") or [])]


@dataclass
class ExternalSelectElement(BaseElement):
    initial_value: Dict = None
    confirm: ConfirmObject = None
    action: str = None
    min_query_length: int = None

    def as_form_field(self, action: str = None):
        j = {"type": "external_select", "action_id": action or self.action}
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.min_query_length:
            j.update({"min_query_length": self.min_query_length})
        if self.initial_value:
            j.update(
                {
                    "initial_option": {
                        "text": {"type": "plain_text", "text": self.initial_value.get("text"), "emoji": True},
                        "value": self.initial_value.get("value"),
                    }
                }
            )
        if self.confirm:
            j.update({"confirm": self.confirm.as_form_field()})
        return j

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_option", "value")


@dataclass
class RadioButtonsElement(BaseElement):
    initial_value: str = None
    options: List[SelectorOption] = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_option", "value")

    def as_form_field(self, action: str):
        if not self.options:
            self.options = as_selector_options(["Default"])

        option_elements = [self.__make_option(o) for o in self.options]
        j = {
            "type": "radio_buttons",
            "options": option_elements,
            "action_id": action,
        }

        initial_option = None
        if self.initial_value:
            initial_option = next((x for x in option_elements if x["value"] == self.initial_value), None)
            if initial_option:
                j["initial_option"] = initial_option
        return j

    def __make_option(self, option: SelectorOption):
        return {
            "text": {"type": "plain_text", "text": option.name, "emoji": True},
            "value": option.value,
        }


@dataclass
class PlainTextInputElement(BaseElement):
    initial_value: str = None
    multiline: bool = False
    max_length: int = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "value")

    def as_form_field(self, action: str):
        j = {
            "type": "plain_text_input",
            "action_id": action,
            "initial_value": self.initial_value or "",
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.multiline:
            j["multiline"] = True
        if self.max_length:
            j["max_length"] = self.max_length
        return j


@dataclass
class EmailInputElement(BaseElement):
    initial_value: str = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "value")

    def as_form_field(self, action: str):
        j = {
            "type": "email_text_input",
            "action_id": action,
        }
        if self.initial_value:
            j["initial_value"] = self.initial_value
        if self.placeholder:
            j.update(self.make_placeholder_field())
        return j


@dataclass
class URLInputElement(BaseElement):
    initial_value: str = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "value")

    def as_form_field(self, action: str):
        j = {
            "type": "url_text_input",
            "action_id": action,
        }
        if self.initial_value:
            j["initial_value"] = self.initial_value
        if self.placeholder:
            j.update(self.make_placeholder_field())
        return j


@dataclass
class RichTextInputElement(BaseElement):
    initial_value: Dict[str, Any] = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "rich_text_value")

    def as_form_field(self, action: str):
        j = {
            "type": "rich_text_input",
            "action_id": action,
        }
        if self.initial_value:
            j["initial_value"] = self.initial_value
        if self.placeholder:
            j.update(self.make_placeholder_field())
        return j


@dataclass
class NumberInputElement(BaseElement):
    initial_value: float | str = None
    min_value: float = None
    max_value: float = None
    is_decimal_allowed: bool = True

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "value")

    def as_form_field(self, action: str):
        j = {
            "type": "number_input",
            "action_id": action,
            "is_decimal_allowed": self.is_decimal_allowed,
        }
        if self.initial_value is not None:
            if isinstance(self.initial_value, str) and self.is_decimal_allowed:
                try:
                    self.initial_value = float(self.initial_value)
                except ValueError:
                    self.initial_value = 0.0
                j["initial_value"] = str(round(self.initial_value, 4))
            elif isinstance(self.initial_value, str) and not self.is_decimal_allowed:
                try:
                    self.initial_value = int(self.initial_value)
                except ValueError:
                    self.initial_value = 0
                j["initial_value"] = str(self.initial_value)
            elif self.is_decimal_allowed:
                j["initial_value"] = str(round(self.initial_value, 4))
            else:
                j["initial_value"] = str(int(self.initial_value))
        if self.min_value:
            j["min_value"] = str(self.min_value)
        if self.max_value:
            j["max_value"] = str(self.max_value)
        return j


@dataclass
class ChannelsSelectElement(BaseElement):
    initial_value: str = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_channel")

    def as_form_field(self, action: str):
        j = {
            "type": "channels_select",
            "action_id": action,
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.initial_value:
            j["initial_channel"] = self.initial_value
        return j


@dataclass
class MultiChannelsSelectElement(BaseElement):
    initial_value: List[str] = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_channels")

    def as_form_field(self, action: str):
        j = {
            "type": "multi_channels_select",
            "action_id": action,
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.initial_value:
            j["initial_channels"] = self.initial_value
        return j


@dataclass
class ConversationsSelectElement(BaseElement):
    initial_value: str = None
    filter: List[str] = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_conversation")

    def as_form_field(self, action: str):
        j = {
            "type": "conversations_select",
            "action_id": action,
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.initial_value:
            j["initial_conversation"] = self.initial_value
        if self.filter:
            j["filter"] = {"include": self.filter}
        return j


@dataclass
class DatepickerElement(BaseElement):
    initial_value: str = None
    action: str = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_date")

    def as_form_field(self, action: str = None):
        j = {
            "type": "datepicker",
            "action_id": action or self.action,
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.initial_value:
            j["initial_date"] = self.initial_value
        return j


@dataclass
class TimepickerElement(BaseElement):
    initial_value: str = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_time")

    def as_form_field(self, action: str):
        j = {
            "type": "timepicker",
            "action_id": action,
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.initial_value:
            j["initial_time"] = self.initial_value
        return j


@dataclass
class UsersSelectElement(BaseElement):
    initial_value: str = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_user")

    def as_form_field(self, action: str):
        j = {
            "type": "users_select",
            "action_id": action,
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.initial_value:
            j["initial_user"] = self.initial_value
        return j


@dataclass
class MultiUsersSelectElement(BaseElement):
    initial_value: List[str] = None
    max_selected_items: int = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "selected_users")

    def as_form_field(self, action: str):
        j = {
            "type": "multi_users_select",
            "action_id": action,
        }
        if self.placeholder:
            j.update(self.make_placeholder_field())
        if self.initial_value:
            j["initial_users"] = self.initial_value
        if self.max_selected_items:
            j["max_selected_items"] = self.max_selected_items
        return j


@dataclass
class FileInputElement(BaseElement):
    max_files: int = None
    filetypes: List[str] = None

    def get_selected_value(self, input_data, action):
        return safe_get(input_data, action, action, "files")

    def as_form_field(self, action: str):
        j = {
            "type": "file_input",
            "action_id": action,
        }
        if self.max_files:
            j["max_files"] = self.max_files
        if self.filetypes:
            j["filetypes"] = self.filetypes
        return j


@dataclass
class CheckboxInputElement(BaseElement):
    initial_value: List[str] = None
    options: List[SelectorOption] = None
    action: str = None

    def get_selected_value(self, input_data, action):
        return [o["value"] for o in (safe_get(input_data, action, action, "selected_options") or [])]

    def as_form_field(self, action: str = None):
        if not self.options:
            self.options = as_selector_options(["Default"])

        option_elements = [self.__make_option(o) for o in self.options]
        j = {
            "type": "checkboxes",
            "options": option_elements,
            "action_id": action or self.action,
        }

        initial_options = []
        if self.initial_value:
            initial_options = [x for x in option_elements if x["value"] in self.initial_value]
            if initial_options:
                j["initial_options"] = initial_options
        return j

    def __make_option(self, option: SelectorOption):
        option_dict = {
            "text": {"type": "plain_text", "text": option.name, "emoji": True},
            "value": option.value,
        }
        if option.description:
            option_dict["description"] = {"type": "plain_text", "text": option.description, "emoji": True}
        return option_dict


@dataclass
class OverflowElement(BaseElement):
    options: List[SelectorOption] = None
    action: str = None
    confirm: ConfirmObject = None

    def as_form_field(self, action: str = None):
        if not self.options:
            self.options = as_selector_options(["Default"])

        option_elements = [self.__make_option(o) for o in self.options]
        j = {
            "type": "overflow",
            "options": option_elements,
            "action_id": action or self.action,
        }
        if self.confirm:
            j["confirm"] = self.confirm.as_form_field()

        return j

    def __make_option(self, option: SelectorOption):
        return {
            "text": {"type": "plain_text", "text": option.name, "emoji": True},
            "value": option.value,
        }


@dataclass
class ContextBlock(BaseBlock):
    element: BaseElement = None
    initial_value: str = ""

    def get_selected_value(self, input_data, action):
        for block in input_data:
            if block["block_id"] == action:
                return block["elements"][0]["text"]
        return None

    def as_form_field(self):
        j = {"type": "context"}
        j.update({"elements": [self.element.as_form_field()]})
        if self.action:
            j["block_id"] = self.action
        return j


@dataclass
class ImageBlock(BaseBlock):
    image_url: str = None
    alt_text: str = None
    slack_file_id: str = None

    def as_form_field(self, action: str = None):
        j = {
            "type": "image",
            # "image_url": self.image_url,
            "alt_text": self.alt_text,
        }
        if self.image_url:
            j["image_url"] = self.image_url
        elif self.slack_file_id:
            j["slack_file"] = {"id": self.slack_file_id}
        if self.action:
            j["block_id"] = self.action
        if self.label:
            j["title"] = self.make_label_field()
        return j


@dataclass
class ContextElement(BaseElement):
    initial_value: str = None

    def as_form_field(self):
        j = {
            "type": "mrkdwn",
            "text": self.initial_value,
        }
        return j


@dataclass
class DividerBlock(BaseBlock):
    def as_form_field(self):
        return {"type": "divider"}


@dataclass
class ActionsBlock(BaseBlock):
    elements: List[BaseAction] = field(default_factory=list)

    def as_form_field(self):
        j = {
            "type": "actions",
            "elements": [e.as_form_field() for e in self.elements],
        }
        if self.action:
            j["block_id"] = self.action
        return j


@dataclass
class BlockView:
    blocks: List[BaseBlock]

    def delete_block(self, action: str):
        self.blocks = [b for b in self.blocks if b.action != action]

    def add_block(self, block: BaseBlock):
        self.blocks.append(block)

    def set_initial_values(self, values: dict):
        for block in self.blocks:
            if block.action in values and isinstance(block, InputBlock):
                block.element.initial_value = values[block.action]
            elif block.action in values and isinstance(block, SectionBlock):
                block.label = values[block.action]
            elif block.action in values and isinstance(block, ImageBlock):
                block.image_url = values[block.action]

    def set_options(self, options: Dict[str, List[SelectorOption]]):
        for block in self.blocks:
            if block.action in options:
                option_list = options[block.action]
                for option in option_list:
                    option.name = option.name[:75]
                    if option.description:
                        option.description = option.description[:75]
                block.element.options = option_list

    def as_form_field(self) -> List[dict]:
        return [b.as_form_field() for b in self.blocks]

    def get_selected_values(self, body) -> dict:
        values = body["view"]["state"]["values"]
        view_blocks = body["view"]["blocks"]

        selected_values = {}
        for block in self.blocks:
            if isinstance(block, InputBlock):
                selected_values[block.action] = block.get_selected_value(values)
            elif isinstance(block, ContextBlock) and block.action:
                selected_values[block.action] = block.get_selected_value(view_blocks, block.action)
            elif isinstance(block, ActionsBlock):  # TODO: fix this, doesn't really work yet
                for element in block.elements:
                    selected_values[element.action] = block.get_selected_value(values, element.action)

        return selected_values

    def post_modal(
        self,
        client: WebClient,
        trigger_id: str,
        title_text: str,
        callback_id: str,
        submit_button_text: str = "Submit",
        parent_metadata: dict = None,
        close_button_text: str = "Close",
        notify_on_close: bool = False,
        new_or_add: str = "new",
    ) -> dict:
        blocks = self.as_form_field()

        view = {
            "type": "modal",
            "callback_id": callback_id,
            "title": {"type": "plain_text", "text": title_text},
            "close": {"type": "plain_text", "text": close_button_text},
            "notify_on_close": notify_on_close,
            "blocks": blocks,
        }
        if parent_metadata:
            view["private_metadata"] = json.dumps(parent_metadata)

        if submit_button_text != "None":  # TODO: would prefer this to use None instead of "None"
            view["submit"] = {"type": "plain_text", "text": submit_button_text}

        if ENABLE_DEBUGGING:
            view["external_id"] = actions.DEBUG_FORM_EXTERNAL_ID
            res = client.views_update(external_id=actions.DEBUG_FORM_EXTERNAL_ID, view=view)
        elif new_or_add == "new":
            res = client.views_open(trigger_id=trigger_id, view=view)
        elif new_or_add == "add":
            res = client.views_push(trigger_id=trigger_id, view=view)
        return res

    def update_modal(
        self,
        client: WebClient,
        view_id: str,
        title_text: str,
        callback_id: str,
        submit_button_text: str = "Submit",
        parent_metadata: dict = None,
        close_button_text: str = "Close",
        notify_on_close: bool = False,
    ) -> dict:
        blocks = self.as_form_field()

        view = {
            "type": "modal",
            "callback_id": callback_id,
            "title": {"type": "plain_text", "text": title_text},
            "close": {"type": "plain_text", "text": close_button_text},
            "notify_on_close": notify_on_close,
            "blocks": blocks,
        }
        if parent_metadata:
            view["private_metadata"] = json.dumps(parent_metadata)
        if submit_button_text != "None":
            view["submit"] = {"type": "plain_text", "text": submit_button_text}

        try:
            if ENABLE_DEBUGGING:
                view["external_id"] = actions.DEBUG_FORM_EXTERNAL_ID
                res = client.views_update(external_id=actions.DEBUG_FORM_EXTERNAL_ID, view=view)
            else:
                res = client.views_update(view_id=view_id, view=view)
        except Exception as e:
            # TODO: handle "not found" errors; post new instead of update?
            print(f"Failed to update modal: {e}")
            res = None

        return res


def parse_welcome_template(template: str, user_id: str) -> List[BaseBlock]:
    blocks = []

    # 1. Insert user name into template
    msg = template.replace("{user}", f"<@{user_id}>")

    # 2. Insert divider blocks
    msg_split = msg.split("/divider")
    blocks.append(SectionBlock(label=msg_split[0]))

    if len(msg_split) > 1:
        for m in msg_split[1:]:
            blocks.append(DividerBlock())
            blocks.append(SectionBlock(label=m))

    return blocks
