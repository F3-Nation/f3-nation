import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from features import downrange, help
from features.calendar import home
from utilities import helper_functions
from utilities.database.orm import SlackSettings


@pytest.fixture
def unlinked_identity(monkeypatch):
    identity = SimpleNamespace(user_id=None, user_name="Test member", email="u_hidden")
    monkeypatch.setattr(helper_functions, "_resolve_user", lambda *_a, **_k: identity)
    return identity


def test_unlinked_member_can_open_calendar(monkeypatch, unlinked_identity):
    monkeypatch.setattr(home, "get_admin_users", lambda *_a: [])
    monkeypatch.setattr(home, "get_aoq_users", lambda *_a: [])
    database = MagicMock()
    database.find_records.return_value = []
    database.find_join_records2.return_value = []
    monkeypatch.setattr(home, "DbManager", database)
    schedule = MagicMock(return_value=[])
    monkeypatch.setattr(home, "home_schedule_query", schedule)
    client = MagicMock()
    home.build_home_form(
        {"user": {"id": "U_HIDDEN"}},
        client,
        MagicMock(),
        {},
        SlackSettings(team_id="T_TEST", org_id=7),
        update_view_id="V_TEST",
    )
    client.views_update.assert_called_once()
    assert schedule.call_args.args[0] is None
    assert '"user_is_admin": false' in client.views_update.call_args.kwargs["view"]["private_metadata"]


def test_unlinked_member_gets_help_without_personal_stats(unlinked_identity):
    client = MagicMock()
    help.handle_app_mention(
        {"event": {"user": "U_HIDDEN", "channel": "C_TEST"}},
        client,
        MagicMock(),
        {},
        SlackSettings(team_id="T_TEST", org_id=7),
    )
    client.chat_postEphemeral.assert_called_once()
    response = client.chat_postEphemeral.call_args.kwargs
    assert response["user"] == "U_HIDDEN"
    assert "My Stats" not in str(response["blocks"])


def test_unlinked_downrange_member_has_no_admin_rights(monkeypatch, unlinked_identity):
    monkeypatch.setattr(downrange, "ALL_USERS_ARE_ADMINS", False)
    monkeypatch.setattr(
        downrange, "get_admin_users", lambda *_a: [(SimpleNamespace(id=42), SimpleNamespace(slack_id="U_ADMIN"))]
    )
    assert not downrange._is_admin(
        {"user": {"id": "U_HIDDEN"}}, SlackSettings(team_id="T_TEST", org_id=7), MagicMock(), MagicMock()
    )


def test_unlinked_member_can_select_downrange_region(monkeypatch, unlinked_identity):
    monkeypatch.setattr(downrange, "_get_target_region_info", lambda *_a: (None, None, None))
    monkeypatch.setattr(
        downrange.DbManager,
        "get",
        lambda *_a, **_k: SimpleNamespace(
            name="Region", website=None, email=None, twitter=None, facebook=None, instagram=None
        ),
    )
    client = MagicMock()
    downrange.handle_region_select(
        {
            "user": {"id": "U_HIDDEN"},
            "actions": [{"selected_option": {"value": "8", "text": {"text": "Target"}}}],
            "view": {"id": "V_TEST", "private_metadata": "{}"},
        },
        client,
        MagicMock(),
        {},
        SlackSettings(team_id="T_TEST", org_id=7),
    )
    client.views_update.assert_called_once()


@pytest.mark.parametrize("action", ["View Preblast", "Take Q", "HC"])
def test_unlinked_home_actions_only_allow_viewing(monkeypatch, unlinked_identity, action):
    render = MagicMock()
    monkeypatch.setattr(home, "build_event_preblast_form", render)
    database = MagicMock()
    monkeypatch.setattr(home, "DbManager", database)
    body = {"user": {"id": "U_HIDDEN"}, "actions": [{"action_id": "event_7", "selected_option": {"value": action}}]}
    if action == "View Preblast":
        home.handle_home_event(body, MagicMock(), MagicMock(), {}, SlackSettings(team_id="T_TEST", org_id=7))
        render.assert_called_once()
    else:
        with pytest.raises(helper_functions.UnlinkedSlackIdentityError):
            home.handle_home_event(body, MagicMock(), MagicMock(), {}, SlackSettings(team_id="T_TEST", org_id=7))
        render.assert_not_called()
    database.create_record.assert_not_called()
    database.update_record.assert_not_called()
    database.delete_records.assert_not_called()
