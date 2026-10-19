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


def _run_cloud_run_env(tmp_path: Path, target: str, contents: str, secret_exists: bool, legacy_state: str = "absent"):
    source_script = REPO_ROOT / "apps/slackbot/scripts/cloud-run-env.sh"
    scripts_dir = tmp_path / "scripts"
    scripts_dir.mkdir()
    script = scripts_dir / "cloud-run-env.sh"
    script.write_text(source_script.read_text())
    script.chmod(0o755)
    (tmp_path / f".env.cloud-run.{target}").write_text(contents)

    bin_dir = tmp_path / "bin"
    bin_dir.mkdir()
    log_path = tmp_path / "gcloud.log"
    secret_input_path = tmp_path / "secret-input"
    secret_state_path = tmp_path / "email-server-secret"
    if secret_exists:
        secret_state_path.write_text("previous-synthetic-value")
    stub_gcloud = bin_dir / "gcloud"
    stub_gcloud.write_text(
        "#!/usr/bin/env bash\n"
        'printf \'%q \' "$@" >> "$GCLOUD_LOG"\n'
        'printf "\\n" >> "$GCLOUD_LOG"\n'
        'if [[ "$1 $2 $3" == "secrets describe sendgrid-api-key" ]]; then\n'
        '  case "$GCLOUD_LEGACY_SECRET_STATE" in\n'
        '    absent) printf "WARNING: Synthetic diagnostic before status.\\n'
        "ERROR: (gcloud.secrets.describe) NOT_FOUND: "
        'Secret [projects/synthetic/secrets/sendgrid-api-key] not found.\\n" >&2; exit 1 ;;\n'
        '    lookup-denied) printf "ERROR: (gcloud.secrets.describe) PERMISSION_DENIED: '
        'Permission denied; diagnostic mentions NOT_FOUND: only; synthetic-private-diagnostic.\\n" >&2; exit 1 ;;\n'
        '    lookup-unavailable) printf "ERROR: (gcloud.secrets.describe) UNAVAILABLE: '
        'Retry failed; diagnostic mentions NOT_FOUND: only; synthetic-private-diagnostic.\\n" >&2; exit 1 ;;\n'
        '    lookup-unknown) printf "ERROR: (gcloud.secrets.describe) SYNTHETIC_FAILURE: '
        'synthetic-private-diagnostic.\\n" >&2; exit 1 ;;\n'
        '    lookup-unanchored) printf "Synthetic diagnostic quotes '
        'ERROR: (gcloud.secrets.describe) PERMISSION_DENIED: synthetic-private-diagnostic.\\n" >&2; exit 1 ;;\n'
        '    *) printf "projects/synthetic/secrets/sendgrid-api-key\\n"; exit 0 ;;\n'
        "  esac\n"
        "fi\n"
        'if [[ "$1 $2 $3" == "secrets add-iam-policy-binding sendgrid-api-key" ]]; then\n'
        '  if [[ "$GCLOUD_LEGACY_SECRET_STATE" == "grant-denied" ]]; then\n'
        '    printf "PERMISSION_DENIED: legacy grant rejected\\n" >&2; exit 1\n'
        "  fi\n"
        "  exit 0\n"
        "fi\n"
        'if [[ "$1 $2 $3" == "secrets describe email-server" ]]; then\n'
        '  test -f "$GCLOUD_EMAIL_SECRET_STATE"; exit $?\n'
        "fi\n"
        'if [[ "$1 $2 $3" == "secrets create email-server" ]]; then\n'
        '  touch "$GCLOUD_EMAIL_SECRET_STATE"; exit 0\n'
        "fi\n"
        'if [[ "$1 $2 $3" == "secrets add-iam-policy-binding email-server" ]]; then\n'
        '  test -f "$GCLOUD_EMAIL_SECRET_STATE"; exit $?\n'
        "fi\n"
        'if [[ "$1 $2 $3 $4 $5" == "secrets versions access latest --secret=email-server" ]]; then\n'
        '  cat "$GCLOUD_EMAIL_SECRET_STATE"; exit $?\n'
        "fi\n"
        'if [[ "$1 $2 $3 $4" == "secrets versions add email-server" ]]; then\n'
        '  cat > "$GCLOUD_SECRET_INPUT"\n'
        '  cp "$GCLOUD_SECRET_INPUT" "$GCLOUD_EMAIL_SECRET_STATE"\n'
        "fi\n"
        'if [[ "$1 $2 $3" == "projects describe"* ]]; then printf "123456\\n"; fi\n'
        'if [[ "$1 $2 $3 $4" == "run services describe f3-slackbot" ]]; then\n'
        '  printf "service-runtime@example.test\\n"\n'
        "fi\n"
        'if [[ "$1 $2 $3 $4" == "run jobs describe f3-slackbot-scripts"* ]]; then\n'
        '  if [[ "$*" == *"--format=value(name)"* ]]; then\n'
        '    printf "f3-slackbot-scripts\\n"\n'
        "  else\n"
        '    printf "job-runtime@example.test\\n"\n'
        "  fi\n"
        "fi\n"
        "exit 0\n"
    )
    stub_gcloud.chmod(0o755)

    env = {
        "PATH": f"{bin_dir}{os.pathsep}{os.environ['PATH']}",
        "GCLOUD_LOG": str(log_path),
        "GCLOUD_SECRET_INPUT": str(secret_input_path),
        "GCLOUD_EMAIL_SECRET_STATE": str(secret_state_path),
        "GCLOUD_LEGACY_SECRET_STATE": legacy_state,
    }
    result = subprocess.run([str(script), "--env", target], capture_output=True, text=True, env=env)

    calls = [shlex.split(line) for line in log_path.read_text().splitlines()]
    return result, calls


