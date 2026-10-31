import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from f3_data_models.models import Org

from features import region
from utilities.slack import actions


def _submit_region_form(monkeypatch, uploaded_urls):
    form_values = {
        actions.REGION_NAME: "Synthetic Region",
        actions.REGION_LOGO: [{"id": "SYNTHETIC_LOGO"}],
        actions.REGION_ADMINS: [],
    }
    monkeypatch.setattr(region.REGION_FORM, "get_selected_values", lambda body: form_values)
    monkeypatch.setattr(
        region, "upload_files_to_storage", MagicMock(return_value=(uploaded_urls, [], ["SYNTHETIC_LOGO"], []))
    )
    update_record = MagicMock()
    monkeypatch.setattr(region.DbManager, "update_record", update_record)
    monkeypatch.setattr(region.DbManager, "find_first_record", MagicMock(return_value=SimpleNamespace(id=3)))
    monkeypatch.setattr(region.DbManager, "delete_records", MagicMock())
    monkeypatch.setattr(region.DbManager, "create_or_ignore", MagicMock())
    monkeypatch.setattr(region, "get_admin_users", MagicMock(return_value=[]))

    region.handle_region_edit({}, MagicMock(), MagicMock(), {}, SimpleNamespace(org_id=7, team_id="T_SYNTHETIC"))

    update_record.assert_called_once()
    model, org_id, fields = update_record.call_args.args
    assert (model, org_id) == (Org, 7)
    assert fields[Org.name] == "Synthetic Region"
    return fields


def test_region_edit_saves_uploaded_logo(monkeypatch):
    fields = _submit_region_form(monkeypatch, ["https://example.test/org-logos/7.png"])
    assert fields[Org.logo_url] == "https://example.test/org-logos/7.png"


def test_region_edit_keeps_logo_and_saves_region_when_logo_upload_fails(monkeypatch):
    fields = _submit_region_form(monkeypatch, [])
    assert Org.logo_url not in fields
