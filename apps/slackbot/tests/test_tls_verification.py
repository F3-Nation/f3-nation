"""Guard against disabling SSL-context certificate and hostname checks to protect credentials."""

import ast
from pathlib import Path

import pytest

APP_ROOT = Path(__file__).resolve().parents[1]
SOURCE_DIRS = ("application", "features", "infrastructure", "scripts", "utilities")


def _source_files():
    files = [APP_ROOT / "main.py"]
    for directory in SOURCE_DIRS:
        files.extend(sorted((APP_ROOT / directory).rglob("*.py")))
    return files


def _disables_verification(node: ast.AST) -> bool:
    if not isinstance(node, ast.Assign):
        return False
    for target in node.targets:
        if not isinstance(target, ast.Attribute):
            continue
        if target.attr == "check_hostname" and isinstance(node.value, ast.Constant) and node.value.value is False:
            return True
        if (
            target.attr == "verify_mode"
            and isinstance(node.value, ast.Attribute)
            and node.value.attr in ("CERT_NONE", "CERT_OPTIONAL")
        ):
            return True
    return False


@pytest.mark.parametrize("path", _source_files(), ids=lambda path: str(path.relative_to(APP_ROOT)))
def test_source_does_not_disable_tls_verification(path):
    tree = ast.parse(path.read_text(), filename=str(path))
    offenders = [node.lineno for node in ast.walk(tree) if _disables_verification(node)]
    assert offenders == [], f"{path.relative_to(APP_ROOT)} disables TLS verification at lines {offenders}"


def test_detector_flags_disabled_verification():
    tree = ast.parse("ctx.check_hostname = False\nctx.verify_mode = ssl.CERT_NONE\n")
    assert [node.lineno for node in ast.walk(tree) if _disables_verification(node)] == [1, 2]
