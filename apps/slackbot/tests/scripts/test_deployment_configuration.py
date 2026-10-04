import os
import shlex
import subprocess
from pathlib import Path

import pytest
import yaml

REPO_ROOT = Path(__file__).resolve().parents[4]
CALLER_WORKFLOW = REPO_ROOT / ".github/workflows/deploy-slackbot.yml"
OVERRIDE_FLAGS = {
    "--set-env-vars",
    "--clear-env-vars",
    "--remove-env-vars",
    "--env-vars-file",
}


def _workflow_jobs(path: Path) -> dict:
    workflow = yaml.safe_load(path.read_text())
    assert isinstance(workflow, dict)
    jobs = workflow.get("jobs")
    assert isinstance(jobs, dict)
    return jobs


def _job(jobs: dict, name: str) -> dict:
    job = jobs.get(name)
    assert isinstance(job, dict), f"Missing workflow job {name!r}"
    return job


def _deploy_action(job: dict) -> dict:
    steps = job.get("steps", [])
    step = next(
        (
            candidate
            for candidate in steps
            if candidate.get("uses", "").startswith("google-github-actions/deploy-cloudrun@")
            and "flags" in candidate.get("with", {})
        ),
        None,
    )
    assert step is not None, "Missing Cloud Run deploy action with flags"
    return step


def _flags(job: dict, key: str, environment: str) -> None:
    flags_value = job.get("with", {}).get(key)
    assert isinstance(flags_value, str), f"Missing {key!r} workflow value"
    tokens = shlex.split(flags_value)
    update_values: list[str] = []

    index = 0
    while index < len(tokens):
        token = tokens[index]
        name, separator, value = token.partition("=")
        assert name not in OVERRIDE_FLAGS, f"Unexpected environment override flag: {token}"
        if name == "--update-env-vars":
            if separator:
                update_values.append(value)
            else:
                index += 1
                assert index < len(tokens), "--update-env-vars is missing its value"
                update_values.append(tokens[index])
        index += 1

    assert len(update_values) == 1, "Expected exactly one --update-env-vars flag"
    assignments = [entry.split("=", maxsplit=1) for entry in update_values[0].split(",")]
    environment_values = [value for name, *rest in assignments if name == "SLACKBOT_ENV" for value in rest]
    assert environment_values == [environment]


def test_service_deploy_blocks_set_slackbot_environment_and_forward_flags():
    caller_jobs = _workflow_jobs(CALLER_WORKFLOW)
    caller = _job(caller_jobs, "deploy-main")
    assert caller.get("uses") == "./.github/workflows/_deploy-cloudrun.yml"
    for flag_name, environment in (("staging_flags", "staging"), ("prod_flags", "production")):
        _flags(caller, flag_name, environment)

    reusable_jobs = _workflow_jobs(REPO_ROOT / ".github/workflows/_deploy-cloudrun.yml")
    staging_action = _deploy_action(_job(reusable_jobs, "deploy-staging"))
    prod_action = _deploy_action(_job(reusable_jobs, "deploy-prod"))
    assert staging_action["with"]["flags"] == "${{ inputs.staging_flags || inputs.flags }}"
    assert prod_action["with"]["flags"] == "${{ inputs.prod_flags || inputs.flags }}"


def test_scripts_job_deploy_blocks_set_slackbot_environment_and_forward_flags():
    caller_jobs = _workflow_jobs(CALLER_WORKFLOW)
    caller = _job(caller_jobs, "deploy-scripts")
    assert caller.get("uses") == "./.github/workflows/_deploy-cloudrun-job.yml"
    for flag_name, environment in (("staging_flags", "staging"), ("prod_flags", "production")):
        _flags(caller, flag_name, environment)

    reusable_jobs = _workflow_jobs(REPO_ROOT / ".github/workflows/_deploy-cloudrun-job.yml")
    staging_step = next(
        step
        for step in _job(reusable_jobs, "deploy-staging")["steps"]
        if step.get("name") == "Deploy Cloud Run Job (staging)"
    )
    prod_step = next(
        step
        for step in _job(reusable_jobs, "deploy-prod")["steps"]
        if step.get("name") == "Deploy Cloud Run Job (prod)"
    )
    assert staging_step["env"]["FLAGS"] == "${{ inputs.staging_flags || inputs.flags }}"
    assert prod_step["env"]["FLAGS"] == "${{ inputs.prod_flags || inputs.flags }}"


@pytest.mark.parametrize(
    "flags",
    [
        "--update-env-vars=SLACKBOT_ENV=staging --set-env-vars=SLACKBOT_ENV=production",
        "--update-env-vars SLACKBOT_ENV=staging --clear-env-vars SLACKBOT_ENV",
        "--update-env-vars=SLACKBOT_ENV=staging --remove-env-vars=SLACKBOT_ENV",
        "--update-env-vars=SLACKBOT_ENV=staging --env-vars-file vars.yaml",
        "--update-env-vars=SLACKBOT_ENV=staging --other=1 --update-env-vars=SLACKBOT_ENV=staging",
    ],
)
def test_flags_reject_conflicting_or_duplicate_environment_flags(flags: str):
    with pytest.raises(AssertionError):
        _flags({"with": {"staging_flags": flags}}, "staging_flags", "staging")


@pytest.mark.parametrize(
    "target,classification,project",
    [("prod", "production", "f3-slackbot"), ("staging", "staging", "f3-slackbot-staging")],
)
def test_cloud_run_env_updates_service_and_job_classification_with_stub_gcloud(
    tmp_path: Path, target: str, classification: str, project: str
):
    source_script = REPO_ROOT / "apps/slackbot/scripts/cloud-run-env.sh"
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    script = scripts_dir / "cloud-run-env.sh"
    script.write_text(source_script.read_text())
    script.chmod(0o755)
    (tmp_path / f".env.cloud-run.{target}").write_text("# Hermetic deployment test\n")

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log_path = tmp_path / "gcloud.log"
    stub_gcloud = bin_dir / "gcloud"
    stub_gcloud.write_text(
        "#!/usr/bin/env bash\n"
        'printf \'%q \' "$@" >> "$GCLOUD_LOG"\n'
        'printf "\\n" >> "$GCLOUD_LOG"\n'
        'if [[ "$1 $2 $3" == "projects describe"* ]]; then printf "123456\\n"; fi\n'
        'if [[ "$1 $2 $3 $4" == "run jobs describe f3-slackbot-scripts"* ]]; then\n'
        '  printf "f3-slackbot-scripts\\n"\n'
        "fi\n"
        "exit 0\n"
    )
    stub_gcloud.chmod(0o755)

    env = os.environ.copy()
    env["PATH"] = f"{bin_dir}{os.pathsep}{env['PATH']}"
    env["GCLOUD_LOG"] = str(log_path)
    subprocess.run([str(script), "--env", target], check=True, capture_output=True, text=True, env=env)

    calls = [shlex.split(line) for line in log_path.read_text().splitlines()]
    update_calls = [call for call in calls if call[:3] in (["run", "services", "update"], ["run", "jobs", "update"])]
    assert len(update_calls) == 2
    for call in update_calls:
        assert call[call.index("--project") + 1] == project
        env_arg = call[call.index("--update-env-vars") + 1]
        assert env_arg.startswith("^__F3_ENV_DELIM__^")
        env_assignments = [part.lstrip("^") for part in env_arg.split("__F3_ENV_DELIM__")]
        assert env_assignments.count(f"SLACKBOT_ENV={classification}") == 1