@pytest.mark.parametrize("secret_exists", [True, False])
@pytest.mark.parametrize(
    "target,classification,project",
    [("prod", "production", "f3-slackbot"), ("staging", "staging", "f3-slackbot-staging")],
)
def test_cloud_run_env_updates_service_and_job_classification_with_stub_gcloud(
    tmp_path: Path, target: str, classification: str, project: str, secret_exists: bool
):
    smtp_url = "smtp://smtp-user:synthetic%40smtp-pass@smtp.example.test:587"
    sender = "F3, Nation <notifications@example.test>"
    result, calls = _run_cloud_run_env(
        tmp_path,
        target,
        f'EMAIL_SERVER={smtp_url}\nEMAIL_FROM="{sender}"\nSENDGRID_API_KEY=unused-legacy-key\n',
        secret_exists,
    )
    assert result.returncode == 0, result.stdout + result.stderr
    secret_creates = [call for call in calls if call[:3] == ["secrets", "create", "email-server"]]
    assert len(secret_creates) == (0 if secret_exists else 1)
    if secret_creates:
        assert secret_creates[0][secret_creates[0].index("--project") + 1] == project
    secret_grants = [call for call in calls if call[:3] == ["secrets", "add-iam-policy-binding", "email-server"]]
    assert len(secret_grants) == 2
    assert {call[call.index("--member") + 1] for call in secret_grants} == {
        "serviceAccount:service-runtime@example.test",
        "serviceAccount:job-runtime@example.test",
    }
    for call in secret_grants:
        assert call[call.index("--project") + 1] == project
        assert call[call.index("--role") + 1] == "roles/secretmanager.secretAccessor"

    update_calls = [call for call in calls if call[:3] in (["run", "services", "update"], ["run", "jobs", "update"])]
    assert len(update_calls) == 2
    for call in update_calls:
        assert call[call.index("--project") + 1] == project
        env_arg = call[call.index("--update-env-vars") + 1]
        assert env_arg.startswith("^__F3_ENV_DELIM__^")
        env_assignments = [part.lstrip("^") for part in env_arg.split("__F3_ENV_DELIM__")]
        assert env_assignments.count(f"SLACKBOT_ENV={classification}") == 1
        assert env_assignments.count(f"EMAIL_FROM={sender}") == 1
        assert not any(assignment.startswith("EMAIL_SERVER=") for assignment in env_assignments)

        secret_arg = call[call.index("--update-secrets") + 1]
        assert secret_arg.startswith("^__F3_ENV_DELIM__^")
        secret_assignments = [part.lstrip("^") for part in secret_arg.split("__F3_ENV_DELIM__")]
        assert secret_assignments.count("EMAIL_SERVER=email-server:latest") == 1
        assert not any(assignment.startswith("SENDGRID_API_KEY=") for assignment in secret_assignments)
        assert "--remove-secrets" not in call

    secret_pushes = [call for call in calls if call[:3] == ["secrets", "versions", "add"]]
    assert len(secret_pushes) == 1
    assert secret_pushes[0][3] == "email-server"
    assert "--data-file=-" in secret_pushes[0]
    assert (tmp_path / "secret-input").read_text() == smtp_url
    assert smtp_url not in (tmp_path / "gcloud.log").read_text()
    assert smtp_url not in result.stdout + result.stderr
    assert "unused-legacy-key" not in (tmp_path / "gcloud.log").read_text()


