import os
import sys
from datetime import date, datetime
from types import SimpleNamespace
from unittest.mock import Mock

import pytest
from sqlalchemy import JSON, Boolean, Column, Date, DateTime, Enum, Float, Integer, String, Table, create_engine, event
from sqlalchemy.dialects import postgresql
from sqlalchemy.orm import Session, registry
from sqlalchemy.sql import visitors
from sqlalchemy.sql.elements import Over

sys.path.insert(0, os.path.join(os.path.dirname(__file__), "..", ".."))

from scripts import auto_preblast_send, preblast_reminders, q_lineups

TODAY = date(2026, 11, 8)
EVENT_DATE = date(2026, 11, 9)
F3_AVATAR = "https://example.test/f3-avatar.png"
SLACK_AVATAR = "https://example.test/selected-avatar.png"


class FixedNow:
    @classmethod
    def now(cls, tz=None):
        return datetime(2026, 11, 8, 17, tzinfo=tz)


@pytest.fixture
def query_data(monkeypatch):
    mapper_registry = registry()
    metadata = mapper_registry.metadata
    tables = {
        "Org": Table(
            "orgs",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("parent_id", Integer),
            Column("name", String),
            Column("meta", JSON),
        ),
        "EventInstance": Table(
            "event_instances",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("org_id", Integer),
            Column("start_date", Date),
            Column("start_time", String),
            Column("is_active", Boolean),
            Column("preblast", String),
            Column("preblast_rich", JSON),
            Column("preblast_ts", Float),
            Column("series_exception", Enum(preblast_reminders.Series_Exception)),
            Column("meta", JSON),
        ),
        "EventType": Table("event_types", metadata, Column("id", Integer, primary_key=True), Column("name", String)),
        "EventType_x_EventInstance": Table(
            "event_type_links",
            metadata,
            Column("event_instance_id", Integer, primary_key=True),
            Column("event_type_id", Integer, primary_key=True),
        ),
        "Attendance": Table(
            "attendance",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("event_instance_id", Integer),
            Column("user_id", Integer),
            Column("created", DateTime),
        ),
        "Attendance_x_AttendanceType": Table(
            "attendance_type_links",
            metadata,
            Column("attendance_id", Integer, primary_key=True),
            Column("attendance_type_id", Integer, primary_key=True),
        ),
        "User": Table(
            "users",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("f3_name", String),
            Column("avatar_url", String),
        ),
        "SlackSpace": Table(
            "slack_spaces",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("team_id", String),
            # Keep settings nonhashable so ORM uniquing cannot hide repeated identical identities.
            Column("settings", JSON),
        ),
        "Org_x_SlackSpace": Table(
            "org_slack_spaces",
            metadata,
            Column("org_id", Integer, primary_key=True),
            Column("slack_space_id", Integer, primary_key=True),
        ),
        "SlackUser": Table(
            "slack_users",
            metadata,
            Column("id", Integer, primary_key=True),
            Column("user_id", Integer),
            Column("slack_id", String),
            Column("slack_team_id", String),
            Column("slack_updated", Integer),
            Column("user_name", String),
            Column("avatar_url", String),
        ),
    }
    models = {}
    for name, table in tables.items():
        model = type(name, (), {})
        mapper_registry.map_imperatively(model, table)
        models[name] = model
        for module in (preblast_reminders, auto_preblast_send, q_lineups):
            if hasattr(module, name):
                monkeypatch.setattr(module, name, model)

    engine = create_engine("sqlite+pysqlite:///:memory:")
    metadata.create_all(engine)
    session = Session(engine)
    for module in (preblast_reminders, auto_preblast_send):
        monkeypatch.setattr(module, "get_session", lambda: Session(engine))
        monkeypatch.setattr(module, "datetime", FixedNow)
        monkeypatch.setattr(module, "current_date_cst", lambda: TODAY)
    monkeypatch.setattr(q_lineups, "datetime", FixedNow)
    monkeypatch.setattr(q_lineups, "current_date_cst", lambda: TODAY)

    settings = {
        "team_id": "T_DESTINATION",
        "org_id": 100,
        "bot_token": "synthetic-bot-token",
        "automated_preblast_option": "q_only",
        "automated_preblast_hour_cst": 17,
        "preblast_reminder_hour_cst": 17,
        "send_q_lineups": True,
        "send_q_lineups_method": "yes_per_ao",
    }
    session.add_all(
        [
            models["Org"](id=100, name="Synthetic Region"),
            models["Org"](id=10, parent_id=100, name="Synthetic AO", meta={"slack_channel_id": "C_AO"}),
            models["EventInstance"](
                id=1,
                org_id=10,
                start_date=EVENT_DATE,
                start_time="0530",
                is_active=True,
                preblast_rich=None,
                meta={},
            ),
            models["EventType"](id=1, name="Bootcamp"),
            models["EventType"](id=2, name="Run"),
            models["EventType_x_EventInstance"](event_instance_id=1, event_type_id=1),
            models["Attendance"](id=1, event_instance_id=1, user_id=1, created=datetime(2026, 11, 1)),
            models["Attendance_x_AttendanceType"](attendance_id=1, attendance_type_id=2),
            models["User"](id=1, f3_name="Synthetic F3 Q", avatar_url=F3_AVATAR),
            models["User"](id=2, f3_name="Other F3 Q", avatar_url="https://example.test/other-f3.png"),
            models["SlackSpace"](id=1, team_id="T_DESTINATION", settings=settings),
            models["Org_x_SlackSpace"](org_id=100, slack_space_id=1),
        ]
    )
    session.commit()
    yield SimpleNamespace(session=session, engine=engine, models=SimpleNamespace(**models), settings=settings)
    session.close()
    engine.dispose()
    mapper_registry.dispose()


