import hashlib
import json
import logging
from contextlib import contextmanager
from unittest.mock import MagicMock, patch
from urllib.parse import parse_qs, urlparse

import pytest
import requests
from f3_data_models.models import SlackUser, User

from features import strava
from features.strava import (
    STRAVA_ACTIVITY_BUTTON_LABEL_MAX_LENGTH,
    STRAVA_OAUTH_STATE_META_KEY,
    STRAVA_OAUTH_STATE_TTL_SECONDS,
    build_strava_activity_blocks,
    build_strava_form,
    consume_strava_oauth_state,
    format_strava_activity_button_label,
    issue_strava_oauth_state,
    strava_exchange_token,
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
    slack_user_store,
    monkeypatch,
):
    monkeypatch.setenv("STRAVA_CLIENT_ID", "test-id")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "test-secret")
    monkeypatch.setenv("APP_URL", "https://example.test")

    mock_db_manager.find_records.return_value = [slack_user_store.records[7]]
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
    assert "state=T123-U123" not in connect_button.url
    assert connect_button.action == actions.STRAVA_CONNECT_BUTTON
    assert connect_button.url.startswith("https://www.strava.com/oauth/authorize")
    assert "client_id=test-id" in connect_button.url
    assert "redirect_uri=https%3A%2F%2Fexample.test%2Fexchange_token" in connect_button.url

    kwargs = mock_strava_form_instance.update_modal.call_args.kwargs
    assert kwargs.get("title_text") == "Choose Activity"


class FakeSession:
    def __init__(self, records):
        self.records = records
        self.get_calls = []

    def get(self, cls, pk, with_for_update=False):
        self.get_calls.append((cls, pk, with_for_update))
        return self.records.get(pk)


@pytest.fixture
def slack_user_store(monkeypatch):
    records = {7: SlackUser(id=7, slack_id="U123", slack_team_id="T123", user_id=42, meta={"other": "kept"})}
    session = FakeSession(records)

    @contextmanager
    def fake_session_scope(backend=None):
        yield session

    monkeypatch.setattr(strava, "session_scope", fake_session_scope)
    return session


def test_issue_state_stores_only_a_hash_with_expiry(slack_user_store, monkeypatch):
    monkeypatch.setattr(strava.time, "time", lambda: 1_000_000)

    state = issue_strava_oauth_state(7)

    pk, token = state.split(".", 1)
    assert pk == "7"
    assert len(token) >= 40
    meta = slack_user_store.records[7].meta
    assert meta["other"] == "kept"
    assert meta[STRAVA_OAUTH_STATE_META_KEY] == {
        "hash": hashlib.sha256(token.encode()).hexdigest(),
        "expires_at": 1_000_000 + STRAVA_OAUTH_STATE_TTL_SECONDS,
    }
    assert token not in json.dumps(meta)
    assert slack_user_store.get_calls == [(SlackUser, 7, True)]


def test_issue_state_is_random(slack_user_store):
    assert issue_strava_oauth_state(7) != issue_strava_oauth_state(7)


def test_issue_state_raises_for_unknown_slack_user(slack_user_store):
    with pytest.raises(ValueError):
        issue_strava_oauth_state(999)


def test_consume_state_returns_linked_user_once(slack_user_store):
    state = issue_strava_oauth_state(7)
    slack_user_store.get_calls = []

    assert consume_strava_oauth_state(state) == 42
    assert slack_user_store.get_calls[0] == (SlackUser, 7, True)
    assert slack_user_store.records[7].meta == {"other": "kept"}
    assert consume_strava_oauth_state(state) is None


def test_reissuing_state_invalidates_the_previous_one(slack_user_store):
    first = issue_strava_oauth_state(7)
    second = issue_strava_oauth_state(7)

    assert consume_strava_oauth_state(first) is None
    assert consume_strava_oauth_state(second) == 42


