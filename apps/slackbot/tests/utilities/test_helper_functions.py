import io
import json
import logging
import os
import sys
from copy import copy
from types import SimpleNamespace

import pytest
from google.cloud.logging_v2.handlers import StructuredLogHandler
from slack_sdk.errors import SlackApiError
from slack_sdk.web import SlackResponse
from sqlalchemy.exc import OperationalError

sys.path.append(os.path.join(os.path.dirname(__file__), "..", ".."))
from utilities import helper_functions
from utilities.helper_functions import is_deactivated_slack_user, safe_get


def test_safe_get():
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "c") == 1
    assert safe_get({"a": {"b": {"c": 1}}}, "a", "b", "d") is None


def test_is_deactivated_slack_user():
    assert is_deactivated_slack_user({"deleted": True}) is True
    assert is_deactivated_slack_user({"deleted": False}) is False
    assert is_deactivated_slack_user({}) is False


@pytest.mark.parametrize(
    "settings",
    [
        {"team_id": "T_VALID", "workspace_name": "Valid workspace"},
        '{"team_id": "T_VALID", "workspace_name": "Valid workspace"}',
    ],
)
def test_update_local_region_records_accepts_mapping_and_json(monkeypatch, settings):
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda *_args, **_kwargs: [SimpleNamespace(team_id="T_VALID", settings=settings)],
    )
    helper_functions.REGION_RECORDS.clear()

    helper_functions.update_local_region_records()

    assert helper_functions.REGION_RECORDS["T_VALID"].workspace_name == "Valid workspace"


@pytest.mark.parametrize(
    ("team_id", "settings"),
    [
        ("T_NULL", None),
        ("T_INVALID_JSON", '{"bot_token":"synthetic-token"'),
        ("T_SCALAR", '"scalar"'),
        ("T_LIST", '[{"team_id":"T_LIST"}]'),
        ("T_MISSING_ID", {"workspace_name": "Malformed"}),
        ("T_MISMATCH", {"team_id": "T_OTHER"}),
        ("T_BAD_FIELD", {"team_id": "T_BAD_FIELD", "unexpected": True}),
    ],
)
def test_update_local_region_records_skips_malformed_settings(monkeypatch, caplog, team_id, settings):
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda *_args, **_kwargs: [SimpleNamespace(team_id=team_id, settings=settings)],
    )
    helper_functions.REGION_RECORDS.clear()

    helper_functions.update_local_region_records()

    assert helper_functions.REGION_RECORDS == {}
    assert "Skipping Slack workspace with invalid settings" in caplog.text
    assert "synthetic-token" not in caplog.text


def test_get_region_record_creates_workspace_when_unrelated_settings_are_malformed(monkeypatch):
    created_records = []
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda *_args, **_kwargs: [SimpleNamespace(team_id="T_BAD", settings="not-json")],
    )
    monkeypatch.setattr(helper_functions.DbManager, "find_first_record", lambda *_args, **_kwargs: None)
    monkeypatch.setattr(
        helper_functions.DbManager,
        "create_record",
        lambda record: created_records.append(record) or record,
    )
    monkeypatch.setattr(helper_functions, "populate_users", lambda *_args, **_kwargs: None)
    helper_functions.REGION_RECORDS.clear()

    region = helper_functions.get_region_record(
        "T_NEW",
        {"team": {"domain": "new-workspace"}},
        {"bot_token": "synthetic-token"},
        SimpleNamespace(team_info=lambda: {"team": {"name": "New workspace"}}),
        None,
    )

    assert region.team_id == "T_NEW"
    assert len(created_records) == 1
    assert created_records[0].team_id == "T_NEW"


class _FakeSession:
    def __init__(self, existing_slack_user=None, after_lock=None):
        self.records = []
        self.expunged = []
        self.expired_on_commit = []
        self.lock_calls = []
        self.events = []
        self.lookup_count = 0
        self.next_id = 101
        self.database_slack_user = existing_slack_user
        self.after_lock = after_lock

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.expired_on_commit = [record for record in self.records if record not in self.expunged]
        return False

    def add(self, record):
        self.events.append(("add", record))
        self.records.append(record)
        if getattr(record, "id", None) is None:
            record.id = self.next_id
            self.next_id += 1
        if isinstance(record, helper_functions.SlackUser):
            self.database_slack_user = record

    def flush(self):
        self.events.append(("flush",))

    def expunge(self, record):
        self.events.append(("expunge", record))
        self.expunged.append(record)

    def execute(self, statement, parameters=None):
        if getattr(statement, "is_insert", False):
            values = statement.compile().params
            self.database_slack_user = helper_functions.SlackUser(id=self.next_id, **values)
            self.next_id += 1
            self.events.append(("insert",))
            return
        self.events.append(("lock",))
        self.lock_calls.append((str(statement), parameters))
        if self.after_lock:
            self.after_lock(self)

    def scalars(self, query):
        self.events.append(("select",))
        self.lookup_count += 1
        if self.database_slack_user:
            params = query.compile().params
            if (
                self.database_slack_user.slack_id != params["slack_id_1"]
                or self.database_slack_user.slack_team_id != params["slack_team_id_1"]
            ):
                return SimpleNamespace(first=lambda: None)
            loaded_slack_user = copy(self.database_slack_user)
            self.records.append(loaded_slack_user)
            return SimpleNamespace(first=lambda: loaded_slack_user, one=lambda: loaded_slack_user)
        return SimpleNamespace(first=lambda: None)


