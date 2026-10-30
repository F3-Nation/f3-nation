import io
from types import SimpleNamespace
from unittest.mock import MagicMock

import pytest
import requests
from PIL import Image
from slack_sdk.models.blocks import ImageBlock as SdkImageBlock
from slack_sdk.models.blocks import SectionBlock as SdkSectionBlock

from utilities import constants, helper_functions, storage
from utilities.slack import orm, sdk_orm

EMULATOR = "http://localhost:9023"


@pytest.fixture
def mount_root(tmp_path, monkeypatch):
    monkeypatch.setattr(storage, "MOUNT_ROOT", str(tmp_path))
    monkeypatch.setattr(constants, "FILE_BUCKET_PREFIX", "f3-public-images")
    for directory in ("user-avatars", "org-logos", storage.CALENDAR_IMAGES):
        (tmp_path / directory).mkdir()
    return tmp_path


@pytest.fixture
def emulator(monkeypatch):
    monkeypatch.setenv("GCS_EMULATOR_HOST", "localhost:9023")
    monkeypatch.setattr(constants, "FILE_BUCKET_PREFIX", "f3-public-images-staging")
    calls = []

    def respond(status):
        def handler(method):
            def call(url, **kwargs):
                calls.append((method, url, kwargs))
                response = requests.Response()
                response.status_code = status
                response.url = url
                return response

            return call

        monkeypatch.setattr(storage.requests, "post", handler("POST"))
        monkeypatch.setattr(storage.requests, "delete", handler("DELETE"))

    respond(200)
    return SimpleNamespace(calls=calls, respond=respond)


def test_public_url_without_emulator_points_at_gcs(monkeypatch):
    monkeypatch.setattr(constants, "FILE_BUCKET_PREFIX", "f3-public-images")
    assert storage.public_url("user-avatars", "U1.png") == (
        "https://storage.googleapis.com/f3-public-images/user-avatars/U1.png"
    )
    assert storage.public_url(storage.CALENDAR_IMAGES, "1-current.png") == (
        "https://storage.googleapis.com/f3nation-calendar-images/1-current.png"
    )


@pytest.mark.parametrize("host", ["localhost:9023", "http://localhost:9023", "http://localhost:9023/"])
def test_public_url_with_emulator_points_at_emulator(monkeypatch, host):
    monkeypatch.setenv("GCS_EMULATOR_HOST", host)
    monkeypatch.setattr(constants, "FILE_BUCKET_PREFIX", "f3-public-images-staging")
    assert storage.public_url("org-logos", "7.png") == f"{EMULATOR}/f3-public-images-staging/org-logos/7.png"
    assert storage.public_url(storage.CALENDAR_IMAGES, "1-next.png") == (
        f"{EMULATOR}/f3nation-calendar-images/1-next.png"
    )


def test_public_url_encodes_object_name_but_keeps_folders(monkeypatch):
    monkeypatch.setattr(constants, "FILE_BUCKET_PREFIX", "f3-public-images")
    assert storage.public_url("backblast-images", "photo#1?.png") == (
        "https://storage.googleapis.com/f3-public-images/backblast-images/photo%231%3F.png"
    )


def test_write_bytes_without_emulator_writes_to_mount(mount_root):
    url = storage.write_bytes("user-avatars", "U1.png", b"avatar", "image/png")

    assert (mount_root / "user-avatars" / "U1.png").read_bytes() == b"avatar"
    assert url == "https://storage.googleapis.com/f3-public-images/user-avatars/U1.png"


def test_write_bytes_with_emulator_uploads_object(mount_root, emulator):
    url = storage.write_bytes("user-avatars", "U1.png", b"avatar", "image/png")

    assert url == f"{EMULATOR}/f3-public-images-staging/user-avatars/U1.png"
    [(method, request_url, kwargs)] = emulator.calls
    assert method == "POST"
    assert request_url == f"{EMULATOR}/upload/storage/v1/b/f3-public-images-staging/o"
    assert kwargs["params"] == {"uploadType": "media", "name": "user-avatars/U1.png"}
    assert kwargs["data"] == b"avatar"
    assert kwargs["headers"] == {"Content-Type": "image/png"}
    assert not (mount_root / "user-avatars" / "U1.png").exists()