def test_consume_state_with_wrong_token_keeps_pending_state(slack_user_store):
    state = issue_strava_oauth_state(7)

    assert consume_strava_oauth_state("7.not-the-token") is None
    assert STRAVA_OAUTH_STATE_META_KEY in slack_user_store.records[7].meta
    assert consume_strava_oauth_state(state) == 42


def test_consume_expired_state_fails_and_clears_it(slack_user_store, monkeypatch, caplog):
    monkeypatch.setattr(strava.time, "time", lambda: 1_000_000)
    state = issue_strava_oauth_state(7)
    monkeypatch.setattr(strava.time, "time", lambda: 1_000_000 + STRAVA_OAUTH_STATE_TTL_SECONDS + 1)

    assert consume_strava_oauth_state(state) is None
    assert STRAVA_OAUTH_STATE_META_KEY not in slack_user_store.records[7].meta
    assert "slack.strava.oauth_state_rejected reason=expired slack_user_pk=7" in caplog.text
    assert state.split(".", 1)[1] not in caplog.text


@pytest.mark.parametrize(
    ("state", "reason"),
    [
        (None, "missing"),
        ("abc.token", "malformed"),
        ("999.token", "unknown_slack_user"),
        ("7.not-the-token", "token_mismatch"),
    ],
)
def test_consume_rejection_logs_reason_without_the_state(slack_user_store, caplog, state, reason):
    issue_strava_oauth_state(7)

    assert consume_strava_oauth_state(state) is None
    assert f"reason={reason}" in caplog.text
    assert state is None or state not in caplog.text


def test_consume_state_without_pending_state_logs_reason(slack_user_store, caplog):
    assert consume_strava_oauth_state("7.token") is None
    assert "reason=no_pending_state slack_user_pk=7" in caplog.text


def test_consume_state_for_unlinked_slack_user_fails(slack_user_store, caplog):
    state = issue_strava_oauth_state(7)
    slack_user_store.records[7].user_id = None

    assert consume_strava_oauth_state(state) is None
    assert "reason=slack_user_unlinked slack_user_pk=7" in caplog.text
    assert STRAVA_OAUTH_STATE_META_KEY not in slack_user_store.records[7].meta


@pytest.mark.parametrize(
    "state", [None, "", "T123-U123", "7", "7.", ".token", "abc.token", "-7.token", "\u00b2.x", "9999999999.x"]
)
def test_consume_malformed_state_does_not_touch_the_database(slack_user_store, state):
    assert consume_strava_oauth_state(state) is None
    assert slack_user_store.get_calls == []


def test_consume_state_for_unknown_slack_user_fails(slack_user_store):
    assert consume_strava_oauth_state("999.token") is None


def _callback_request(args):
    request = MagicMock()
    request.args = args
    return request


@pytest.fixture
def strava_env(monkeypatch):
    monkeypatch.setenv("STRAVA_CLIENT_ID", "test-id")
    monkeypatch.setenv("STRAVA_CLIENT_SECRET", "test-secret")


@pytest.mark.parametrize(
    "args",
    [
        {"code": "auth-code"},
        {"state": "T123-U123", "code": "auth-code"},
        {"state": "7.forged", "code": "auth-code"},
    ],
)
@patch("features.strava.DbManager")
@patch("features.strava.requests.post")
def test_exchange_token_rejects_unissued_state(mock_post, mock_db_manager, slack_user_store, strava_env, args):
    issue_strava_oauth_state(7)

    response = strava_exchange_token(_callback_request(args))

    assert response.status_code == 400
    assert "invalid or has expired" in json.loads(response.get_data(as_text=True))["error"]
    mock_post.assert_not_called()
    mock_db_manager.update_record.assert_not_called()


