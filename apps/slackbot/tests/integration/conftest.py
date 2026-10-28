"""Fixtures that run the slackbot against a real database and the real F3 Nation API, with Slack faked.

Each session drops and rebuilds a throwaway database on the local Docker Postgres
(``packages/db`` migrations plus the local seed), starts ``apps/api`` against it
on a free port, and builds the real Bolt app with its Web API client pointed at
``FakeSlackApi``. Only Slack itself is simulated.

Opt in with ``SLACKBOT_INTEGRATION_TESTS=1``; the suite needs Docker Postgres
(``pnpm docker:up``), Node, and pnpm.
"""

from __future__ import annotations

import functools
import json
import os
import shutil
import socket
import subprocess
import sys
import time
import uuid
from dataclasses import dataclass
from datetime import timedelta
from pathlib import Path

import pytest
import requests
from dotenv import dotenv_values
from sqlalchemy import Engine, create_engine, text
from sqlalchemy.engine import URL

APP_DIR = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(APP_DIR))

from tests.integration.slack_fake import FakeSlackApi, SlackDriver  # noqa: E402

REPO_ROOT = APP_DIR.parents[1]
DB_NAME = "f3nation_slackbot_it"
SIGNING_SECRET = "integration-test-signing-secret"
API_KEY = "local-slackbot-key"  # admin key created by the local seed


def pytest_collection_modifyitems(config, items):
    if os.environ.get("SLACKBOT_INTEGRATION_TESTS") == "1":
        return
    skip = pytest.mark.skip(reason="set SLACKBOT_INTEGRATION_TESTS=1 to run against a real database and API")
    here = Path(__file__).parent
    for item in items:
        if here in item.path.parents:
            item.add_marker(skip)


@dataclass
class F3Stack:
    db_url: URL
    engine: Engine
    api_url: str


def _pnpm() -> str:
    pnpm = shutil.which("pnpm")
    if not pnpm:
        raise RuntimeError("pnpm is not on PATH; run `. ~/.nvm/nvm.sh && nvm use` first")
    return pnpm


def _free_port() -> int:
    with socket.socket() as s:
        s.bind(("127.0.0.1", 0))
        return s.getsockname()[1]


def _rebuild_database(db_url: URL) -> None:
    admin = create_engine(db_url.set(database="postgres"), isolation_level="AUTOCOMMIT")
    with admin.connect() as conn:
        conn.execute(text(f'DROP DATABASE IF EXISTS "{DB_NAME}" WITH (FORCE)'))
    admin.dispose()

    # migrate:local creates the database and refuses any non-local target; it also refuses to run while CI is set.
    env = {**os.environ, "DATABASE_URL": db_url.render_as_string(hide_password=False), "CI": ""}
    for script in ("migrate:local", "seed:local"):
        subprocess.run(
            [_pnpm(), "-C", str(REPO_ROOT / "packages/db"), script],
            env=env,
            check=True,
            capture_output=True,
        )


def _start_api(db_url: URL, port: int, log_path: Path) -> subprocess.Popen:
    env = {
        **os.environ,
        "DATABASE_URL": db_url.render_as_string(hide_password=False),
        "PORT": str(port),
        "TZ": "UTC",
        "NODE_ENV": "development",
    }
    log = log_path.open("w")
    return subprocess.Popen(
        [_pnpm(), "-C", str(REPO_ROOT / "apps/api"), "with-env", "tsx", "src/server.ts"],
        env=env,
        stdout=log,
        stderr=subprocess.STDOUT,
    )


def _wait_for_api(api_url: str, process: subprocess.Popen, log_path: Path, timeout: float = 60) -> None:
    deadline = time.monotonic() + timeout
    while time.monotonic() < deadline:
        if process.poll() is not None:
            raise RuntimeError(f"apps/api exited with {process.returncode}:\n{log_path.read_text()[-4000:]}")
        try:
            requests.get(api_url, timeout=1, allow_redirects=False)
            return
        except requests.ConnectionError:
            time.sleep(0.25)
    raise RuntimeError(f"apps/api did not start within {timeout}s:\n{log_path.read_text()[-4000:]}")