def add_identities(data, *overrides):
    for index, values in enumerate(overrides):
        fields = {
            "id": 10,
            "user_id": 1,
            "slack_id": "U_SELECTED",
            "slack_team_id": "T_DESTINATION",
            "slack_updated": 200,
            "user_name": "Selected Slack Q" if index == 0 else "Other Slack Q",
            "avatar_url": SLACK_AVATAR if index == 0 else "https://example.test/other-slack-avatar.png",
        }
        fields.update(values)
        data.session.add(data.models.SlackUser(**fields))
    data.session.commit()


def pull_items(module):
    results = module.PreblastList()
    results.pull_data(filters=[])
    return results.items


@pytest.mark.parametrize("module", [preblast_reminders, auto_preblast_send], ids=["reminder", "automatic"])
@pytest.mark.parametrize(
    "identities",
    [
        pytest.param([{}], id="one-identity"),
        pytest.param(
            [{}, {"id": 11, "user_name": "Selected Slack Q", "avatar_url": SLACK_AVATAR}],
            id="duplicate-account-pair",
        ),
        pytest.param(
            [{"id": 20}, {"id": 1, "slack_id": "U_OLDER", "user_name": "Older Q", "slack_updated": 100}],
            id="distinct-accounts-latest-timestamp",
        ),
        pytest.param(
            [{}, {"id": 11, "slack_team_id": "T_OTHER", "slack_id": "U_OTHER_TEAM", "slack_updated": 999}],
            id="other-team-cannot-win",
        ),
        pytest.param(
            [{}, {"id": 11, "user_id": 2, "slack_id": "U_OTHER_USER", "slack_updated": 999}],
            id="other-f3-user-cannot-win",
        ),
        pytest.param(
            [{"id": 20}, {"id": 1, "slack_id": "U_NULL", "slack_updated": None}],
            id="nonnull-timestamp-before-null",
        ),
        pytest.param(
            [
                {"id": 21, "slack_id": "U_TIED", "user_name": "Tied Q"},
                {"id": 20, "user_name": "Selected Slack Q", "avatar_url": SLACK_AVATAR},
            ],
            id="equal-timestamps-lowest-id",
        ),
        pytest.param(
            [
                {"id": 11, "slack_id": "U_NULL_TIED", "slack_updated": None},
                {"slack_updated": None, "user_name": "Selected Slack Q", "avatar_url": SLACK_AVATAR},
            ],
            id="all-null-timestamps-lowest-id",
        ),
    ],
)
def test_queries_select_one_identity_for_f3_user_and_workspace(query_data, module, identities):
    add_identities(query_data, *identities)

    items = pull_items(module)

    assert len(items) == 1
    item = items[0]
    assert item.slack_user_id == "U_SELECTED"
    assert item.q_avatar_url == F3_AVATAR
    assert item.slack_settings.team_id == "T_DESTINATION"
    if module is preblast_reminders:
        assert item.q_name == "Selected Slack Q"
        assert item.slack_avatar_url == SLACK_AVATAR
    else:
        assert item.q_name == "Synthetic F3 Q"


