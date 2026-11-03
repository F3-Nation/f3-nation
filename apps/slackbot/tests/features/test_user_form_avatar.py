import os
import sys
from types import SimpleNamespace
from unittest.mock import MagicMock

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from features import user
from utilities.slack import orm

EMULATOR = "http://localhost:9023"


def _posted_blocks(monkeypatch, avatar_url):
    monkeypatch.setenv("GCS_EMULATOR_HOST", "localhost:9023")
    monkeypatch.setattr(user, "get_user", lambda *args: SimpleNamespace(user_id=42))
    profile = SimpleNamespace(
        id=42,
        avatar_url=avatar_url,
        f3_name="Synthetic Pax",
        emergency_contact=None,
        emergency_phone=None,
        emergency_notes=None,
        meta=None,
        home_region_id=None,
    )
    monkeypatch.setattr(user.DbManager, "get", lambda *args, **kwargs: profile)
    posted = []
    monkeypatch.setattr(orm.BlockView, "post_modal", lambda self, **kwargs: posted.append(self.blocks))

    user.build_user_form({"user": {"id": "U1"}, "trigger_id": "T"}, MagicMock(), MagicMock(), {}, MagicMock())

    [blocks] = posted
    return blocks


def test_user_form_embeds_public_avatar(monkeypatch):
    url = "https://storage.googleapis.com/f3-public-images/user-avatars/42.png"
    blocks = _posted_blocks(monkeypatch, url)

    [image] = [b for b in blocks if b.action == user.USER_FORM_IMAGE]
    assert isinstance(image, orm.ImageBlock)
    assert image.image_url == url


def test_user_form_links_avatar_slack_cannot_download(monkeypatch):
    avatar_url = f"{EMULATOR}/f3-public-images-staging/user-avatars/42.png"
    blocks = _posted_blocks(monkeypatch, avatar_url)

    assert not any(isinstance(b, orm.ImageBlock) for b in blocks)
    link = next(b for b in blocks if isinstance(b, orm.SectionBlock) and avatar_url in (b.label or ""))
    assert link.as_form_field()["text"]["text"] == f"<{avatar_url}|User Image>"
