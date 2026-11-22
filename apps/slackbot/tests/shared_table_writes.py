"""Find the bot's direct database writes to shared F3 tables.

The bot is moving every write to shared F3 data onto the F3 API (see
docs/API_MIGRATION.md). This module reads the bot's non-test code with `ast`
and lists each call that writes a table outside BOT_OWNED_TABLES and
BOT_OWNED_SCHEMA. The per-file counts are committed in
shared_table_writes_baseline.json, which is the list of writes still to move.

A write is a DbManager write helper or execute_sql_query,
session.add/add_all/delete/merge, session.execute of an insert/update/delete
statement (or of raw SQL that isn't a single SELECT), session.scalar/scalars
of an insert/update/delete statement, or session.query(...).update()/
.delete(). Its table comes from the model named in the call, directly or
through every value assigned to a variable in the same function. A target
that can't be told statically counts as a shared write.

The baseline holds counts, not sites, so a change that moves one write to
the API and adds another in the same file keeps the count and passes.
Changing an attribute on a loaded record and committing writes the database
without any of these calls, so it isn't detected.

Run from apps/slackbot to check the code (exits 1 on a mismatch), or add
--write-baseline to rewrite the baseline:

    uv run python -m tests.shared_table_writes [--write-baseline]
"""

import argparse
import ast
import json
from dataclasses import dataclass
from pathlib import Path

import f3_data_models.models as models

from utilities.constants import BOT_OWNED_SCHEMA, BOT_OWNED_TABLES

SLACKBOT_DIR = Path(__file__).resolve().parents[1]
BASELINE_PATH = Path(__file__).with_name("shared_table_writes_baseline.json")
UPDATE_COMMAND = "uv run python -m tests.shared_table_writes --write-baseline"

UNRESOLVED = "<unresolved>"
SKIPPED_DIRS = frozenset({"tests", "node_modules"})
NOT_A_WRITE = object()

DB_MANAGER_WRITES = frozenset(
    {
        "create_record",
        "create_records",
        "update_record",
        "update_records",
        "delete_record",
        "delete_records",
        "create_or_ignore",
        "upsert_records",
    }
)
SESSION_OBJECT_WRITES = frozenset({"add", "add_all", "delete", "merge"})
QUERY_BULK_WRITES = frozenset({"update", "delete"})
WRITE_STATEMENTS = frozenset({"insert", "update", "delete"})
READ_STATEMENTS = frozenset({"select", "union", "union_all", "intersect", "except_", "exists"})
# Calls whose first argument names the model of the rows they return.
MODEL_QUERIES = frozenset({"select", "query"})


@dataclass(frozen=True)
class Write:
    line: int
    table: str


def _model_tables():
    tables = {}
    for name, value in vars(models).items():
        table = getattr(value, "__table__", None)
        if isinstance(value, type) and table is not None:
            tables[name] = table
    return tables


MODEL_TABLES = _model_tables()


def _is_bot_owned(table):
    return table.schema == BOT_OWNED_SCHEMA or (table.schema is None and table.name in BOT_OWNED_TABLES)


def _table_name(table):
    return f"{table.schema}.{table.name}" if table.schema else table.name


def _call_name(call):
    func = call.func
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


# Stands in for a value bound some way the resolver can't follow (a parameter,
# a loop target, tuple unpacking), so the variable resolves as unknown.
_UNKNOWN_VALUE = ast.Constant(value=...)


