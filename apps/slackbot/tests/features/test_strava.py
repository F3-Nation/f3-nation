import json
from unittest.mock import MagicMock, patch

import pytest
from f3_data_models.models import SlackUser, User

from features.strava import (
    STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH,
    build_strava_activity_blocks,
    build_strava_form,
    format_strava_activity_button_label,
)
from utilities.slack import actions
from utilities.slack import orm as slack_orm


@pytest.mark.parametrize(
    ("activity_name", "expected_name"),
    [
        ("a" * 22, "a" * 22),
        ("a" * 23, f"{'a' * 21}…"),
    ],
)
def test_activity_button_label_truncation_boundary(activity_name: str, expected_name: str) -> None:
    label = format_strava_activity_button_label("08-01 05:30", activity_name)

    assert label == f"08-01 05:30 - {expected_name}"
    assert len(label) <= STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH


def test_activity_buttons_truncate_names_and_preserve_selection_payloads() -> None:
    long_name = "Michael took Loki for a walk around the neighborhood before the morning workout"
    activities = [
        {
            "id": 1000 + index,
            "name": long_name if index == 0 else f"Morning Activity {index}",
            "start_date_local": f"2026-08-{index + 1:02d}T05:30:00Z",
        }
        for index in range(10)
    ]

    blocks = build_strava_activity_blocks(
        activities=activities,
        channel_id="C123",
        backblast_ts="1234.5678",
        backblast_title="Test Backblast",
    )
    actions_block = blocks[0].as_form_field()

    assert len(blocks) == 1
    assert actions_block["type"] == "actions"
    assert len(actions_block["elements"]) == 10
    assert all(
        len(button["text"]["text"]) <= STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH for button in actions_block["elements"]
    )
    assert actions_block["elements"][0]["text"]["text"] == "08-01 05:30 - Michael took Loki for…"
    assert actions_block["elements"][1]["text"]["text"] == "08-02 05:30 - Morning Activity 1"

    first_button = actions_block["elements"][0]
    assert first_button["action_id"] == f"{actions.STRAVA_ACTIVITY_BUTTON}-1000"
    assert json.loads(first_button["value"]) == {
        actions.STRAVA_ACTIVITY_ID: 1000,
        actions.STRAVA_CHANNEL_ID: "C123",
        actions.STRAVA_BACKBLAST_TS: "1234.5678",
        actions.STRAVA_BACKBLAST_TITLE: "Test Backblast",
    }


def _compile_filter(expression) -> str:
    return str(expression.compile(compile_kwargs={"literal_binds": True}))


@pytest.fixture
def mock_strava_form_body():
    return {
        "user_id": "U123",
        "team_id": "T123",
        "channel_id": "C123",
        "message": {
            "ts": "1234.5678",
            "metadata": {"event_payload": {"title": "Test Title"}},
            "blocks": [
                {"type": "section"},
                {"type": "section"},
                {"type": "actions", "elements": [{"value": json.dumps({"title": "Test Title"})}]},
            ],
        },
        actions.LOADING_ID: "view123",
    }


@pytest.mark.parametrize(
    ("mock_activities", "expect_empty_message"),
    [
        ([], True),
        ([{"id": 1000, "name": "Morning Run", "start_date_local": "2026-08-01T05:30:00Z"}], False),
    ],
)
@patch("features.strava.DbManager")
@patch("features.strava.get_strava_activities")
@patch("features.strava.slack_orm.BlockView")
def test_build_strava_form_linked_user(
    mock_block_view,
    mock_get_strava_activities,
    mock_db_manager,
    mock_strava_form_body,
    monkeypatch,
    mock_activities,
    expect_empty_message,
):
    monkeypatch.delenv("STRAVA_CLIENT_ID", raising=False)
    monkeypatch.delenv("STRAVA_CLIENT_SECRET", raising=False)

    mock_client = MagicMock()
    mock_logger = MagicMock()

    mock_slack_user = SlackUser(slack_id="U123", slack_team_id="T123", user_id=1)
    mock_db_manager.find_records.return_value = [mock_slack_user]

    mock_user = User(id=1)
    mock_db_manager.get.return_value = mock_user

    mock_get_strava_activities.return_value = mock_activities

    mock_strava_form_instance = MagicMock()
    mock_block_view.return_value = mock_strava_form_instance

    build_strava_form(mock_strava_form_body, mock_client, mock_logger, {}, MagicMock())

    mock_db_manager.find_records.assert_called_once()
    find_call = mock_db_manager.find_records.call_args
    assert find_call.args[0] is SlackUser
    assert [_compile_filter(f) for f in find_call.kwargs["filters"]] == [
        _compile_filter(SlackUser.slack_id == "U123"),
        _compile_filter(SlackUser.slack_team_id == "T123"),
    ]
    mock_db_manager.get.assert_called_once_with(User, 1)
    mock_get_strava_activities.assert_called_once_with(mock_user)

    mock_block_view.assert_called_once()
    blocks = mock_block_view.call_args[1]["blocks"]

    if expect_empty_message:
        assert len(blocks) == 2
        assert hasattr(blocks[0], "label") and "No recent activities found" in str(blocks[0].label)
        assert hasattr(blocks[1], "label") and "Strava client ID and secret are not configured" in str(blocks[1].label)
    else:
        assert not any(hasattr(block, "label") and "No recent activities found" in str(block.label) for block in blocks)
        assert any(
            hasattr(block, "elements")
            and any("08-01 05:30 - Morning Run" in str(elem.label) for elem in block.elements)
            for block in blocks
        )
        assert json.loads(blocks[0].elements[0].value)[actions.STRAVA_BACKBLAST_TITLE] == "Test Title"

    mock_strava_form_instance.update_modal.assert_called_once()
    kwargs = mock_strava_form_instance.update_modal.call_args.kwargs
    assert kwargs.get("title_text") == "Choose Activity"
    assert kwargs.get("view_id") == mock_strava_form_body[actions.LOADING_ID]