def _use_fake_nonproduction_db(monkeypatch, slack_users=None, after_lock=None):
    slack_users = slack_users or {}
    session = _FakeSession(slack_users.get("record"), after_lock=after_lock)
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: False)
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda model, *_args, **_kwargs: (
            [session.database_slack_user] if model is helper_functions.SlackUser and session.database_slack_user else []
        ),
    )
    monkeypatch.setattr(helper_functions, "session_scope", lambda: session)
    helper_functions.SLACK_USERS.clear()
    return session


def test_nonproduction_unknown_user_is_synthetic_and_repeatable(monkeypatch):
    session = _use_fake_nonproduction_db(monkeypatch)
    client = SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called"))

    region = SimpleNamespace(org_id=9, team_id="T_SYNTH")
    slack_user = helper_functions.get_user("U_SYNTHETIC", region, client, None)
    same_slack_user = helper_functions.get_user("U_SYNTHETIC", region, client, None)

    user = next(record for record in session.records if isinstance(record, helper_functions.User))
    assert same_slack_user.id == slack_user.id
    assert same_slack_user.user_id == slack_user.user_id
    assert user.email == f"dev.staging-email-sink+{user.id}@f3nation.com"
    assert user.f3_name == f"F3 {user.id}"
    assert user.home_region_id == 9
    assert slack_user.user_id == user.id
    assert slack_user.slack_id == "U_SYNTHETIC"
    assert slack_user.user_name == f"F3 {user.id}"
    assert slack_user.email == user.email
    assert slack_user.avatar_url is None
    assert slack_user.slack_team_id == "T_SYNTH"
    assert slack_user.is_admin is False
    assert slack_user.is_owner is False
    assert slack_user.is_bot is False
    assert len(session.records) == 2
    assert user in session.expunged
    assert slack_user in session.expunged
    assert session.expired_on_commit == []


def test_nonproduction_known_user_preserves_link_without_slack_lookup(monkeypatch):
    known = SimpleNamespace(
        slack_id="U_KNOWN", slack_team_id="T_KNOWN", user_id=77, user_name="Existing", email="existing@f3nation.com"
    )
    _use_fake_nonproduction_db(monkeypatch, {"record": known})
    client = SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called"))

    result = helper_functions.get_user("U_KNOWN", SimpleNamespace(org_id=9, team_id="T_KNOWN"), client, None)

    assert result is known
    assert result.user_id == 77


def test_nonproduction_get_user_preloads_complete_cache_for_positions(monkeypatch):
    from features import positions

    first = SimpleNamespace(slack_id="U_FIRST", user_id=78, slack_team_id="T_CACHE")
    second = SimpleNamespace(slack_id="U_SECOND", user_id=79, slack_team_id="T_CACHE")
    session = _use_fake_nonproduction_db(monkeypatch, {"record": first})
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda model, *_args, **_kwargs: [first, second] if model is helper_functions.SlackUser else [],
    )

    result = helper_functions.get_user(
        first.slack_id,
        SimpleNamespace(org_id=9, team_id="T_CACHE"),
        SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called")),
        None,
    )

    assert result is first
    assert positions._user_id_to_slack_id_map("T_CACHE") == {78: "U_FIRST", 79: "U_SECOND"}
    assert session.lookup_count == 0


def test_nonproduction_get_user_returns_linked_cache_without_database_lookup(monkeypatch):
    cached = SimpleNamespace(slack_id="U_CACHED", user_id=78, user_name="Existing", email="existing@f3nation.com")
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: False)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[("T_CACHED", cached.slack_id)] = cached
    monkeypatch.setattr(
        helper_functions,
        "create_user",
        lambda *_args, **_kwargs: pytest.fail("linked cache hit must not call create_user"),
    )
    monkeypatch.setattr(
        helper_functions,
        "session_scope",
        lambda: pytest.fail("linked cache hit must not open a database session"),
    )

    result = helper_functions.get_user(
        cached.slack_id,
        SimpleNamespace(org_id=9, team_id="T_CACHED"),
        SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called")),
        None,
    )

    assert result is cached


def test_nonproduction_direct_create_links_unlinked_row_without_email_matching(monkeypatch):
    old_slack_user = SimpleNamespace(
        id=44,
        slack_id="U_UNLINKED",
        user_id=None,
        email="retained-profile@example.invalid",
        user_name="Retained profile",
        avatar_url="https://example.invalid/avatar",
        slack_team_id="T_STORED",
        is_admin=True,
        is_owner=True,
        is_bot=True,
    )
    session = _use_fake_nonproduction_db(monkeypatch, {"record": old_slack_user})

    result = helper_functions.create_user(
        {
            "id": "U_UNLINKED",
            "profile": {
                "email": "fabricated@example.invalid",
                "real_name": "Fabricated Name",
                "image_192": "https://example.invalid/fabricated-avatar",
            },
        },
        home_region_id=12,
        team_id="T_STORED",
    )

    user = next(record for record in session.records if isinstance(record, helper_functions.User))
    assert result.id == old_slack_user.id
    assert result is not old_slack_user
    assert result.user_id == user.id
    assert user.email == f"dev.staging-email-sink+{user.id}@f3nation.com"
    assert user.f3_name == f"F3 {user.id}"
    assert result.email == user.email
    assert result.user_name == f"F3 {user.id}"
    assert result.avatar_url is None
    assert result.slack_team_id == "T_STORED"
    assert result.is_admin is True
    assert result.is_owner is True
    assert result.is_bot is True
    assert result.user_id == user.id
    assert result.email == user.email
    assert result.user_name == f"F3 {user.id}"
    assert result.avatar_url is None
    assert result.slack_team_id == "T_STORED"
    loaded_slack_user = next(record for record in session.records if record is not user)
    assert loaded_slack_user in session.expunged
    assert user in session.expunged
    assert session.expired_on_commit == []


