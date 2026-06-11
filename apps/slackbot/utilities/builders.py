import copy
import time
from logging import Logger
from typing import Any, Dict

from slack_sdk.models.blocks import (
    ContextBlock,
    DividerBlock,
    SectionBlock,
)
from slack_sdk.models.blocks.basic_components import PlainTextObject
from slack_sdk.models.views import View
from slack_sdk.web import WebClient

from utilities import constants
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get
from utilities.slack import actions, forms

# from pymysql.err import ProgrammingError


def submit_modal() -> Dict[str, Any]:
    return {
        "response_action": "update",
        "view": View(
            type="modal",
            title="Submitting...",
            external_id=actions.SUBMIT_MODAL_EXTERNAL_ID,
            blocks=[
                SectionBlock(
                    text=PlainTextObject(text="Submitting your form, please wait... :hourglass_flowing_sand:")
                ),
                DividerBlock(),
                ContextBlock(
                    elements=[
                        PlainTextObject(
                            text="If this takes longer than 10 seconds, please check back later or contact support."
                        )
                    ]
                ),
            ],
        ),
    }


def submit_modal_success() -> Dict[str, Any]:
    return {
        "response_action": "update",
        "view": View(
            type="modal",
            title="Submitting...",
            external_id=actions.SUBMIT_MODAL_EXTERNAL_ID,
            blocks=[
                SectionBlock(
                    text=PlainTextObject(
                        text=":white_check_mark: Your data was saved successfully! You can close this form now."
                    )  # noqa: E501
                ),
            ],
        ),
    }


def update_submit_modal(client: WebClient, logger: Logger, text: str) -> Dict[str, Any]:
    view = View(
        type="modal",
        title="Success!",
        external_id=actions.SUBMIT_MODAL_EXTERNAL_ID,
        blocks=[
            SectionBlock(text=f":white_check_mark: {text} You can close this form now."),
        ],
    )
    try:
        client.views_update(
            external_id=actions.SUBMIT_MODAL_EXTERNAL_ID,
            view=view.to_dict(),
        )
    except Exception as e:
        logger.error(f"Failed to update submit modal: {e}")


def add_loading_form(body: dict, client: WebClient, new_or_add: str = "new") -> str:
    trigger_id = safe_get(body, "trigger_id")
    if safe_get(body, "view", "id"):
        loading_form_response = forms.LOADING_FORM.update_modal(
            client=client,
            view_id=safe_get(body, "view", "id"),
            title_text="Loading...",
            submit_button_text="None",
            callback_id="loading-id",
        )
    else:
        loading_form_response = forms.LOADING_FORM.post_modal(
            client=client,
            trigger_id=trigger_id,
            title_text="Loading...",
            submit_button_text="None",
            callback_id="loading-id",
            new_or_add=new_or_add,
        )
    # wait 0.1 seconds
    time.sleep(0.3)
    print(f"loading_form_response: {loading_form_response}")
    return safe_get(loading_form_response, "view", "id")


def add_debug_form(body: dict, client: WebClient, new_or_add: str = "new") -> str:
    trigger_id = safe_get(body, "trigger_id")

    form = View(
        type="modal",
        title="Debug Mode",
        external_id=actions.DEBUG_FORM_EXTERNAL_ID,
        blocks=[
            SectionBlock(text=":beetle: Debug Mode"),
        ],
    )

    view_id = safe_get(body, "view", "id")
    view_hash = safe_get(body, "view", "hash")

    if view_id:
        # We are already in a modal context (e.g., view_submission). Update that modal by id.
        res = client.views_update(
            view_id=view_id,
            hash=view_hash,
            view=form.to_dict(),
        )
    else:
        # We have a trigger_id (e.g., block_actions/shortcuts). Open a new modal.
        res = client.views_open(
            trigger_id=trigger_id,
            view=form.to_dict(),
        )

    return safe_get(res, "view", "id")


def ignore_event(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    logger.debug("Ignoring event")


def send_error_response(body: dict, client: WebClient, error: str) -> None:
    error_form = copy.deepcopy(forms.ERROR_FORM)
    error_msg = constants.ERROR_FORM_MESSAGE_TEMPLATE.format(error=error)
    error_form.set_initial_values({actions.ERROR_FORM_MESSAGE: error_msg})

    # if safe_get(body, actions.LOADING_ID):
    #     update_view_id = safe_get(body, actions.LOADING_ID)
    #     error_form.update_modal(
    #         client=client,
    #         view_id=update_view_id,
    #         title_text="F3 Nation Error",
    #         submit_button_text="None",
    #         callback_id="error-id",
    #     )
    # else:
    blocks = [block.as_form_field() for block in error_form.blocks]
    client.chat_postMessage(channel=safe_get(body, "user", "id"), text=error, blocks=blocks)
