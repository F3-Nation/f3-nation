import os
import sys
from types import SimpleNamespace

import pytest

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
        self.observed_records = []
        self.expunged = []
        self.expired_on_commit = []
        self.lock_calls = []
        self.lookup_count = 0
        self.next_id = 101
        self.database_slack_user = existing_slack_user
        self.after_lock = after_lock

    def __enter__(self):
        return self

    def __exit__(self, *_args):
        self.expired_on_commit = [
            record for record in [*self.records, *self.observed_records] if record not in self.expunged
        ]
        return False

    def add(self, record):
        self.records.append(record)
        if getattr(record, "id", None) is None:
            record.id = self.next_id
            self.next_id += 1
        if isinstance(record, helper_functions.SlackUser):
            self.database_slack_user = record

    def flush(self):
        if self.database_slack_user and self.observed_records:
            session_row = self.observed_records[-1]
            for field, value in vars(session_row).items():
                setattr(self.database_slack_user, field, value)

    def expunge(self, record):
        self.expunged.append(record)

    def execute(self, statement, parameters):
        self.lock_calls.append((str(statement), parameters))
        if self.after_lock:
            self.after_lock(self)

    def scalars(self, _query):
        self.lookup_count += 1
        if self.database_slack_user:
            session_row = SimpleNamespace(**vars(self.database_slack_user))
            self.observed_records.append(session_row)
            return SimpleNamespace(first=lambda: session_row)
        return SimpleNamespace(first=lambda: None)


def _use_fake_nonproduction_db(monkeypatch, slack_users=None, after_lock=None):
    slack_users = slack_users or {}
    session = _FakeSession(slack_users.get("record"), after_lock=after_lock)
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: False)
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda *_args, **_kwargs: pytest.fail("non-production creation must query inside its locked session"),
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

    user = session.records[0]
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
    assert len(session.records) == 2
    assert user in session.expunged
    assert slack_user in session.expunged
    assert session.expired_on_commit == []


def test_nonproduction_known_user_preserves_link_without_slack_lookup(monkeypatch):
    known = SimpleNamespace(slack_id="U_KNOWN", user_id=77, user_name="Existing", email="existing@f3nation.com")
    _use_fake_nonproduction_db(monkeypatch, {"record": known})
    client = SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called"))

    result = helper_functions.get_user("U_KNOWN", SimpleNamespace(org_id=9, team_id="T_KNOWN"), client, None)

    assert result is not known
    assert result.user_id == 77


def test_nonproduction_get_user_returns_linked_cache_without_database_lookup(monkeypatch):
    cached = SimpleNamespace(slack_id="U_CACHED", user_id=78, user_name="Existing", email="existing@f3nation.com")
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: False)
    helper_functions.SLACK_USERS.clear()
    helper_functions.SLACK_USERS[cached.slack_id] = cached
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
    )

    user = session.records[0]
    assert result is not old_slack_user
    assert result.user_id == user.id
    assert user.email == f"dev.staging-email-sink+{user.id}@f3nation.com"
    assert user.f3_name == f"F3 {user.id}"
    assert result.email == user.email
    assert result.user_name == f"F3 {user.id}"
    assert result.avatar_url is None
    assert result.slack_team_id == "T_STORED"
    assert old_slack_user.user_id == user.id
    assert old_slack_user.email == user.email
    assert old_slack_user.user_name == f"F3 {user.id}"
    assert old_slack_user.avatar_url is None
    assert old_slack_user.slack_team_id == "T_STORED"
    assert old_slack_user in session.expunged
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
    helper_functions.SLACK_USERS[orphan.slack_id] = orphan

    result = helper_functions.get_user(
        orphan.slack_id,
        SimpleNamespace(org_id=13, team_id="T_CACHED"),
        SimpleNamespace(users_info=lambda **_kwargs: pytest.fail("users_info must not be called")),
        None,
    )

    user = session.records[0]
    assert result is not orphan
    assert result.user_id == user.id
    assert result.email == user.email == f"dev.staging-email-sink+{user.id}@f3nation.com"
    assert result.user_name == f"F3 {user.id}"
    assert result.avatar_url is None
    assert result.slack_team_id == "T_CACHED"
    assert orphan.user_id == user.id
    assert orphan.email == result.email
    assert orphan.user_name == result.user_name
    assert orphan.avatar_url is None
    assert orphan.slack_team_id == "T_CACHED"


