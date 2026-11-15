import hashlib
import os

import pytest
from f3_data_models.models import SlackUser, User
from sqlalchemy.orm import Session
from test_create_user_postgres import isolated_postgres  # noqa: F401

from features.strava import (
    STRAVA_OAUTH_STATE_META_KEY,
    consume_strava_oauth_state,
    issue_strava_oauth_state,
)

pytestmark = pytest.mark.skipif(
    os.environ.get("SLACKBOT_POSTGRES_TESTS") != "1",
    reason="set SLACKBOT_POSTGRES_TESTS=1 to run disposable-Postgres integration tests",
)


@pytest.fixture
def slack_user_pk(isolated_postgres):  # noqa: F811
    with Session(isolated_postgres) as session:
        user = User(email="strava-state@example.invalid")
        session.add(user)
        session.flush()
        slack_user = SlackUser(
            slack_id="U_STRAVA_STATE",
            slack_team_id="T_STRAVA_STATE",
            user_name="synthetic",
            email="strava-state@example.invalid",
            is_admin=False,
            is_owner=False,
            is_bot=False,
            user_id=user.id,
            meta={"other": 1},
        )
        session.add(slack_user)
        session.commit()
        return slack_user.id, user.id


def _reread_meta(engine, pk):
    with Session(engine) as session:
        return session.get(SlackUser, pk).meta


def test_state_is_persisted_and_consumed_once(isolated_postgres, slack_user_pk):  # noqa: F811
    pk, user_id = slack_user_pk

    state = issue_strava_oauth_state(pk)

    token = state.split(".", 1)[1]
    stored = _reread_meta(isolated_postgres, pk)
    assert stored["other"] == 1
    assert stored[STRAVA_OAUTH_STATE_META_KEY]["hash"] == hashlib.sha256(token.encode()).hexdigest()
    assert isinstance(stored[STRAVA_OAUTH_STATE_META_KEY]["expires_at"], int)

    assert consume_strava_oauth_state(state) == user_id
    assert _reread_meta(isolated_postgres, pk) == {"other": 1}
    assert consume_strava_oauth_state(state) is None
