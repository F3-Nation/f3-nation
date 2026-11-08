import io
import json
import logging

import pytest
from google.cloud.logging_v2.handlers import StructuredLogHandler
from slack_sdk.errors import SlackApiError
from sqlalchemy.exc import StatementError

from scripts import hourly_runner


@pytest.mark.parametrize("local", [False, True])
@pytest.mark.parametrize("level", ["INFO", "DEBUG"])
def test_hourly_logging_configuration(monkeypatch, local, level):
    monkeypatch.setattr(hourly_runner, "LOCAL_DEVELOPMENT", local)
    monkeypatch.setenv("LOG_LEVEL", level)
    root = logging.getLogger()
    previous_handlers, previous_level = root.handlers[:], root.level
    previous_propagation = {
        name: logger.propagate
        for name, logger in logging.root.manager.loggerDict.items()
        if isinstance(logger, logging.Logger)
    }
    stream = io.StringIO()
    try:
        hourly_runner.configure_logging()
        assert root.level == getattr(logging, level)
        assert len(root.handlers) == 1
        handler = root.handlers[0]
        assert isinstance(handler, logging.StreamHandler if local else StructuredLogHandler)
        handler.setStream(stream)
        logging.getLogger("scripts.update_slack_users").error(
            "slack.identity.sync_failed", extra={"json_fields": {"event": "slack.identity.sync_failed"}}
        )
        if local:
            assert "slack.identity.sync_failed" in stream.getvalue()
        else:
            payloads = [json.loads(line) for line in stream.getvalue().splitlines() if line.strip()]
            payload = next(value for value in payloads if value.get("event") == "slack.identity.sync_failed")
            assert payload["severity"] == "ERROR"
    finally:
        for handler in root.handlers:
            if handler not in previous_handlers:
                handler.close()
        root.handlers[:] = previous_handlers
        root.setLevel(previous_level)
        for name, logger in logging.root.manager.loggerDict.items():
            if isinstance(logger, logging.Logger):
                logger.propagate = previous_propagation.get(name, True)


JOBS = [
    ("calendar_images", "generate_calendar_images"),
    ("backblast_reminders", "send_backblast_reminders"),
    ("preblast_reminders", "send_preblast_reminders"),
    ("auto_preblast_send", "send_automated_preblasts"),
    ("q_lineups", "send_lineups"),
    ("update_slack_users", "update_slack_users"),
    ("update_slack_users", "update_home_regions"),
    ("fng_reminders", "send_fng_reminders"),
    ("home_region_nudge", "send_home_region_nudges"),
    ("f3versary_announcements", "send_f3versary_announcements"),
    ("monthly_reporting", "cycle_all_orgs"),
    ("kotter_reports", "send_kotter_reports"),
    ("award_achievements", "main"),
    ("requests", "post"),
]
SENSITIVE = "member@example.invalid xoxb-synthetic-token SELECT private_data U_SYNTHETIC_MEMBER"


def stub_jobs(monkeypatch, failing_job=None, error=None):
    attempted = []
    for module, function in JOBS:
        job = f"{module}.{function}"

        def run(*args, _job=job, **kwargs):
            attempted.append(_job)
            if _job == failing_job:
                raise error

        monkeypatch.setattr(getattr(hourly_runner, module), function, run)
    return attempted


@pytest.mark.parametrize("module,function", JOBS)
@pytest.mark.parametrize("structured", [False, True])
def test_hourly_failure_output_is_private_and_keeps_job_context(
    monkeypatch, capsys, caplog, module, function, structured
):
    job = f"{module}.{function}"
    attempted = stub_jobs(monkeypatch, job, RuntimeError(SENSITIVE))
    stream = io.StringIO()
    handler = StructuredLogHandler(stream=stream) if structured else logging.StreamHandler(stream)
    logger = logging.getLogger("scripts.hourly_runner")
    logger.addHandler(handler)
    try:
        with caplog.at_level(logging.ERROR):
            hourly_runner.run_all_hourly_scripts()
    finally:
        logger.removeHandler(handler)
        handler.close()
    captured = capsys.readouterr()
    output = stream.getvalue() + captured.out + captured.err
    for private_value in SENSITIVE.split():
        assert private_value not in output
    assert "Traceback" not in output
    assert attempted == [f"{m}.{f}" for m, f in JOBS]
    records = [record for record in caplog.records if record.name == "scripts.hourly_runner"]
    assert len(records) == 1
    record = records[0]
    assert record.levelno == logging.ERROR
    assert record.exc_info is None
    assert record.stack_info is None
    assert SENSITIVE not in repr(record.__dict__)
    assert job in stream.getvalue()
    assert "RuntimeError" in stream.getvalue()
    if structured:
        payloads = [json.loads(line) for line in stream.getvalue().splitlines()]
        payload = next(item for item in payloads if item.get("event") == "slack.hourly.job_failed")
        assert payload["job"] == job
        assert payload["error_type"] == "RuntimeError"
        assert payload["severity"] == "ERROR"


@pytest.mark.parametrize("run_reporting", [False, True])
def test_hourly_success_keeps_job_selection(monkeypatch, caplog, run_reporting):
    attempted = stub_jobs(monkeypatch)
    hourly_runner.run_all_hourly_scripts(run_reporting=run_reporting)
    expected = [f"{m}.{f}" for m, f in JOBS if run_reporting or m not in {"monthly_reporting", "kotter_reports"}]
    assert attempted == expected
    assert not [record for record in caplog.records if record.name == "scripts.hourly_runner"]


@pytest.mark.parametrize("name", ["member@example.invalid", "X" * 100])
def test_hourly_failure_bounds_exception_class(monkeypatch, caplog, name):
    error = type(name, (Exception,), {})(SENSITIVE)
    stub_jobs(monkeypatch, "requests.post", error)
    with caplog.at_level(logging.ERROR):
        hourly_runner.run_all_hourly_scripts()
    record = next(record for record in caplog.records if record.name == "scripts.hourly_runner")
    assert record.json_fields["error_type"] == "Exception"
    assert name not in repr(record.__dict__)


@pytest.mark.parametrize(
    "error",
    [
        StatementError(
            "query failed", "SELECT private_data", {"email": "member@example.invalid"}, RuntimeError(SENSITIVE)
        ),
        SlackApiError("request failed", {"error": SENSITIVE, "token": "xoxb-synthetic-token"}),
    ],
)
def test_hourly_provider_errors_do_not_retain_sensitive_payloads(monkeypatch, caplog, capsys, error):
    attempted = stub_jobs(monkeypatch, "update_slack_users.update_slack_users", error)
    with caplog.at_level(logging.ERROR):
        hourly_runner.run_all_hourly_scripts()
    captured = capsys.readouterr()
    record = next(record for record in caplog.records if record.name == "scripts.hourly_runner")
    output = captured.out + captured.err + repr(record.__dict__)
    for value in SENSITIVE.split():
        assert value not in output
    assert record.json_fields["error_type"] == type(error).__name__
    assert record.exc_info is None
    assert attempted == [f"{m}.{f}" for m, f in JOBS]
