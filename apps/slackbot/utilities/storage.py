"""File storage for uploaded and generated images.

Deployed, Cloud Run mounts each storage directory at ``/mnt/<directory>`` as a GCS
bucket (the ``--add-volume`` flags in ``deploy-slackbot.yml``), so storing an
object is an ordinary file write. When ``GCS_EMULATOR_HOST`` is set (local dev),
objects go through the fake-gcs-server JSON API instead: the emulator keeps its own
records about each object, so files written straight to its data folder may not be
served.

Every function takes the mount directory name (e.g. ``"user-avatars"``) and a file
name; the directory decides which bucket and object name back the file.
"""

import os
import shutil
import tempfile
from collections.abc import Iterator
from contextlib import contextmanager
from urllib.parse import quote, urlparse

import requests

from utilities import constants

CALENDAR_IMAGES = "calendar-images"
CALENDAR_IMAGES_BUCKET = "f3nation-calendar-images"
MOUNT_ROOT = "/mnt"
PUBLIC_GCS_BASE = "https://storage.googleapis.com"

_EMULATOR_TIMEOUT_SECONDS = 30
_LOOPBACK_HOSTS = {"localhost", "127.0.0.1", "::1"}


def _emulator_base() -> str | None:
    host = os.environ.get("GCS_EMULATOR_HOST")
    if not host:
        return None
    return host.rstrip("/") if "://" in host else f"http://{host.rstrip('/')}"


def _bucket_and_object(directory: str, name: str) -> tuple[str, str]:
    # The calendar volume mounts a whole bucket; every other volume mounts one
    # folder (`only-dir`) of the FILE_BUCKET_PREFIX bucket.
    if directory == CALENDAR_IMAGES:
        return CALENDAR_IMAGES_BUCKET, name
    return constants.FILE_BUCKET_PREFIX, f"{directory}/{name}"


def _object_api_url(base: str, bucket: str, object_name: str) -> str:
    return f"{base}/storage/v1/b/{quote(bucket, safe='')}/o/{quote(object_name, safe='')}"


def mount_path(directory: str, name: str) -> str:
    return f"{MOUNT_ROOT}/{directory}/{name}"


def public_url(directory: str, name: str) -> str:
    """URL a browser can load the stored file from."""
    bucket, object_name = _bucket_and_object(directory, name)
    return f"{_emulator_base() or PUBLIC_GCS_BASE}/{bucket}/{quote(object_name)}"


def is_publicly_reachable(url: str) -> bool:
    """False for emulator and loopback URLs, which Slack's servers cannot download.

    Slack rejects a message whose image block it cannot fetch (``invalid_blocks``),
    so callers link to these URLs instead of embedding them.
    """
    base = _emulator_base()
    if base and url.startswith(f"{base}/"):
        return False
    return urlparse(url).hostname not in _LOOPBACK_HOSTS


def write_bytes(directory: str, name: str, data: bytes, content_type: str) -> str:
    """Store ``data`` as ``name``, overwriting any existing file, and return its public URL."""
    base = _emulator_base()
    if base:
        bucket, object_name = _bucket_and_object(directory, name)
        response = requests.post(
            f"{base}/upload/storage/v1/b/{quote(bucket, safe='')}/o",
            params={"uploadType": "media", "name": object_name},
            data=data,
            headers={"Content-Type": content_type},
            timeout=_EMULATOR_TIMEOUT_SECONDS,
        )
        response.raise_for_status()
    else:
        with open(mount_path(directory, name), "wb") as f:
            f.write(data)
    return public_url(directory, name)


@contextmanager
def writable_path(directory: str, name: str, content_type: str) -> Iterator[str]:
    """Yield a local path for a library that writes files itself; the file is stored as ``name`` on exit.

    Nothing is stored if the block raises.
    """
    if not _emulator_base():
        yield mount_path(directory, name)
        return
    with tempfile.TemporaryDirectory() as tmp_dir:
        path = os.path.join(tmp_dir, name)
        yield path
        with open(path, "rb") as f:
            write_bytes(directory, name, f.read(), content_type)


def copy(directory: str, source: str, destination: str) -> None:
    """Copy ``source`` to ``destination`` within one directory, overwriting ``destination``."""
    base = _emulator_base()
    if not base:
        shutil.copyfile(mount_path(directory, source), mount_path(directory, destination))
        return
    bucket, source_object = _bucket_and_object(directory, source)
    _, destination_object = _bucket_and_object(directory, destination)
    response = requests.post(
        f"{_object_api_url(base, bucket, source_object)}/copyTo/b/{quote(bucket, safe='')}"
        f"/o/{quote(destination_object, safe='')}",
        timeout=_EMULATOR_TIMEOUT_SECONDS,
    )
    if response.status_code == 404:
        raise FileNotFoundError(mount_path(directory, source))
    response.raise_for_status()


def delete(directory: str, name: str) -> None:
    """Delete ``name``; raises ``FileNotFoundError`` when it does not exist, like ``os.remove``."""
    base = _emulator_base()
    if not base:
        os.remove(mount_path(directory, name))
        return
    bucket, object_name = _bucket_and_object(directory, name)
    response = requests.delete(_object_api_url(base, bucket, object_name), timeout=_EMULATOR_TIMEOUT_SECONDS)
    if response.status_code == 404:
        raise FileNotFoundError(mount_path(directory, name))
    response.raise_for_status()