def test_write_bytes_with_emulator_raises_on_upload_failure(emulator):
    emulator.respond(500)
    with pytest.raises(requests.HTTPError):
        storage.write_bytes("user-avatars", "U1.png", b"avatar", "image/png")


def test_writable_path_without_emulator_yields_mount_path(mount_root):
    with storage.writable_path(storage.CALENDAR_IMAGES, "1-current.png", "image/png") as path:
        assert path == f"{mount_root}/calendar-images/1-current.png"


def test_writable_path_with_emulator_uploads_file_on_exit(emulator):
    with storage.writable_path(storage.CALENDAR_IMAGES, "1-current.png", "image/png") as path:
        with open(path, "wb") as f:
            f.write(b"calendar")
        assert emulator.calls == []

    [(_, request_url, kwargs)] = emulator.calls
    assert request_url == f"{EMULATOR}/upload/storage/v1/b/f3nation-calendar-images/o"
    assert kwargs["params"]["name"] == "1-current.png"
    assert kwargs["data"] == b"calendar"


def test_writable_path_with_emulator_stores_nothing_when_block_raises(emulator):
    with pytest.raises(RuntimeError):
        with storage.writable_path(storage.CALENDAR_IMAGES, "1-current.png", "image/png"):
            raise RuntimeError("export failed")
    assert emulator.calls == []


def test_copy_without_emulator_copies_mounted_file(mount_root):
    (mount_root / "calendar-images" / "a.png").write_bytes(b"calendar")

    storage.copy(storage.CALENDAR_IMAGES, "a.png", "1-current.png")

    assert (mount_root / "calendar-images" / "1-current.png").read_bytes() == b"calendar"


def test_copy_with_emulator_copies_object(emulator):
    storage.copy("org-logos", "7-req.png", "7.png")

    [(method, request_url, _)] = emulator.calls
    assert method == "POST"
    assert request_url == (
        f"{EMULATOR}/storage/v1/b/f3-public-images-staging/o/org-logos%2F7-req.png"
        "/copyTo/b/f3-public-images-staging/o/org-logos%2F7.png"
    )


def test_copy_with_emulator_missing_source_raises_file_not_found(emulator):
    emulator.respond(404)
    with pytest.raises(FileNotFoundError):
        storage.copy(storage.CALENDAR_IMAGES, "missing.png", "1-current.png")


def test_delete_without_emulator_removes_mounted_file(mount_root):
    target = mount_root / "calendar-images" / "old.png"
    target.write_bytes(b"old")

    storage.delete(storage.CALENDAR_IMAGES, "old.png")

    assert not target.exists()
    with pytest.raises(FileNotFoundError):
        storage.delete(storage.CALENDAR_IMAGES, "old.png")


def test_delete_with_emulator_deletes_object(emulator):
    storage.delete(storage.CALENDAR_IMAGES, "old.png")

    assert emulator.calls[0][:2] == ("DELETE", f"{EMULATOR}/storage/v1/b/f3nation-calendar-images/o/old.png")


@pytest.mark.parametrize("status,error", [(404, FileNotFoundError), (500, requests.HTTPError)])
def test_delete_with_emulator_reports_failures(emulator, status, error):
    emulator.respond(status)
    with pytest.raises(error):
        storage.delete(storage.CALENDAR_IMAGES, "old.png")


@pytest.mark.parametrize(
    "url,reachable",
    [
        ("https://storage.googleapis.com/f3-public-images/org-logos/7.png", True),
        (f"{EMULATOR}/f3-public-images-staging/org-logos/7.png", False),
        ("http://127.0.0.1:9123/f3-public-images-staging/org-logos/7.png", False),
    ],
)
def test_is_publicly_reachable(monkeypatch, url, reachable):
    monkeypatch.setenv("GCS_EMULATOR_HOST", "localhost:9023")
    assert storage.is_publicly_reachable(url) is reachable


