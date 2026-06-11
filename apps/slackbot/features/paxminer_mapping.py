import copy
from logging import Logger
from typing import List

from f3_data_models.models import EventInstance, EventType_x_EventInstance, Org, Org_Type
from f3_data_models.utils import DbManager, get_session
from slack_sdk.models.blocks import (
    DividerBlock,
    InputBlock,
    SectionBlock,
)
from slack_sdk.models.blocks.basic_components import Option
from slack_sdk.models.blocks.block_elements import ChannelSelectElement, ExternalDataSelectElement, SelectElement
from slack_sdk.web import WebClient
from sqlalchemy import func

from utilities.database.orm import SlackSettings
from utilities.helper_functions import safe_convert, safe_get
from utilities.slack.sdk_orm import SdkBlockView

# Action IDs
PAXMINER_ORIGINATING_CHANNEL = "paxminer-originating-channel"
PAXMINER_EVENT_TYPE = "paxminer-event-type"
PAXMINER_AO = "paxminer-assign-ao"
PAXMINER_MAPPING_ID = "paxminer-mapping-id"
PAXMINER_REGION = "paxminer-assign-region"
PAXMINER_CURRENT_MAPPING = "paxminer-current-mapping"


def get_paxminer_mapping_text(channel_id: str) -> str:
    session = get_session()
    print(channel_id)
    query = (
        session.query(Org.name, func.count(EventInstance.id))
        .join(EventInstance, EventInstance.org_id == Org.id)
        .filter(EventInstance.meta.op("->>")("og_channel") == channel_id)
        .group_by(Org.name)
        .order_by(func.count(EventInstance.id).desc())
    )
    results = query.all()
    if not results:
        return "No paxminer import found from this channel. The migration may not have been run yet (check your migration date), or the migration may have been run before we started adding channel metadata. If this is the case, you can request a remigration from the dev team."  # noqa: E501
    output = "*Current Mapping:*\n"
    mapping_lines = [f"{count} Events -> *{org_name}*" for org_name, count in results]
    session.close()
    return output + "\n".join(mapping_lines)


def get_unmapped_channels_section(region_org_id: int) -> SectionBlock:
    session = get_session()
    query = (
        session.query(EventInstance.meta.op("->>")("og_channel"), func.count(EventInstance.id))
        .filter(
            EventInstance.meta.op("->>")("source") == "paxminer_import",
            EventInstance.is_active.is_(True),
            EventInstance.org_id == region_org_id,
        )
        .group_by(EventInstance.meta.op("->>")("og_channel"))
        .order_by(func.count(EventInstance.id).desc())
    )
    results = query.all()
    session.close()
    if not results:
        return SectionBlock(
            block_id="paxminer-unmapped-channels",
            text="No unmapped data found",  # noqa: E501
        )
    unmapped_channels = []
    for channel_id, count in results:
        if channel_id:
            unmapped_channels.append(f"<#{channel_id}> -> {count} Events")
        else:
            unmapped_channels.append(f"Unknown Channel -> {count} Events")
    return SectionBlock(
        block_id="paxminer-unmapped-channels",
        text="*Unmapped Channels:*\n" + "\n".join(unmapped_channels),
    )


