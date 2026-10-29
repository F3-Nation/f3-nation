import os
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
WORKFLOW = REPO_ROOT / ".github/workflows/ci.yml"
SCRIPTS_IMAGE = {"app": "slackbot-scripts", "dockerfile": "apps/slackbot/scripts/Dockerfile"}
EXISTING_IMAGES = {"admin", "api", "auth", "map", "me", "region-pages", "slackbot"}


@pytest.fixture
def workflow():
    return yaml.safe_load(WORKFLOW.read_text())


def _images(job: dict) -> list[dict]:
    matrix = job["strategy"]["matrix"]
    if "include" in matrix:
        return matrix["include"]
    return [{"app": app, "dockerfile": f"apps/{app}/Dockerfile"} for app in matrix["app"]]


def _build_steps(job: dict) -> list[dict]:
    return [step for step in job["steps"] if step.get("uses", "").startswith("docker/build-push-action@")]


@pytest.mark.parametrize("job_name", ["docker-build", "docker-cache-refresh"])
def test_scripts_image_has_its_own_matrix_entry_and_cache_identity(workflow: dict, job_name: str):
    images = _images(workflow["jobs"][job_name])
    assert images.count(SCRIPTS_IMAGE) == 1
    apps = [image["app"] for image in images]
    assert len(apps) == len(set(apps)), "Images must not overwrite each other's cache"
    expected_apps = EXISTING_IMAGES | {"slackbot-scripts"}
    if job_name == "docker-build":
        expected_apps |= {"analytics"}
    assert set(apps) == expected_apps
    for image in images:
        assert (REPO_ROOT / image["dockerfile"]).is_file()
        if image != SCRIPTS_IMAGE:
            assert image["dockerfile"] == f"apps/{image['app']}/Dockerfile"


@pytest.mark.parametrize("job_name", ["docker-build", "docker-cache-refresh"])
def test_every_build_path_uses_selected_dockerfile_and_root_context(workflow: dict, job_name: str):
    job = workflow["jobs"][job_name]
    builds = _build_steps(job)
    assert len(builds) == (3 if job_name == "docker-build" else 4)
    for step in builds:
        arguments = step["with"]
        assert arguments["context"] == "."
        assert arguments["file"] == "${{ matrix.dockerfile }}"
        assert arguments["platforms"] == "linux/amd64"
        assert arguments["push"] is False


def test_pr_validation_runs_for_scripts_changes_without_registry_write_access(workflow: dict):
    # PyYAML's YAML 1.1 loader treats the GitHub Actions key `on` as True.
    events = workflow[True]
    assert events["pull_request"]["branches"] == ["**"]
    assert {"opened", "synchronize", "reopened"} <= set(events["pull_request"]["types"])
    assert "paths" not in events["pull_request"]
    assert "paths-ignore" not in events["pull_request"]
    job = workflow["jobs"]["docker-build"]
    assert job["if"] == "github.event_name == 'pull_request'"
    assert job["permissions"] == {"contents": "read", "packages": "read"}
    for step in _build_steps(job):
        assert "cache-to" not in step["with"]


def test_pr_cache_failures_still_require_a_successful_image_build(workflow: dict):
    builds = _build_steps(workflow["jobs"]["docker-build"])
    cached = next(step for step in builds if "cache-from" in step["with"])
    assert cached["id"] == "build"
    assert cached["if"] == "steps.login.outcome == 'success'"
    assert cached["continue-on-error"] is True
    fallbacks = [step for step in builds if step is not cached]
    assert {step["if"] for step in fallbacks} == {
        "steps.login.outcome == 'failure'",
        "steps.login.outcome == 'success' && steps.build.outcome == 'failure'",
    }
    for step in fallbacks:
        assert not step.get("continue-on-error", False)
        assert "cache-from" not in step["with"]


@pytest.mark.parametrize("job_name", ["docker-build", "docker-cache-refresh"])
def test_cache_references_keep_existing_names_and_separate_scripts(workflow: dict, job_name: str, tmp_path: Path):
    job = workflow["jobs"][job_name]
    cache_step = next(step for step in job["steps"] if step.get("id") == "cache")
    assert cache_step["env"]["APP"] == "${{ matrix.app }}"
    cache_references = []
    for image in _images(job):
        output = tmp_path / image["app"]
        result = subprocess.run(
            ["bash", "-e", "-c", cache_step["run"]],
            capture_output=True,
            text=True,
            env={
                "PATH": os.environ["PATH"],
                "APP": image["app"],
                "GITHUB_REPOSITORY_OWNER": "F3-Nation",
                "GITHUB_REPOSITORY": "F3-Nation/F3-Nation",
                "GITHUB_OUTPUT": str(output),
            },
        )
        assert result.returncode == 0, result.stdout + result.stderr
        reference = output.read_text().strip()
        assert reference == f"ref=ghcr.io/f3-nation/f3-nation-ci-cache-{image['app']}"
        cache_references.append(reference)
    assert len(cache_references) == len(set(cache_references))


def test_cache_writer_remains_main_only_with_uncached_validation_fallback(workflow: dict):
    assert workflow[True]["push"]["branches"] == ["main"]
    job = workflow["jobs"]["docker-cache-refresh"]
    assert job["if"] == "github.event_name == 'push'"
    assert job["permissions"] == {"contents": "read", "packages": "write"}
    builds = _build_steps(job)
    exporters = [step for step in builds if "cache-to" in step["with"]]
    assert len(exporters) == 2
    for step in exporters:
        assert step["continue-on-error"] is True
        assert step["with"]["cache-to"].startswith("type=registry,ref=${{ steps.cache.outputs.ref }},")
    for step in builds:
        if step not in exporters:
            assert not step.get("continue-on-error", False)
    final = next(step for step in builds if "steps.repair.outcome == 'failure'" in step["if"])
    assert not final.get("continue-on-error", False)
    assert "cache-from" not in final["with"]
    assert "cache-to" not in final["with"]
