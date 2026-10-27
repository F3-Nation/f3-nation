import json
import os
import subprocess
import sys
from pathlib import Path

import pytest

SLACKBOT_DIR = Path(__file__).resolve().parents[1]
SOURCE_LAYERS = ("application", "infrastructure", "utilities", "features")


def _write(project, name, contents):
    path = project / name
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(contents, encoding="utf-8")


@pytest.fixture
def project(tmp_path):
    # Exercise the real settings against synthetic inputs, without collecting
    # this suite recursively or touching its coverage data.
    _write(tmp_path, "pyproject.toml", (SLACKBOT_DIR / "pyproject.toml").read_text(encoding="utf-8"))
    (tmp_path / "tests").mkdir()
    return tmp_path


def _run_pytest(project, *args):
    # An allowlist excludes ambient credentials and pytest/coverage overrides.
    # Load only the coverage plugin explicitly when a probe needs it.
    env = {
        "PATH": os.defpath,
        "TMPDIR": str(project),
        "PYTEST_DISABLE_PLUGIN_AUTOLOAD": "1",
        "PYTHONDONTWRITEBYTECODE": "1",
        "PYTHONNOUSERSITE": "1",
    }
    return subprocess.run(
        [sys.executable, "-m", "pytest", "-q", "-c", "pyproject.toml", *args],
        cwd=project,
        env=env,
        capture_output=True,
        text=True,
        timeout=30,
        check=False,
    )


def test_default_collection_stays_in_tests(project):
    _write(project, "tests/test_inside.py", "def test_inside():\n    assert True\n")
    _write(project, "test_outside.py", "def test_outside():\n    raise AssertionError('outside testpaths')\n")

    result = _run_pytest(project)

    assert result.returncode == 0, result.stdout + result.stderr
    assert "1 passed" in result.stdout


def test_unregistered_marker_fails(project):
    _write(
        project,
        "tests/test_marker.py",
        "import pytest\n\n@pytest.mark.misspelled_marker\ndef test_probe():\n    assert True\n",
    )

    result = _run_pytest(project)

    assert result.returncode != 0, result.stdout + result.stderr
    assert "misspelled_marker" in result.stdout + result.stderr


def test_unknown_pytest_setting_fails(project):
    _write(project, "tests/test_probe.py", "def test_probe():\n    assert True\n")
    config_path = project / "pyproject.toml"
    config = config_path.read_text(encoding="utf-8")
    heading = "[tool.pytest.ini_options]\n"
    invalid_setting = "misspelled_pytest_option = true\n"
    # Corrupt only this temporary copy to exercise strict configuration parsing.
    if heading in config:
        config = config.replace(heading, heading + invalid_setting, 1)
    else:
        config += "\n" + heading + invalid_setting
    config_path.write_text(config, encoding="utf-8")

    result = _run_pytest(project)

    assert result.returncode != 0, result.stdout + result.stderr
    assert "Unknown config option: misspelled_pytest_option" in result.stdout + result.stderr


def test_empty_collection_remains_an_error(project):
    result = _run_pytest(project)

    assert result.returncode == pytest.ExitCode.NO_TESTS_COLLECTED, result.stdout + result.stderr


def test_coverage_counts_unexecuted_layers_and_enforces_floor(project):
    for layer in SOURCE_LAYERS:
        _write(project, f"{layer}/__init__.py", "")
        _write(project, f"{layer}/unexecuted.py", "value = 1\n" * 100)
    _write(project, "application/probe.py", "VALUE = 1\n")
    _write(
        project,
        "tests/test_probe.py",
        "from application.probe import VALUE\n\ndef test_probe():\n    assert VALUE == 1\n",
    )

    result = _run_pytest(
        project,
        "-p",
        "pytest_cov.plugin",
        "--cov",
        "--cov-config=pyproject.toml",
        "--cov-report=term",
        "--cov-report=json:coverage/coverage.json",
    )

    assert "1 passed" in result.stdout, result.stdout + result.stderr
    assert result.returncode != 0, result.stdout + result.stderr
    assert "Required test coverage" in result.stdout + result.stderr
    report = json.loads((project / "coverage/coverage.json").read_text(encoding="utf-8"))
    files = {}
    for name, details in report["files"].items():
        path = Path(name)
        if path.is_absolute():
            path = path.relative_to(project)
        files[path.as_posix()] = details
    for layer in SOURCE_LAYERS:
        assert files[f"{layer}/unexecuted.py"]["summary"]["covered_lines"] == 0
    assert files["application/probe.py"]["summary"]["covered_lines"] == 1
    assert all(Path(name).parts[0] in SOURCE_LAYERS for name in files)
