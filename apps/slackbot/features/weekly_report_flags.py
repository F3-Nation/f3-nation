import copy
import json
import re
from logging import Logger

from f3_data_models.models import SlackSpace
from f3_data_models.utils import DbManager
from slack_sdk.models import blocks
from slack_sdk.web import WebClient

from scripts.weekly_reporting import FLAG_HOLDER_LOCATION, FLAG_HOLDER_PAX, FLAG_HOLDER_TYPE_OPTIONS
from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_get
from utilities.slack.sdk_orm import SdkBlockView, as_selector_options

MANAGE_WEEKLY_FLAGS = "manage_weekly_flags"
WEEKLY_FLAGS_MENU_CALLBACK_ID = "weekly_flags_menu"
WEEKLY_FLAG_ADD = "weekly_flag_add"
WEEKLY_FLAG_EDIT = "weekly_flag_edit"
WEEKLY_FLAG_DELETE = "weekly_flag_delete"
WEEKLY_FLAG_ADD_CALLBACK_ID = "weekly_flag_add_edit"
WEEKLY_FLAG_ENABLED_PREFIX = "weekly_flag_enabled"

WEEKLY_FLAG_NAME = "weekly_flag_name"
WEEKLY_FLAG_HASHTAG = "weekly_flag_hashtag"
WEEKLY_FLAG_CUSTOM_FIELD_NAME = "weekly_flag_custom_field_name"

NO_CUSTOM_FIELDS_OPTION = "(No custom fields configured yet)"


def _slugify(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "-", name.strip().lower()).strip("-") or "trophy"


def build_weekly_flags_menu(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id: str = None,
) -> None:
    trigger_id = safe_get(body, "trigger_id")
    trophies = region_record.weekly_report_flags or {}

    form_blocks = [
        blocks.ContextBlock(
            elements=[
                blocks.MarkdownTextObject(
                    text="Named trophies (Ghost Flag, Pirate Flag, HIM Belt, ...). PAX-held and location-held "
                    "trophies are both best tracked via a Custom Field the Q fills in on the backblast (set "
                    "one up under Backblast & Preblast Settings -> Custom Field Settings — use the 'PAX' "
                    "field type for a real person picker, or 'Location' for a real channel picker). "
                    "Location-held trophies can fall back to hashtag detection (scanning preblast/backblast "
                    "text) instead if you'd rather not use a Custom Field. Only shown in the weekly report if "
                    "'Trophies' is checked in Weekly Report Sections."
                )
            ]
        ),
    ]
    for key, trophy in trophies.items():
        holder_type = trophy.get("holder_type", FLAG_HOLDER_LOCATION)
        holder_label = FLAG_HOLDER_TYPE_OPTIONS.get(holder_type)
        if trophy.get("custom_field_name"):
            source_line = f"Custom Field: {trophy['custom_field_name']}"
        elif holder_type == FLAG_HOLDER_LOCATION:
            source_line = f"Hashtag: #{trophy.get('hashtag') or '(not set)'}"
        else:
            source_line = "Custom Field: (not set)"
        label = f"Name: {trophy['name']}\n{source_line}\nHeld by: {holder_label}"
        toggle_block_id = f"{WEEKLY_FLAG_ENABLED_PREFIX}_{key}"
        form_blocks.extend(
            [
                blocks.InputBlock(
                    label=label,
                    element=blocks.RadioButtonsElement(
                        action_id=toggle_block_id,
                        options=as_selector_options(names=["Enabled", "Disabled"], values=["enable", "disable"]),
                    ),
                    optional=False,
                    block_id=toggle_block_id,
                ),
                blocks.ActionsBlock(
                    elements=[
                        blocks.ButtonElement(text="Edit", action_id=WEEKLY_FLAG_EDIT, value=key),
                        blocks.ButtonElement(text="Delete", action_id=WEEKLY_FLAG_DELETE, value=key, style="danger"),
                    ]
                ),
                blocks.DividerBlock(),
            ]
        )

    form_blocks.append(
        blocks.ActionsBlock(elements=[blocks.ButtonElement(text="Add Trophy", action_id=WEEKLY_FLAG_ADD, value="add")])
    )

    form = SdkBlockView(blocks=form_blocks)
    form.set_initial_values(
        {
            f"{WEEKLY_FLAG_ENABLED_PREFIX}_{key}": "enable" if trophy.get("enabled", True) else "disable"
            for key, trophy in trophies.items()
        }
    )

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=WEEKLY_FLAGS_MENU_CALLBACK_ID,
            title_text="Manage Trophies",
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=trigger_id,
            callback_id=WEEKLY_FLAGS_MENU_CALLBACK_ID,
            title_text="Manage Trophies",
            new_or_add="add",
        )