def test_nonproduction_requeries_after_advisory_lock_and_uses_worker_created_row(monkeypatch):
    created_by_worker = SimpleNamespace(
        id=501, slack_id="U_LOCKED", user_id=601, email="canonical@example.invalid", slack_team_id="T_LOCK"
    )
    session = _use_fake_nonproduction_db(
        monkeypatch,
        after_lock=lambda locked_session: setattr(locked_session, "database_slack_user", created_by_worker),
    )

    result = helper_functions.create_user({"id": "U_LOCKED", "profile": {"email": "ignored@example.invalid"}})

    assert result is not created_by_worker
    assert result.user_id == created_by_worker.user_id
    assert session.records == []
    assert session.lookup_count == 1
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

    result = helper_functions.create_user({"id": orphan.slack_id})

    assert result is not orphan
    assert result.user_id == 777
    assert session.records == []
    assert session.lookup_count == 1


def test_nonproduction_create_user_does_not_read_profile_before_lookup(monkeypatch):
    known = SimpleNamespace(slack_id="U_LINKED", user_id=99, email="existing@example.invalid")
    _use_fake_nonproduction_db(monkeypatch, {"record": known})

    class ProfileGuard(dict):
        def __getitem__(self, key):
            if key == "profile":
                raise AssertionError("profile must not be accessed")
            return super().__getitem__(key)

    result = helper_functions.create_user(ProfileGuard(id="U_LINKED"))

    assert result is not known
    assert result.user_id == known.user_id


def test_production_get_user_keeps_slack_profile_lookup(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    monkeypatch.setattr(helper_functions, "update_local_slack_users", lambda: None)
    helper_functions.SLACK_USERS.clear()
    expected = SimpleNamespace(slack_id="U_PROD", user_id=88)
    client = SimpleNamespace(users_info=lambda **kwargs: {"user": {"id": kwargs["user"]}})
    monkeypatch.setattr(helper_functions, "create_user", lambda *_args: expected)

    result = helper_functions.get_user("U_PROD", SimpleNamespace(org_id=1), client, None)

    assert result is expected
    assert helper_functions.SLACK_USERS["U_PROD"] is expected


def test_production_direct_create_user_keeps_email_matching_and_profile_fields(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: True)
    existing_user = SimpleNamespace(id=42, email="synthetic.member@example.invalid")
    created_records = []
    monkeypatch.setattr(
        helper_functions.DbManager,
        "find_records",
        lambda model, *_args, **_kwargs: [existing_user] if model is helper_functions.User else [],
    )

    def create_record(record):
        record.id = 501
        created_records.append(record)
        return record

    monkeypatch.setattr(helper_functions.DbManager, "create_record", create_record)
    helper_functions.SLACK_USERS.clear()

    result = helper_functions.create_user(
        {
            "id": "U_PROD_DIRECT",
            "team_id": "T_PROD_DIRECT",
            "profile": {
                "email": "Synthetic.Member@example.invalid",
                "display_name": "Synthetic Member",
                "real_name": "Synthetic Real Name",
                "image_192": "https://example.invalid/synthetic-avatar.png",
            },
        },
        home_region_id=8,
    )

    assert result.user_id == existing_user.id
    assert result.email == "synthetic.member@example.invalid"
    assert result.user_name == "Synthetic Member"
    assert result.avatar_url == "https://example.invalid/synthetic-avatar.png"
    assert result.slack_team_id == "T_PROD_DIRECT"
    assert len(created_records) == 1
    assert created_records[0] is result
    assert helper_functions.SLACK_USERS["U_PROD_DIRECT"] is result


def test_nonproduction_populate_users_does_not_enumerate_members(monkeypatch):
    monkeypatch.setattr(helper_functions.constants, "is_production_deployment", lambda: False)
    client = SimpleNamespace(users_list=lambda: pytest.fail("users_list must not be called"))

    helper_functions.populate_users(client, "T_TEST", 9)
