import json
import os
import sys
from unittest.mock import MagicMock, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

import pytest

from application.event_instance import EventInstanceData
from application.event_instance.service import EventInstanceService
from application.preblast import PostMode, PreblastPostDecision
from application.preblast.service import PreblastService
from features.calendar import event_preblast
from infrastructure.api_client.event_instance_repository import ApiEventInstanceRepository
from utilities import constants
from utilities.slack import actions

EVENT_ID = 42
FULL_URL = "https://storage.googleapis.com/f3nation/event_instance_images/preblast_42_F_NEW.png"
LOW_REZ_URL = "https://storage.googleapis.com/f3nation/event_instance_images/preblast_42_F_NEW_low_res.png"
SLACK_FILE = {
    "id": "F_NEW",
    "filetype": "png",
    "mimetype": "image/png",
    "url_private_download": "https://files.slack.com/F_NEW",
    "thumb_720": "https://files.slack.com/F_NEW_720",
}
EXISTING_META = {
    "backblast_reminder_dismissed": True,
    "files": ["https://storage.googleapis.com/f3nation/event_instance_images/42.png"],
    "file_ids": ["F_BACKBLAST"],
    constants.PREBLAST_IMAGE_URL: "https://storage.googleapis.com/f3nation/event_instance_images/preblast_42_F_OLD.png",
    constants.PREBLAST_IMAGE_LOW_REZ_URL: (
        "https://storage.googleapis.com/f3nation/event_instance_images/preblast_42_F_OLD_low_res.png"
    ),
    constants.PREBLAST_IMAGE_SOURCE_FILE_ID: "F_OLD",
}


def _raw_instance(meta):
    return {
        "id": EVENT_ID,
        "name": "The Grind",
        "orgId": 10,
        "startDate": "2026-11-02",
        "startTime": "0530",
        "endTime": "0615",
        "isActive": True,
        "isPrivate": False,
        "highlight": False,
        "eventTypes": [{"eventTypeId": 5}],
        "eventTags": [],
        "seriesException": None,
        "preblastTs": None,
        "seriesId": None,
        "meta": meta,
    }


def _submission_body(files=None):
    values = {
        actions.EVENT_PREBLAST_TITLE: {
            actions.EVENT_PREBLAST_TITLE: {"type": "plain_text_input", "value": "The Grind"},
        },
        actions.EVENT_PREBLAST_SEND_OPTIONS: {
            actions.EVENT_PREBLAST_SEND_OPTIONS: {
                "type": "radio_buttons",
                "selected_option": {"value": "Send later"},
            },
        },
    }
    if files is not None:
        values[actions.EVENT_PREBLAST_IMAGE] = {
            actions.EVENT_PREBLAST_IMAGE: {"type": "file_input", "files": files},
        }
    return {
        "user": {"id": "U_Q"},
        "view": {
            "id": "V_SUBMIT",
            "private_metadata": json.dumps({"event_instance_id": EVENT_ID, "preblast_ts": "None"}),
            "state": {"values": values},
        },
    }


@pytest.fixture
def api_client():
    client = MagicMock()
    client.get.return_value = {"eventInstance": _raw_instance(dict(EXISTING_META))}
    client.post.return_value = {"eventInstance": _raw_instance(dict(EXISTING_META))}
    return client


@pytest.fixture
def wired_services(api_client):
    """Route the handler through the real services and repository, faking only HTTP."""
    event_svc = EventInstanceService(repository=ApiEventInstanceRepository(api_client))
    preblast_svc = PreblastService(event_instance_service=event_svc, attendance_service=MagicMock())
    with (
        patch.object(event_preblast, "_build_event_instance_service", return_value=event_svc),
        patch.object(event_preblast, "_build_preblast_service", return_value=preblast_svc),
    ):
        yield


@pytest.fixture
def wait_view():
    with patch.object(event_preblast, "update_submission_wait_view") as mock:
        yield mock


def _posted_meta(api_client):
    return api_client.post.call_args.kwargs["json"]["meta"]


# ---------------------------------------------------------------------------
# Upload
# ---------------------------------------------------------------------------


def test_upload_uses_event_image_bucket_and_preblast_object_name():
    with patch.object(
        event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], ["F_NEW"], [LOW_REZ_URL])
    ) as upload:
        meta = event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), MagicMock())

    kwargs = upload.call_args.kwargs
    assert kwargs["files"] == [SLACK_FILE]
    assert kwargs["bucket_name"] == "event_instance_images"
    assert kwargs["file_name"] == "preblast_42_F_NEW"
    assert meta == {
        constants.PREBLAST_IMAGE_URL: FULL_URL,
        constants.PREBLAST_IMAGE_LOW_REZ_URL: LOW_REZ_URL,
        constants.PREBLAST_IMAGE_SOURCE_FILE_ID: "F_NEW",
    }