@pytest.mark.parametrize("module", [preblast_reminders, auto_preblast_send], ids=["reminder", "automatic"])
def test_actual_identity_ranking_uses_postgres_null_and_id_ordering(query_data, module):
    add_identities(query_data, {}, {"id": 11, "slack_id": "U_NULL", "slack_updated": None})
    statements = []

    def capture_statement(_connection, clauseelement, _multiparams, _params, _execution_options):
        statements.append(clauseelement)

    event.listen(query_data.engine, "before_execute", capture_statement)
    try:
        items = pull_items(module)
    finally:
        event.remove(query_data.engine, "before_execute", capture_statement)

    assert [item.slack_user_id for item in items] == ["U_SELECTED"]
    dialect = postgresql.dialect()
    identity_orders = [
        str(node.order_by.compile(dialect=dialect))
        for statement in statements
        for node in visitors.iterate(statement)
        if isinstance(node, Over)
        and str(node.partition_by.compile(dialect=dialect)) == "slack_users.user_id, slack_users.slack_team_id"
    ]
    assert set(identity_orders) == {"slack_users.slack_updated DESC NULLS LAST, slack_users.id ASC"}


@pytest.mark.parametrize("module", [preblast_reminders, auto_preblast_send], ids=["reminder", "automatic"])
@pytest.mark.parametrize("has_q", [True, False], ids=["q-without-slack", "open-q"])
def test_queries_preserve_events_without_matching_identity(query_data, module, has_q):
    add_identities(query_data, {"slack_team_id": "T_OTHER"}, {"id": 11, "user_id": None})
    if not has_q:
        query_data.session.query(query_data.models.Attendance).delete()
        query_data.session.commit()

    items = pull_items(module)

    assert len(items) == 1
    assert items[0].slack_user_id is None
    assert items[0].q_name == ("Synthetic F3 Q" if has_q else None)
    assert items[0].q_avatar_url == (F3_AVATAR if has_q else None)
    if module is preblast_reminders:
        assert items[0].slack_avatar_url is None
        blocks = q_lineups.build_lineup_blocks(items, items[0].org)
        assert len(blocks) == 1
        assert ("@Synthetic F3 Q" if has_q else "*OPEN!*") in blocks[0]["text"]["text"]
        if not has_q:
            assert blocks[0]["accessory"]["value"] == "1"


@pytest.mark.parametrize("module", [preblast_reminders, auto_preblast_send], ids=["reminder", "automatic"])
def test_queries_preserve_two_event_types_after_identity_selection(query_data, module):
    add_identities(query_data, {}, {"id": 11, "slack_id": "U_OLDER", "slack_updated": 100})
    query_data.session.add(query_data.models.EventType_x_EventInstance(event_instance_id=1, event_type_id=2))
    query_data.session.commit()

    items = pull_items(module)

    assert sorted((item.event.id, item.event_type.name, item.slack_user_id) for item in items) == [
        (1, "Bootcamp", "U_SELECTED"),
        (1, "Run", "U_SELECTED"),
    ]


