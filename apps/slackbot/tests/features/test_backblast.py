import copy
import datetime
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import pytest
from f3_data_models.models import EventInstance, Org

from features.backblast import build_backblast_form, handle_backblast_post
from utilities.slack import actions, forms


@pytest.fixture(autouse=True)
def isolated_backblast_forms():
    with (
        patch.object(forms, "BACKBLAST_FORM", copy.deepcopy(forms.BACKBLAST_FORM)),
        patch.object(forms, "UNSCHEDULED_BACKBLAST_BLOCKS", copy.deepcopy(forms.UNSCHEDULED_BACKBLAST_BLOCKS)),
    ):
        yield


@pytest.fixture
def region_record():
    return SimpleNamespace(
        org_id=10,
        team_id="T_TEST",
        backblast_moleskin_template={
            "type": "rich_text",
            "elements": [{"type": "rich_text_section", "elements": [{"type": "text", "text": "Test workout."}]}],
        },
        custom_fields={},
        email_enabled=0,
        email_option_show=0,
    )


@pytest.mark.parametrize("update_view_id", [None, "V_BACKBLAST"])
@pytest.mark.parametrize("regional_type_active", [True, False])
def test_new_unscheduled_backblast_offers_only_active_event_types(region_record, update_view_id, regional_type_active):
    event_types = [
        SimpleNamespace(id=11, name="Bootcamp", is_active=True, specific_org_id=None),
        SimpleNamespace(id=12, name="Retired Regional Type", is_active=False, specific_org_id=10),
        SimpleNamespace(id=13, name="Regional Type", is_active=regional_type_active, specific_org_id=10),
        SimpleNamespace(id=14, name="Retired National Type", is_active=False, specific_org_id=None),
    ]
    org_record = SimpleNamespace(id=10, event_types=event_types)
    original_event_types = copy.deepcopy(event_types)
    client = MagicMock()
    body = {
        "user": {"id": "U_TEST"},
        "trigger_id": "T_TRIGGER",
        "actions": [{"action_id": actions.BACKBLAST_NEW_BLANK_BUTTON}],
    }
    if update_view_id:
        body["view"] = {"id": update_view_id}

    with (
        patch("features.backblast.DbManager") as db_manager,
        patch("features.backblast.get_user", return_value=SimpleNamespace(user_id=1)),
    ):
        db_manager.get.return_value = org_record
        db_manager.find_records.return_value = [SimpleNamespace(id=20, name="Test AO")]
        db_manager.find_join_records2.return_value = []

        build_backblast_form(body, client, MagicMock(), {}, region_record)

    if update_view_id:
        client.views_update.assert_called_once()
        client.views_open.assert_not_called()
        assert client.views_update.call_args.kwargs["view_id"] == update_view_id
        view = client.views_update.call_args.kwargs["view"]
    else:
        client.views_open.assert_called_once()
        client.views_update.assert_not_called()
        view = client.views_open.call_args.kwargs["view"]

    event_type_block = next(block for block in view["blocks"] if block.get("block_id") == actions.BACKBLAST_EVENT_TYPE)
    expected_options = [("11", "Bootcamp")]
    if regional_type_active:
        expected_options.append(("13", "Regional Type"))
    assert [
        (option["value"], option["text"]["text"]) for option in event_type_block["element"]["options"]
    ] == expected_options
    assert org_record.event_types == original_event_types


@pytest.mark.parametrize("update_view_id", [None, "V_BACKBLAST"])
@pytest.mark.parametrize("has_inactive_types", [False, True], ids=["empty_catalog", "all_inactive"])
def test_new_unscheduled_backblast_without_active_types_cannot_be_submitted(
    region_record, update_view_id, has_inactive_types
):
    event_types = (
        [
            SimpleNamespace(id=12, name="Retired Regional Type", is_active=False, specific_org_id=10),
            SimpleNamespace(id=14, name="Retired National Type", is_active=False, specific_org_id=None),
        ]
        if has_inactive_types
        else []
    )
    client = MagicMock()
    body = {
        "user": {"id": "U_TEST"},
        "trigger_id": "T_TRIGGER",
        "actions": [{"action_id": actions.BACKBLAST_NEW_BLANK_BUTTON}],
    }
    if update_view_id:
        body["view"] = {"id": update_view_id}

    with (
        patch("features.backblast.DbManager") as db_manager,
        patch("features.backblast.get_user", return_value=SimpleNamespace(user_id=1)),
    ):
        db_manager.get.return_value = SimpleNamespace(id=10, event_types=event_types)
        db_manager.find_records.return_value = [SimpleNamespace(id=20, name="Test AO")]
        db_manager.find_join_records2.return_value = []

        build_backblast_form(body, client, MagicMock(), {}, region_record)

    if update_view_id:
        client.views_update.assert_called_once()
        client.views_open.assert_not_called()
        assert client.views_update.call_args.kwargs["view_id"] == update_view_id
        view = client.views_update.call_args.kwargs["view"]
    else:
        client.views_open.assert_called_once()
        client.views_update.assert_not_called()
        view = client.views_open.call_args.kwargs["view"]

    assert "submit" not in view
    assert not any(block["type"] == "input" for block in view["blocks"])
    assert any(
        block["type"] == "section" and "no active event types" in block["text"]["text"].lower()
        for block in view["blocks"]
    )


