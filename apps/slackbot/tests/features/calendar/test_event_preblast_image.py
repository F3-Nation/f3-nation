import json
import os
import sys
from unittest.mock import MagicMock, mock_open, patch

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../../..")))

import pytest
from slack_sdk.errors import SlackApiError

from application.event_instance import EventInstanceData
from application.event_instance.service import EventInstanceService
from application.preblast import PostMode, PreblastPostDecision
from application.preblast.service import PreblastService
from features.calendar import event_preblast
from infrastructure.api_client.event_instance_repository import ApiEventInstanceRepository
from utilities import constants, helper_functions
from utilities.slack import actions

EVENT_ID = 42
FULL_URL = "https://storage.googleapis.com/f3nation/event_instance_images/42_F_NEW_preblast.png"
LOW_REZ_URL = "https://storage.googleapis.com/f3nation/event_instance_images/42_F_NEW_preblast_low_res.png"
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
    constants.PREBLAST_IMAGE_URL: "https://storage.googleapis.com/f3nation/event_instance_images/42_F_OLD_preblast.png",
    constants.PREBLAST_IMAGE_LOW_REZ_URL: (
        "https://storage.googleapis.com/f3nation/event_instance_images/42_F_OLD_preblast_low_res.png"
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
    """Route the handler through the real event-instance service and repository, faking the
    API client's HTTP calls; the attendance service stays mocked."""
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
    assert kwargs["file_name"] == "42_F_NEW_preblast"
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


def test_preblast_object_name_starts_with_event_id_so_it_sorts_by_event():
    with patch.object(event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], [], [])) as upload:
        event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), MagicMock())

    assert upload.call_args.kwargs["file_name"].startswith(f"{EVENT_ID}_")
    assert upload.call_args.kwargs["file_name"].endswith("_preblast")


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


def test_gif_uses_full_size_url_so_it_still_animates():
    with patch.object(
        event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], ["F_NEW"], [LOW_REZ_URL])
    ):
        meta = event_preblast._upload_preblast_image(
            {**SLACK_FILE, "filetype": "gif"}, EVENT_ID, MagicMock(), MagicMock()
        )

    assert meta[constants.PREBLAST_IMAGE_LOW_REZ_URL] == FULL_URL


def test_upload_producing_no_file_returns_none_and_logs():
    logger = MagicMock()
    with patch.object(event_preblast, "upload_files_to_storage", return_value=([], [], ["F_NEW"], [])):
        meta = event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), logger)

    assert meta is None
    logger.error.assert_called_once()


def test_upload_exception_returns_none_and_logs_traceback():
    logger = MagicMock()
    with patch.object(event_preblast, "upload_files_to_storage", side_effect=RuntimeError("storage down")):
        meta = event_preblast._upload_preblast_image(SLACK_FILE, EVENT_ID, MagicMock(), logger)

    assert meta is None
    logger.exception.assert_called_once()


def _http_response(ok, content=b"img"):
    response = MagicMock(ok=ok, status_code=200 if ok else 404, content=content)
    if not ok:
        response.raise_for_status.side_effect = RuntimeError("HTTP 404")
    return response


@pytest.mark.parametrize(
    ("thumb_ok", "expected_low_res"),
    [
        (True, ["https://storage.googleapis.com/f3nation/event_instance_images/42_F_NEW_preblast_low_res.png"]),
        (False, []),
    ],
)
def test_storage_helper_returns_low_res_url_only_when_thumbnail_download_succeeds(thumb_ok, expected_low_res):
    with (
        patch.object(helper_functions.requests, "get", side_effect=[_http_response(True), _http_response(thumb_ok)]),
        patch("builtins.open", mock_open()) as opened,
        patch.object(constants, "FILE_BUCKET_PREFIX", "f3nation"),
    ):
        file_list, _, _, low_res = helper_functions.upload_files_to_storage(
            files=[SLACK_FILE],
            client=MagicMock(token="xoxb"),
            logger=MagicMock(),
            bucket_name="event_instance_images",
            file_name="42_F_NEW_preblast",
        )

    assert file_list == ["https://storage.googleapis.com/f3nation/event_instance_images/42_F_NEW_preblast.png"]
    assert low_res == expected_low_res
    written_paths = [c.args[0] for c in opened.call_args_list]
    assert ("/mnt/event_instance_images/42_F_NEW_preblast_low_res.png" in written_paths) is thumb_ok


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

    assert upload.call_args.kwargs["file_name"] == "42_F_NEW_preblast"
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


