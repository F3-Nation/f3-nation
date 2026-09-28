import os
import sys
from types import SimpleNamespace
from unittest.mock import Mock

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import update_slack_users


@pytest.mark.parametrize("force", [False, True])
def test_nonproduction_sync_returns_before_database_or_slack_calls(monkeypatch, force):
    monkeypatch.setattr(update_slack_users, "is_production_deployment", lambda: False)
    find_records = Mock(side_effect=AssertionError("database should not be read"))
    find_join_records2 = Mock(side_effect=AssertionError("database should not be read"))
    update_record = Mock(side_effect=AssertionError("database should not be written"))
    web_client = Mock(side_effect=AssertionError("Slack API should not be called"))
    monkeypatch.setattr(update_slack_users.DbManager, "find_records", find_records)
    monkeypatch.setattr(update_slack_users.DbManager, "find_join_records2", find_join_records2)
    monkeypatch.setattr(update_slack_users.DbManager, "update_record", update_record)
    monkeypatch.setattr(update_slack_users, "WebClient", web_client)

    update_slack_users.update_slack_users(force=force)

    find_records.assert_not_called()
    find_join_records2.assert_not_called()
    update_record.assert_not_called()
    web_client.assert_not_called()


def test_production_sync_imports_slack_name_and_avatar(monkeypatch):
    monkeypatch.setattr(update_slack_users, "is_production_deployment", lambda: True)
    slack_user = SimpleNamespace(id=17, slack_id="UFAKE001", user_id=42, slack_updated=1)
    slack_space = SimpleNamespace(settings={"bot_token": "fabricated-token"})
    org_space = SimpleNamespace(org_id=3)
    monkeypatch.setattr(update_slack_users.DbManager, "find_records", Mock(return_value=[slack_user]))
    monkeypatch.setattr(
        update_slack_users.DbManager,
        "find_join_records2",
        Mock(return_value=[(slack_space, org_space)]),
    )
    update_record = Mock()
    monkeypatch.setattr(update_slack_users.DbManager, "update_record", update_record)

    client = Mock()
    client.users_list.return_value = {
        "members": [
            {
                "id": "UFAKE001",
                "is_bot": False,
                "updated": 2,
                "name": "Fabricated Member",
                "profile": {
                    "display_name": "Fabricated Display",
                    "real_name": "Fabricated Member",
                    "image_512": "https://example.invalid/fabricated-avatar.png",
                },
            }
        ]
    }
    monkeypatch.setattr(update_slack_users, "WebClient", Mock(return_value=client))

    update_slack_users.update_slack_users()

    client.users_list.assert_called_once_with()
    update_record.assert_called_once()
    model, record_id, fields = update_record.call_args.args
    assert model is update_slack_users.SlackUser
    assert record_id == slack_user.id
    fields_by_name = {column.key: value for column, value in fields.items()}
    assert fields_by_name["user_name"] == "Fabricated Display"
    assert fields_by_name["avatar_url"] == "https://example.invalid/fabricated-avatar.png"
