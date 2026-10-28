"""Verify package Ruff checks follow the shared workspace configuration."""

import json
import shutil
import subprocess
from pathlib import Path

import pytest

PACKAGE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PACKAGE_DIR.parents[1]


@pytest.fixture
def ruff_project(tmp_path):
    package_dir = tmp_path / PACKAGE_DIR.relative_to(REPO_DIR)
    package_dir.mkdir(parents=True)
    shutil.copy(REPO_DIR / "pyproject.toml", tmp_path)
    shutil.copy(PACKAGE_DIR / "pyproject.toml", package_dir)
    ruff = shutil.which("ruff")
    assert ruff is not None, "Ruff must be on PATH; run the package test task (uv run pytest)."
    return ruff, package_dir, tmp_path / "pyproject.toml"


def test_package_inherits_root_ruff_format_settings(ruff_project):
    ruff, package_dir, root_config = ruff_project

    def format_fixture():
        result = subprocess.run(
            [ruff, "format", "--no-cache", "--stdin-filename", "fixture.py", "-"],
            cwd=package_dir,
            input='label = "synthetic"\n',
            capture_output=True,
            text=True,
            check=False,
        )
        assert result.returncode == 0, result.stderr
        return result.stdout

    assert format_fixture() == 'label = "synthetic"\n'

    # A new shared setting must reach the package without a matching child edit.
    with root_config.open("a") as config:
        config.write('\n[tool.ruff.format]\nquote-style = "single"\n')

    assert format_fixture() == "label = 'synthetic'\n"


def test_package_inherits_root_ruff_lint_settings(ruff_project):
    ruff, package_dir, root_config = ruff_project

    def lint_fixture():
        return subprocess.run(
            [ruff, "check", "--no-cache", "--output-format", "json", "--stdin-filename", "fixture.py", "-"],
            cwd=package_dir,
            input="import sys\nimport os\n\nplatform = os.name + sys.platform\n",
            capture_output=True,
            text=True,
            check=False,
        )

    checked = lint_fixture()
    assert checked.returncode == 1, checked.stderr
    assert [diagnostic["code"] for diagnostic in json.loads(checked.stdout)] == ["I001"]

    with root_config.open("a") as config:
        config.write('\n[tool.ruff.lint.per-file-ignores]\n"fixture.py" = ["I001"]\n')

    checked = lint_fixture()
    assert checked.returncode == 0, checked.stderr
    assert json.loads(checked.stdout) == []
