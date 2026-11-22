import textwrap

from tests.shared_table_writes import SLACKBOT_DIR, UNRESOLVED, UPDATE_COMMAND, Write, compare, load_baseline, scan


def _scan_source(tmp_path, source, name="features/thing.py"):
    path = tmp_path / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(textwrap.dedent(source), encoding="utf-8")
    return scan(tmp_path)


def _tables(result, name="features/thing.py"):
    return [write.table for write in result.get(name, [])]


def test_db_manager_write_to_shared_model_is_counted(tmp_path):
    result = _scan_source(
        tmp_path,
        """
        from f3_data_models.models import EventInstance
        from f3_data_models.utils import DbManager

        def save(event_id):
            DbManager.update_record(EventInstance, event_id, {})
        """,
    )

    assert _tables(result) == ["event_instances"]
    assert result["features/thing.py"][0].line == 6


def test_tests_and_installed_packages_are_not_scanned(tmp_path):
    write = "DbManager.update_record(User, 1, {})\n"
    for name in ("tests/test_user.py", ".venv/lib/pkg.py", "node_modules/pkg/x.py", "features/user.py"):
        _scan_source(tmp_path, write, name)

    assert list(scan(tmp_path)) == ["features/user.py"]


def test_writes_to_bot_owned_tables_are_not_counted(tmp_path):
    result = _scan_source(
        tmp_path,
        """
        def save(team_id, settings):
            DbManager.update_records(cls=SlackSpace, filters=[SlackSpace.team_id == team_id], fields=settings)
            DbManager.create_record(F3versaryDeliveryRun(org_id=1))
            DbManager.update_records(cls=Org, filters=[], fields={})
        """,
    )

    assert _tables(result) == ["orgs"]


def test_unresolvable_target_is_counted(tmp_path):
    result = _scan_source(
        tmp_path,
        """
        def save(model, rows):
            DbManager.update_records(cls=model, filters=[], fields={})
            session.add(rows[2])

        def refine(session, stmt):
            stmt = stmt.where(1)
            session.execute(stmt)

        def loop(session, orgs):
            org = None
            for org in orgs:
                break
            session.delete(org)

        def default(session, record=None):
            if record is None:
                record = SlackSpace(team_id="T")
            session.add(record)

        def mixed(session, flag, unknown):
            record = SlackSpace(team_id="T")
            if flag:
                record = load_somehow()
            session.add(record)
            session.add_all([SlackSpace(team_id="T"), unknown])
        """,
    )

    assert _tables(result) == [UNRESOLVED] * 7


def test_variable_target_is_followed_to_its_assignment(tmp_path):
    result = _scan_source(
        tmp_path,
        """
        def save(user_id, email):
            record = None
            if email:
                record = session.scalars(select(User).where(User.email == email)).one()
            else:
                record = User(email=email)
            session.add(record)

            space = DbManager.find_first_record(SlackSpace, [])
            DbManager.create_record(space)

            created = SlackSpace(team_id="T1")
            created = DbManager.create_record(created)
            DbManager.update_record(created, 1, {})

            rows = [Attendance(user_id=u) for u in [user_id]]
            DbManager.create_records(rows)
        """,
    )

    assert _tables(result) == ["users", "attendance"]


def test_statement_and_query_writes_are_counted(tmp_path):
    result = _scan_source(
        tmp_path,
        """
        from f3_data_models.utils import DbManager as Db
        from sqlalchemy import insert, text, update
        from sqlalchemy.dialects.postgresql import insert as pg_insert

        def save(session, user_id, record):
            session.execute(update(User).where(User.id == user_id).values(f3_name="x"))
            statement = pg_insert(Achievement_x_User).values(user_id=user_id)
            session.execute(statement.on_conflict_do_nothing())
            session.query(Attendance).filter(Attendance.user_id == user_id).delete()
            session.delete(record)
            session.merge(Org(id=1))
            session.query(SlackSpace).filter(SlackSpace.id == 1).update({"settings": {}})
            options = {}
            options.update({"a": 1})

        def more(session, self):
            session.scalar(insert(Org).values(name="x").returning(Org.id))
            query = session.query(User).filter(User.id == 1)
            query.delete()
            DbManager.execute_sql_query("delete from users")
            self.session.add(Attendance(user_id=1))
            session.execute(text("select 1; delete from users"))
            Db.create_record(EventInstance(org_id=1))
        """,
    )

    assert _tables(result) == [
        "users",
        "achievements_x_users",
        "attendance",
        UNRESOLVED,
        "orgs",
        "orgs",
        "users",
        UNRESOLVED,
        "attendance",
        UNRESOLVED,
        "event_instances",
    ]


def test_reads_are_not_counted_but_an_untraceable_statement_is(tmp_path):
    result = _scan_source(
        tmp_path,
        """
        from sqlalchemy import func, select, text, union_all

        def load(session, statement):
            session.execute(select(User).where(User.id == 1)).all()
            query = select(Org)
            query = query.where(Org.id == 1)
            session.execute(query)
            session.execute(union_all(select(User.id), select(Org.id)))
            session.execute(select(func.pg_advisory_xact_lock(1)))
            session.execute(text("SELECT pg_advisory_xact_lock(:k)"), {"k": 1})
            session.scalars(_joinedloads(Org, query)).all()
            session.execute(text("DELETE FROM users"))
            session.execute(statement)
        """,
    )

    assert _tables(result) == [UNRESOLVED, UNRESOLVED]


def _writes(*lines):
    return [Write(line, "users") for line in lines]


def test_a_new_file_with_a_write_fails():
    messages = compare({"features/new.py": _writes(12)}, {})

    assert len(messages) == 1
    assert "features/new.py" in messages[0]
    assert "0 -> 1" in messages[0]
    assert "line 12 (users)" in messages[0]
    assert UPDATE_COMMAND in messages[0]


def test_a_rising_count_fails():
    messages = compare({"features/user.py": _writes(3, 9)}, {"features/user.py": 1})

    assert len(messages) == 1
    assert "features/user.py" in messages[0]
    assert "1 -> 2" in messages[0]
    assert UPDATE_COMMAND in messages[0]


def test_a_falling_count_without_a_baseline_update_fails():
    messages = compare({"features/user.py": _writes(3)}, {"features/user.py": 2, "features/old.py": 1})

    assert len(messages) == 2
    assert "features/old.py" in messages[0] and "1 -> 0" in messages[0]
    assert "features/user.py" in messages[1] and "2 -> 1" in messages[1]
    assert all("lower the baseline" in m and UPDATE_COMMAND in m for m in messages)


def test_counts_matching_the_baseline_pass():
    assert compare({"features/user.py": _writes(3, 9)}, {"features/user.py": 2}) == []


def test_bot_code_matches_the_committed_baseline():
    messages = compare(scan(SLACKBOT_DIR), load_baseline())

    assert messages == [], "\n".join(messages)
