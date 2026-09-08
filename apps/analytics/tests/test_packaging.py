from __future__ import annotations

import os
import subprocess
import sys
import zipfile
from pathlib import Path


def test_wheel_contains_sql_resources_and_reads_them(tmp_path):
    project = Path(__file__).parents[1]
    wheel_dir = tmp_path / "wheel"
    extracted_dir = tmp_path / "installed"

    subprocess.run(
        ["uv", "build", "--wheel", "--out-dir", str(wheel_dir)],
        cwd=project,
        check=True,
        capture_output=True,
        text=True,
    )

    wheels = list(wheel_dir.glob("*.whl"))
    assert len(wheels) == 1
    with zipfile.ZipFile(wheels[0]) as wheel:
        sql_members = {name for name in wheel.namelist() if name.startswith("analytics/sql/")}
        expected = {f"analytics/sql/{path.name}" for path in (project / "analytics" / "sql").glob("*.sql")}
        assert sql_members == expected
        wheel.extractall(extracted_dir)

    environment = os.environ | {"PYTHONPATH": str(extracted_dir)}
    subprocess.run(
        [
            sys.executable,
            "-c",
            (
                "from importlib.resources import files; "
                "assert files('analytics').joinpath('sql/pv_regions.sql').read_text()"
            ),
        ],
        cwd=tmp_path,
        env=environment,
        check=True,
    )
