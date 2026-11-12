import time
from contextlib import contextmanager
from datetime import timedelta
from unittest.mock import MagicMock

import pytest
from slack_bolt.authorization.authorize import InstallationStoreAuthorize
from slack_bolt.context import BoltContext
from slack_sdk.errors import SlackApiError
from slack_sdk.oauth.installation_store import Installation
from slack_sdk.oauth.token_rotation import TokenRotator
from sqlalchemy.orm import Session

from tests import postgres_fixture
from tests.utilities.slack_tokens.test_refresh_postgres import (
    NEW_REFRESH,
    NEW_TOKEN,
    STORED_REFRESH,
    STORED_TOKEN,
    TEAM_ID,
    FakeRotator,
    _row,
    _seed,
    encryption_key,  # noqa: F401  (autouse fixture)
    postgres_schema,  # noqa: F401  (fixture used by isolated_postgres)
    rotator,  # noqa: F401
)
from utilities.slack_tokens import refresh, store
from utilities.slack_tokens.crypto import decrypt_refresh_token
from utilities.slack_tokens.store import SlackSpaceInstallationStore

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres


def _installation(**overrides):
    fields = {
        "app_id": "A1",
        "enterprise_id": None,
        "team_id": TEAM_ID,
        "team_name": "Installed Team",
        "user_id": "U_INSTALLER",
        "bot_token": NEW_TOKEN,
        "bot_id": "B_NEW",
        "bot_user_id": "U_BOT_NEW",
        "bot_scopes": ["chat:write"],
        "bot_refresh_token": NEW_REFRESH,
        "bot_token_expires_at": int(time.time()) + 12 * 3600,
        "user_token": "xoxp-user",
        "installed_at": time.time(),
    }
    fields.update(overrides)
    return Installation(**fields)


def test_save_installation_writes_row_without_settings_token(isolated_postgres):
    installation = _installation()
    SlackSpaceInstallationStore().save(installation)

    row = _row(isolated_postgres)
    assert row["workspace_name"] == "Installed Team"
    assert row["bot_token"] == NEW_TOKEN
    assert row["bot_token_expires_at"] is not None
    assert int(row["bot_token_expires_at"].timestamp()) == installation.bot_token_expires_at
    assert decrypt_refresh_token(row["bot_refresh_token_encrypted"]) == NEW_REFRESH
    with Session(isolated_postgres) as session:
        settings = session.execute(
            refresh.text("SELECT settings::text FROM slack_spaces WHERE team_id = :t"), {"t": TEAM_ID}
        ).scalar()
    assert settings is None or "xoxb" not in settings


def test_save_keeps_existing_workspace_name(isolated_postgres):
    _seed(isolated_postgres, expires_in=None, refresh_token=None)
    SlackSpaceInstallationStore().save(_installation(bot_refresh_token=None, bot_token_expires_at=None))
    row = _row(isolated_postgres)
    assert row["workspace_name"] == "Rotation Test"
    assert row["bot_token"] == NEW_TOKEN


def test_find_bot_refreshes_near_expiry(isolated_postgres, rotator):  # noqa: F811
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    bot = SlackSpaceInstallationStore().find_bot(enterprise_id=None, team_id=TEAM_ID)

    assert rotator.calls == 1
    assert rotator.received_refresh_tokens == [STORED_REFRESH]
    assert bot.bot_token == NEW_TOKEN
    assert bot.bot_token_expires_at is None
    assert bot.bot_refresh_token is None
    assert _row(isolated_postgres)["bot_token"] == NEW_TOKEN


def test_find_bot_returns_none_for_unknown_workspace(isolated_postgres, rotator):  # noqa: F811
    assert SlackSpaceInstallationStore().find_bot(enterprise_id=None, team_id="T_NONE") is None


