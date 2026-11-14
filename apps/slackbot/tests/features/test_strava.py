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
        assert hasattr(blocks[0], "label") and "Strava is not connected or no recent activities were found" in str(
            blocks[0].label
        )
        assert hasattr(blocks[1], "label") and "Strava client ID and secret are not configured" in str(blocks[1].label)
    else:
        assert not any(
            hasattr(block, "label") and "Strava is not connected or no recent activities were found" in str(block.label)
            for block in blocks
        )
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
    assert "Strava is not connected or no recent activities were found" in str(blocks[0].label)

    connect_button = blocks[2].elements[0]
    assert isinstance(connect_button, slack_orm.ButtonElement)
    assert connect_button.action == actions.STRAVA_CONNECT_BUTTON
    assert connect_button.url.startswith("https://www.strava.com/oauth/authorize")
    assert "client_id=test-id" in connect_button.url
    assert "redirect_uri=https%3A%2F%2Fexample.test%2Fexchange_token" in connect_button.url

    kwargs = mock_strava_form_instance.update_modal.call_args.kwargs
    assert kwargs.get("title_text") == "Choose Activity"


def test_activity_lookup_never_falls_back_to_legacy_metadata():
    from features.strava import get_strava_activities

    user = User(id=12, meta={"strava_access_token": "synthetic-legacy"})
    with (
        patch("features.strava.get_access_token", return_value=None) as token,
        patch("features.strava.requests.get") as get,
    ):
        assert get_strava_activities(user) == []
    token.assert_called_once()
    assert token.call_args.args[0] == 12
    get.assert_not_called()


def test_exchange_uses_workspace_qualified_identity_and_never_updates_profile(monkeypatch):
    from flask import Flask, request

    from features.strava import strava_exchange_token

    monkeypatch.setenv("STRAVA_CLIENT_ID", "synthetic-client")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "synthetic-secret")
    bundle = {
        "athlete": {"id": 34},
        "access_token": "synthetic-access",
        "refresh_token": "synthetic-refresh",
        "expires_at": 200,
    }
    app = Flask(__name__)
    with (
        app.test_request_context("/?state=Tsynthetic-Usynthetic&code=synthetic-code"),
        patch("features.strava.requests.post") as post,
        patch("features.strava.DbManager") as manager,
        patch("features.strava.save_connection", return_value=True) as save,
    ):
        post.return_value.json.return_value = bundle
        manager.find_records.return_value = [SlackUser(user_id=12)]
        manager.get.return_value = User(id=12, meta={"my_f3_why": "synthetic reason"})
        result = strava_exchange_token(request)
        assert result.json == {"message": "Authorization successful! You can return to Slack."}
        filters = manager.find_records.call_args.kwargs["filters"]
        assert [_compile_filter(item) for item in filters] == [
            "slack_users.slack_id = 'Usynthetic'",
            "slack_users.slack_team_id = 'Tsynthetic'",
        ]
        save.assert_called_once_with(12, bundle)
        manager.update_record.assert_not_called()


def test_exchange_ownership_conflict_keeps_connection_and_shows_support_message(monkeypatch):
    from flask import Flask, request

    from features.strava import strava_exchange_token
    from infrastructure.strava_credentials import StravaOwnershipConflict

    monkeypatch.setenv("STRAVA_CLIENT_ID", "synthetic-client")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "synthetic-secret")
    app = Flask(__name__)
    with (
        app.test_request_context("/?state=Tsynthetic-Usynthetic&code=synthetic-code"),
        patch("features.strava.requests.post") as post,
        patch("features.strava.DbManager") as manager,
        patch("features.strava.save_connection", side_effect=StravaOwnershipConflict) as save,
    ):
        post.return_value.json.return_value = {"synthetic": "provider-payload"}
        manager.find_records.return_value = [SlackUser(user_id=12)]
        manager.get.return_value = User(id=12)
        result = strava_exchange_token(request)
        assert result.status_code == 409
        assert result.json == {
            "message": (
                "This Strava account is already connected to another F3 profile. "
                "The existing connection has not changed. Please contact support for help."
            )
        }
        save.assert_called_once()
        manager.update_record.assert_not_called()
        assert "synthetic" not in result.get_data(as_text=True)


@pytest.mark.parametrize("failure", [False, RuntimeError("synthetic-storage"), ValueError("synthetic-provider")])
def test_exchange_save_failure_returns_service_unavailable(monkeypatch, failure, caplog):
    from flask import Flask, request

    from features.strava import strava_exchange_token

    monkeypatch.setenv("STRAVA_CLIENT_ID", "synthetic-client")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "synthetic-secret")
    app = Flask(__name__)
    with (
        app.test_request_context("/?state=Tsynthetic-Usynthetic&code=synthetic-code"),
        patch("features.strava.requests.post") as post,
        patch("features.strava.DbManager") as manager,
        patch("features.strava.save_connection") as save,
    ):
        post.return_value.json.return_value = {"synthetic": "provider-payload"}
        manager.find_records.return_value = [SlackUser(user_id=12)]
        manager.get.return_value = User(id=12)
        if isinstance(failure, Exception):
            save.side_effect = failure
        else:
            save.return_value = failure
        result = strava_exchange_token(request)
        assert result.status_code == 503
        assert result.json == {"message": "Strava could not be connected right now. Please try again later."}
        manager.update_record.assert_not_called()
        assert "synthetic" not in result.get_data(as_text=True)
        assert "synthetic" not in caplog.text


@pytest.mark.parametrize("configured", [True, False])
def test_refresh_request_uses_stored_token_and_bounded_provider_wait(monkeypatch, configured):
    from features.strava import check_and_refresh_strava_token

    for name in ("STRAVA_CLIENT_ID", "STRAVA_CLIENT_SECRET"):
        if configured:
            monkeypatch.setenv(name, "synthetic-config")
        else:
            monkeypatch.delenv(name, raising=False)
    bundle = {"access_token": "synthetic-access", "refresh_token": "synthetic-rotated", "expires_at": 200}
    with (
        patch("features.strava.get_access_token", side_effect=lambda uid, refresh: refresh("synthetic-refresh")),
        patch("features.strava.requests.post") as post,
    ):
        post.return_value.json.return_value = bundle
        if configured:
            assert check_and_refresh_strava_token(User(id=12)) == bundle
            assert post.call_args.kwargs["data"]["refresh_token"] == "synthetic-refresh"
            assert post.call_args.kwargs["data"]["grant_type"] == "refresh_token"
            assert post.call_args.kwargs["timeout"] == 10
            post.return_value.raise_for_status.assert_called_once()
        else:
            with pytest.raises(ValueError, match="Strava application credentials are not configured"):
                check_and_refresh_strava_token(User(id=12))
            post.assert_not_called()


@pytest.mark.parametrize("operation", ["update_strava_activity", "get_strava_activity"])
def test_missing_connection_raises_actionable_error(operation):
    from features import strava

    with patch("features.strava.DbManager") as manager, patch("features.strava.get_access_token", return_value=None):
        manager.find_records.return_value = [SlackUser(user_id=12)]
        manager.get.return_value = User(id=12)
        args = ["34", "Usynthetic", "Tsynthetic"]
        if operation == "update_strava_activity":
            args.extend(["Title", "Description"])
        with pytest.raises(Exception) as captured:
            getattr(strava, operation)(*args)
        assert type(captured.value).__name__ == "StravaNotConnectedError"
        assert "reconnect" in str(captured.value)