@pytest.mark.parametrize("target,project", [("prod", "f3-slackbot"), ("staging", "f3-slackbot-staging")])
@pytest.mark.parametrize("legacy_exists", [True, False])
def test_legacy_secret_rollback_access_uses_metadata_and_grants_only(
    tmp_path: Path, target: str, project: str, legacy_exists: bool
):
    result, calls = _run_cloud_run_env(
        tmp_path,
        target,
        "EMAIL_FROM=notifications@example.test\n",
        secret_exists=True,
        legacy_state="exists" if legacy_exists else "absent",
    )
    assert result.returncode == 0, result.stdout + result.stderr
    legacy_calls = [call for call in calls if any("sendgrid-api-key" in argument for argument in call)]
    metadata_calls = [call for call in legacy_calls if call[:3] == ["secrets", "describe", "sendgrid-api-key"]]
    assert len(metadata_calls) == 1
    assert metadata_calls[0][metadata_calls[0].index("--project") + 1] == project
    grants = [call for call in legacy_calls if call[:3] == ["secrets", "add-iam-policy-binding", "sendgrid-api-key"]]
    assert len(grants) == (2 if legacy_exists else 0)
    if legacy_exists:
        assert {call[call.index("--member") + 1] for call in grants} == {
            "serviceAccount:service-runtime@example.test",
            "serviceAccount:job-runtime@example.test",
        }
        for call in grants:
            assert call[call.index("--project") + 1] == project
            assert call[call.index("--role") + 1] == "roles/secretmanager.secretAccessor"
    assert len(legacy_calls) == len(metadata_calls) + len(grants)
    assert not (tmp_path / "secret-input").exists()

    update_calls = [call for call in calls if call[:3] in (["run", "services", "update"], ["run", "jobs", "update"])]
    assert len(update_calls) == 2
    for call in update_calls:
        assert "--remove-secrets" not in call
        assert "SENDGRID_API_KEY" not in call[call.index("--update-secrets") + 1]


