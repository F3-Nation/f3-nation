import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from f3_data_models.models import Org

from features import region
from utilities.slack import actions

LOGO_FILE = {"id": "SYNTHETIC_LOGO", "filetype": "png", "mimetype": "image/png"}


def _region_form_body():
    values = {
        actions.REGION_NAME: {actions.REGION_NAME: {"type": "plain_text_input", "value": "Synthetic Region"}},
        actions.REGION_LOGO: {actions.REGION_LOGO: {"type": "file_input", "files": [LOGO_FILE]}},
        actions.REGION_ADMINS: {actions.REGION_ADMINS: {"type": "multi_users_select", "selected_users": []}},
    }
    return {"user": {"id": "U_SYNTHETIC"}, "view": {"id": "V1", "state": {"values": values}, "blocks": []}}


def _submit_region_form(monkeypatch, uploaded_urls):
    upload = MagicMock(return_value=(uploaded_urls, [], ["SYNTHETIC_LOGO"], []))
    monkeypatch.setattr(region, "upload_files_to_storage", upload)
    send_error = MagicMock()
    monkeypatch.setattr(region, "send_error_response", send_error)
    update_record = MagicMock()
    monkeypatch.setattr(region.DbManager, "update_record", update_record)
    monkeypatch.setattr(region.DbManager, "find_first_record", MagicMock(return_value=SimpleNamespace(id=3)))
    monkeypatch.setattr(region.DbManager, "delete_records", MagicMock())
    monkeypatch.setattr(region.DbManager, "create_or_ignore", MagicMock())
    monkeypatch.setattr(region, "get_admin_users", MagicMock(return_value=[]))
    body = _region_form_body()
    client = MagicMock()

    region.handle_region_edit(body, client, MagicMock(), {}, SimpleNamespace(org_id=7, team_id="T_SYNTHETIC"))

    assert upload.call_args.kwargs["files"] == [LOGO_FILE]
    update_record.assert_called_once()
    model, org_id, fields = update_record.call_args.args
    assert (model, org_id) == (Org, 7)
    assert fields[Org.name] == "Synthetic Region"
    return fields, send_error, body, client


def test_region_edit_saves_uploaded_logo(monkeypatch):
    fields, send_error, _, _ = _submit_region_form(monkeypatch, ["https://example.test/org-logos/7.png"])
    assert fields[Org.logo_url] == "https://example.test/org-logos/7.png"
    send_error.assert_not_called()


def test_region_edit_keeps_logo_saves_region_and_tells_user_when_logo_upload_fails(monkeypatch):
    fields, send_error, body, client = _submit_region_form(monkeypatch, [])
    assert Org.logo_url not in fields
    send_error.assert_called_once_with(
        body, client, "The region settings were saved, but the logo couldn't be uploaded. Please try again."
    )