def test_lineup_sends_one_entry_with_selected_name_and_avatar(query_data, monkeypatch):
    add_identities(query_data, {}, {"id": 11, "slack_id": "U_OLDER", "slack_updated": 100})
    spaces = query_data.session.query(query_data.models.SlackSpace).all()
    monkeypatch.setattr(q_lineups.DbManager, "find_records", lambda *args, **kwargs: spaces)
    send = Mock()
    monkeypatch.setattr(q_lineups, "send_q_lineup_message", send)

    q_lineups.send_lineups(force=True)

    send.assert_called_once()
    org, blocks, settings, start, end = send.call_args.args
    assert org.id == 10
    assert settings.team_id == "T_DESTINATION"
    assert (start, end) == (EVENT_DATE, date(2026, 11, 15))
    entries = [block for block in blocks if "Bootcamp" in block.get("text", {}).get("text", "")]
    assert len(entries) == 1
    assert "@Selected Slack Q" in entries[0]["text"]["text"]
    assert entries[0]["accessory"]["image_url"] == SLACK_AVATAR


@pytest.mark.parametrize("two_types", [False, True], ids=["one-type", "two-types"])
def test_reminder_delivers_once_per_event_type_to_selected_recipient(query_data, monkeypatch, two_types):
    add_identities(query_data, {}, {"id": 11, "slack_id": "U_OLDER", "slack_updated": 100})
    if two_types:
        query_data.session.add(query_data.models.EventType_x_EventInstance(event_instance_id=1, event_type_id=2))
        query_data.session.commit()
    client = Mock()
    monkeypatch.setattr(preblast_reminders, "WebClient", lambda *args, **kwargs: client)

    preblast_reminders.send_preblast_reminders(force=True)

    deliveries = client.chat_postMessage.call_args_list
    assert len(deliveries) == (2 if two_types else 1)
    assert all(call.kwargs["channel"] == "U_SELECTED" for call in deliveries)
    assert all("Selected Slack Q" in call.kwargs["text"] for call in deliveries)
    assert sum("Bootcamp" in call.kwargs["text"] for call in deliveries) == 1
    if two_types:
        assert sum("Run" in call.kwargs["text"] for call in deliveries) == 1


@pytest.mark.parametrize(
    "event_values",
    [
        {"is_active": False},
        {"series_exception": preblast_reminders.Series_Exception.closed},
        {"preblast_ts": 123.0},
        {"preblast_rich": {"blocks": []}},
        {"start_date": TODAY},
    ],
    ids=["inactive", "closed", "already-sent", "rich-preblast-set", "wrong-day"],
)
def test_reminder_preserves_event_eligibility(query_data, monkeypatch, event_values):
    add_identities(query_data, {}, {"id": 11})
    query_data.session.query(query_data.models.EventInstance).update(event_values)
    query_data.session.commit()
    client = Mock()
    monkeypatch.setattr(preblast_reminders, "WebClient", lambda *args, **kwargs: client)

    preblast_reminders.send_preblast_reminders(force=True)

    client.chat_postMessage.assert_not_called()


@pytest.mark.parametrize("two_types", [False, True], ids=["one-type", "two-types"])
def test_automatic_preblast_sends_once_per_event_type(query_data, monkeypatch, two_types):
    add_identities(query_data, {}, {"id": 11, "slack_id": "U_OLDER", "slack_updated": 100})
    if two_types:
        query_data.session.add(query_data.models.EventType_x_EventInstance(event_instance_id=1, event_type_id=2))
        query_data.session.commit()
    client = Mock()
    monkeypatch.setattr(auto_preblast_send, "WebClient", lambda *args, **kwargs: client)
    send = Mock()
    monkeypatch.setattr(auto_preblast_send.event_preblast, "send_preblast", send)

    auto_preblast_send.send_automated_preblasts(force=True)

    assert send.call_count == (2 if two_types else 1)
    for call in send.call_args_list:
        assert call.kwargs["event_instance_id"] == 1
        assert call.kwargs["region_record"].team_id == "T_DESTINATION"
        assert call.kwargs["client"] is client