@patch("features.strava.save_connection", return_value=True)
@patch("features.strava.DbManager")
@patch("features.strava.requests.post")
def test_exchange_token_links_tokens_to_the_user_the_state_was_issued_to(
    mock_post, mock_db_manager, mock_save, slack_user_store, strava_env
):
    state = issue_strava_oauth_state(7)
    bundle = {
        "athlete": {"id": 555},
        "access_token": "access",
        "refresh_token": "refresh",
        "expires_at": 123,
    }
    mock_post.return_value.json.return_value = bundle

    response = strava_exchange_token(_callback_request({"state": state, "code": "auth-code"}))

    assert response.status_code == 200
    assert json.loads(response.get_data(as_text=True)) == {
        "message": "Authorization successful! You can return to Slack."
    }
    assert mock_post.call_args.kwargs["data"]["code"] == "auth-code"
    assert mock_post.call_args.kwargs["timeout"] == 10
    mock_save.assert_called_once_with(42, bundle)
    mock_db_manager.update_record.assert_not_called()

    replay = strava_exchange_token(_callback_request({"state": state, "code": "auth-code"}))
    assert replay.status_code == 400
    assert mock_post.call_count == 1
    assert mock_save.call_count == 1


@pytest.mark.parametrize(
    "failure",
    [
        "http_error",
        requests.ConnectionError("synthetic-down"),
        requests.Timeout("synthetic-slow"),
        "invalid_json",
    ],
)
@patch("features.strava.save_connection")
@patch("features.strava.requests.post")
def test_exchange_token_provider_failure_returns_502_and_saves_nothing(
    mock_post, mock_save, slack_user_store, strava_env, failure, caplog
):
    state = issue_strava_oauth_state(7)
    if failure == "http_error":
        mock_post.return_value.status_code = 400
        mock_post.return_value.raise_for_status.side_effect = requests.HTTPError(
            "synthetic-body", response=mock_post.return_value
        )
    elif failure == "invalid_json":
        mock_post.return_value.json.side_effect = ValueError("synthetic-body")
    else:
        mock_post.side_effect = failure

    response = strava_exchange_token(_callback_request({"state": state, "code": "synthetic-code"}))

    assert response.status_code == 502
    assert "Reopen the Strava option in Slack" in json.loads(response.get_data(as_text=True))["error"]
    mock_save.assert_not_called()
    assert "slack.strava.token_exchange.failed" in caplog.text
    assert "synthetic" not in caplog.text
    if failure == "http_error":
        assert "status=400" in caplog.text


@patch("features.strava.save_connection")
@patch("features.strava.requests.post")
def test_exchange_ownership_conflict_keeps_connection_and_shows_support_message(
    mock_post, mock_save, slack_user_store, strava_env
):
    from infrastructure.strava_credentials import StravaOwnershipConflict

    state = issue_strava_oauth_state(7)
    mock_post.return_value.json.return_value = {"synthetic": "provider-payload"}
    mock_save.side_effect = StravaOwnershipConflict

    response = strava_exchange_token(_callback_request({"state": state, "code": "synthetic-code"}))

    assert response.status_code == 409
    assert json.loads(response.get_data(as_text=True)) == {
        "message": (
            "This Strava account is already connected to another F3 profile. "
            "The existing connection has not changed. Please contact support for help."
        )
    }
    mock_save.assert_called_once()
    assert mock_save.call_args.args[0] == 42
    assert "synthetic" not in response.get_data(as_text=True)


@pytest.mark.parametrize("failure", [False, RuntimeError("synthetic-storage"), ValueError("synthetic-provider")])
@patch("features.strava.save_connection")
@patch("features.strava.requests.post")
def test_exchange_save_failure_returns_service_unavailable(
    mock_post, mock_save, slack_user_store, strava_env, failure, caplog
):
    state = issue_strava_oauth_state(7)
    mock_post.return_value.json.return_value = {"synthetic": "provider-payload"}
    if isinstance(failure, Exception):
        mock_save.side_effect = failure
    else:
        mock_save.return_value = failure

    response = strava_exchange_token(_callback_request({"state": state, "code": "synthetic-code"}))

    assert response.status_code == 503
    assert json.loads(response.get_data(as_text=True)) == {
        "message": "Strava could not be connected right now. Please try again later."
    }
    assert mock_save.call_args.args[0] == 42
    assert "synthetic" not in response.get_data(as_text=True)
    assert "synthetic" not in caplog.text


