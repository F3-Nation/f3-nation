from unittest.mock import MagicMock

import pytest
from f3_data_models.models import Base
from sqlalchemy import text
from sqlalchemy.orm import Session

from tests import postgres_fixture
from tests.utilities.slack_tokens.test_refresh_postgres import (
    STORED_TOKEN,
    TEAM_ID,
    _row,
    _seed,
    encryption_key,  # noqa: F401  (autouse fixture)
)
from utilities import helper_functions

pytestmark = postgres_fixture.requires_postgres
isolated_postgres = postgres_fixture.isolated_postgres


@pytest.fixture
def postgres_schema():
    def create(engine):
        with engine.begin() as connection:
            connection.execute(text("CREATE EXTENSION IF NOT EXISTS citext"))
        Base.metadata.create_all(
            engine, tables=[Base.metadata.tables[n] for n in ("orgs", "slack_spaces", "orgs_x_slack_spaces")]
        )
        helper_functions.REGION_RECORDS.clear()

    yield create
    helper_functions.REGION_RECORDS.clear()


def _slack_client():
    client = MagicMock()
    client.team_info.return_value = {"team": {"name": "Client Team Name"}}
    return client


def _space_rows(engine, team_id=TEAM_ID):
    with Session(engine) as session:
        return session.execute(
            text("SELECT workspace_name, bot_token, settings::text FROM slack_spaces WHERE team_id = :t"),
            {"t": team_id},
        ).all()


def test_get_region_record_updates_existing_row(isolated_postgres):
    # The installation store creates the row, with a token and no settings.
    _seed(isolated_postgres, expires_in=None, refresh_token=None)

    record = helper_functions.get_region_record(
        TEAM_ID, {}, {"bot_token": "xoxb-from-context"}, _slack_client(), MagicMock()
    )

    rows = _space_rows(isolated_postgres)
    assert len(rows) == 1
    workspace_name, bot_token, settings = rows[0]
    assert bot_token == STORED_TOKEN
    assert settings is not None and TEAM_ID in settings
    assert "xoxb" not in settings
    assert record.team_id == TEAM_ID
    assert _row(isolated_postgres)["bot_token"] == STORED_TOKEN


def test_get_region_record_creates_row_without_token_when_missing(isolated_postgres):
    helper_functions.get_region_record(TEAM_ID, {}, {"bot_token": "xoxb-from-context"}, _slack_client(), MagicMock())

    rows = _space_rows(isolated_postgres)
    assert len(rows) == 1
    workspace_name, bot_token, settings = rows[0]
    assert workspace_name == "Client Team Name"
    assert bot_token is None
    assert "xoxb" not in settings