def test_find_bot_returns_stored_token_when_refresh_fails(isolated_postgres, monkeypatch):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    failing = FakeRotator(error=SlackApiError("boom", {"error": "invalid_refresh_token"}))
    monkeypatch.setattr(refresh, "_rotator", lambda: failing)

    bot = SlackSpaceInstallationStore().find_bot(enterprise_id=None, team_id=TEAM_ID)

    assert failing.calls == 1
    assert bot.bot_token == STORED_TOKEN
    assert bot.bot_token_expires_at is None
    assert bot.bot_refresh_token is None


def test_find_bot_returns_stored_token_when_decrypt_fails(isolated_postgres, rotator):  # noqa: F811
    _seed(isolated_postgres, expires_in=timedelta(minutes=30), ciphertext="not-a-valid-ciphertext")
    bot = SlackSpaceInstallationStore().find_bot(enterprise_id=None, team_id=TEAM_ID)
    assert rotator.calls == 0
    assert bot.bot_token == STORED_TOKEN
    assert bot.bot_token_expires_at is None


def test_delete_bot_clears_credentials(isolated_postgres):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    SlackSpaceInstallationStore().delete_bot(enterprise_id=None, team_id=TEAM_ID)

    row = _row(isolated_postgres)
    assert row is not None
    assert row["workspace_name"] == "Rotation Test"
    assert row["bot_token"] is None
    assert row["bot_token_expires_at"] is None
    assert row["bot_refresh_token_encrypted"] is None


def test_delete_installation_clears_credentials(isolated_postgres):
    _seed(isolated_postgres, expires_in=timedelta(minutes=30))
    SlackSpaceInstallationStore().delete_installation(enterprise_id=None, team_id=TEAM_ID)
    row = _row(isolated_postgres)
    assert row["bot_token"] is None
    assert row["bot_refresh_token_encrypted"] is None


def test_find_installation_is_not_implemented():
    with pytest.raises(NotImplementedError):
        SlackSpaceInstallationStore().find_installation(enterprise_id=None, team_id=TEAM_ID)


@pytest.mark.parametrize("lock_times_out", [False, True])
def test_bolt_authorize_never_rotates(isolated_postgres, monkeypatch, lock_times_out):
    """Bolt's own rotation path would save without the lock; the store keeps it from ever running."""
    bolt_rotations = []
    monkeypatch.setattr(
        TokenRotator,
        "perform_bot_token_rotation",
        lambda self, **kwargs: bolt_rotations.append(kwargs),
    )
    save_bot_calls = []
    monkeypatch.setattr(SlackSpaceInstallationStore, "save_bot", lambda self, bot: save_bot_calls.append(bot))
    fake = FakeRotator()
    monkeypatch.setattr(refresh, "_rotator", lambda: fake)

    if lock_times_out:
        _seed(isolated_postgres, expires_in=timedelta(minutes=1))

        @contextmanager
        def timed_out(team_id):
            raise refresh.TokenLockTimeout(team_id)
            yield  # pragma: no cover

        monkeypatch.setattr(refresh, "_locked", timed_out)
        expected_token = STORED_TOKEN
    else:
        _seed(isolated_postgres, expires_in=timedelta(minutes=30))
        expected_token = NEW_TOKEN

    client = MagicMock()
    client.auth_test.return_value = {
        "ok": True,
        "url": "https://x.slack.com/",
        "team": "T",
        "user": "bot",
        "team_id": TEAM_ID,
        "user_id": "U_ROTATE",
        "bot_id": "B_ROTATE",
    }
    context = BoltContext()
    context["client"] = client
    authorize = InstallationStoreAuthorize(
        logger=MagicMock(),
        installation_store=store.SlackSpaceInstallationStore(),
        client_id="x",
        client_secret="y",
        bot_only=True,
    )

    result = authorize(context=context, enterprise_id=None, team_id=TEAM_ID, user_id="U1")

    assert result is not None
    assert result.bot_token == expected_token
    assert bolt_rotations == []
    assert save_bot_calls == []
    assert fake.calls == (0 if lock_times_out else 1)