@pytest.mark.parametrize("target", ["prod", "staging"])
@pytest.mark.parametrize(
    "legacy_state,expected_status",
    [
        ("grant-denied", None),
        ("lookup-denied", "PERMISSION_DENIED"),
        ("lookup-unavailable", "UNAVAILABLE"),
        ("lookup-unknown", "UNKNOWN"),
        ("lookup-unanchored", "UNKNOWN"),
    ],
)
def test_legacy_rollback_access_failure_aborts_before_runtime_updates(
    tmp_path: Path, target: str, legacy_state: str, expected_status: str | None
):
    result, calls = _run_cloud_run_env(
        tmp_path,
        target,
        "EMAIL_FROM=notifications@example.test\n",
        secret_exists=True,
        legacy_state=legacy_state,
    )
    assert result.returncode != 0
    assert "sendgrid-api-key" in result.stdout
    if legacy_state == "grant-denied":
        assert "Failed to grant IAM access" in result.stdout
    else:
        assert "ERROR:" in result.stdout
        assert f"(status: {expected_status})" in result.stdout
        assert "diagnostic mentions" not in result.stdout + result.stderr
        assert "synthetic-private-diagnostic" not in result.stdout + result.stderr
    assert not any(call[:3] in (["run", "services", "update"], ["run", "jobs", "update"]) for call in calls)
    assert not any(
        call[:2] == ["secrets", "versions"] and any("sendgrid-api-key" in argument for argument in call)
        for call in calls
    )
    assert not (tmp_path / "secret-input").exists()


@pytest.mark.parametrize("target", ["prod", "staging"])
@pytest.mark.parametrize("secret_exists", [True, False])
def test_missing_email_server_preserves_existing_secret_or_aborts_before_runtime_updates(
    tmp_path: Path, target: str, secret_exists: bool
):
    result, calls = _run_cloud_run_env(tmp_path, target, "EMAIL_FROM=notifications@example.test\n", secret_exists)
    assert "SKIP: EMAIL_SERVER (empty)" in result.stdout
    assert not (tmp_path / "secret-input").exists()
    assert not any(call[:3] == ["secrets", "create", "email-server"] for call in calls)
    assert not any(call[:3] == ["secrets", "versions", "add"] for call in calls)
    assert any(call[:3] == ["secrets", "add-iam-policy-binding", "email-server"] for call in calls)

    update_calls = [call for call in calls if call[:3] in (["run", "services", "update"], ["run", "jobs", "update"])]
    if secret_exists:
        assert result.returncode == 0, result.stdout + result.stderr
        assert (tmp_path / "email-server-secret").read_text() == "previous-synthetic-value"
        assert len(update_calls) == 2
        for call in update_calls:
            secret_arg = call[call.index("--update-secrets") + 1]
            secret_assignments = [part.lstrip("^") for part in secret_arg.split("__F3_ENV_DELIM__")]
            assert secret_assignments.count("EMAIL_SERVER=email-server:latest") == 1
    else:
        assert result.returncode != 0
        assert "Failed to grant IAM access for secret email-server" in result.stdout
        assert not update_calls


@pytest.mark.parametrize("slot,smtp_port", [(0, 1025), (3, 1325)])
def test_local_email_defaults_follow_checkout_mailpit_port(tmp_path: Path, slot: int, smtp_port: int):
    env_file = tmp_path / "apps/slackbot/.env"
    env_file.parent.mkdir(parents=True)
    env_file.write_text((REPO_ROOT / "apps/slackbot/.env.example").read_text())
    port_script = tmp_path / "scripts/lib/local-ports.sh"
    port_script.parent.mkdir(parents=True)
    port_script.write_text((REPO_ROOT / "scripts/lib/local-ports.sh").read_text())
    subprocess.run(
        [
            "bash",
            "-c",
            'source "$1"; write_local_ports "$3"; load_local_ports; rewrite_env_ports "$2"',
            "test-local-smtp",
            str(port_script),
            str(env_file),
            str(slot),
        ],
        check=True,
        capture_output=True,
        text=True,
        env={"PATH": os.environ["PATH"]},
    )
    assignments = dict(
        line.split("=", maxsplit=1) for line in env_file.read_text().splitlines() if line and not line.startswith("#")
    )
    assert assignments["EMAIL_SERVER"] == f"smtp://localhost:{smtp_port}"
    assert assignments["EMAIL_FROM"] == "F3 Nation <no-reply@f3local.dev>"
    if slot:
        assert f"F3_MAILPIT_SMTP_PORT={smtp_port}\n" in (tmp_path / ".env").read_text()