def _assignments(scope):
    """Map each variable name in a function to every value bound to it."""
    values = {}

    def bind(target, value):
        # `stmt, n = insert(User), 1` pairs each name with its own value.
        if (
            isinstance(target, (ast.Tuple, ast.List))
            and isinstance(value, (ast.Tuple, ast.List))
            and len(target.elts) == len(value.elts)
            and not any(isinstance(elt, ast.Starred) for elt in [*target.elts, *value.elts])
        ):
            for sub_target, sub_value in zip(target.elts, value.elts, strict=True):
                bind(sub_target, sub_value)
            return
        for name in ast.walk(target):
            if isinstance(name, ast.Name):
                simple = isinstance(target, ast.Name) and value is not None
                values.setdefault(name.id, []).append(value if simple else _UNKNOWN_VALUE)

    if isinstance(scope, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)):
        args = scope.args
        for arg in [*args.posonlyargs, *args.args, *args.kwonlyargs, args.vararg, args.kwarg]:
            if arg is not None:
                values.setdefault(arg.arg, []).append(_UNKNOWN_VALUE)
    for node in ast.walk(scope):
        if isinstance(node, ast.Assign):
            for target in node.targets:
                bind(target, node.value)
        elif isinstance(node, ast.AnnAssign):
            bind(node.target, node.value)
        elif isinstance(node, (ast.AugAssign, ast.For, ast.AsyncFor, ast.comprehension)):
            bind(node.target, None)
        elif isinstance(node, ast.NamedExpr):
            bind(node.target, node.value)
        elif isinstance(node, ast.withitem) and node.optional_vars is not None:
            bind(node.optional_vars, None)
        elif isinstance(node, ast.ExceptHandler) and node.name:
            values.setdefault(node.name, []).append(_UNKNOWN_VALUE)
    return values


class _Resolver:
    """Work out statically which tables an expression writes to.

    Each method returns a set of tables, an empty set for an expression that
    writes nothing (a read, or None), or None when it can't be told.
    """

    def __init__(self, assignments, aliases):
        self.assignments = assignments
        self.aliases = aliases
        self.visiting = set()
        self.looped = set()

    def tables(self, node):
        """Tables of the rows an expression evaluates to."""
        if node is None:
            return None
        if isinstance(node, ast.Constant) and node.value is None:
            return set()
        if isinstance(node, ast.Name):
            if node.id in MODEL_TABLES:
                return {MODEL_TABLES[node.id]}
            return self._variable(node.id, self.tables)
        if isinstance(node, (ast.List, ast.Tuple, ast.Set)):
            return self._all(node.elts)
        if isinstance(node, (ast.ListComp, ast.SetComp, ast.GeneratorExp)):
            return self.tables(node.elt)
        if isinstance(node, ast.Call):
            return self._call(node)
        return None

    def _all(self, nodes, resolve=None):
        resolve = resolve or self.tables
        found = set()
        for node in nodes:
            tables = resolve(node)
            if tables is None:
                return None
            found |= tables
        return found

    def _variable(self, name, resolve):
        values = self.assignments.get(name)
        if not values:
            return None
        # `query = query.where(...)` refers back to the variable's other assignments,
        # so it resolves only when some assignment resolves without looping back.
        if name in self.visiting:
            self.looped.add(name)
            return set()
        self.visiting.add(name)
        try:
            found, seeded = set(), False
            for value in values:
                self.looped.discard(name)
                tables = resolve(value)
                if tables is None:
                    return None
                found |= tables
                seeded = seeded or name not in self.looped
            return found if seeded else None
        finally:
            self.visiting.discard(name)
            self.looped.discard(name)

    def is_write_statement(self, node):
        """Whether a statement is an insert/update/delete, whatever its target."""
        if isinstance(node, ast.Name):
            if node.id in self.visiting:
                return False
            self.visiting.add(node.id)
            try:
                return any(self.is_write_statement(value) for value in self.assignments.get(node.id, []))
            finally:
                self.visiting.discard(node.id)
        if not isinstance(node, ast.Call):
            return False
        func = node.func
        if isinstance(func, ast.Name):
            return self.aliases.get(func.id, func.id) in WRITE_STATEMENTS
        if isinstance(func, ast.Attribute) and isinstance(func.value, (ast.Call, ast.Name)):
            return self.is_write_statement(func.value)
        return False

    def all_tables(self, nodes):
        return self._all(nodes)

    def statement(self, node):
        """Tables a statement passed to session.execute writes to."""
        if _is_select_sql(node):
            return set()
        if isinstance(node, ast.Name):
            return self._variable(node.id, self.statement)
        if not isinstance(node, ast.Call):
            return None
        func = node.func
        if isinstance(func, ast.Name):
            name = self.aliases.get(func.id, func.id)
            if name in WRITE_STATEMENTS:
                return self.tables(node.args[0]) if node.args else None
            if name in READ_STATEMENTS:
                return set()
            if name == "text":
                return set() if node.args and _is_select_sql(node.args[0]) else None
            return None
        # insert(X).values(...).on_conflict_do_nothing() and select(X).where(...) keep their kind.
        if isinstance(func, ast.Attribute) and isinstance(func.value, (ast.Call, ast.Name)):
            return self.statement(func.value)
        return None

    def _call(self, call):
        name = _call_name(call)
        if name in MODEL_TABLES:
            return {MODEL_TABLES[name]}
        # DbManager.create_record(record) returns the record it saved.
        if name in DB_MANAGER_WRITES:
            return self.tables(_db_manager_target(call))
        if name in MODEL_QUERIES or (name or "").startswith("find_"):
            return self.tables(call.args[0]) if call.args else None
        if isinstance(call.func, ast.Attribute):
            receiver = call.func.value
            # session.scalars(select(X)) / session.execute(select(X)) return X rows.
            if name in {"scalars", "scalar", "execute"} and call.args:
                return self.tables(call.args[0])
            # select(X).where(...).first() and similar chains keep X.
            if isinstance(receiver, ast.Call):
                return self.tables(receiver)
        return None


def _is_select_sql(node):
    """Whether a string literal is a single SELECT statement."""
    if not isinstance(node, ast.Constant) or not isinstance(node.value, str):
        return False
    sql = node.value.strip().rstrip(";")
    words = sql.split()
    return bool(words) and words[0].lower() == "select" and ";" not in sql


def _query_targets(node, assignments, visiting=frozenset()):
    """Return the models a session.query(X)... chain, or a variable holding one, can target.

    None means the expression isn't traced to any session.query (dict.update()
    stays a non-write). Otherwise every model found is listed, plus
    _UNKNOWN_VALUE when some other assignment can't be traced.
    """
    while isinstance(node, ast.Call) and isinstance(node.func, ast.Attribute):
        if node.func.attr == "query" and _is_session(node.func.value):
            return [node.args[0] if node.args else _UNKNOWN_VALUE]
        node = node.func.value
    if not isinstance(node, ast.Name):
        return None
    if node.id in visiting:
        return []
    found, unknown = [], False
    for value in assignments.get(node.id, []):
        targets = _query_targets(value, assignments, visiting | {node.id})
        if targets is None:
            unknown = True
        else:
            found.extend(targets)
    if not found:
        return None
    return [*found, _UNKNOWN_VALUE] if unknown else found


def _db_manager_target(call):
    for keyword in call.keywords:
        if keyword.arg in {"cls", "record", "records"}:
            return keyword.value
    return call.args[0] if call.args else None


def _written_tables(call, resolver):
    """Return the tables a call writes, None when it writes something unresolvable, or NOT_A_WRITE."""
    func = call.func
    if not isinstance(func, ast.Attribute):
        return NOT_A_WRITE
    receiver = func.value
    if isinstance(receiver, ast.Name) and resolver.aliases.get(receiver.id, receiver.id) == "DbManager":
        if func.attr in DB_MANAGER_WRITES:
            return resolver.tables(_db_manager_target(call))
        # execute_sql_query runs any statement and commits it.
        if func.attr == "execute_sql_query":
            return resolver.statement(call.args[0]) if call.args else None
    if _is_session(receiver):
        if func.attr in SESSION_OBJECT_WRITES:
            return resolver.tables(call.args[0]) if call.args else None
        if func.attr == "execute":
            return resolver.statement(call.args[0]) if call.args else None
        # scalar/scalars almost always read rows, so only an insert/update/delete
        # statement (insert(...).returning(...)) counts, traced or not.
        if func.attr in {"scalar", "scalars"} and call.args:
            tables = resolver.statement(call.args[0])
            if tables is None and resolver.is_write_statement(call.args[0]):
                return None
            return tables or NOT_A_WRITE
    if func.attr in QUERY_BULK_WRITES:
        targets = _query_targets(receiver, resolver.assignments)
        if targets is not None:
            return resolver.all_tables(targets)
    return NOT_A_WRITE