@pytest.fixture(scope="session")
def f3_stack(tmp_path_factory) -> F3Stack:
    local_env = dotenv_values(APP_DIR / ".env")

    def setting(name: str, default: str | None = None) -> str | None:
        return os.environ.get(name) or local_env.get(name) or default

    db_url = URL.create(
        "postgresql",
        username=setting("DATABASE_USER"),
        password=setting("DATABASE_PASSWORD"),
        host=setting("DATABASE_HOST", "localhost"),
        port=int(setting("DATABASE_PORT", "5432")),
        database=DB_NAME,
    )
    _rebuild_database(db_url)

    port = _free_port()
    api_url = f"http://127.0.0.1:{port}"
    log_path = tmp_path_factory.mktemp("api") / "api.log"
    process = _start_api(db_url, port, log_path)
    engine = create_engine(db_url)
    try:
        _wait_for_api(api_url, process, log_path)
        yield F3Stack(db_url=db_url, engine=engine, api_url=api_url)
    finally:
        process.terminate()
        process.wait(timeout=10)
        engine.dispose()


@pytest.fixture(scope="session")
def fake_slack() -> FakeSlackApi:
    fake = FakeSlackApi()
    fake.start()
    yield fake
    fake.stop()


def _reset_cached_clients(monkeypatch) -> None:
    """Drop every module-level cache that would hold a DB engine, API client, or Slack data from another test."""
    import f3_data_models.utils as db_utils

    from features.calendar import event_preblast
    from infrastructure.api_client import (
        attendance_repository,
        client,
        event_instance_repository,
        event_tag_repository,
        event_type_repository,
        location_repository,
        series_repository,
    )
    from utilities import helper_functions

    monkeypatch.setattr(db_utils, "ENGINE_CACHE", {})
    monkeypatch.setattr(db_utils, "SESSION_FACTORY_CACHE", {})
    monkeypatch.setattr(client, "_client", None)
    for repo_module in (
        attendance_repository,
        event_instance_repository,
        event_tag_repository,
        event_type_repository,
        location_repository,
        series_repository,
    ):
        monkeypatch.setattr(repo_module, "_repo", None)
    for service in ("_evt_svc", "_att_svc", "_et_svc", "_pb_svc"):
        monkeypatch.setattr(event_preblast, service, None)
    helper_functions.REGION_RECORDS.clear()
    helper_functions.SLACK_USERS.clear()


@dataclass
class Workspace:
    """A Slack workspace connected to a seeded region, with one linked user."""

    team_id: str
    user_slack_id: str
    user_id: int
    region_org_id: int
    ao_org_id: int
    preblast_channel: str


def _seed_workspace(engine: Engine) -> Workspace:
    suffix = uuid.uuid4().hex[:8].upper()
    team_id, slack_id, channel = f"T{suffix}", f"U{suffix}", f"C{suffix}"
    with engine.begin() as conn:
        region_id = conn.execute(text("SELECT id FROM orgs WHERE name = 'Local Territory Region'")).scalar_one()
        ao_id = conn.execute(text("SELECT id FROM orgs WHERE name = 'Local Territory AO'")).scalar_one()
        user_id = conn.execute(
            text(
                "INSERT INTO users (f3_name, email, home_region_id, status) "
                "VALUES (:name, :email, :region, 'active') RETURNING id"
            ),
            {"name": f"Q {suffix}", "email": f"q-{suffix.lower()}@example.test", "region": region_id},
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO slack_users "
                "(slack_id, user_name, email, is_admin, is_owner, is_bot, user_id, slack_team_id) "
                "VALUES (:slack_id, :name, :email, false, false, false, :user_id, :team_id)"
            ),
            {
                "slack_id": slack_id,
                "name": f"Q {suffix}",
                "email": f"q-{suffix.lower()}@example.test",
                "user_id": user_id,
                "team_id": team_id,
            },
        )
        settings = {
            "team_id": team_id,
            "workspace_name": "Integration Test",
            "bot_token": "xoxb-integration-test",
            "org_id": region_id,
            "default_preblast_destination": "specified_channel",
            "preblast_destination_channel": channel,
        }
        space_id = conn.execute(
            text(
                "INSERT INTO slack_spaces (team_id, workspace_name, bot_token, settings) "
                "VALUES (:team_id, 'Integration Test', 'xoxb-integration-test', CAST(:settings AS jsonb)) RETURNING id"
            ),
            {"team_id": team_id, "settings": json.dumps(settings)},
        ).scalar_one()
        conn.execute(
            text("INSERT INTO orgs_x_slack_spaces (org_id, slack_space_id) VALUES (:org, :space)"),
            {"org": region_id, "space": space_id},
        )
    return Workspace(team_id, slack_id, user_id, region_id, ao_id, channel)