def test_nonproduction_get_user_links_cached_orphan(monkeypatch):
    orphan = SimpleNamespace(
        id=45,
        slack_id="U_CACHED_ORPHAN",
        user_id=None,
        email="retained-profile@example.invalid",
        user_name="Retained profile",
        avatar_url="https://example.invalid/avatar",
        slack_team_id="T_CACHED",
    )
    session = _use_fake_nonproduction_db(monkeypatch, {"record": orphan})
    helper_functions.SLACK_USERS[("T_CACHED", orphan.slack_id)] = orphan

    result = helper_functions.get_user(
        orphan.slack_id,
        SimpleNamespace(org_id=13, team_id="T_CACHED"),
        SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called")),
        None,
    )

    user = next(record for record in session.records if isinstance(record, helper_functions.User))
    assert result.id == orphan.id
    assert result is not orphan
    assert result.user_id == user.id
    assert result.email == user.email == f"dev.staging-email-sink+{user.id}@f3nation.com"
    assert result.user_name == f"F3 {user.id}"
    assert result.avatar_url is None
    assert result.slack_team_id == "T_CACHED"
    assert session.events[0][0] == "lock"
    assert session.events[1][0] == "select"
    loaded_slack_user = next(record for record in session.records if record is not user)
    assert ("expunge", loaded_slack_user) in session.events
    assert loaded_slack_user in session.expunged


def test_nonproduction_requeries_after_advisory_lock_and_uses_worker_created_row(monkeypatch):
    created_by_worker = SimpleNamespace(
        id=501, slack_id="U_LOCKED", user_id=601, email="canonical@example.invalid", slack_team_id="T_LOCK"
    )
    session = _use_fake_nonproduction_db(
        monkeypatch,
        after_lock=lambda locked_session: setattr(locked_session, "database_slack_user", created_by_worker),
    )

    result = helper_functions.create_user(
        {"id": "U_LOCKED", "profile": {"email": "ignored@example.invalid"}}, team_id="T_LOCK"
    )

    assert result.id == created_by_worker.id
    assert result is not created_by_worker
    assert result.user_id == created_by_worker.user_id
    assert not any(isinstance(record, helper_functions.User) for record in session.records)
    assert session.lookup_count == 1
    assert [event[0] for event in session.events[:2]] == ["lock", "select"]
    assert len(session.lock_calls) == 1
    statement, parameters = session.lock_calls[0]
    assert "pg_advisory_xact_lock(:lock_key)" in statement
    assert set(parameters) == {"lock_key"}


def test_nonproduction_requeries_orphan_linked_by_worker_without_creating_user(monkeypatch):
    orphan = SimpleNamespace(
        id=45,
        slack_id="U_ORPHAN_RACE",
        user_id=None,
        email="old@example.invalid",
        user_name="Old name",
        avatar_url="https://example.invalid/old",
        slack_team_id="T_ORPHAN",
    )

    def another_worker_links(session):
        orphan.user_id = 777
        session.database_slack_user = orphan

    session = _use_fake_nonproduction_db(monkeypatch, after_lock=another_worker_links)

    result = helper_functions.create_user({"id": orphan.slack_id}, team_id="T_ORPHAN")

    assert result.id == orphan.id
    assert result is not orphan
    assert result.user_id == 777
    assert not any(isinstance(record, helper_functions.User) for record in session.records)
    assert session.lookup_count == 1


def test_nonproduction_create_user_does_not_read_profile_before_lookup(monkeypatch):
    known = SimpleNamespace(slack_id="U_LINKED", slack_team_id="T_LINKED", user_id=99, email="existing@example.invalid")
    _use_fake_nonproduction_db(monkeypatch, {"record": known})

    class ProfileGuard(dict):
        def __getitem__(self, key):
            if key == "profile":
                raise AssertionError("profile must not be accessed")
            return super().__getitem__(key)

    result = helper_functions.create_user(
        ProfileGuard(id="U_LINKED", profile={"email": "must-not-be-read@example.invalid"}), team_id="T_LINKED"
    )

    assert result.slack_id == known.slack_id
    assert result.user_id == known.user_id


def test_production_get_user_keeps_slack_profile_lookup(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    helper_functions.SLACK_USERS.clear()
    expected = SimpleNamespace(slack_id="U_PROD", user_id=88)
    client = SimpleNamespace(users_info=lambda **kwargs: {"user": {"id": kwargs["user"]}})
    monkeypatch.setattr(helper_functions, "create_user", lambda *_args, **_kwargs: expected)

    result = helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None)

    assert result is expected
    assert helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] is expected


def test_production_get_user_returns_linked_cache_without_slack_lookup(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    cached = SimpleNamespace(slack_id="U_PROD", user_id=88)
    helper_functions.SLACK_USERS[("T_PROD", cached.slack_id)] = cached
    monkeypatch.setattr(helper_functions, "create_user", lambda *_args: pytest.fail("must not call create_user"))
    client = SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called"))

    assert helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None) is cached


def test_production_get_user_links_cached_user_without_f3_user(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] = SimpleNamespace(slack_id="U_PROD", user_id=None)
    linked = SimpleNamespace(slack_id="U_PROD", user_id=88)
    looked_up = []
    client = SimpleNamespace(users_info=lambda **kwargs: looked_up.append(kwargs["user"]) or {"user": {"id": "U_PROD"}})
    monkeypatch.setattr(helper_functions, "create_user", lambda *_args, **_kwargs: linked)

    result = helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None)

    assert looked_up == ["U_PROD"]
    assert result is linked
    assert helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] is linked