def test_preblast_object_name_differs_from_backblast_object_name():
    # The backblast flow names its object str(event_instance_id); see features/backblast.py.
    with patch.object(event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], [], [])) as upload:
        event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), MagicMock())

    assert upload.call_args.kwargs["file_name"] != str(EVENT_ID)


def test_replacement_photo_gets_a_new_object_name():
    with patch.object(event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], [], [])) as upload:
        event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), MagicMock())
        event_preblast._upload_preblast_image({**SLACK_FILE, "id": "F_OTHER"}, EVENT_ID, MagicMock(), MagicMock())

    first, second = (c.kwargs["file_name"] for c in upload.call_args_list)
    assert first != second


def test_upload_without_thumbnail_falls_back_to_full_url():
    with patch.object(event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], ["F_NEW"], [])):
        meta = event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), MagicMock())

    assert meta[constants.PREBLAST_IMAGE_LOW_REZ_URL] == FULL_URL


@pytest.mark.parametrize(
    "upload_kwargs",
    [
        {"return_value": ([], [], ["F_NEW"], [])},
        {"side_effect": RuntimeError("storage down")},
    ],
)
def test_upload_failure_returns_none_and_logs(upload_kwargs):
    logger = MagicMock()
    with patch.object(event_preblast, "upload_files_to_storage", **upload_kwargs):
        meta = event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), logger)

    assert meta is None
    logger.error.assert_called_once()


# ---------------------------------------------------------------------------
# Rendering
# ---------------------------------------------------------------------------


def test_image_block_renders_low_rez_storage_url():
    block = event_preblast._preblast_image_block(
        {constants.PREBLAST_IMAGE_URL: FULL_URL, constants.PREBLAST_IMAGE_LOW_REZ_URL: LOW_REZ_URL}
    )
    assert block == {"type": "image", "image_url": LOW_REZ_URL, "alt_text": "Preblast Image"}


def test_image_block_prefers_storage_url_over_legacy_slack_file():
    block = event_preblast._preblast_image_block(
        {constants.PREBLAST_IMAGE_LOW_REZ_URL: LOW_REZ_URL, constants.PREBLAST_IMAGE_SLACK_FILE_ID_LEGACY: "F_LEGACY"}
    )
    assert block["image_url"] == LOW_REZ_URL
    assert "slack_file" not in block


def test_image_block_falls_back_to_legacy_slack_file():
    block = event_preblast._preblast_image_block({constants.PREBLAST_IMAGE_SLACK_FILE_ID_LEGACY: "F_LEGACY"})
    assert block == {"type": "image", "slack_file": {"id": "F_LEGACY"}, "alt_text": "Preblast Image"}


@pytest.mark.parametrize("meta", [None, {}, {"files": [FULL_URL]}])
def test_image_block_is_none_without_preblast_photo(meta):
    assert event_preblast._preblast_image_block(meta) is None


# ---------------------------------------------------------------------------
# Submit handler
# ---------------------------------------------------------------------------


@pytest.mark.usefixtures("wired_services")
def test_new_photo_is_merged_into_meta_preserving_other_keys(api_client, wait_view):
    with patch.object(
        event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], ["F_NEW"], [LOW_REZ_URL])
    ) as upload:
        event_preblast.handle_event_preblast_edit(
            _submission_body(files=[SLACK_FILE]), MagicMock(), MagicMock(), {}, MagicMock()
        )

    assert upload.call_args.kwargs["file_name"] == "preblast_42_F_NEW"
    assert _posted_meta(api_client) == {
        **EXISTING_META,
        constants.PREBLAST_IMAGE_URL: FULL_URL,
        constants.PREBLAST_IMAGE_LOW_REZ_URL: LOW_REZ_URL,
        constants.PREBLAST_IMAGE_SOURCE_FILE_ID: "F_NEW",
    }
    assert wait_view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS


@pytest.mark.usefixtures("wired_services")
@pytest.mark.parametrize("files", [None, []])
def test_edit_without_new_photo_keeps_current_photo(api_client, wait_view, files):
    with patch.object(event_preblast, "upload_files_to_storage") as upload:
        event_preblast.handle_event_preblast_edit(
            _submission_body(files=files), MagicMock(), MagicMock(), {}, MagicMock()
        )

    upload.assert_not_called()
    assert _posted_meta(api_client) == EXISTING_META
    assert wait_view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS


@pytest.mark.usefixtures("wired_services")
def test_failed_upload_keeps_current_photo_and_reports_error(api_client, wait_view):
    logger = MagicMock()
    with patch.object(event_preblast, "upload_files_to_storage", return_value=([], [], ["F_NEW"], [])):
        event_preblast.handle_event_preblast_edit(
            _submission_body(files=[SLACK_FILE]), MagicMock(), logger, {}, MagicMock()
        )

    assert _posted_meta(api_client) == EXISTING_META
    logger.error.assert_called()
    kwargs = wait_view.call_args.kwargs
    assert kwargs["level"] == constants.AlertLevel.ERROR
    assert event_preblast.PREBLAST_IMAGE_UPLOAD_FAILED_TEXT in kwargs["text"]