def test_orm_image_or_link_block_embeds_public_image():
    url = "https://storage.googleapis.com/f3-public-images/org-logos/7.png"
    block = orm.image_or_link_block(image_url=url, alt_text="Region Logo").as_form_field()
    assert block == {"type": "image", "image_url": url, "alt_text": "Region Logo"}


def test_orm_image_or_link_block_links_unreachable_image(monkeypatch):
    monkeypatch.setenv("GCS_EMULATOR_HOST", "localhost:9023")
    url = f"{EMULATOR}/f3-public-images-staging/backblast-images/F1_low_res.png"
    block = orm.image_or_link_block(image_url=url, alt_text="Beatdown <!channel>").as_form_field()
    assert block == {"type": "section", "text": {"type": "mrkdwn", "text": f"<{url}|Beatdown &lt;!channel&gt;>"}}


def test_sdk_image_or_link_block_embeds_public_image():
    url = "https://storage.googleapis.com/f3nation-calendar-images/1-current.png"
    block = sdk_orm.image_or_link_block(image_url=url, alt_text="This week")
    assert isinstance(block, SdkImageBlock)
    assert block.image_url == url


def test_sdk_image_or_link_block_links_unreachable_image(monkeypatch):
    monkeypatch.setenv("GCS_EMULATOR_HOST", "localhost:9023")
    url = f"{EMULATOR}/f3nation-calendar-images/1-current.png"
    block = sdk_orm.image_or_link_block(image_url=url, alt_text="This week")
    assert isinstance(block, SdkSectionBlock)
    assert block.to_dict()["text"] == {"type": "mrkdwn", "text": f"<{url}|This week>"}


def _png(width, height):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (255, 0, 0)).save(buffer, format="PNG")
    return buffer.getvalue()


def _jpeg(width, height):
    buffer = io.BytesIO()
    Image.new("RGB", (width, height), (255, 0, 0)).save(buffer, format="JPEG")
    return buffer.getvalue()


@pytest.fixture
def slack_downloads(monkeypatch):
    downloads = {}

    def get(url, **kwargs):
        return SimpleNamespace(content=downloads[url], raise_for_status=lambda: None)

    monkeypatch.setattr(helper_functions.requests, "get", get)
    return downloads


def test_upload_files_to_storage_without_emulator_writes_mount_and_returns_gcs_urls(mount_root, slack_downloads):
    slack_downloads["https://files.slack.com/F1"] = b"full"
    slack_downloads["https://files.slack.com/F1/thumb_480"] = b"thumb"
    file = {
        "id": "F1",
        "filetype": "jpg",
        "mimetype": "image/jpeg",
        "url_private_download": "https://files.slack.com/F1",
        "thumb_480": "https://files.slack.com/F1/thumb_480",
    }
    (mount_root / "backblast-images").mkdir()

    file_list, send_list, file_ids, low_res = helper_functions.upload_files_to_storage(
        [file], SimpleNamespace(token="xoxb"), MagicMock()
    )

    base = "https://storage.googleapis.com/f3-public-images/backblast-images"
    assert file_list == [f"{base}/F1.jpg"]
    assert low_res == [f"{base}/F1_low_res.png"]
    assert file_ids == ["F1"]
    assert send_list == [{"content": b"full", "meta": {"filename": "F1.jpg", "maintype": "image", "subtype": "jpeg"}}]
    assert (mount_root / "backblast-images" / "F1.jpg").read_bytes() == b"full"
    assert (mount_root / "backblast-images" / "F1_low_res.png").read_bytes() == b"thumb"


def test_upload_files_to_storage_with_emulator_converts_logo_and_returns_emulator_url(emulator, slack_downloads):
    slack_downloads["https://files.slack.com/F2"] = _jpeg(40, 20)
    file = {
        "id": "F2",
        "filetype": "jpg",
        "mimetype": "image/jpeg",
        "url_private_download": "https://files.slack.com/F2",
    }

    file_list, send_list, _, low_res = helper_functions.upload_files_to_storage(
        [file],
        SimpleNamespace(token="xoxb"),
        MagicMock(),
        enforce_square=True,
        max_height=16,
        bucket_name="org-logos",
        file_name="7",
        enforce_png=True,
    )

    assert file_list == [f"{EMULATOR}/f3-public-images-staging/org-logos/7.png"]
    assert low_res == []
    [(_, _, kwargs)] = emulator.calls
    assert kwargs["params"]["name"] == "org-logos/7.png"
    assert kwargs["headers"] == {"Content-Type": "image/png"}
    stored = Image.open(io.BytesIO(kwargs["data"]))
    assert (stored.format, stored.size) == ("PNG", (16, 16))
    assert send_list[0]["content"] == kwargs["data"]
    assert send_list[0]["meta"] == {"filename": "7.png", "maintype": "image", "subtype": "png"}


def test_upload_files_to_storage_keeps_source_format_after_squaring(emulator, slack_downloads):
    slack_downloads["https://files.slack.com/F3"] = _png(30, 10)
    file = {
        "id": "F3",
        "filetype": "png",
        "mimetype": "image/png",
        "url_private_download": "https://files.slack.com/F3",
    }

    file_list, _, _, _ = helper_functions.upload_files_to_storage(
        [file], SimpleNamespace(token="xoxb"), MagicMock(), enforce_square=True, bucket_name="user-avatars"
    )

    assert file_list == [f"{EMULATOR}/f3-public-images-staging/user-avatars/F3.png"]
    stored = Image.open(io.BytesIO(emulator.calls[0][2]["data"]))
    assert (stored.format, stored.size) == ("PNG", (30, 30))


def test_upload_files_to_storage_leaves_failed_upload_out_of_results(emulator, slack_downloads):
    emulator.respond(503)
    slack_downloads["https://files.slack.com/F4"] = b"full"
    logger = MagicMock()
    file = {
        "id": "F4",
        "filetype": "jpg",
        "mimetype": "image/jpeg",
        "url_private_download": "https://files.slack.com/F4",
    }

    file_list, send_list, file_ids, low_res = helper_functions.upload_files_to_storage(
        [file], SimpleNamespace(token="xoxb"), logger
    )

    assert (file_list, send_list, low_res) == ([], [], [])
    assert file_ids == ["F4"]
    logger.error.assert_called_once()


def test_upload_files_to_storage_deletes_stored_copy_when_a_later_write_fails(monkeypatch, slack_downloads):
    slack_downloads["https://files.slack.com/F5"] = b"full"
    slack_downloads["https://files.slack.com/F5/thumb_480"] = b"thumb"
    written, deleted = [], []

    def write_bytes(directory, name, data, content_type):
        if name.endswith("_low_res.png"):
            raise requests.HTTPError("503")
        written.append((directory, name))
        return f"https://storage.googleapis.com/f3-public-images/{directory}/{name}"

    monkeypatch.setattr(storage, "write_bytes", write_bytes)
    monkeypatch.setattr(storage, "delete", lambda directory, name: deleted.append((directory, name)))
    file = {
        "id": "F5",
        "filetype": "jpg",
        "mimetype": "image/jpeg",
        "url_private_download": "https://files.slack.com/F5",
        "thumb_480": "https://files.slack.com/F5/thumb_480",
    }

    file_list, send_list, file_ids, low_res = helper_functions.upload_files_to_storage(
        [file], SimpleNamespace(token="xoxb"), MagicMock()
    )

    assert (file_list, send_list, low_res) == ([], [], [])
    assert file_ids == ["F5"]
    assert written == [("backblast-images", "F5.jpg")]
    assert deleted == [("backblast-images", "F5.jpg")]
