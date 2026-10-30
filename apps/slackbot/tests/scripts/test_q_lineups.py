import os
import sys
from datetime import date
from types import SimpleNamespace

import pytest

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import q_lineups

PLACEHOLDER = "https://www.publicdomainpictures.net/pictures/40000/t2/question-mark.jpg"


def _lineup_item(q_avatar_url, slack_avatar_url=None):
    return SimpleNamespace(
        event=SimpleNamespace(start_date=date(2026, 11, 2), start_time="0530", series_exception=None, id=1),
        event_type=SimpleNamespace(name="Bootcamp"),
        q_name="Synthetic Q",
        q_avatar_url=q_avatar_url,
        slack_avatar_url=slack_avatar_url,
    )


@pytest.mark.parametrize(
    "q_avatar_url,expected",
    [
        ("https://storage.googleapis.com/f3-public-images/user-avatars/42.png", None),
        ("http://localhost:9023/f3-public-images-staging/user-avatars/42.png", PLACEHOLDER),
        (None, PLACEHOLDER),
    ],
)
def test_lineup_accessory_uses_placeholder_when_slack_cannot_download_avatar(monkeypatch, q_avatar_url, expected):
    monkeypatch.setenv("GCS_EMULATOR_HOST", "localhost:9023")

    blocks = q_lineups.build_lineup_blocks([_lineup_item(q_avatar_url)], SimpleNamespace(name="Synthetic AO"))

    assert [block["accessory"]["image_url"] for block in blocks] == [expected or q_avatar_url]