def handle_weekly_flags_menu(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    """Saves the Enabled/Disabled toggles from the trophies menu (submitted as one form)."""
    values = SdkBlockView(blocks=[]).get_selected_values(body)
    trophies = region_record.weekly_report_flags or {}
    for block_id, value in values.items():
        if block_id.startswith(f"{WEEKLY_FLAG_ENABLED_PREFIX}_"):
            key = block_id[len(WEEKLY_FLAG_ENABLED_PREFIX) + 1 :]
            if key in trophies:
                trophies[key]["enabled"] = value == "enable"

    region_record.weekly_report_flags = trophies
    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )


def _set_custom_field_options(form: SdkBlockView, region_record: SlackSettings) -> None:
    custom_fields = region_record.custom_fields or {}
    if custom_fields:
        form.set_options(
            {
                WEEKLY_FLAG_CUSTOM_FIELD_NAME: as_selector_options(
                    names=[f"{f['name']} ({f.get('type', 'Text')})" for f in custom_fields.values()],
                    values=[f["name"] for f in custom_fields.values()],
                )
            }
        )
    else:
        form.set_options(
            {WEEKLY_FLAG_CUSTOM_FIELD_NAME: as_selector_options(names=[NO_CUSTOM_FIELDS_OPTION], values=[""])}
        )