def build_paxminer_mapping_form(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    if safe_get(body, "actions", 0, "action_id") in [PAXMINER_ORIGINATING_CHANNEL, PAXMINER_REGION]:
        initial_channel = safe_get(
            body,
            "view",
            "state",
            "values",
            PAXMINER_ORIGINATING_CHANNEL,
            PAXMINER_ORIGINATING_CHANNEL,
            "selected_channel",
        )
        print(f"Initial Channel: {initial_channel}")
        initial_org = safe_convert(
            safe_get(body, "view", "state", "values", PAXMINER_REGION, PAXMINER_REGION, "selected_option", "value"), int
        )

        org_record = DbManager.get(Org, (initial_org or region_record.org_id), joinedloads=[Org.event_types])
        event_type_options = [Option(label=et.name, value=str(et.id)) for et in org_record.event_types]
        intial_event_type = next(et for et in event_type_options if et.label == "Bootcamp")
        initial_region = {"text": org_record.name, "value": str(org_record.id)}
        current_mapping_text = get_paxminer_mapping_text(initial_channel)
        ao_records: List[Org] = DbManager.find_records(
            Org,
            [
                Org.parent_id == (initial_org or region_record.org_id),
                Org.org_type == Org_Type.ao,
                Org.is_active.is_(True),
            ],
        )
        form = copy.deepcopy(PAXMINER_MAPPING_FORM)
        form.set_options(
            {
                PAXMINER_AO: [Option(label=ao.name, value=str(ao.id)) for ao in ao_records],
                PAXMINER_EVENT_TYPE: event_type_options,
            }
        )
        form.set_initial_values(
            {
                PAXMINER_REGION: initial_region,
                PAXMINER_EVENT_TYPE: intial_event_type,
                PAXMINER_ORIGINATING_CHANNEL: initial_channel,
                PAXMINER_CURRENT_MAPPING: current_mapping_text,
            }
        )
        update_view_id = safe_get(body, "view", "id")
    else:
        form = copy.deepcopy(PAXMINER_MAPPING_FORM)
        form.blocks = form.blocks[:2]  # only keep the channel select block
        form.blocks.append(get_unmapped_channels_section(region_record.org_id))
        initial_channel = None
        update_view_id = None

    if update_view_id:
        form.update_modal(
            client=client,
            view_id=update_view_id,
            title_text="Paxminer Data Mapping",
            callback_id=PAXMINER_MAPPING_ID,
        )
    else:
        form.post_modal(
            client=client,
            trigger_id=safe_get(body, "trigger_id"),
            title_text="Paxminer Data Mapping",
            callback_id=PAXMINER_MAPPING_ID,
            new_or_add="add",
            submit_button_text="None",
        )


PAXMINER_MAPPING_FORM = SdkBlockView(
    blocks=[
        SectionBlock(
            block_id="paxminer-mapping-instructions",
            text="Use this tool *after* your paxminer data has been migrated (ie after you migration date). The tool allows you to re-assign imported paxminer events to a different AO, as sometimes the migration script will get it wrong. Notes:\n - Include AOs that starfished prior to your migration, to preserve the historical data with the local AO that generated it\n - Updates to PAX Vault are not instant, please wait up to an hour for these changes to be reflected",  # noqa: E501
        ),
        InputBlock(
            label="Originating Channel",
            block_id=PAXMINER_ORIGINATING_CHANNEL,
            element=ChannelSelectElement(
                action_id=PAXMINER_ORIGINATING_CHANNEL,
            ),
            dispatch_action=True,
            hint="Unarchive the channel if you don't see it in the list.",
        ),
        DividerBlock(),
        SectionBlock(
            block_id=PAXMINER_CURRENT_MAPPING,
            text="Current mapping",
        ),  # Placeholder for current mapping text
        InputBlock(
            label="Assign to Region",
            block_id=PAXMINER_REGION,
            element=ExternalDataSelectElement(
                action_id=PAXMINER_REGION,
                placeholder="Select a region...",
            ),
            optional=False,
            dispatch_action=True,
        ),
        InputBlock(
            label="Assign to AO",
            block_id=PAXMINER_AO,
            element=SelectElement(
                action_id=PAXMINER_AO,
            ),
            optional=False,
        ),
        InputBlock(
            label="Assign to Event Type",
            block_id=PAXMINER_EVENT_TYPE,
            element=SelectElement(
                action_id=PAXMINER_EVENT_TYPE,
            ),
            optional=False,
        ),
    ]
)


def handle_paxminer_mapping_post(
    body: dict, client: WebClient, logger: Logger, context: dict, region_record: SlackSettings
):
    data = PAXMINER_MAPPING_FORM.get_selected_values(body)
    print(data)
    if data.get(PAXMINER_ORIGINATING_CHANNEL) and data.get(PAXMINER_AO) and data.get(PAXMINER_EVENT_TYPE):
        DbManager.update_records(
            EventInstance,
            filters=[EventInstance.meta.op("->>")("og_channel") == data[PAXMINER_ORIGINATING_CHANNEL]],
            fields={
                EventInstance.org_id: int(data[PAXMINER_AO]),
                EventInstance.event_instances_x_event_types: [
                    EventType_x_EventInstance(event_type_id=int(data[PAXMINER_EVENT_TYPE]))
                ],
            },
        )
