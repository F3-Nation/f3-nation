from unittest.mock import MagicMock

import pytest

from features import region
from utilities.database.orm import SlackSettings
from utilities.helper_functions import UnlinkedSlackIdentityError
from utilities.slack import actions


def test_region_edit_unlinked_admin_does_not_upload_or_save(monkeypatch):
    fields = {
        actions.REGION_ADMINS: {"type": "multi_users_select", "selected_users": ["U_UNLINKED"]},
        actions.REGION_LOGO: {"type": "file_input", "files": [{"id": "F_LOGO"}]},
    }
    body = {"view": {"blocks": [], "state": {"values": {action: {action: value} for action, value in fields.items()}}}}
    db_manager = MagicMock()
    monkeypatch.setattr(region, "DbManager", db_manager)
    upload = MagicMock(return_value=(["https://example.test/logo.png"], [], [], []))
    monkeypatch.setattr(region, "upload_files_to_storage", upload)
    monkeypatch.setattr(region, "get_user", MagicMock(side_effect=UnlinkedSlackIdentityError()))
    client = MagicMock()

    with pytest.raises(UnlinkedSlackIdentityError):
        region.handle_region_edit(body, client, MagicMock(), {}, SlackSettings(team_id="T_TEST", org_id=7))

    upload.assert_not_called()
    for operation in ("create_record", "create_records", "update_record", "update_records", "delete_records"):
        getattr(db_manager, operation).assert_not_called()
    client.chat_postMessage.assert_not_called()
