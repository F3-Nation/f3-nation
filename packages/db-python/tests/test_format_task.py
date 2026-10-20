"""Verify the package format task checks and fixes Python files."""

import json
import shlex
import shutil
import subprocess
import sys
from pathlib import Path

PACKAGE_DIR = Path(__file__).resolve().parents[1]
REPO_DIR = PACKAGE_DIR.parents[1]


def test_format_task_checks_then_fixes_python(tmp_path):
    package_dir = tmp_path / "packages" / "db-python"
    (package_dir / "scripts").mkdir(parents=True)
    (tmp_path / "scripts").mkdir()
    shutil.copy(PACKAGE_DIR / "package.json", package_dir)
    shutil.copy(PACKAGE_DIR / "scripts" / "format.sh", package_dir / "scripts")
    shutil.copy(REPO_DIR / "scripts" / "python-task.sh", tmp_path / "scripts")
    command = shlex.split(json.loads((package_dir / "package.json").read_text())["scripts"]["format"])

    # Keep the real task entrypoint and formatter, replacing only uv's environment
    # bootstrap so this synthetic project needs no downloads or dependency install.
    ruff = shutil.which("ruff")
    assert ruff is not None
    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    for executable in ("bash", "grep"):
        path = shutil.which(executable)
        assert path is not None
        (bin_dir / executable).symlink_to(path)
    uv = bin_dir / "uv"
    uv.write_text(
        f"#!{sys.executable}\n"
        "import os, sys\n"
        "assert sys.argv[1:3] == ['run', 'ruff']\n"
        f"os.execv({ruff!r}, [{ruff!r}, *sys.argv[3:]])\n"
    )
    uv.chmod(0o755)
    environment = {"PATH": str(bin_dir), "HOME": str(tmp_path)}

    def run_format(*arguments):
        return subprocess.run(
            [*command, *arguments], cwd=package_dir, env=environment, capture_output=True, text=True, check=False
        )

    source = package_dir / "fixture.py"
    original = "numbers=[1,2,3]\n"
    source.write_text(original)

    assert run_format().returncode == 1
    assert source.read_text() == original

    fixed = run_format("--write", "--cache", "--cache-location", "cache-path")
    assert fixed.returncode == 0, fixed.stderr
    assert source.read_text() == "numbers = [1, 2, 3]\n"
    checked = run_format()
    assert checked.returncode == 0, checked.stderr