def test_production_get_user_matches_unlinked_cache_by_its_email_when_slack_omits_it(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] = SimpleNamespace(
        slack_id="U_PROD", user_id=None, is_bot=False, email="member@example.invalid"
    )
    passed = []
    linked = SimpleNamespace(slack_id="U_PROD", user_id=88)
    client = SimpleNamespace(users_info=lambda **_kwargs: {"user": {"id": "U_PROD", "profile": {}}})
    monkeypatch.setattr(helper_functions, "create_user", lambda info, *_args, **_kwargs: passed.append(info) or linked)

    result = helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None)

    assert passed[0]["profile"]["email"] == "member@example.invalid"
    assert result is linked
    assert helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] is linked


def test_production_get_user_fills_email_when_slack_sends_a_null_profile(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] = SimpleNamespace(
        slack_id="U_PROD", user_id=None, is_bot=False, email="member@example.invalid"
    )
    passed = []
    linked = SimpleNamespace(slack_id="U_PROD", user_id=88)
    client = SimpleNamespace(users_info=lambda **_kwargs: {"user": {"id": "U_PROD", "profile": None}})
    monkeypatch.setattr(helper_functions, "create_user", lambda info, *_args, **_kwargs: passed.append(info) or linked)

    assert helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None) is linked
    assert passed[0]["profile"]["email"] == "member@example.invalid"


def test_production_get_user_keeps_slack_profile_email_over_cached_email(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] = SimpleNamespace(
        slack_id="U_PROD", user_id=None, is_bot=False, email="stale@example.invalid"
    )
    passed = []
    client = SimpleNamespace(
        users_info=lambda **_kwargs: {"user": {"id": "U_PROD", "profile": {"email": "current@example.invalid"}}}
    )
    monkeypatch.setattr(
        helper_functions,
        "create_user",
        lambda info, *_args, **_kwargs: passed.append(info) or SimpleNamespace(user_id=88),
    )

    helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None)

    assert passed[0]["profile"]["email"] == "current@example.invalid"


def test_production_get_user_does_not_fill_email_for_cached_bot(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[("T_PROD", "B_PROD")] = SimpleNamespace(
        slack_id="B_PROD", user_id=None, is_bot=True, email="b_prod"
    )
    passed = []
    client = SimpleNamespace(users_info=lambda **_kwargs: {"user": {"id": "B_PROD", "profile": {}}})
    monkeypatch.setattr(
        helper_functions, "create_user", lambda info, *_args, **_kwargs: passed.append(info) or SimpleNamespace()
    )

    with pytest.raises(helper_functions.UnlinkedSlackIdentityError):
        helper_functions.get_user("B_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None)

    assert "email" not in passed[0]["profile"]


def test_production_get_user_retains_unlinked_cache_but_rejects_interaction_when_linking_fails(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    cached = SimpleNamespace(slack_id="U_PROD", user_id=None, is_bot=False, email="member@example.invalid")
    helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] = cached
    client = SimpleNamespace(users_info=lambda **_kwargs: {"user": {"id": "U_PROD", "profile": {}}})

    def create_user(*_args, **_kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(helper_functions, "create_user", create_user)

    with pytest.raises(helper_functions.UnlinkedSlackIdentityError):
        helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None)
    assert helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] is cached


def test_production_get_user_raises_when_create_user_fails_for_an_uncached_user(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    helper_functions.SLACK_USERS.clear()
    client = SimpleNamespace(users_info=lambda **_kwargs: {"user": {"id": "U_NEW", "profile": {}}})

    def create_user(*_args, **_kwargs):
        raise RuntimeError("db down")

    monkeypatch.setattr(helper_functions, "create_user", create_user)

    with pytest.raises(RuntimeError):
        helper_functions.get_user("U_NEW", SimpleNamespace(org_id=1, team_id="T_PROD"), client, None)


def test_production_get_user_preserves_cache_but_rejects_unlinked_interaction_when_slack_fails(monkeypatch, caplog):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    cached = SimpleNamespace(slack_id="U_PROD", user_id=None, is_bot=False, email="member@example.invalid")
    helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] = cached

    def users_info(**_kwargs):
        raise RuntimeError("fabricated-token member@example.invalid U_PROD SQL parameters")

    monkeypatch.setattr(helper_functions, "create_user", lambda *_args: pytest.fail("must not call create_user"))

    with (
        caplog.at_level("WARNING", logger=helper_functions.__name__),
        pytest.raises(helper_functions.UnlinkedSlackIdentityError),
    ):
        helper_functions.get_user(
            "U_PROD", SimpleNamespace(org_id=1, team_id="T_PROD"), SimpleNamespace(users_info=users_info), None
        )

    assert helper_functions.SLACK_USERS[("T_PROD", "U_PROD")] is cached
    assert "slack.identity.cached_link_failed" in caplog.text
    assert all(
        value not in caplog.text for value in ["fabricated-token", "member@example.invalid", "U_PROD", "SQL parameters"]
    )
    assert all(record.exc_info is None for record in caplog.records)


def test_production_get_user_raises_when_slack_lookup_fails_for_an_uncached_user(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    helper_functions.SLACK_USERS.clear()

    def users_info(**_kwargs):
        raise RuntimeError("slack down")

    with pytest.raises(RuntimeError):
        helper_functions.get_user(
            "U_NEW", SimpleNamespace(org_id=1, team_id="T_PROD"), SimpleNamespace(users_info=users_info), None
        )


@pytest.mark.parametrize(
    "slack_error,expected_code",
    [
        ("invalid_auth", "invalid_auth"),
        ("token_revoked", "token_revoked"),
        ("ratelimited", "ratelimited"),
        ("missing_scope", "missing_scope"),
        ("user_not_found", "user_not_found"),
        ("account_inactive", "account_inactive"),
        ("not_authed", "not_authed"),
        ("unknown_error", "other"),
        ("private-member@f3local.dev fabricated-token U_PRIVATE SQL parameters", "other"),
        ({"private": "private-member@f3local.dev"}, "other"),
        (["fabricated-token"], "other"),
        (None, "other"),
        (123, "other"),
    ],
    ids=[
        "auth",
        "revoked",
        "rate",
        "scope",
        "missing",
        "inactive",
        "unauthenticated",
        "unknown",
        "private",
        "map",
        "list",
        "null",
        "number",
    ],
)
def test_cached_link_failure_logs_safe_context_for_both_handlers(monkeypatch, caplog, slack_error, expected_code):
    error = SlackApiError(
        "fabricated-token private-member@f3local.dev U_PRIVATE SQL parameters",
        response={"error": slack_error, "user": {"id": "U_PRIVATE", "name": "Private Member"}},
    )
    _assert_cached_failure_logs(monkeypatch, caplog, error, "SlackApiError", expected_code, fail_at="slack")


def test_cached_database_failure_logs_class_without_sql_or_parameters(monkeypatch, caplog):
    error = OperationalError(
        "SELECT private_email FROM users WHERE slack_id = 'U_PRIVATE'",
        {"email": "private-member@f3local.dev", "token": "fabricated-token"},
        SimpleNamespace(pgcode="23505", diag=SimpleNamespace(constraint_name="uq_slack_users_slack_id_team_id")),
    )
    _assert_cached_failure_logs(
        monkeypatch,
        caplog,
        error,
        "OperationalError",
        "none",
        fail_at="database",
        expected_sqlstate="23505",
        expected_constraint="uq_slack_users_slack_id_team_id",
    )


@pytest.mark.parametrize("team_id", ["T" * 65, "T_PRIVATE\nprivate-member@f3local.dev"])
def test_cached_failure_bounds_untrusted_team_context(monkeypatch, caplog, team_id):
    _assert_cached_failure_logs(
        monkeypatch,
        caplog,
        RuntimeError("fabricated-token"),
        "RuntimeError",
        "none",
        fail_at="database",
        team_id=team_id,
        expected_team="other",
    )


def _assert_cached_failure_logs(
    monkeypatch,
    caplog,
    error,
    expected_type,
    expected_code,
    *,
    fail_at,
    team_id="T_DIAGNOSTIC",
    expected_team="T_DIAGNOSTIC",
    expected_sqlstate="none",
    expected_constraint="none",
):
    cache = helper_functions.SLACK_USERS
    previous = cache.copy()
    cached = SimpleNamespace(slack_id="U_PRIVATE", user_id=None, is_bot=False, email="private-member@f3local.dev")
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)

    def unexpected_boundary(*_args, **_kwargs):
        pytest.fail("unexpected database or Slack boundary")

    monkeypatch.setattr(helper_functions, "session_scope", unexpected_boundary)
    monkeypatch.setattr(helper_functions, "update_local_slack_users", unexpected_boundary)
    for method in ("find_records", "find_first_record", "find_join_records2", "update_record", "create_record"):
        monkeypatch.setattr(helper_functions.DbManager, method, unexpected_boundary)

    def users_info(**_kwargs):
        if fail_at == "slack":
            raise error
        return {"user": {"id": "U_PRIVATE", "profile": {}}}

    def create_user(*_args, **_kwargs):
        if fail_at == "database":
            raise error
        unexpected_boundary()

    monkeypatch.setattr(helper_functions, "create_user", create_user)
    cache.clear()
    cache[(team_id, "U_PRIVATE")] = cached
    try:
        with (
            caplog.at_level(logging.WARNING, logger=helper_functions.__name__),
            pytest.raises(helper_functions.UnlinkedSlackIdentityError),
        ):
            helper_functions.get_user(
                "U_PRIVATE", SimpleNamespace(org_id=1, team_id=team_id), SimpleNamespace(users_info=users_info), None
            )
        assert cache[(team_id, "U_PRIVATE")] is cached
        assert helper_functions.SLACK_USERS is cache
        record = next(record for record in caplog.records if record.name == helper_functions.__name__)
        assert record.json_fields == {
            "event": "slack.identity.cached_link_failed",
            "team_id": expected_team,
            "error_type": expected_type,
            "slack_error": expected_code,
            "sqlstate": expected_sqlstate,
            "constraint": expected_constraint,
        }
        assert record.levelno == (logging.WARNING if isinstance(error, SlackApiError) else logging.ERROR)
        expected_message = (
            f"slack.identity.cached_link_failed team_id={expected_team} "
            f"error_type={expected_type} slack_error={expected_code} "
            f"sqlstate={expected_sqlstate} constraint={expected_constraint}"
        )
        stream = io.StringIO()
        local_handler = logging.StreamHandler(stream)
        structured_handler = StructuredLogHandler()
        try:
            local_handler.handle(record)
            assert stream.getvalue().strip() == expected_message
            assert structured_handler.filter(record)
            serialized = structured_handler.format(record)
        finally:
            local_handler.close()
            structured_handler.close()
        payload = json.loads(serialized)
        assert payload["message"] == expected_message
        assert {key: payload[key] for key in record.json_fields} == record.json_fields
        assert record.exc_info is None and record.stack_info is None
        recorded = json.dumps(record.__dict__, default=str)
        for private in (
            "fabricated-token",
            "private-member@f3local.dev",
            "U_PRIVATE",
            "Private Member",
            "SQL parameters",
            "SELECT private_email",
        ):
            assert private not in stream.getvalue() + serialized + recorded + caplog.text
    finally:
        cache.clear()
        cache.update(previous)


def test_nonproduction_populate_users_does_not_enumerate_members(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: False)
    client = SimpleNamespace(users_list=lambda: pytest.fail("users_list must not be called"))

    helper_functions.populate_users(client, "T_TEST", 9)


@pytest.mark.parametrize("production", [False, True])
def test_get_user_selects_only_requested_workspace(monkeypatch, production):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: production)
    helper_functions.SLACK_USERS.clear()
    first = SimpleNamespace(slack_id="USHARED", slack_team_id="T_FIRST", user_id=11)
    second = SimpleNamespace(slack_id="USHARED", slack_team_id="T_SECOND", user_id=22)
    helper_functions.SLACK_USERS.update({("T_FIRST", "USHARED"): first, ("T_SECOND", "USHARED"): second})
    monkeypatch.setattr(helper_functions, "create_user", lambda *_a, **_k: pytest.fail("linked pair must be reused"))
    client = SimpleNamespace(users_info=lambda **_k: pytest.fail("linked pair must not fetch profile"))
    assert helper_functions.get_user("USHARED", SimpleNamespace(team_id="T_SECOND", org_id=9), client, None) is second


@pytest.mark.parametrize("return_urls", [False, True])
def test_names_and_avatars_are_workspace_scoped_with_raw_id_fallback(return_urls):
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS.update(
        {
            ("T_FIRST", "USHARED"): SimpleNamespace(user_name="First Name", avatar_url="first-avatar"),
            ("T_SECOND", "USHARED"): SimpleNamespace(user_name="Second Name", avatar_url="second-avatar"),
        }
    )
    result = helper_functions.get_user_names(["USHARED", "UMISSING"], None, None, return_urls, team_id="T_SECOND")
    assert (
        result == (["Second Name", "UMISSING"], ["second-avatar", None])
        if return_urls
        else result == ["Second Name", "UMISSING"]
    )


def test_refresh_retains_pairs_and_deterministically_selects_legacy_duplicates(monkeypatch):
    from features import positions

    cache = helper_functions.SLACK_USERS
    rows = [
        SimpleNamespace(id=4, slack_team_id="T_FIRST", slack_id="USHARED", user_id=11, slack_updated=None),
        SimpleNamespace(id=3, slack_team_id="T_FIRST", slack_id="USHARED", user_id=12, slack_updated=0),
        SimpleNamespace(id=2, slack_team_id="T_FIRST", slack_id="USHARED", user_id=13, slack_updated=0),
        SimpleNamespace(id=5, slack_team_id="T_SECOND", slack_id="USHARED", user_id=22, slack_updated=10),
    ]
    monkeypatch.setattr(helper_functions.DbManager, "find_records", lambda *_a, **_k: rows)
    helper_functions.update_local_slack_users()
    assert helper_functions.SLACK_USERS is cache is positions.SLACK_USERS
    assert cache == {("T_FIRST", "USHARED"): rows[2], ("T_SECOND", "USHARED"): rows[3]}
    assert positions._user_id_to_slack_id_map("T_FIRST") == {13: "USHARED"}
    assert positions._user_id_to_slack_id_map("T_SECOND") == {22: "USHARED"}
    helper_functions.update_local_slack_users(rows[0])
    assert cache[("T_FIRST", "USHARED")] is rows[0]
    assert cache[("T_SECOND", "USHARED")] is rows[3]


@pytest.mark.parametrize("production", [False, True])
@pytest.mark.parametrize("payload,team,error", [({}, "T", "Slack user ID"), ({"id": "U"}, None, "Slack team ID")])
def test_create_rejects_missing_identity_before_database(monkeypatch, production, payload, team, error):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: production)
    monkeypatch.setattr(helper_functions, "session_scope", lambda: pytest.fail("no DB before identity validation"))
    monkeypatch.setattr(helper_functions.DbManager, "find_records", lambda *_a, **_k: pytest.fail("no DB"))
    with pytest.raises(ValueError, match=error):
        helper_functions.create_user(payload, team_id=team)


@pytest.mark.parametrize("production", [False, True])
def test_get_user_rejects_missing_team_before_cache_refresh(monkeypatch, production):
    helper_functions.SLACK_USERS.clear()
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: production)
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: pytest.fail("no DB without workspace"))
    with pytest.raises(ValueError, match="Slack team ID"):
        helper_functions.get_user("U", SimpleNamespace(org_id=1), None, None)


def test_text_and_rich_text_names_use_workspace_context():
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS.update(
        {
            ("T_FIRST", "USHARED"): SimpleNamespace(user_name="First Name", avatar_url="first-avatar"),
            ("T_SECOND", "USHARED"): SimpleNamespace(user_name="Second Name", avatar_url="second-avatar"),
        }
    )
    region = SimpleNamespace(team_id="T_SECOND")
    client = SimpleNamespace(conversations_list=lambda: {"channels": []})
    assert helper_functions.replace_user_channel_ids("Hello <@USHARED>", region, client, None) == "Hello Second Name"
    block = {
        "type": "rich_text",
        "elements": [{"type": "rich_text_section", "elements": [{"type": "user", "user_id": "USHARED"}]}],
    }
    result = helper_functions.replace_rich_text_user_channel(block, region, None, None)
    assert result["elements"][0]["elements"] == [{"type": "text", "text": "@Second Name"}]
    assert block["elements"][0]["elements"][0]["type"] == "user"


