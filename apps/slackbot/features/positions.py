import copy
import json
from logging import Logger
from typing import List

from slack_sdk.web import WebClient

from application.ao import AoData
from application.ao.service import AoService
from application.position import PositionData, PositionWithAssignmentsData
from application.position.service import PositionService
from infrastructure.api_client.ao_repository import get_api_ao_repository
from infrastructure.api_client.position_repository import get_api_position_repository
from utilities.database.orm import SlackSettings
from utilities.helper_functions import SLACK_USERS, get_user, safe_convert, safe_get
from utilities.slack import actions, forms, orm

# ---------------------------------------------------------------------------
# Composition root
# ---------------------------------------------------------------------------


def _build_position_service() -> PositionService:
    return PositionService(repository=get_api_position_repository())


def _build_ao_service() -> AoService:
    return AoService(repository=get_api_ao_repository())


# ---------------------------------------------------------------------------
# Views
# ---------------------------------------------------------------------------


class PositionViews:
    @staticmethod
    def build_slt_modal(
        position_assignments: List[PositionWithAssignmentsData],
        aos: List[AoData],
        org_id: int,
        region_org_id: int,
        user_id_to_slack_id: dict,
    ) -> orm.BlockView:
        level_options = [orm.SelectorOption(name="Region", value="0")]
        for a in aos:
            level_options.append(orm.SelectorOption(name=a.name, value=str(a.id)))

        blocks = [
            orm.InputBlock(
                label="Select the SLT positions for...",
                action=actions.SLT_LEVEL_SELECT,
                element=orm.StaticSelectElement(
                    options=level_options,
                    initial_value="0" if org_id == region_org_id else str(org_id),
                ),
                dispatch_action=True,
            ),
        ]

        for p in position_assignments:
            slack_user_ids = [user_id_to_slack_id[u.user_id] for u in p.users if u.user_id in user_id_to_slack_id]
            block = orm.InputBlock(
                label=p.name,
                action=actions.SLT_SELECT + str(p.id) + "_" + str(org_id),
                optional=True,
                element=orm.MultiUsersSelectElement(
                    placeholder="Select SLT Members...",
                ),
                hint=p.description,
            )
            if slack_user_ids:
                block.element.initial_value = slack_user_ids
            blocks.append(block)

        blocks.append(
            orm.ActionsBlock(
                elements=[
                    orm.ButtonElement(
                        label=":heavy_plus_sign: New Position",
                        action=actions.CONFIG_NEW_POSITION,
                    ),
                    orm.ButtonElement(
                        label=":pencil2: Edit Positions",
                        action=actions.CONFIG_EDIT_POSITIONS,
                    ),
                ]
            )
        )

        return orm.BlockView(blocks=blocks)

    @staticmethod
    def build_position_list_modal(positions: List[PositionData]) -> orm.BlockView:
        blocks = [
            orm.ContextBlock(
                element=orm.ContextElement(
                    initial_value="Only region-specific positions can be edited or deleted.",
                ),
            )
        ]

        if not positions:
            blocks.append(
                orm.SectionBlock(
                    label="No custom positions found. Use 'New Position' to create one.",
                )
            )
        else:
            for p in positions:
                blocks.append(
                    orm.SectionBlock(
                        label=p.name,
                        action=f"{actions.POSITION_EDIT_DELETE}_{p.id}",
                        element=orm.StaticSelectElement(
                            placeholder="Edit or Delete",
                            options=orm.as_selector_options(names=["Edit", "Delete"]),
                            confirm=orm.ConfirmObject(
                                title="Are you sure?",
                                text="Are you sure you want to edit / delete this Position? This cannot be undone.",
                                confirm="Yes, I am sure",
                                deny="Whups, never mind",
                            ),
                        ),
                    )
                )

        return orm.BlockView(blocks=blocks)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _user_id_to_slack_id_map(team_id: str) -> dict:
    if not SLACK_USERS:
        from utilities.helper_functions import update_local_slack_users

        update_local_slack_users()
    return {su.user_id: su.slack_id for su in SLACK_USERS.values() if su.slack_team_id == team_id}


# ---------------------------------------------------------------------------
# Handler functions
# ---------------------------------------------------------------------------


def build_config_slt_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id: str = None,
    selected_org_id: int = None,
):
    if safe_get(body, "actions", 0, "action_id") == actions.SLT_LEVEL_SELECT:
        org_id = safe_convert(safe_get(body, "actions", 0, "selected_option", "value"), int)
        org_id = org_id if org_id != 0 else region_record.org_id
        update_view_id = safe_get(body, "view", "id")
    elif update_view_id is None:
        update_view_id = safe_get(body, actions.LOADING_ID)
        org_id = selected_org_id or region_record.org_id
    else:
        org_id = selected_org_id or region_record.org_id

    service = _build_position_service()
    ao_service = _build_ao_service()
    position_assignments = service.get_positions_with_assignments(org_id, region_record.org_id)

    aos = ao_service.get_region_aos(region_record.org_id)

    user_id_to_slack_id = _user_id_to_slack_id_map(region_record.team_id)

    form = PositionViews.build_slt_modal(
        position_assignments=position_assignments,
        aos=aos,
        org_id=org_id,
        region_org_id=region_record.org_id,
        user_id_to_slack_id=user_id_to_slack_id,
    )

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.CONFIG_SLT_CALLBACK_ID,
            title_text="SLT Members",
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            callback_id=actions.CONFIG_SLT_CALLBACK_ID,
            title_text="SLT Members",
            new_or_add="add",
        )


