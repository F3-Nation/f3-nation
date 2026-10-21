"""Verify package formatting follows the shared workspace configuration."""

import shutil
import subprocess
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PACKAGE_DIR.parents[1]


def test_package_inherits_root_ruff_format_settings(tmp_path):
    package_dir = tmp_path / "packages" / "db-python"
    package_dir.mkdir(parents=True)
    shutil.copy(REPO_DIR / "pyproject.toml", tmp_path)
    shutil.copy(PACKAGE_DIR / "pyproject.toml", package_dir)
    ruff = shutil.which("ruff")
    assert ruff is not None, "Ruff must be on PATH; run the package test task (uv run pytest)."

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
    with (tmp_path / "pyproject.toml").open("a") as root_config:
        root_config.write('\n[tool.ruff.format]\nquote-style = "single"\n')

    assert format_fixture() == "label = 'synthetic'\n"