@pytest.mark.parametrize("production", [False, True])
@pytest.mark.parametrize(
    "explicit_team,payload_team", [("T_CONTEXT", None), ("T_CONTEXT", "T_OTHER"), (None, "T_CONTEXT")]
)
def test_creation_resolves_context_before_payload_and_preserves_link(
    monkeypatch, production, explicit_team, payload_team
):
    linked = SimpleNamespace(id=901, slack_id="U_CONTEXT", slack_team_id="T_CONTEXT", user_id=123)
    _use_fake_nonproduction_db(monkeypatch, {"record": linked})
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: production)

    class ProfileGuard(dict):
        def __getitem__(self, key):
            if key == "profile":
                raise AssertionError("linked identity must not inspect profile")
            return super().__getitem__(key)

    result = helper_functions.create_user(
        ProfileGuard(id="U_CONTEXT", team_id=payload_team, profile={}), team_id=explicit_team
    )
    assert result.id == 901 and result.user_id == 123
    assert helper_functions.SLACK_USERS[("T_CONTEXT", "U_CONTEXT")] is result


def test_nonproduction_new_identity_never_inspects_profile(monkeypatch):
    session = _use_fake_nonproduction_db(monkeypatch)

    class ProfileGuard(dict):
        def __getitem__(self, key):
            if key == "profile":
                raise AssertionError("nonproduction must not inspect profile")
            return super().__getitem__(key)

    result = helper_functions.create_user(ProfileGuard(id="U_PRIVATE", profile={}), team_id="T_PRIVATE")
    user = next(record for record in session.records if isinstance(record, helper_functions.User))
    assert result.email == user.email == f"dev.staging-email-sink+{user.id}@f3nation.com"
    assert result.user_name == user.f3_name == f"F3 {user.id}"
    assert result.avatar_url is None


@pytest.mark.parametrize("production", [False, True])
def test_get_user_passes_caller_team_when_payload_omits_or_disagrees(monkeypatch, production):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: production)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[("T_OTHER", "U_CONTEXT")] = SimpleNamespace(user_id=99)
    captured = []
    expected = SimpleNamespace(user_id=42)

    def create(payload, org_id, *, team_id):
        captured.append((payload["id"], org_id, team_id))
        return expected

    monkeypatch.setattr(helper_functions, "create_user", create)
    monkeypatch.setattr(helper_functions, "session_scope", lambda: pytest.fail("no DB in caller test"))
    client = SimpleNamespace(users_info=lambda **_k: {"user": {"id": "U_CONTEXT", "team_id": "T_OTHER"}})
    result = helper_functions.get_user("U_CONTEXT", SimpleNamespace(team_id="T_ACTIVE", org_id=3), client, None)
    assert result is expected
    assert captured == [("U_CONTEXT", 3, "T_ACTIVE")]


@pytest.mark.parametrize("return_urls", [False, True])
def test_names_empty_cache_keeps_raw_id_and_null_avatar(return_urls):
    helper_functions.SLACK_USERS.clear()
    result = helper_functions.get_user_names(["U_UNKNOWN"], None, None, return_urls, team_id="T_ACTIVE")
    assert result == (["U_UNKNOWN"], [None]) if return_urls else result == ["U_UNKNOWN"]


def test_production_populate_generates_only_eligible_workspace_pairs(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    member = {
        "id": "U_IMPORT",
        "updated": 42,
        "profile": {
            "email": "member@example.invalid",
            "display_name": "Import Display",
            "real_name": "Import Real",
            "image_192": "import-avatar",
        },
    }
    members = [
        member,
        {**member, "id": "U_BOT", "is_bot": True},
        {**member, "id": "USLACKBOT"},
        {**member, "id": "U_DELETED", "deleted": True},
        {**member, "id": None},
    ]
    client = SimpleNamespace(users_list=lambda: {"members": members})
    batches = []
    monkeypatch.setattr(
        helper_functions.DbManager, "create_or_ignore", lambda model, rows: batches.append((model, rows))
    )
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda *_a, **_k: [SimpleNamespace(id=73, email="Member@EXAMPLE.invalid")],
    )
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    helper_functions.populate_users(client, "T_ACTIVE")
    assert [model for model, _ in batches] == [helper_functions.User, helper_functions.SlackUser]
    identities = batches[1][1]
    assert {(row.slack_team_id, row.slack_id, row.user_id) for row in identities} == {
        ("T_ACTIVE", "U_IMPORT", 73),
        ("T_ACTIVE", "U_BOT", 73),
    }
    assert all(
        row.slack_updated == 42 and row.user_name == "Import Display" and row.avatar_url == "import-avatar"
        for row in identities
    )


@pytest.mark.parametrize("data", [b"fabricated-token", [], "fabricated-token", 123, None])
@pytest.mark.parametrize("wrapped", [False, True], ids=["raw-response", "sdk-response"])
def test_cached_link_failure_survives_non_mapping_slack_responses(monkeypatch, caplog, data, wrapped):
    response = (
        SlackResponse(
            client=None,
            http_verb="GET",
            api_url="https://slack.invalid",
            req_args={},
            data=data,
            headers={},
            status_code=500,
        )
        if wrapped
        else data
    )
    error = SlackApiError("fabricated-token", response={})
    error.response = response
    _assert_cached_failure_logs(monkeypatch, caplog, error, "SlackApiError", "other", fail_at="slack")


def test_identity_error_context_survives_response_inspection_failure():
    class BrokenResponse:
        @property
        def data(self):
            raise ValueError("fabricated-token")

    error = SlackApiError("fabricated-token", response=BrokenResponse())
    assert helper_functions.slack_identity_error_context("T_TEST", error) == {
        "team_id": "T_TEST",
        "error_type": "SlackApiError",
        "slack_error": "response_inspection_failed",
    }