def build_new_position_form(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form = copy.deepcopy(forms.CONFIG_NEW_POSITION_FORM)
    selected_org_id = safe_convert(
        safe_get(
            body,
            "view",
            "state",
            "values",
            actions.SLT_LEVEL_SELECT,
            actions.SLT_LEVEL_SELECT,
            "selected_option",
            "value",
        ),
        int,
    )
    selected_org_id = selected_org_id if selected_org_id != 0 else region_record.org_id

    form.post_modal(
        client=client,
        trigger_id=safe_get(body, "trigger_id"),
        callback_id=actions.NEW_POSITION_CALLBACK_ID,
        title_text="New Position",
        new_or_add="add",
        parent_metadata={"org_id": selected_org_id},
    )


def handle_new_position_post(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form_data = forms.CONFIG_NEW_POSITION_FORM.get_selected_values(body)
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    org_id = metadata.get("org_id") or region_record.org_id
    org_type = "region" if org_id == region_record.org_id else "ao"

    service = _build_position_service()
    service.create_position(
        name=safe_get(form_data, actions.CONFIG_NEW_POSITION_NAME),
        description=safe_get(form_data, actions.CONFIG_NEW_POSITION_DESCRIPTION),
        org_id=region_record.org_id,
        org_type=org_type,
    )

    build_config_slt_form(
        body,
        client,
        logger,
        context,
        region_record,
        update_view_id=safe_get(body, "view", "previous_view_id"),
        selected_org_id=org_id,
    )


def handle_config_slt_post(body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings):
    form_data = body["view"]["state"]["values"]
    org_assignments: dict = {}

    for key, value in form_data.items():
        if key.startswith(actions.SLT_SELECT):
            position_id, org_id = map(int, key.replace(actions.SLT_SELECT, "").split("_"))
            org_id = org_id if org_id != 0 else region_record.org_id
            slack_user_ids = value[key].get("selected_users", [])
            users = [get_user(u, region_record, client, logger) for u in slack_user_ids]
            user_ids = [u.user_id for u in users if u]

            if org_id not in org_assignments:
                org_assignments[org_id] = {}
            org_assignments[org_id][position_id] = user_ids

    service = _build_position_service()
    for org_id, position_map in org_assignments.items():
        assignments = [{"positionId": pos_id, "userIds": uid_list} for pos_id, uid_list in position_map.items()]
        service.update_org_assignments(org_id=org_id, assignments=assignments)


def build_position_list_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    update_view_id: str = None,
):
    service = _build_position_service()
    positions = service.get_org_positions(region_record.org_id)

    form = PositionViews.build_position_list_modal(positions)

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            callback_id=actions.EDIT_DELETE_POSITION_CALLBACK_ID,
            title_text="Edit/Delete Positions",
            submit_button_text="None",
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Edit/Delete Positions",
            callback_id=actions.EDIT_DELETE_POSITION_CALLBACK_ID,
            submit_button_text="None",
            new_or_add="add",
        )


def handle_position_edit_delete(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    action = safe_get(body, "actions", 0, "selected_option", "value")
    position_id = int(safe_get(body, "actions", 0, "action_id").split("_")[-1])

    service = _build_position_service()

    if action == "Edit":
        position = service.get_by_id(position_id)
        if position:
            build_edit_position_form(body, client, logger, context, region_record, position)
    elif action == "Delete":
        service.delete_position(position_id)
        build_position_list_form(
            body, client, logger, context, region_record, update_view_id=safe_get(body, "view", "id")
        )


def build_edit_position_form(
    body: dict,
    client: WebClient,
    logger: Logger,
    context: dict,
    region_record: SlackSettings,
    position: PositionData,
):
    form = copy.deepcopy(forms.CONFIG_NEW_POSITION_FORM)

    form.set_initial_values(
        {
            actions.CONFIG_NEW_POSITION_NAME: position.name,
            actions.CONFIG_NEW_POSITION_DESCRIPTION: position.description or "",
        }
    )

    form.update_modal(
        client=client,
        view_id=safe_get(body, "view", "id"),
        callback_id=actions.EDIT_POSITION_CALLBACK_ID,
        title_text="Edit Position",
        parent_metadata={"position_id": position.id},
    )


def handle_edit_position_post(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    form_data = forms.CONFIG_NEW_POSITION_FORM.get_selected_values(body)
    metadata = json.loads(safe_get(body, "view", "private_metadata") or "{}")
    position_id = metadata.get("position_id")

    if position_id:
        service = _build_position_service()
        service.update_position(
            position_id=position_id,
            name=safe_get(form_data, actions.CONFIG_NEW_POSITION_NAME),
            description=safe_get(form_data, actions.CONFIG_NEW_POSITION_DESCRIPTION),
        )

    build_config_slt_form(
        body,
        client,
        logger,
        context,
        region_record,
        update_view_id=safe_get(body, "view", "previous_view_id"),
        selected_org_id=metadata.get("org_id"),
    )