def _is_session(node):
    """Match `session`, `db_session`, `self.session` and similar receivers."""
    if isinstance(node, ast.Name):
        return "session" in node.id.lower()
    return isinstance(node, ast.Attribute) and "session" in node.attr.lower()


def _shared_label(tables):
    if tables is None:
        return UNRESOLVED
    shared = sorted(_table_name(t) for t in tables if not _is_bot_owned(t))
    return ", ".join(shared) or None


def _writes_in_scope(scope, calls, aliases):
    resolver = _Resolver(_assignments(scope), aliases)
    for call in calls:
        tables = _written_tables(call, resolver)
        if tables is NOT_A_WRITE:
            continue
        label = _shared_label(tables)
        if label is not None:
            yield Write(call.lineno, label)


def _import_aliases(tree):
    """Map local names to the SQLAlchemy and f3_data_models names they import, e.g. pg_insert -> insert."""
    aliases = {}
    for node in ast.walk(tree):
        if isinstance(node, ast.ImportFrom) and (node.module or "").startswith(("sqlalchemy", "f3_data_models")):
            for alias in node.names:
                aliases[alias.asname or alias.name] = alias.name
    return aliases


def _calls_by_scope(tree):
    """Group each call under the innermost function (or module) that contains it."""
    groups = {}

    def visit(node, scope):
        for child in ast.iter_child_nodes(node):
            child_scope = child if isinstance(child, (ast.FunctionDef, ast.AsyncFunctionDef, ast.Lambda)) else scope
            if isinstance(child, ast.Call):
                groups.setdefault(child_scope, []).append(child)
            visit(child, child_scope)

    visit(tree, tree)
    return groups


def scan(root):
    root = Path(root)
    result = {}
    for path in sorted(root.rglob("*.py")):
        parts = path.relative_to(root).parts
        if any(part in SKIPPED_DIRS for part in parts[:-1]) or any(part.startswith(".") for part in parts):
            continue
        rel = "/".join(parts)
        tree = ast.parse(path.read_text(encoding="utf-8"))
        aliases = _import_aliases(tree)
        writes = []
        for scope, calls in _calls_by_scope(tree).items():
            writes.extend(_writes_in_scope(scope, calls, aliases))
        if writes:
            result[rel] = sorted(writes, key=lambda w: w.line)
    return result


def counts(result):
    return {path: len(writes) for path, writes in sorted(result.items())}


def compare(result, baseline):
    """Return one message per file whose write count differs from the baseline."""
    current = counts(result)
    messages = []
    for path in sorted(set(current) | set(baseline)):
        before, after = baseline.get(path, 0), current.get(path, 0)
        if before == after:
            continue
        sites = ", ".join(f"line {w.line} ({w.table})" for w in result.get(path, []))
        if after > before:
            message = (
                f"{path}: direct writes to shared tables went from {before} -> {after}. "
                "Write shared F3 data through the F3 API instead (docs/API_MIGRATION.md). "
                "If a bot-owned table is being counted, check BOT_OWNED_TABLES in utilities/constants.py."
            )
        else:
            message = (
                f"{path}: direct writes to shared tables went from {before} -> {after}. "
                "Good progress: lower the baseline so it doesn't overstate what's left."
            )
        if sites:
            message += f" Current writes: {sites}."
        messages.append(f"{message} To update the baseline, run from apps/slackbot: {UPDATE_COMMAND}")
    return messages


def load_baseline(path=BASELINE_PATH):
    return json.loads(path.read_text(encoding="utf-8"))


def write_baseline(path=BASELINE_PATH, root=SLACKBOT_DIR):
    path.write_text(json.dumps(counts(scan(root)), indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__, formatter_class=argparse.RawDescriptionHelpFormatter)
    parser.add_argument("--write-baseline", action="store_true", help=f"rewrite {BASELINE_PATH.name}")
    if parser.parse_args().write_baseline:
        write_baseline()
    else:
        messages = compare(scan(SLACKBOT_DIR), load_baseline())
        print("\n".join(messages) or "Baseline matches the code.")
        raise SystemExit(1 if messages else 0)