class _ProductionSession(_FakeSession):
    def __init__(self, existing=None, user=None):
        super().__init__(existing)
        self.database_user = user
        self.user_inserts = []

    def execute(self, statement, parameters=None):
        if getattr(statement, "is_insert", False) and statement.table.name == "users":
            values = statement.compile().params
            self.user_inserts.append(values)
            if self.database_user is None:
                self.database_user = helper_functions.User(id=42, **values)
            return
        return super().execute(statement, parameters)

    def scalars(self, query):
        if query.column_descriptions[0]["entity"] is helper_functions.User:
            assert query.compile().params["email_1"] == self.database_user.email
            return SimpleNamespace(one=lambda: self.database_user)
        return super().scalars(query)


@pytest.mark.parametrize("cached", [False, True])
def test_production_identity_insert_and_cached_email_normalization(monkeypatch, cached):
    existing = (
        helper_functions.SlackUser(
            id=12, slack_id="U_P", slack_team_id="T_P", user_id=None, is_bot=False, email="Member@Example.invalid"
        )
        if cached
        else None
    )
    user = helper_functions.User(id=42, email="member@example.invalid") if cached else None
    session = _ProductionSession(existing, user)
    monkeypatch.setattr(helper_functions, "session_scope", lambda: session)
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    profile = {"display_name": "D", "image_192": "a"}
    if not cached:
        profile["email"] = "New@Example.invalid"
    result = helper_functions.create_user({"id": "U_P", "updated": 7, "profile": profile}, team_id="T_P")
    assert result.user_id == 42
    assert result.user_id == session.database_user.id
    assert len(session.user_inserts) == 1
    assert session.user_inserts[0]["email"] == ("member@example.invalid" if cached else "new@example.invalid")
    assert helper_functions.SLACK_USERS[("T_P", "U_P")] is result
    if not cached:
        assert result.slack_updated == 7
        assert result.user_name == "D" and result.avatar_url == "a"


def test_production_populate_keeps_no_email_member_unlinked(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    member = {
        "id": "U_NOEMAIL",
        "is_bot": True,
        "updated": 1,
        "profile": {"display_name": "B", "real_name": "", "image_192": None},
    }
    batches = []
    monkeypatch.setattr(helper_functions.DbManager, "create_or_ignore", lambda model, rows: batches.append(rows))
    monkeypatch.setattr(
        helper_functions.DbManager, "find_records", lambda *_a, **_k: [SimpleNamespace(id=74, email="U_NOEMAIL")]
    )
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    helper_functions.populate_users(SimpleNamespace(users_list=lambda: {"members": [member]}), "T_ACTIVE")
    assert batches[0] == []
    assert {(row.slack_team_id, row.slack_id, row.user_id) for row in batches[1]} == {("T_ACTIVE", "U_NOEMAIL", None)}


@pytest.mark.parametrize("cached_email", [None, "U_NOEMAIL", "u_noemail"])
def test_production_no_email_does_not_create_or_link_f3_user(monkeypatch, cached_email):
    existing = (
        helper_functions.SlackUser(
            id=12, slack_id="U_NOEMAIL", slack_team_id="T_P", user_id=None, is_bot=False, email=cached_email
        )
        if cached_email
        else None
    )
    session = _ProductionSession(existing)
    monkeypatch.setattr(helper_functions, "session_scope", lambda: session)
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    helper_functions.SLACK_USERS.clear()
    result = helper_functions.create_user(
        {"id": "U_NOEMAIL", "profile": {"display_name": "Visible Name", "image_192": "avatar"}}, team_id="T_P"
    )
    assert result.user_id is None
    assert session.user_inserts == []
    assert helper_functions.SLACK_USERS[("T_P", "U_NOEMAIL")] is result
    if existing is None:
        assert result.user_name == "Visible Name" and result.avatar_url == "avatar"


def test_interaction_rejects_unlinked_identity_before_returning_it(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    helper_functions.SLACK_USERS.clear()
    identity = helper_functions.SlackUser(slack_id="U_HIDDEN", slack_team_id="T_P", user_id=None)
    monkeypatch.setattr(helper_functions, "create_user", lambda *_a, **_k: identity)
    client = SimpleNamespace(users_info=lambda **_k: {"user": {"id": "U_HIDDEN", "profile": {}}})
    with pytest.raises(ValueError, match="could not be verified"):
        helper_functions.get_user("U_HIDDEN", SimpleNamespace(org_id=1, team_id="T_P"), client, None)
    assert helper_functions.SLACK_USERS[("T_P", "U_HIDDEN")] is identity


@pytest.mark.parametrize("team", [None, ""])
def test_production_populate_rejects_missing_team_before_enumeration(monkeypatch, team):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    client = SimpleNamespace(users_list=lambda: pytest.fail("enumerated members without a team"))
    monkeypatch.setattr(helper_functions.DbManager, "find_records", lambda *_a, **_k: pytest.fail("database read"))
    with pytest.raises(ValueError, match="Slack team ID"):
        helper_functions.populate_users(client, team)


@pytest.mark.parametrize("diagnostic", ["unsafe", "throws"])
def test_cached_database_diagnostic_extraction_cannot_leak_or_raise(monkeypatch, caplog, diagnostic):
    class BrokenDiagnostic:
        @property
        def pgcode(self):
            raise ValueError("private-member@f3local.dev")

    orig = (
        BrokenDiagnostic()
        if diagnostic == "throws"
        else SimpleNamespace(
            pgcode="private-member@f3local.dev", diag=SimpleNamespace(constraint_name="private-member@f3local.dev")
        )
    )
    error = OperationalError("SELECT private_email", {}, orig)
    _assert_cached_failure_logs(
        monkeypatch,
        caplog,
        error,
        "OperationalError",
        "none",
        fail_at="database",
        expected_sqlstate="none" if diagnostic == "throws" else "other",
        expected_constraint="none" if diagnostic == "throws" else "other",
    )