def test_failed_upload_warning_is_passed_to_send_preblast(wired_services):
    body = _submission_body(files=[SLACK_FILE])
    body["view"]["state"]["values"][actions.EVENT_PREBLAST_SEND_OPTIONS][actions.EVENT_PREBLAST_SEND_OPTIONS][
        "selected_option"
    ]["value"] = "Send now"
    with (
        patch.object(event_preblast, "upload_files_to_storage", return_value=([], [], [], [])),
        patch.object(event_preblast, "send_preblast") as send,
    ):
        event_preblast.handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

    assert send.call_args.kwargs["warning"] == event_preblast.PREBLAST_IMAGE_UPLOAD_FAILED_TEXT


# ---------------------------------------------------------------------------
# send_preblast
# ---------------------------------------------------------------------------


def _event(meta, preblast_ts=None):
    return EventInstanceData(
        id=EVENT_ID,
        name="The Grind",
        org_id=10,
        start_date="2026-11-02",
        start_time="0530",
        end_time="0615",
        event_type_ids=[5],
        event_tag_ids=[],
        meta=meta,
        preblast_ts=preblast_ts,
    )


def _send(meta, mode, warning=None, preblast_ts=None):
    client = MagicMock()
    client.chat_postMessage.return_value = {"ts": "1761800000.000100"}
    info = event_preblast.PreblastInfo(
        event_record=_event(meta, preblast_ts),
        attendance_records=[],
        preblast_blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "Preblast"}}],
        action_blocks=[],
    )
    svc = MagicMock()
    svc.decide_post_mode.return_value = PreblastPostDecision(
        mode=mode, desired_channel_id="C_AO", posted_channel_id="C_AO", existing_preblast_ts=preblast_ts
    )
    with (
        patch.object(event_preblast, "build_preblast_info", return_value=info),
        patch.object(event_preblast, "_build_preblast_service", return_value=svc),
        patch.object(event_preblast, "get_preblast_channel", return_value="C_AO"),
        patch.object(event_preblast, "get_user_names", return_value=(["Q"], ["https://img/q.png"])),
        patch.object(event_preblast, "post_bot_log"),
        patch.object(event_preblast, "update_submission_wait_view") as wait_view,
    ):
        event_preblast.send_preblast(
            body={"user": {"id": "U_Q"}, "view": {"id": "V_SUBMIT"}},
            client=client,
            logger=MagicMock(),
            region_record=MagicMock(team_id="T1"),
            event_instance_id=EVENT_ID,
            warning=warning,
        )
    return client, wait_view


def _image_blocks(blocks):
    return [b for b in blocks if b["type"] == "image"]


def test_new_post_renders_stored_image_url():
    client, _ = _send(EXISTING_META, PostMode.POST_NEW)

    blocks = client.chat_postMessage.call_args.kwargs["blocks"]
    assert _image_blocks(blocks) == [
        {
            "type": "image",
            "image_url": EXISTING_META[constants.PREBLAST_IMAGE_LOW_REZ_URL],
            "alt_text": "Preblast Image",
        }
    ]
    assert blocks[-1]["type"] == "actions"
    assert blocks[-2]["type"] == "image"


def test_update_renders_stored_image_url():
    client, _ = _send(EXISTING_META, PostMode.UPDATE_EXISTING, preblast_ts=1761800000.0001)

    blocks = client.chat_update.call_args.kwargs["blocks"]
    assert _image_blocks(blocks)[0]["image_url"] == EXISTING_META[constants.PREBLAST_IMAGE_LOW_REZ_URL]


def test_legacy_preblast_still_renders_slack_file():
    client, _ = _send({constants.PREBLAST_IMAGE_SLACK_FILE_ID_LEGACY: "F_LEGACY"}, PostMode.POST_NEW)

    blocks = client.chat_postMessage.call_args.kwargs["blocks"]
    assert _image_blocks(blocks) == [{"type": "image", "slack_file": {"id": "F_LEGACY"}, "alt_text": "Preblast Image"}]


def test_warning_marks_successful_post_as_error_for_submitter():
    _, wait_view = _send(EXISTING_META, PostMode.POST_NEW, warning="photo failed")

    kwargs = wait_view.call_args.kwargs
    assert kwargs["level"] == constants.AlertLevel.ERROR
    assert kwargs["text"].startswith("Preblast posted")
    assert kwargs["text"].endswith("\nphoto failed")


def test_post_without_warning_reports_success():
    _, wait_view = _send(EXISTING_META, PostMode.POST_NEW)

    assert wait_view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS
