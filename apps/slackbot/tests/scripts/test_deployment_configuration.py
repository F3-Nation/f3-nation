import re
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parents[4]
CALLER_WORKFLOW = REPO_ROOT / ".github/workflows/deploy-slackbot.yml"


def _job_block(workflow: str, job_name: str) -> str:
    match = re.search(
        rf"(?m)^  {re.escape(job_name)}:\s*\n(.*?)(?=^  [\w-]+:|\Z)",
        workflow,
        re.DOTALL,
    )
    assert match is not None, f"Missing workflow job {job_name!r}"
    return match.group(1)


def _flag_block(job: str, flag_name: str) -> str:
    match = re.search(
        rf"(?m)^      {re.escape(flag_name)}: >-\s*\n((?:^        .*\n|^\s*\n)*)",
        job,
    )
    assert match is not None, f"Missing {flag_name!r} block"
    return match.group(1)


def test_service_deploy_blocks_set_slackbot_environment_and_forward_flags():
    workflow = CALLER_WORKFLOW.read_text()
    job = _job_block(workflow, "deploy-main")
    assert "uses: ./.github/workflows/_deploy-cloudrun.yml" in job

    expected_classifications = {
        "staging_flags": "staging",
        "prod_flags": "production",
    }
    for flag_name, environment in expected_classifications.items():
        flags = _flag_block(job, flag_name)
        assert flags.count(f"--update-env-vars=SLACKBOT_ENV={environment}") == 1
        other_environment = "production" if environment == "staging" else "staging"
        assert f"--update-env-vars=SLACKBOT_ENV={other_environment}" not in flags

    reusable = (REPO_ROOT / ".github/workflows/_deploy-cloudrun.yml").read_text()
    assert "flags: ${{ inputs.staging_flags || inputs.flags }}" in _job_block(reusable, "deploy-staging")
    assert "flags: ${{ inputs.prod_flags || inputs.flags }}" in _job_block(reusable, "deploy-prod")


def test_scripts_job_deploy_blocks_set_slackbot_environment_and_forward_flags():
    workflow = CALLER_WORKFLOW.read_text()
    job = _job_block(workflow, "deploy-scripts")
    assert "uses: ./.github/workflows/_deploy-cloudrun-job.yml" in job

    expected_classifications = {
        "staging_flags": "staging",
        "prod_flags": "production",
    }
    for flag_name, environment in expected_classifications.items():
        flags = _flag_block(job, flag_name)
        assert flags.count(f"--update-env-vars=SLACKBOT_ENV={environment}") == 1
        other_environment = "production" if environment == "staging" else "staging"
        assert f"--update-env-vars=SLACKBOT_ENV={other_environment}" not in flags

    reusable = (REPO_ROOT / ".github/workflows/_deploy-cloudrun-job.yml").read_text()
    assert "FLAGS: ${{ inputs.staging_flags || inputs.flags }}" in _job_block(reusable, "deploy-staging")
    assert "FLAGS: ${{ inputs.prod_flags || inputs.flags }}" in _job_block(reusable, "deploy-prod")