@pytest.mark.parametrize("event_type_value", [None, "", "Default", "0", "-1"])
def test_new_unscheduled_backblast_rejects_invalid_event_type_before_side_effects(region_record, event_type_value):
    selected_option = {"value": event_type_value} if event_type_value is not None else None
    body = {
        "user": {"id": "U_TEST"},
        "view": {
            "callback_id": actions.BACKBLAST_CALLBACK_ID,
            "private_metadata": "{}",
            "blocks": [],
            "state": {
                "values": {
                    actions.BACKBLAST_EVENT_TYPE: {
                        actions.BACKBLAST_EVENT_TYPE: {"type": "static_select", "selected_option": selected_option}
                    },
                    actions.BACKBLAST_AO: {
                        actions.BACKBLAST_AO: {"type": "static_select", "selected_option": {"value": "20"}}
                    },
                }
            },
        },
    }
    client = MagicMock()

    with (
        patch("features.backblast.DbManager") as db_manager,
        patch("features.backblast.get_user") as get_user,
        patch("features.backblast.upload_files_to_storage") as upload_files,
    ):
        db_manager.get.side_effect = AssertionError("Invalid event type reached the database")

        handle_backblast_post(body, client, MagicMock(), {}, region_record)

    assert not db_manager.mock_calls
    get_user.assert_not_called()
    upload_files.assert_not_called()
    client.chat_postMessage.assert_called_once()
    assert client.chat_postMessage.call_args.kwargs["channel"] == "U_TEST"
    assert "event type" in client.chat_postMessage.call_args.kwargs["text"].lower()


def test_existing_backblast_preserves_inactive_historical_event_type(region_record):
    historical_type = SimpleNamespace(id=12, name="Retired Regional Type", is_active=False, specific_org_id=10)
    event_types = [historical_type]
    original_event_types = copy.deepcopy(event_types)
    event_record = SimpleNamespace(
        id=42,
        name="Historical Workout",
        org=SimpleNamespace(name="Test AO"),
        start_date=datetime.date(2026, 9, 30),
        event_types=event_types,
        meta={},
        backblast_ts="123.456",
        pax_count=0,
        backblast_rich=[region_record.backblast_moleskin_template],
        backblast=None,
    )
    org_record = SimpleNamespace(id=10, event_types=[historical_type])
    client = MagicMock()

    def get_record(model, record_id, **kwargs):
        if model is EventInstance:
            assert record_id == event_record.id
            return event_record
        assert model is Org
        assert record_id == region_record.org_id
        return org_record

    with (
        patch("features.backblast.DbManager") as db_manager,
        patch("features.backblast.get_user", return_value=SimpleNamespace(user_id=1)),
    ):
        db_manager.get.side_effect = get_record
        db_manager.find_records.return_value = []

        build_backblast_form(
            body={
                "user": {"id": "U_TEST"},
                "actions": [{"action_id": actions.BACKBLAST_EDIT_BUTTON}],
                "view": {"id": "V_EXISTING"},
            },
            client=client,
            logger=MagicMock(),
            context={},
            region_record=region_record,
            event_instance_id=event_record.id,
        )

    client.views_update.assert_called_once()
    view = client.views_update.call_args.kwargs["view"]
    info_block = next(block for block in view["blocks"] if block.get("block_id") == actions.BACKBLAST_INFO)
    assert "*EVENT TYPE:* Retired Regional Type" in info_block["text"]["text"]
    assert view["callback_id"] == actions.BACKBLAST_EDIT_CALLBACK_ID
    assert "submit" in view
    assert event_record.event_types == original_event_types
