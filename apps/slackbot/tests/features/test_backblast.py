import copy
import datetime
import json
import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

import pytest
from f3_data_models.models import EventInstance, EventType_x_EventInstance, Org

from features.backblast import backblast_middleware, build_backblast_form, handle_backblast_post
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
        default_backblast_destination="",
        backblast_destination_channel=None,
        strava_enabled=False,
    )


@pytest.fixture
def submission_body(region_record):
    selected_values = {
        actions.BACKBLAST_TITLE: {"type": "plain_text_input", "value": "Test Workout"},
        actions.BACKBLAST_DATE: {"type": "datepicker", "selected_date": "2026-10-05"},
        actions.BACKBLAST_EVENT_TYPE: {"type": "static_select", "selected_option": {"value": "12"}},
        actions.BACKBLAST_AO: {"type": "static_select", "selected_option": {"value": "20"}},
        actions.BACKBLAST_Q: {"type": "users_select", "selected_user": "U_TEST"},
        actions.BACKBLAST_PAX: {"type": "multi_users_select", "selected_users": ["U_TEST"]},
        actions.BACKBLAST_MOLESKIN: {
            "type": "rich_text_input",
            "rich_text_value": copy.deepcopy(region_record.backblast_moleskin_template),
        },
        actions.BACKBLAST_SEND_OPTIONS: {
            "type": "radio_buttons",
            "selected_option": {"value": "Save and send later"},
        },
    }
    return {
        "user": {"id": "U_TEST"},
        "view": {
            "callback_id": actions.BACKBLAST_CALLBACK_ID,
            "private_metadata": "{}",
            "blocks": [],
            "state": {"values": {action: {action: value} for action, value in selected_values.items()}},
        },
    }


@pytest.fixture
def posting_context():
    client = MagicMock()
    client.chat_update.side_effect = lambda **kwargs: {
        "channel": kwargs["channel"],
        "ts": kwargs["ts"],
        "message": {"blocks": copy.deepcopy(kwargs["blocks"])},
    }
    ao_record = SimpleNamespace(id=20, name="Test AO", meta={"slack_channel_id": "C_TEST"})
    with (
        patch("features.backblast.DbManager") as db_manager,
        patch(
            "features.backblast.get_user",
            return_value=SimpleNamespace(user_id=1, slack_id="U_TEST", user_name="Test PAX", avatar_url=None),
        ) as get_user,
        patch("features.backblast.upload_files_to_storage") as upload_files,
        patch("features.backblast.post_bot_log"),
    ):
        db_manager.get.return_value = ao_record
        db_manager.find_records.return_value = []
        db_manager.create_record.return_value = SimpleNamespace(id=42)
        yield SimpleNamespace(
            client=client,
            db_manager=db_manager,
            get_user=get_user,
            upload_files=upload_files,
            ao_record=ao_record,
        )


def _assert_ineligible_submission_rejected(posting_context):
    db_manager = posting_context.db_manager
    db_manager.get.assert_not_called()
    for operation in ("create_record", "create_records", "update_record", "update_records", "delete_records"):
        getattr(db_manager, operation).assert_not_called()
    posting_context.get_user.assert_not_called()
    posting_context.upload_files.assert_not_called()
    posting_context.client.chat_postMessage.assert_called_once()
    response = posting_context.client.chat_postMessage.call_args.kwargs
    assert response["channel"] == "U_TEST"
    assert "event type" in response["text"].lower()
    assert "reopen" in response["text"].lower()


def test_backblast_selector_emits_unscheduled_event_confirmation(region_record):
    region_record.migration_date = "2020-01-01"
    event = SimpleNamespace(
        id=42,
        start_date=datetime.date(2026, 10, 5),
        org=SimpleNamespace(name="Test AO"),
        event_types=[SimpleNamespace(name="Bootcamp")],
    )
    body = {"user": {"id": "U_TEST"}, actions.LOADING_ID: "V_BACKBLAST"}
    client = MagicMock()

    with (
        patch("features.backblast.get_user", return_value=SimpleNamespace(user_id=1)),
        patch("features.backblast.event_attendance_query", return_value=[event]),
        patch("features.backblast.get_admin_users", return_value=[]),
        patch("features.backblast.get_aoq_users", return_value=[]),
    ):
        backblast_middleware(body, client, MagicMock(), {}, region_record)

    client.views_update.assert_called_once()
    client.views_open.assert_not_called()
    assert client.views_update.call_args.kwargs["view_id"] == "V_BACKBLAST"
    view = client.views_update.call_args.kwargs["view"]
    assert view["callback_id"] == actions.BACKBLAST_SELECT_CALLBACK_ID
    buttons = [element for block in view["blocks"] for element in block.get("elements", [])]
    scheduled = next(button for button in buttons if button["action_id"] == f"{actions.BACKBLAST_FILL_BUTTON}_42")
    assert scheduled["value"] == "42"
    assert "confirm" not in scheduled
    unscheduled = next(button for button in buttons if button["action_id"] == actions.BACKBLAST_NEW_BLANK_BUTTON)
    assert unscheduled["text"]["text"] == "New Unscheduled Event"
    assert unscheduled["value"] == "New Unscheduled Event"
    assert unscheduled["confirm"] == {
        "title": {"type": "plain_text", "text": "Are you sure?"},
        "text": {
            "type": "plain_text",
            "text": (
                "This option should ONLY BE USED FOR UNSCHEDULED EVENTS that are not listed on the calendar. "
                "If this is for a normal, scheduled event, please select it from the lists above."
            ),
        },
        "confirm": {"type": "plain_text", "text": "Yes, I'm sure"},
        "deny": {"type": "plain_text", "text": "Whups, never mind"},
        "style": "danger",
    }


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


