from datetime import timedelta
from unittest.mock import MagicMock

from features import db_admin
from tests import postgres_fixture
from tests.utilities.slack_tokens.test_refresh_postgres import (
    NEW_TOKEN,
    STORED_TOKEN,
    TEAM_ID,
    _row,
    _seed,
    encryption_key,  # noqa: F401  (autouse fixture)
    postgres_schema,  # noqa: F401  (fixture used by isolated_postgres)
)
from utilities.database.orm import SlackSettings

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres

BODY = {"user": {"id": "U_ADMIN"}}
CONTEXT = {"bot_token": NEW_TOKEN, "bot_id": "B_NEW", "bot_user_id": "U_BOT_NEW"}


def test_update_bot_token_refuses_rotating_row(isolated_postgres):
    _seed(isolated_postgres, expires_in=timedelta(hours=11))
    before = _row(isolated_postgres)
    client = MagicMock()

    db_admin.handle_update_bot_token(BODY, client, MagicMock(), CONTEXT, SlackSettings(team_id=TEAM_ID))

    assert _row(isolated_postgres) == before
    client.chat_postEphemeral.assert_called_once()
    call = client.chat_postEphemeral.call_args.kwargs
    assert call["user"] == "U_ADMIN"
    assert call["text"] == "This workspace uses rotating tokens; reinstall the app instead."


def test_update_bot_token_overwrites_non_rotating_row(isolated_postgres):
    _seed(isolated_postgres, expires_in=None, refresh_token=None)
    client = MagicMock()

    db_admin.handle_update_bot_token(BODY, client, MagicMock(), CONTEXT, SlackSettings(team_id=TEAM_ID))

    row = _row(isolated_postgres)
    assert row["bot_token"] == NEW_TOKEN != STORED_TOKEN
    assert row["bot_token_expires_at"] is None
    client.chat_postEphemeral.assert_not_called()