def test_failed_upload_on_already_posted_preblast_passes_warning_to_send_preblast(wired_services):
    body = _submission_body(files=[SLACK_FILE])
    body["view"]["private_metadata"] = json.dumps({"event_instance_id": EVENT_ID, "preblast_ts": "1761800000.000100"})
    with (
        patch.object(event_preblast, "upload_files_to_storage", return_value=([], [], [], [])),
        patch.object(event_preblast, "send_preblast") as send,
    ):
        event_preblast.handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

    assert send.call_args.kwargs["warning"] == event_preblast.PREBLAST_IMAGE_UPLOAD_FAILED_TEXT


@pytest.mark.usefixtures("wired_services")
def test_failed_upload_warning_is_kept_when_coqs_also_fail(wait_view):
    body = _submission_body(files=[SLACK_FILE])
    body["view"]["state"]["values"][actions.EVENT_PREBLAST_COQS] = {
        actions.EVENT_PREBLAST_COQS: {"type": "multi_users_select", "selected_users": ["U_BAD"]},
    }
    with (
        patch.object(event_preblast, "upload_files_to_storage", return_value=([], [], [], [])),
        patch.object(event_preblast, "get_user", side_effect=RuntimeError("unknown user")),
    ):
        event_preblast.handle_event_preblast_edit(body, MagicMock(), MagicMock(), {}, MagicMock())

    kwargs = wait_view.call_args.kwargs
    assert kwargs["title"] == "Co-Qs not saved"
    assert event_preblast.PREBLAST_IMAGE_UPLOAD_FAILED_TEXT in kwargs["text"]


def test_send_now_posts_the_photo_uploaded_in_the_same_submission(api_client, wired_services):
    saved = {"meta": dict(EXISTING_META)}

    def _post(*args, **kwargs):
        saved["meta"] = kwargs.get("json", {}).get("meta", saved["meta"])
        return {"eventInstance": _raw_instance(dict(saved["meta"]))}

    api_client.post.side_effect = _post
    api_client.get.side_effect = lambda *args, **kwargs: {"eventInstance": _raw_instance(dict(saved["meta"]))}

    def _info(body, client, logger, context, region_record, event_instance_id):
        return event_preblast.PreblastInfo(
            event_record=event_preblast._build_event_instance_service().get_by_id(event_instance_id),
            attendance_records=[],
            preblast_blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "Preblast"}}],
            action_blocks=[],
        )

    body = _submission_body(files=[SLACK_FILE])
    body["view"]["state"]["values"][actions.EVENT_PREBLAST_SEND_OPTIONS][actions.EVENT_PREBLAST_SEND_OPTIONS][
        "selected_option"
    ]["value"] = "Send now"
    client = MagicMock()
    client.chat_postMessage.return_value = {"ts": "1761800000.000100"}
    with (
        patch.object(
            event_preblast, "upload_files_to_storage", return_value=([FULL_URL], [], ["F_NEW"], [LOW_REZ_URL])
        ),
        patch.object(event_preblast, "build_preblast_info", side_effect=_info),
        patch.object(event_preblast, "get_preblast_channel", return_value="C_AO"),
        patch.object(event_preblast, "get_user_names", return_value=(["Q"], ["https://img/q.png"])),
        patch.object(event_preblast, "post_bot_log"),
        patch.object(event_preblast, "update_submission_wait_view"),
    ):
        event_preblast.handle_event_preblast_edit(body, client, MagicMock(), {}, MagicMock(team_id="T1"))

    assert client.chat_postMessage.call_args.kwargs["blocks"][-2] == {
        "type": "image",
        "image_url": LOW_REZ_URL,
        "alt_text": "Preblast Image",
    }


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