def test_event_type_deactivated_after_modal_open_is_rejected(region_record, submission_body, posting_context):
    selected_type = SimpleNamespace(id=12, name="Regional Type", is_active=True, specific_org_id=10)
    db_manager = posting_context.db_manager
    db_manager.get.return_value = SimpleNamespace(id=10, event_types=[selected_type])
    db_manager.find_records.return_value = [posting_context.ao_record]
    db_manager.find_join_records2.return_value = []

    build_backblast_form(
        body={
            "user": {"id": "U_TEST"},
            "trigger_id": "T_TRIGGER",
            "actions": [{"action_id": actions.BACKBLAST_NEW_BLANK_BUTTON}],
        },
        client=posting_context.client,
        logger=MagicMock(),
        context={},
        region_record=region_record,
    )
    view = posting_context.client.views_open.call_args.kwargs["view"]
    event_type_block = next(block for block in view["blocks"] if block.get("block_id") == actions.BACKBLAST_EVENT_TYPE)
    assert event_type_block["element"]["options"][0]["value"] == "12"

    selected_type.is_active = False
    db_manager.reset_mock()
    posting_context.get_user.reset_mock()
    posting_context.client.reset_mock()
    db_manager.find_first_record.return_value = selected_type
    db_manager.get.side_effect = AssertionError("Inactive event type reached AO lookup")

    handle_backblast_post(submission_body, posting_context.client, MagicMock(), {}, region_record)

    _assert_ineligible_submission_rejected(posting_context)


@pytest.mark.parametrize("type_exists", [False, True], ids=["missing_type", "active_other_region"])
def test_new_unscheduled_backblast_rejects_ineligible_positive_id(
    region_record, submission_body, posting_context, type_exists
):
    db_manager = posting_context.db_manager
    db_manager.find_first_record.return_value = (
        SimpleNamespace(id=12, name="Other Region Type", is_active=True, specific_org_id=99) if type_exists else None
    )
    db_manager.get.side_effect = AssertionError("Ineligible event type reached AO lookup")

    handle_backblast_post(submission_body, posting_context.client, MagicMock(), {}, region_record)

    _assert_ineligible_submission_rejected(posting_context)


@pytest.mark.parametrize("specific_org_id", [10, None], ids=["regional_type", "national_type"])
def test_new_unscheduled_backblast_saves_eligible_event_type(
    region_record, submission_body, posting_context, specific_org_id
):
    db_manager = posting_context.db_manager
    db_manager.find_first_record.return_value = SimpleNamespace(
        id=12, name="Active Type", is_active=True, specific_org_id=specific_org_id
    )

    handle_backblast_post(submission_body, posting_context.client, MagicMock(), {}, region_record)

    associations = [
        call.args[0]
        for call in db_manager.create_record.call_args_list
        if isinstance(call.args[0], EventType_x_EventInstance)
    ]
    assert [(association.event_instance_id, association.event_type_id) for association in associations] == [(42, 12)]
    db_manager.update_record.assert_called_once()
    assert db_manager.update_record.call_args.args[:2] == (EventInstance, 42)
    assert db_manager.update_records.call_args.kwargs["fields"][EventType_x_EventInstance.event_type_id] == 12
    posting_context.client.chat_postMessage.assert_called_once()
    assert "saved but not posted yet" in posting_context.client.chat_postMessage.call_args.kwargs["text"]


def test_existing_backblast_saves_inactive_historical_event_type(region_record, submission_body, posting_context):
    historical_type = SimpleNamespace(id=12, name="Retired Regional Type", is_active=False, specific_org_id=10)
    event_record = SimpleNamespace(
        id=42,
        start_date=datetime.date(2026, 9, 30),
        org=posting_context.ao_record,
        event_types=[historical_type],
        location_id=None,
        meta={},
    )
    original_event_types = copy.deepcopy(event_record.event_types)
    submission_body["view"]["callback_id"] = actions.BACKBLAST_EDIT_CALLBACK_ID
    submission_body["view"]["private_metadata"] = json.dumps(
        {"event_instance_id": 42, "channel_id": "C_TEST", "message_ts": "123.456"}
    )
    for action in (actions.BACKBLAST_EVENT_TYPE, actions.BACKBLAST_AO, actions.BACKBLAST_DATE):
        del submission_body["view"]["state"]["values"][action]

    def get_record(model, record_id, **kwargs):
        if model is EventInstance:
            assert record_id == event_record.id
            return event_record
        assert model is Org
        assert record_id == region_record.org_id
        return SimpleNamespace(id=10, name="Test Region")

    db_manager = posting_context.db_manager
    db_manager.get.side_effect = get_record
    db_manager.find_first_record.side_effect = AssertionError("Historical event type was revalidated")

    handle_backblast_post(submission_body, posting_context.client, MagicMock(), {}, region_record)

    db_manager.find_first_record.assert_not_called()
    db_manager.create_record.assert_not_called()
    db_manager.update_record.assert_called_once()
    assert db_manager.update_record.call_args.args[:2] == (EventInstance, 42)
    assert db_manager.update_records.call_args.kwargs["fields"][EventType_x_EventInstance.event_type_id] == 12
    posting_context.client.chat_update.assert_called_once()
    posting_context.client.chat_postMessage.assert_not_called()
    assert event_record.event_types == original_event_types


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