@patch("features.strava.requests.post")
def test_exchange_token_without_code_uses_up_state(mock_post, slack_user_store, strava_env):
    state = issue_strava_oauth_state(7)

    response = strava_exchange_token(_callback_request({"state": state, "error": "access_denied"}))

    assert response.status_code == 400
    assert json.loads(response.get_data(as_text=True)) == {"error": "No code provided."}
    assert STRAVA_OAUTH_STATE_META_KEY not in slack_user_store.records[7].meta
    mock_post.assert_not_called()


@patch("features.strava.requests.post")
def test_exchange_token_unconfigured_returns_500(mock_post, slack_user_store, monkeypatch):
    monkeypatch.delenv("STRAVA_CLIENT_ID", raising=False)
    monkeypatch.delenv("STRAVA_CLIENT_SECRET", raising=False)

    response = strava_exchange_token(_callback_request({"state": "7.token", "code": "c"}))

    assert response.status_code == 500
    mock_post.assert_not_called()


@patch("features.strava.DbManager")
@patch("features.strava.get_strava_activities")
@patch("features.strava.slack_orm.BlockView")
def test_build_strava_form_connect_url_carries_issued_state(
    mock_block_view,
    mock_get_strava_activities,
    mock_db_manager,
    mock_strava_form_body,
    slack_user_store,
    strava_env,
    caplog,
):
    caplog.set_level(logging.DEBUG)
    mock_db_manager.find_records.return_value = [slack_user_store.records[7]]
    mock_db_manager.get.return_value = User(id=42)
    mock_get_strava_activities.return_value = []

    build_strava_form(mock_strava_form_body, MagicMock(), MagicMock(), {}, MagicMock())

    blocks = mock_block_view.call_args.kwargs["blocks"]
    url = blocks[2].elements[0].url
    (state,) = parse_qs(urlparse(url).query)["state"]
    assert state.startswith("7.")
    token = state.split(".", 1)[1]
    assert token not in caplog.text
    assert consume_strava_oauth_state(state) == 42


@patch("features.strava.DbManager")
@patch("features.strava.get_strava_activities")
@patch("features.strava.slack_orm.BlockView")
def test_build_strava_form_with_activities_issues_no_state(
    mock_block_view,
    mock_get_strava_activities,
    mock_db_manager,
    mock_strava_form_body,
    slack_user_store,
    strava_env,
):
    mock_db_manager.find_records.return_value = [slack_user_store.records[7]]
    mock_db_manager.get.return_value = User(id=42)
    mock_get_strava_activities.return_value = [
        {"id": 1000, "name": "Morning Run", "start_date_local": "2026-08-01T05:30:00Z"}
    ]

    build_strava_form(mock_strava_form_body, MagicMock(), MagicMock(), {}, MagicMock())

    assert slack_user_store.get_calls == []
    assert STRAVA_OAUTH_STATE_META_KEY not in slack_user_store.records[7].meta


@patch("features.strava.DbManager")
@patch("features.strava.get_strava_activities")
@patch("features.strava.slack_orm.BlockView")
def test_build_strava_form_without_slack_user_shows_no_connect_link(
    mock_block_view,
    mock_get_strava_activities,
    mock_db_manager,
    mock_strava_form_body,
    slack_user_store,
    strava_env,
):
    mock_db_manager.find_records.return_value = []

    build_strava_form(mock_strava_form_body, MagicMock(), MagicMock(), {}, MagicMock())

    blocks = mock_block_view.call_args.kwargs["blocks"]
    assert len(blocks) == 1
    assert isinstance(blocks[0], slack_orm.SectionBlock)
    assert "couldn't find your F3 profile" in str(blocks[0].label)
    assert slack_user_store.get_calls == []


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