def build_weekly_flag_add_edit(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    # Slack caps modal stacks at 3 views deep (Config -> Reporting Settings -> Manage Trophies
    # is already at that cap), so this form REPLACES the open Manage Trophies view
    # (views.update) instead of pushing a 4th view (views.push), which Slack rejects with
    # push_limit_reached.
    view_id = safe_get(body, "view", "id")
    action_id = safe_get(body, "actions", 0, "action_id")

    form = copy.deepcopy(FLAG_ADD_EDIT_FORM)
    _set_custom_field_options(form, region_record)
    custom_fields = region_record.custom_fields or {}

    if action_id == WEEKLY_FLAG_NAME:
        # Re-render triggered by pressing Enter in the Name field (see its
        # dispatch_action_config below) — preserve whatever's currently typed, and
        # auto-select a Custom Field whose name exactly matches what was just typed.
        current_values = SdkBlockView(blocks=[]).get_selected_values(body)
        typed_name = (current_values.get(WEEKLY_FLAG_NAME) or "").strip()
        matched_field = next((f for f in custom_fields.values() if f["name"] == typed_name), None)
        current_custom_field_name = current_values.get(WEEKLY_FLAG_CUSTOM_FIELD_NAME) or ""
        form.set_initial_values(
            {
                WEEKLY_FLAG_NAME: typed_name,
                WEEKLY_FLAG_HASHTAG: current_values.get(WEEKLY_FLAG_HASHTAG) or "",
                WEEKLY_FLAG_CUSTOM_FIELD_NAME: matched_field["name"] if matched_field else current_custom_field_name,
            }
        )
        # Recover flag_key (if editing) from the view's already-set private_metadata —
        # this re-render isn't itself an Add/Edit button click, so body.actions[0].value
        # doesn't carry it.
        flag_key = None
        private_metadata = safe_get(body, "view", "private_metadata")
        if private_metadata:
            try:
                flag_key = json.loads(private_metadata).get("flag_key")
            except (ValueError, TypeError):
                flag_key = None
        action_text = "Edit" if flag_key else "Add"
    else:
        flag_key = safe_get(body, "actions", 0, "value") if action_id == WEEKLY_FLAG_EDIT else None
        trophy = safe_get(region_record.weekly_report_flags, flag_key or "")
        if trophy:
            form.set_initial_values(
                {
                    WEEKLY_FLAG_NAME: trophy["name"],
                    WEEKLY_FLAG_HASHTAG: trophy.get("hashtag") or "",
                    WEEKLY_FLAG_CUSTOM_FIELD_NAME: trophy.get("custom_field_name") or "",
                }
            )
            action_text = "Edit"
        else:
            action_text = "Add"

    form.update_modal(
        client=client,
        view_id=view_id,
        callback_id=WEEKLY_FLAG_ADD_CALLBACK_ID,
        title_text=f"{action_text} Trophy",
        submit_button_text=f"{action_text} Trophy",
        parent_metadata={"flag_key": flag_key} if flag_key else None,
    )


def handle_weekly_flag_add(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = FLAG_ADD_EDIT_FORM.get_selected_values(body)
    name = (form_data.get(WEEKLY_FLAG_NAME) or "").strip()
    hashtag = (form_data.get(WEEKLY_FLAG_HASHTAG) or "").strip().lstrip("#")
    custom_field_name = (form_data.get(WEEKLY_FLAG_CUSTOM_FIELD_NAME) or "").strip()

    # Held-by is derived from the selected Custom Field's own type — the admin already told
    # us that when they created the field, no need to ask again. A PAX-type field makes a
    # PAX-held trophy; any other type (Location/Dropdown/Text/Number), or no field at all
    # (hashtag-only), makes a location-held trophy.
    selected_field_type = (
        safe_get(region_record.custom_fields, custom_field_name, "type") if custom_field_name else None
    )
    holder_type = FLAG_HOLDER_PAX if selected_field_type == "PAX" else FLAG_HOLDER_LOCATION

    error = None
    if not name:
        error = "Please provide a name for the trophy."
    elif holder_type == FLAG_HOLDER_LOCATION and not hashtag and not custom_field_name:
        error = "Please provide a hashtag or select a Custom Field."
    if error:
        slack_user_id = safe_get(body, "user", "id")
        if slack_user_id:
            client.chat_postMessage(channel=slack_user_id, text=error)
        return

    original_key = None
    private_metadata = safe_get(body, "view", "private_metadata")
    if private_metadata:
        try:
            original_key = json.loads(private_metadata).get("flag_key")
        except (ValueError, TypeError):
            original_key = None

    trophies = region_record.weekly_report_flags or {}
    previously_enabled = True
    if original_key and original_key in trophies:
        previously_enabled = trophies[original_key].get("enabled", True)
        trophies.pop(original_key)

    trophies[_slugify(name)] = {
        "name": name,
        "hashtag": hashtag,
        "custom_field_name": custom_field_name,
        "holder_type": holder_type,
        "enabled": previously_enabled,
    }
    region_record.weekly_report_flags = trophies
    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )

    # This form replaced the Manage Trophies view in place (see build_weekly_flag_add_edit),
    # so the current view id IS the Manage Trophies slot — update it back to the list.
    view_id = safe_get(body, "view", "id")
    build_weekly_flags_menu(body, client, logger, context, region_record, update_view_id=view_id)


def handle_weekly_flag_delete(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    flag_key = safe_get(body, "actions", 0, "value")
    view_id = safe_get(body, "container", "view_id")

    trophies = region_record.weekly_report_flags or {}
    trophies.pop(flag_key, None)
    region_record.weekly_report_flags = trophies
    DbManager.update_records(
        cls=SlackSpace,
        filters=[SlackSpace.team_id == region_record.team_id],
        fields={SlackSpace.settings: region_record.__dict__},
    )
    build_weekly_flags_menu(body, client, logger, context, region_record, update_view_id=view_id)


FLAG_ADD_EDIT_FORM = SdkBlockView(
    blocks=[
        blocks.InputBlock(
            label="Name",
            element=blocks.PlainTextInputElement(
                action_id=WEEKLY_FLAG_NAME,
                placeholder="e.g. Ghost Flag, Pirate Flag, HIM Belt",
                dispatch_action_config={"trigger_actions_on": ["on_enter_pressed"]},
            ),
            optional=False,
            block_id=WEEKLY_FLAG_NAME,
            dispatch_action=True,
            hint="Press Enter after typing to auto-select a Custom Field with a matching name below, if one exists.",
        ),
        blocks.InputBlock(
            label="Custom Field Name",
            element=blocks.StaticSelectElement(
                action_id=WEEKLY_FLAG_CUSTOM_FIELD_NAME,
                options=as_selector_options(names=[NO_CUSTOM_FIELDS_OPTION], values=[""]),
            ),
            optional=True,
            block_id=WEEKLY_FLAG_CUSTOM_FIELD_NAME,
            hint="Recommended. Pick an existing Custom Field (set one up under Backblast & Preblast Settings "
            "-> Custom Field Settings) that Qs fill in on the backblast — its most recent value becomes the "
            "current holder. Whether this trophy is held by a location or a PAX is taken automatically from "
            "the field's own type ('PAX' or 'Location') — no need to set it separately. Leave this unset "
            "only if you want a location-held trophy to use hashtag detection instead (below).",
        ),
        blocks.InputBlock(
            label="Hashtag (fallback for location-held trophies only)",
            element=blocks.PlainTextInputElement(
                action_id=WEEKLY_FLAG_HASHTAG, placeholder="e.g. ghost flag, pirate flag"
            ),
            optional=True,
            block_id=WEEKLY_FLAG_HASHTAG,
            hint="Only used when no Custom Field Name is set above. Word(s) to match after '#' in "
            "preblasts/backblasts (no need to include the '#'). 'ghost flag' matches #ghostflag, "
            "#nwpghostflag, #ghost-flag, etc.",
        ),
    ]
)
