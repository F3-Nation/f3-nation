import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from f3_data_models.models import User

from features import user
from utilities import constants, helper_functions


def test_nonproduction_user_form_persists_submitted_fields_only_for_linked_user_without_slack_profile_fetch(
    monkeypatch,
):
    monkeypatch.setattr(constants, "is_production_deployment", lambda: False, raising=False)
    slack_user = SimpleNamespace(user_id=42, slack_id="U_NONPROD_PROFILE")
    monkeypatch.setattr(helper_functions, "SLACK_USERS", {slack_user.slack_id: slack_user})
    form_values = {
        user.USER_FORM_USERNAME: "Fabricated Test Pax",
        user.USER_FORM_HOME_REGION: 17,
        user.USER_FORM_EMERGENCY_CONTACT: "Fabricated Contact",
        user.USER_FORM_EMERGENCY_CONTACT_PHONE: "555-0199",
        user.USER_FORM_EMERGENCY_CONTACT_NOTES: "Fabricated medical notes",
        user.USER_EMERGENCY_INFO_SHARING: ["enabled"],
        user.USER_FORM_START_DATE: "2025-02-03",
        user.USER_FORM_BROUGHT_BY: "23",
        user.USER_FORM_F3_NAME_ORIGIN: "Fabricated origin text",
        user.USER_FORM_F3_WHY: "Fabricated why text",
        user.USER_FORM_IMAGE_UPLOAD: [{"id": "FABRICATED_USER_UPLOAD"}],
    }
    monkeypatch.setattr(user.FORM, "get_selected_values", lambda _body: form_values)
    profile = MagicMock(meta={})
    db_get = MagicMock(return_value=profile)
    update_record = MagicMock()
    monkeypatch.setattr(user.DbManager, "get", db_get)
    monkeypatch.setattr(user.DbManager, "update_record", update_record)
    client = MagicMock()
    logger = MagicMock()
    upload = MagicMock(return_value=(["https://example.test/fabricated-avatar.png"], [], [], []))
    monkeypatch.setattr(user, "upload_files_to_storage", upload)

    body = {"user": {"id": slack_user.slack_id}}
    user.handle_user_form(body, client, logger, {}, SimpleNamespace(org_id=17, team_id="T_NONPROD"))

    db_get.assert_called_once_with(User, slack_user.user_id)
    update_record.assert_called_once()
    model, user_id, fields = update_record.call_args.args
    assert model is User
    assert user_id == slack_user.user_id
    assert fields[User.f3_name] == "Fabricated Test Pax"
    assert fields[User.home_region_id] == 17
    assert fields[User.emergency_contact] == "Fabricated Contact"
    assert fields[User.emergency_phone] == "555-0199"
    assert fields[User.emergency_notes] == "Fabricated medical notes"
    assert fields[User.avatar_url] == "https://example.test/fabricated-avatar.png"
    assert fields[User.meta] == {
        user.USER_EMERGENCY_INFO_SHARING: True,
        user.USER_META_START_DATE: "2025-02-03",
        user.USER_META_BROUGHT_BY: 23,
        user.USER_META_F3_NAME_ORIGIN: "Fabricated origin text",
        user.USER_META_F3_WHY: "Fabricated why text",
    }
    upload.assert_called_once_with(
        form_values[user.USER_FORM_IMAGE_UPLOAD],
        client=client,
        logger=logger,
        bucket_name="user-avatars",
        file_name="42",
        enforce_png=True,
    )
    client.users_info.assert_not_called()
    assert set(fields) == {
        User.f3_name,
        User.home_region_id,
        User.emergency_contact,
        User.emergency_phone,
        User.emergency_notes,
        User.avatar_url,
        User.meta,
    }


def test_production_user_form_updates_profile_and_uploads_photo(monkeypatch):
    monkeypatch.setattr(constants, "is_production_deployment", lambda: True, raising=False)
    form_values = {
        user.USER_FORM_USERNAME: "Synthetic Test Pax",
        user.USER_FORM_HOME_REGION: 17,
        user.USER_FORM_EMERGENCY_CONTACT: "Synthetic Contact",
        user.USER_FORM_EMERGENCY_CONTACT_PHONE: "555-0100",
        user.USER_FORM_EMERGENCY_CONTACT_NOTES: "Synthetic notes only",
        user.USER_EMERGENCY_INFO_SHARING: ["enabled"],
        user.USER_FORM_START_DATE: "2025-01-02",
        user.USER_FORM_BROUGHT_BY: "23",
        user.USER_FORM_F3_NAME_ORIGIN: "Synthetic origin",
        user.USER_FORM_F3_WHY: "Synthetic why",
        user.USER_FORM_IMAGE_UPLOAD: [{"id": "SYNTHETIC_FILE"}],
    }
    monkeypatch.setattr(user.FORM, "get_selected_values", lambda body: form_values)
    slack_user = MagicMock(user_id=42)
    monkeypatch.setattr(user, "get_user", MagicMock(return_value=slack_user))
    profile = MagicMock(meta={})
    monkeypatch.setattr(user.DbManager, "get", MagicMock(return_value=profile))
    update_record = MagicMock()
    monkeypatch.setattr(user.DbManager, "update_record", update_record)
    upload = MagicMock(return_value=(["https://example.test/synthetic-avatar.png"], [], [], []))
    monkeypatch.setattr(user, "upload_files_to_storage", upload)

    client = MagicMock()
    logger = MagicMock()
    user.handle_user_form({}, client, logger, {}, MagicMock())

    upload.assert_called_once_with(
        form_values[user.USER_FORM_IMAGE_UPLOAD],
        client=client,
        logger=logger,
        bucket_name="user-avatars",
        file_name="42",
        enforce_png=True,
    )
    update_record.assert_called_once()
    model, user_id, fields = update_record.call_args.args
    assert model is User
    assert user_id == 42
    assert fields[User.f3_name] == "Synthetic Test Pax"
    assert fields[User.home_region_id] == 17
    assert fields[User.emergency_contact] == "Synthetic Contact"
    assert fields[User.emergency_phone] == "555-0100"
    assert fields[User.emergency_notes] == "Synthetic notes only"
    assert fields[User.avatar_url] == "https://example.test/synthetic-avatar.png"
    assert fields[User.meta] == {
        user.USER_EMERGENCY_INFO_SHARING: True,
        user.USER_META_START_DATE: "2025-01-02",
        user.USER_META_BROUGHT_BY: 23,
        user.USER_META_F3_NAME_ORIGIN: "Synthetic origin",
        user.USER_META_F3_WHY: "Synthetic why",
    }
