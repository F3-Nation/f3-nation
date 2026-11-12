"""No Slackbot code outside the token module reads or handles a Slack token.

With token rotation on, a token copied out of `utilities/slack_tokens` goes
stale within hours. Features that need a client get one from
`slack_client_for_team`.
"""

import ast
from pathlib import Path

ROOT = Path(__file__).resolve().parents[1]
EXCLUDED_DIRS = {"tests", ".venv", "node_modules", "build", "coverage", "__pycache__"}
EXCLUDED_PREFIXES = ("utilities/slack_tokens/",)
EXCLUDED_FILES = {
    "scripts/convert_slack_tokens.py",
    "scripts/import_slack_installations.py",
    "scripts/rekey_slack_tokens.py",
}
# The settings field is removed together with the settings-JSON token copy.
ALLOWED = {("utilities/database/orm/__init__.py", "bot_token")}
TOKEN_NAMES = {"bot_token", "bot_refresh_token", "bot_refresh_token_encrypted"}
TOKEN_CALLS = {"get_bot_token", "decrypt_refresh_token"}


def _source_files():
    for path in ROOT.rglob("*.py"):
        rel = path.relative_to(ROOT).as_posix()
        if EXCLUDED_DIRS & set(path.relative_to(ROOT).parts[:-1]):
            continue
        if rel.startswith(EXCLUDED_PREFIXES) or rel in EXCLUDED_FILES:
            continue
        yield path, rel


def _called_name(node: ast.Call):
    func = node.func
    return func.id if isinstance(func, ast.Name) else func.attr if isinstance(func, ast.Attribute) else None


def _violations():
    found = []
    for path, rel in _source_files():
        tree = ast.parse(path.read_text(encoding="utf-8"), filename=rel)
        for node in ast.walk(tree):
            if isinstance(node, ast.Attribute) and node.attr in TOKEN_NAMES:
                name = node.attr
            elif isinstance(node, ast.Constant) and isinstance(node.value, str) and node.value in TOKEN_NAMES:
                name = node.value
            elif isinstance(node, ast.Call) and _called_name(node) in TOKEN_CALLS:
                name = _called_name(node)
            elif (
                isinstance(node, ast.AnnAssign) and isinstance(node.target, ast.Name) and node.target.id in TOKEN_NAMES
            ):
                name = node.target.id
            else:
                continue
            if (rel, name) in ALLOWED and isinstance(node, ast.AnnAssign):
                continue
            found.append(f"{rel}:{node.lineno} {name}")
    return sorted(found)


def test_scan_covers_features_and_scripts():
    scanned = {rel for _, rel in _source_files()}
    assert "features/downrange.py" in scanned
    assert any(rel.startswith("scripts/") for rel in scanned)


def test_no_token_access_outside_token_module():
    assert _violations() == []