@patch("features.strava.DbManager")
@patch("features.strava.get_strava_activities")
@patch("features.strava.slack_orm.BlockView")
def test_build_strava_form_unlinked_user(
    mock_block_view,
    mock_get_strava_activities,
    mock_db_manager,
    mock_strava_form_body,
    monkeypatch,
):
    monkeypatch.delenv("STRAVA_CLIENT_ID", raising=False)
    monkeypatch.delenv("STRAVA_CLIENT_SECRET", raising=False)

    mock_db_manager.find_records.return_value = []

    mock_strava_form_instance = MagicMock()
    mock_block_view.return_value = mock_strava_form_instance

    build_strava_form(mock_strava_form_body, MagicMock(), MagicMock(), {}, MagicMock())

    mock_db_manager.get.assert_not_called()
    mock_get_strava_activities.assert_not_called()

    blocks = mock_block_view.call_args.kwargs["blocks"]
    assert len(blocks) == 1
    assert isinstance(blocks[0], slack_orm.SectionBlock)
    assert "Strava client ID and secret are not configured" in str(blocks[0].label)

    mock_strava_form_instance.update_modal.assert_called_once()
    kwargs = mock_strava_form_instance.update_modal.call_args.kwargs
    assert kwargs.get("title_text") == "Connect Strava"
    assert kwargs.get("view_id") == mock_strava_form_body[actions.LOADING_ID]


@patch("features.strava.DbManager")
@patch("features.strava.get_strava_activities")
@patch("features.strava.slack_orm.BlockView")
def test_build_strava_form_no_activities_shows_reconnect_button(
    mock_block_view,
    mock_get_strava_activities,
    mock_db_manager,
    mock_strava_form_body,
    monkeypatch,
):
    monkeypatch.setenv("STRAVA_CLIENT_ID", "test-id")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("APP_URL", "https://example.test")

    mock_db_manager.find_records.return_value = [SlackUser(slack_id="U123", slack_team_id="T123", user_id=1)]
    mock_db_manager.get.return_value = User(id=1)
    mock_get_strava_activities.return_value = []

    mock_strava_form_instance = MagicMock()
    mock_block_view.return_value = mock_strava_form_instance

    build_strava_form(mock_strava_form_body, MagicMock(), MagicMock(), {}, MagicMock())

    blocks = mock_block_view.call_args.kwargs["blocks"]
    assert [type(block) for block in blocks] == [
        slack_orm.SectionBlock,
        slack_orm.ImageBlock,
        slack_orm.ActionsBlock,
        slack_orm.ContextBlock,
    ]
    assert "No recent activities found" in str(blocks[0].label)

    connect_button = blocks[2].elements[0]
    assert isinstance(connect_button, slack_orm.ButtonElement)
    assert connect_button.action == actions.STRAVA_CONNECT_BUTTON
    assert connect_button.url.startswith("https://www.strava.com/oauth/authorize")
    assert "client_id=test-id" in connect_button.url
    assert "redirect_uri=https%3A%2F%2Fexample.test%2Fexchange_token" in connect_button.url

    kwargs = mock_strava_form_instance.update_modal.call_args.kwargs
    assert kwargs.get("title_text") == "Choose Activity"