@pytest.mark.parametrize(
    "event_values,option,has_q",
    [
        ({}, "disable", True),
        ({"series_exception": preblast_reminders.Series_Exception.closed}, "all", True),
        ({"meta": {"do_not_send_auto_preblasts": True}}, "all", True),
        ({}, "q_only", False),
        ({"is_active": False}, "all", True),
        ({"preblast_ts": 123.0}, "all", True),
        ({"start_date": TODAY}, "all", True),
    ],
    ids=["disabled", "closed", "opt-out", "q-only-without-q", "inactive", "already-sent", "wrong-day"],
)
def test_automatic_preblast_preserves_eligibility(query_data, monkeypatch, event_values, option, has_q):
    add_identities(query_data, {}, {"id": 11})
    if event_values:
        query_data.session.query(query_data.models.EventInstance).update(event_values)
    query_data.session.query(query_data.models.SlackSpace).update(
        {"settings": {**query_data.settings, "automated_preblast_option": option}}
    )
    if not has_q:
        query_data.session.query(query_data.models.Attendance).delete()
    query_data.session.commit()
    send = Mock()
    monkeypatch.setattr(auto_preblast_send.event_preblast, "send_preblast", send)
    monkeypatch.setattr(auto_preblast_send, "WebClient", Mock())

    auto_preblast_send.send_automated_preblasts(force=True)

    send.assert_not_called()


@pytest.mark.parametrize("module", [preblast_reminders, auto_preblast_send], ids=["reminder", "automatic"])
def test_queries_preserve_name_and_avatar_fallback_sources(query_data, module):
    add_identities(query_data, {"user_name": None}, {"id": 11, "slack_updated": 100})
    query_data.session.query(query_data.models.User).filter_by(id=1).update({"avatar_url": None})
    query_data.session.commit()

    items = pull_items(module)

    assert len(items) == 1
    assert items[0].q_name == "Synthetic F3 Q"
    assert items[0].slack_user_id == "U_SELECTED"
    assert items[0].q_avatar_url == (SLACK_AVATAR if module is preblast_reminders else None)
    if module is preblast_reminders:
        assert items[0].slack_avatar_url == SLACK_AVATAR


@pytest.mark.parametrize("module", [preblast_reminders, auto_preblast_send], ids=["reminder", "automatic"])
def test_queries_keep_first_q_attendance_selection(query_data, module):
    add_identities(query_data, {}, {"id": 11, "user_id": 2, "slack_updated": 999})
    query_data.session.add_all(
        [
            query_data.models.Attendance(id=2, event_instance_id=1, user_id=2, created=datetime(2026, 11, 2)),
            query_data.models.Attendance_x_AttendanceType(attendance_id=2, attendance_type_id=2),
        ]
    )
    query_data.session.commit()

    items = pull_items(module)

    assert len(items) == 1
    assert items[0].slack_user_id == "U_SELECTED"
    assert items[0].q_name == ("Selected Slack Q" if module is preblast_reminders else "Synthetic F3 Q")


def test_lineup_disabled_region_sends_nothing(query_data, monkeypatch):
    add_identities(query_data, {}, {"id": 11})
    query_data.session.query(query_data.models.SlackSpace).update(
        {"settings": {**query_data.settings, "send_q_lineups": False}}
    )
    query_data.session.commit()
    spaces = query_data.session.query(query_data.models.SlackSpace).all()
    monkeypatch.setattr(q_lineups.DbManager, "find_records", lambda *args, **kwargs: spaces)
    send = Mock()
    monkeypatch.setattr(q_lineups, "send_q_lineup_message", send)

    q_lineups.send_lineups(force=True)

    send.assert_not_called()


def test_automatic_preblast_all_option_preserves_open_q_event(query_data, monkeypatch):
    add_identities(query_data, {}, {"id": 11})
    query_data.session.query(query_data.models.Attendance).delete()
    query_data.session.query(query_data.models.SlackSpace).update(
        {"settings": {**query_data.settings, "automated_preblast_option": "all"}}
    )
    query_data.session.commit()
    send = Mock()
    monkeypatch.setattr(auto_preblast_send.event_preblast, "send_preblast", send)
    monkeypatch.setattr(auto_preblast_send, "WebClient", Mock())

    auto_preblast_send.send_automated_preblasts(force=True)

    send.assert_called_once()
    assert send.call_args.kwargs["event_instance_id"] == 1
    assert send.call_args.kwargs["region_record"].team_id == "T_DESTINATION"