@pytest.fixture
def workspace(f3_stack) -> Workspace:
    return _seed_workspace(f3_stack.engine)


@pytest.fixture
def slack(f3_stack, fake_slack, workspace, monkeypatch) -> SlackDriver:
    """The real Bolt app wired to the throwaway stack, driven as ``workspace``'s user."""
    from slack_bolt import App
    from slack_sdk.web import WebClient

    import main

    monkeypatch.setenv("DATABASE_SCHEMA", DB_NAME)
    monkeypatch.setenv("DATABASE_HOST", f3_stack.db_url.host)
    monkeypatch.setenv("DATABASE_PORT", str(f3_stack.db_url.port))
    monkeypatch.setenv("DATABASE_USER", f3_stack.db_url.username)
    monkeypatch.setenv("DATABASE_PASSWORD", f3_stack.db_url.password)
    monkeypatch.setenv("F3_API_BASE_URL", f3_stack.api_url)
    monkeypatch.setenv("F3_API_KEY", API_KEY)
    monkeypatch.setenv("SLACKBOT_ENV", "test")
    _reset_cached_clients(monkeypatch)
    fake_slack.reset(workspace.team_id)

    # Run listeners before dispatch returns, so a test sees all of a request's side effects.
    monkeypatch.setattr(main, "process_before_response", True)
    monkeypatch.setattr(main, "get_oauth_settings", lambda: None)
    monkeypatch.setattr(
        main,
        "App",
        functools.partial(
            App,
            client=WebClient(token="xoxb-integration-test", base_url=fake_slack.base_url),
            signing_secret=SIGNING_SECRET,
        ),
    )
    app = main.create_slack_app()
    return SlackDriver(app, SIGNING_SECRET, workspace.team_id, workspace.user_slack_id)


@pytest.fixture
def seed_q_event(f3_stack, workspace):
    """Return a function that creates an upcoming event at the workspace's AO with its user as Q."""
    return functools.partial(_seed_q_event, f3_stack.engine, workspace)


def _seed_q_event(engine: Engine, workspace: Workspace, days_out: int = 3) -> int:
    from utilities.helper_functions import current_date_cst

    start = current_date_cst() + timedelta(days=days_out)
    with engine.begin() as conn:
        event_id = conn.execute(
            text(
                "INSERT INTO event_instances (org_id, is_active, highlight, start_date, start_time, end_time, name) "
                "VALUES (:org, true, false, :start, '0530', '0615', :name) RETURNING id"
            ),
            {"org": workspace.ao_org_id, "start": start, "name": f"IT Bootcamp {workspace.team_id}"},
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO event_instances_x_event_types (event_instance_id, event_type_id) "
                "SELECT :event, id FROM event_types WHERE name = 'Bootcamp' AND specific_org_id IS NULL"
            ),
            {"event": event_id},
        )
        attendance_id = conn.execute(
            text(
                "INSERT INTO attendance (event_instance_id, user_id, is_planned) "
                "VALUES (:event, :user, true) RETURNING id"
            ),
            {"event": event_id, "user": workspace.user_id},
        ).scalar_one()
        conn.execute(
            text(
                "INSERT INTO attendance_x_attendance_types (attendance_id, attendance_type_id) "
                "SELECT :attendance, id FROM attendance_types WHERE type = 'Q'"
            ),
            {"attendance": attendance_id},
        )
    return event_id