EVENT_SUMMARY = "*Preblast: The Grind*\n*Date:* Monday, November 02\n*Q:* <@U_Q>"
PREBLAST_BODY = "Bring a coupon."
SEND_PREBLAST_BLOCKS = [
    {"type": "section", "text": {"type": "mrkdwn", "text": EVENT_SUMMARY}},
    {
        "type": "rich_text",
        "elements": [{"type": "rich_text_section", "elements": [{"type": "text", "text": PREBLAST_BODY}]}],
    },
]


def _send(meta, mode, warning=None, preblast_ts=None, client=None, channel="C_AO", preblast_blocks=None):
    if client is None:
        client = MagicMock()
        client.chat_postMessage.return_value = {"ts": "1761800000.000100"}
    info = event_preblast.PreblastInfo(
        event_record=_event(meta, preblast_ts),
        attendance_records=[],
        preblast_blocks=preblast_blocks if preblast_blocks is not None else SEND_PREBLAST_BLOCKS,
        action_blocks=[],
    )
    svc = MagicMock()
    svc.decide_post_mode.return_value = PreblastPostDecision(
        mode=mode, desired_channel_id="C_AO", posted_channel_id="C_AO", existing_preblast_ts=preblast_ts
    )
    with (
        patch.object(event_preblast, "build_preblast_info", return_value=info),
        patch.object(event_preblast, "_build_preblast_service", return_value=svc),
        patch.object(event_preblast, "get_preblast_channel", return_value=channel),
        patch.object(event_preblast, "get_user_names", return_value=(["Q"], ["https://img/q.png"])),
        patch.object(event_preblast, "post_bot_log") as bot_log,
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
    return client, wait_view, bot_log


def _image_blocks(blocks):
    return [b for b in blocks if b["type"] == "image"]


def _slack_error(error):
    return SlackApiError("rejected", {"ok": False, "error": error})


def test_new_post_renders_stored_image_url():
    client, _, _ = _send(EXISTING_META, PostMode.POST_NEW)

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
    client, _, _ = _send(EXISTING_META, PostMode.UPDATE_EXISTING, preblast_ts=1761800000.0001)

    blocks = client.chat_update.call_args.kwargs["blocks"]
    assert _image_blocks(blocks)[0]["image_url"] == EXISTING_META[constants.PREBLAST_IMAGE_LOW_REZ_URL]


def test_legacy_preblast_still_renders_slack_file():
    client, _, _ = _send({constants.PREBLAST_IMAGE_SLACK_FILE_ID_LEGACY: "F_LEGACY"}, PostMode.POST_NEW)

    blocks = client.chat_postMessage.call_args.kwargs["blocks"]
    assert _image_blocks(blocks) == [{"type": "image", "slack_file": {"id": "F_LEGACY"}, "alt_text": "Preblast Image"}]


@pytest.mark.parametrize(
    ("mode", "preblast_ts", "action_text"),
    [(PostMode.POST_NEW, None, "posted"), (PostMode.UPDATE_EXISTING, 1761800000.0001, "updated")],
)
def test_warning_on_successful_send_is_titled_photo_not_saved_and_logged(mode, preblast_ts, action_text):
    _, wait_view, bot_log = _send(EXISTING_META, mode, warning="photo failed", preblast_ts=preblast_ts)

    kwargs = wait_view.call_args.kwargs
    assert kwargs["title"] == "Photo not saved"
    assert kwargs["level"] == constants.AlertLevel.ERROR
    assert kwargs["text"].startswith(f"Preblast {action_text}")
    assert kwargs["text"].endswith("\nphoto failed")
    assert bot_log.call_args.kwargs["text"].endswith("\n:warning: photo failed")


def test_failed_post_is_titled_error_even_with_warning():
    client = MagicMock()
    client.chat_postMessage.side_effect = _slack_error("channel_not_found")

    _, wait_view, _ = _send(EXISTING_META, PostMode.POST_NEW, warning="photo failed", client=client)

    assert wait_view.call_args.kwargs["title"] == "Error"


def test_post_without_warning_reports_success():
    _, wait_view, _ = _send(EXISTING_META, PostMode.POST_NEW)

    assert wait_view.call_args.kwargs["title"] == "Complete!"
    assert wait_view.call_args.kwargs["level"] == constants.AlertLevel.SUCCESS


def test_no_channel_reports_saved_with_warning_to_submitter():
    client, wait_view, bot_log = _send({}, PostMode.POST_NEW, warning="photo failed", channel=None)

    client.chat_postMessage.assert_not_called()
    kwargs = wait_view.call_args.kwargs
    assert kwargs["title"] == "Photo not saved"
    assert kwargs["text"] == "Preblast saved (no channel)\nphoto failed"
    assert bot_log.call_args.kwargs["text"].startswith(":mega: Preblast saved (no channel)")


def test_no_channel_without_warning_reports_success_to_submitter():
    _, wait_view, _ = _send({}, PostMode.POST_NEW, channel=None)

    assert wait_view.call_args.kwargs["title"] == "Complete!"
    assert wait_view.call_args.kwargs["text"] == "Preblast saved (no channel) successfully!"


# ---------------------------------------------------------------------------
# Rejected blocks
# ---------------------------------------------------------------------------


@pytest.mark.parametrize("error", sorted(event_preblast.SLACK_BLOCK_REJECTION_ERRORS))
def test_rejected_post_retries_without_photo(error):
    client = MagicMock()
    client.chat_postMessage.side_effect = [_slack_error(error), {"ts": "1761800000.000100"}]

    _, wait_view, _ = _send(EXISTING_META, PostMode.POST_NEW, client=client)

    first, second = client.chat_postMessage.call_args_list
    assert _image_blocks(first.kwargs["blocks"])
    assert _image_blocks(second.kwargs["blocks"]) == []
    assert second.kwargs["blocks"][-1]["type"] == "actions"
    assert wait_view.call_args.kwargs["title"] == "Complete!"


def test_rejected_post_falls_back_to_plain_text_when_retry_without_photo_is_rejected():
    client = MagicMock()
    client.chat_postMessage.side_effect = [
        _slack_error("invalid_blocks"),
        _slack_error("msg_blocks_too_long"),
        {"ts": "1761800000.000100"},
    ]

    _send(EXISTING_META, PostMode.POST_NEW, client=client)

    last = client.chat_postMessage.call_args_list[-1]
    assert "blocks" not in last.kwargs
    assert last.kwargs["text"] == f"{EVENT_SUMMARY}\n\n{PREBLAST_BODY}"
    assert last.kwargs["channel"] == "C_AO"


def test_rejected_post_without_photo_falls_back_straight_to_plain_text():
    client = MagicMock()
    client.chat_postMessage.side_effect = [_slack_error("msg_too_long"), {"ts": "1761800000.000100"}]

    _send({}, PostMode.POST_NEW, client=client)

    assert client.chat_postMessage.call_count == 2
    second = client.chat_postMessage.call_args_list[1]
    assert "blocks" not in second.kwargs
    assert second.kwargs["text"] == f"{EVENT_SUMMARY}\n\n{PREBLAST_BODY}"


def test_plain_text_fallback_is_capped_at_slack_text_limit():
    client = MagicMock()
    client.chat_postMessage.side_effect = [_slack_error("msg_too_long"), {"ts": "1761800000.000100"}]
    long_summary = [{"type": "section", "text": {"type": "mrkdwn", "text": "x" * 5000}}]

    _send({}, PostMode.POST_NEW, client=client, preblast_blocks=long_summary)

    text = client.chat_postMessage.call_args_list[1].kwargs["text"]
    assert len(text) == event_preblast.SLACK_TEXT_FALLBACK_MAX_CHARS
    assert text.endswith("…")


def test_plain_text_fallback_keeps_caller_text_when_blocks_hold_none():
    client = MagicMock()
    client.chat_postMessage.side_effect = [_slack_error("invalid_blocks"), {"ts": "1761800000.000100"}]

    _send({}, PostMode.POST_NEW, client=client, preblast_blocks=[])

    assert client.chat_postMessage.call_args_list[1].kwargs["text"] == "Event Preblast"


def test_rejected_update_retries_without_photo_keeping_ts():
    client = MagicMock()
    client.chat_update.side_effect = [_slack_error("invalid_blocks"), {"ok": True}]

    _, wait_view, _ = _send(EXISTING_META, PostMode.UPDATE_EXISTING, preblast_ts=1761800000.0001, client=client)

    second = client.chat_update.call_args_list[1]
    assert _image_blocks(second.kwargs["blocks"]) == []
    assert second.kwargs["ts"] == "1761800000.000100"
    assert wait_view.call_args.kwargs["title"] == "Complete!"


def test_other_slack_errors_are_not_retried():
    client = MagicMock()
    client.chat_postMessage.side_effect = _slack_error("channel_not_found")

    _, wait_view, _ = _send(EXISTING_META, PostMode.POST_NEW, client=client)

    assert client.chat_postMessage.call_count == 1
    assert wait_view.call_args.kwargs["title"] == "Error"


# ---------------------------------------------------------------------------
# HC / Q button refresh
# ---------------------------------------------------------------------------

STORED_IMAGE_BLOCK = {
    "type": "image",
    "image_url": EXISTING_META[constants.PREBLAST_IMAGE_LOW_REZ_URL],
    "alt_text": "Preblast Image",
}


def _modal_action_body():
    return {
        "actions": [{"action_id": actions.EVENT_PREBLAST_HC}],
        "user": {"id": "U_Q"},
        "view": {
            "id": "V_PREBLAST",
            "private_metadata": json.dumps({"event_instance_id": EVENT_ID, "preblast_ts": "1761800000.000100"}),
        },
    }


def _message_action_body():
    return {
        "actions": [{"action_id": actions.EVENT_PREBLAST_HC_UN_HC}],
        "user": {"id": "U_Q"},
        "message": {
            "ts": "1761800000.000100",
            "metadata": {"event_payload": {"event_instance_id": EVENT_ID, "attendees": [], "qs": []}},
        },
    }


def _act(body, client):
    info = event_preblast.PreblastInfo(
        event_record=_event(EXISTING_META, 1761800000.0001),
        attendance_records=[],
        preblast_blocks=[{"type": "section", "text": {"type": "mrkdwn", "text": "Preblast"}}],
        action_blocks=[],
    )
    with (
        patch.object(event_preblast, "get_user", return_value=MagicMock(user_id=7)),
        patch.object(event_preblast, "_user_is_q", return_value=False),
        patch.object(event_preblast, "_build_preblast_service", return_value=MagicMock()),
        patch.object(event_preblast, "build_preblast_info", return_value=info),
        patch.object(event_preblast, "get_user_names", return_value=(["Q"], ["https://img/q.png"])),
        patch.object(event_preblast, "get_preblast_channel", return_value="C_AO"),
        patch.object(event_preblast, "post_hc_thread_reply"),
        patch.object(event_preblast, "build_event_preblast_form"),
    ):
        event_preblast.handle_event_preblast_action(body, client, MagicMock(), {}, MagicMock())


@pytest.mark.parametrize("body_factory", [_modal_action_body, _message_action_body])
def test_hc_refresh_keeps_the_stored_photo(body_factory):
    client = MagicMock()

    _act(body_factory(), client)

    assert client.chat_update.call_args.kwargs["blocks"][-2] == STORED_IMAGE_BLOCK


@pytest.mark.parametrize("body_factory", [_modal_action_body, _message_action_body])
def test_hc_refresh_retries_without_photo_when_slack_rejects_it(body_factory):
    client = MagicMock()
    client.chat_update.side_effect = [_slack_error("invalid_blocks"), {"ok": True}]

    _act(body_factory(), client)

    assert client.chat_update.call_count == 2
    assert _image_blocks(client.chat_update.call_args_list[1].kwargs["blocks"]) == []
