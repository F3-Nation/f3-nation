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
    ("calendar_images", "generate_calendar_images", "calendar_images.generate_calendar_images"),
    ("backblast_reminders", "send_backblast_reminders", "backblast_reminders.send_backblast_reminders"),
    ("preblast_reminders", "send_preblast_reminders", "preblast_reminders.send_preblast_reminders"),
    ("auto_preblast_send", "send_automated_preblasts", "auto_preblast_send.send_automated_preblasts"),
    ("q_lineups", "send_lineups", "q_lineups.send_lineups"),
    ("update_slack_users", "update_slack_users", "update_slack_users.update_slack_users"),
    ("update_slack_users", "update_home_regions", "update_slack_users.update_home_regions"),
    ("fng_reminders", "send_fng_reminders", "fng_reminders.send_fng_reminders"),
    ("home_region_nudge", "send_home_region_nudges", "home_region_nudge.send_home_region_nudges"),
    ("f3versary_announcements", "send_f3versary_announcements", "f3versary_announcements.send_f3versary_announcements"),
    ("monthly_reporting", "cycle_all_orgs", "monthly_reporting.cycle_all_orgs"),
    ("kotter_reports", "send_kotter_reports", "kotter_reports.send_kotter_reports"),
    ("award_achievements", "main", "award_achievements.main"),
    ("requests", "post", "hourly_runner.notify_completion"),
]
SENSITIVE = "member@example.invalid xoxb-synthetic-token SELECT private_data U_SYNTHETIC_MEMBER"


def stub_jobs(monkeypatch, failing_job=None, error=None, arguments=None):
    attempted = []
    for module, function, job in JOBS:

        def run(*args, _job=job, **kwargs):
            attempted.append(_job)
            if arguments is not None:
                arguments.append((_job, args, kwargs))
            if _job == failing_job:
                raise error

        monkeypatch.setattr(getattr(hourly_runner, module), function, run)
    return attempted


@pytest.mark.parametrize("module,function,job", JOBS)
@pytest.mark.parametrize("structured", [False, True])
def test_hourly_failure_output_is_private_and_keeps_job_context(
    monkeypatch, capsys, caplog, module, function, job, structured
):
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
    assert attempted == [job for _, _, job in JOBS]
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
        assert payload["error_module"] == "builtins"
        assert payload["severity"] == "ERROR"


@pytest.mark.parametrize("run_reporting", [False, True])
def test_hourly_success_keeps_job_selection(monkeypatch, caplog, run_reporting):
    attempted = stub_jobs(monkeypatch)
    hourly_runner.run_all_hourly_scripts(run_reporting=run_reporting)
    expected = [job for m, _, job in JOBS if run_reporting or m not in {"monthly_reporting", "kotter_reports"}]
    assert attempted == expected
    assert not [record for record in caplog.records if record.name == "scripts.hourly_runner"]


@pytest.mark.parametrize(
    "name,expected",
    [
        ("member@example.invalid", "Exception"),
        ("X" * 64, "X" * 64),
        ("X" * 65, "Exception"),
        ("1Bad", "Exception"),
        ("_Err2", "_Err2"),
    ],
)
def test_hourly_failure_bounds_exception_class(monkeypatch, caplog, capsys, name, expected):
    error = type(name, (Exception,), {})(SENSITIVE)
    stub_jobs(monkeypatch, "hourly_runner.notify_completion", error)
    with caplog.at_level(logging.ERROR):
        hourly_runner.run_all_hourly_scripts()
    record = next(record for record in caplog.records if record.name == "scripts.hourly_runner")
    assert record.json_fields["error_type"] == expected
    captured = capsys.readouterr()
    output = captured.out + captured.err + repr(record.__dict__)
    assert SENSITIVE not in output
    if expected != name:
        assert name not in output


@pytest.mark.parametrize(
    "error,expected_module",
    [
        (
            StatementError(
                "query failed", "SELECT private_data", {"email": "member@example.invalid"}, RuntimeError(SENSITIVE)
            ),
            "sqlalchemy.exc",
        ),
        (SlackApiError("request failed", {"error": SENSITIVE, "token": "xoxb-synthetic-token"}), "slack_sdk.errors"),
    ],
)
@pytest.mark.parametrize("structured", [False, True])
def test_hourly_provider_errors_do_not_retain_sensitive_payloads(
    monkeypatch, caplog, capsys, error, expected_module, structured
):
    attempted = stub_jobs(monkeypatch, "update_slack_users.update_slack_users", error)
    stream = io.StringIO()
    handler = StructuredLogHandler(stream=stream) if structured else logging.StreamHandler(stream)
    logger = hourly_runner.logger
    logger.addHandler(handler)
    try:
        with caplog.at_level(logging.ERROR):
            hourly_runner.run_all_hourly_scripts()
    finally:
        logger.removeHandler(handler)
        handler.close()
    captured = capsys.readouterr()
    record = next(record for record in caplog.records if record.name == "scripts.hourly_runner")
    output = stream.getvalue() + captured.out + captured.err + repr(record.__dict__)
    for value in SENSITIVE.split():
        assert value not in output
    assert record.json_fields["error_type"] == type(error).__name__
    assert record.json_fields["error_module"] == expected_module
    assert f"error_module={expected_module}" in stream.getvalue()
    if structured:
        payload = next(json.loads(line) for line in stream.getvalue().splitlines() if '"event"' in line)
        assert payload["error_module"] == expected_module
    assert record.exc_info is None
    assert attempted == [job for _, _, job in JOBS]


@pytest.mark.parametrize("failure", [None, "calendar_images.generate_calendar_images"])
def test_hourly_runner_preserves_job_arguments(monkeypatch, failure):
    arguments = []
    stub_jobs(monkeypatch, failure, RuntimeError(SENSITIVE), arguments)
    hourly_runner.run_all_hourly_scripts(force=True, reporting_org_id=123)
    assert arguments == [
        ("calendar_images.generate_calendar_images", (), {"force": True}),
        ("backblast_reminders.send_backblast_reminders", (), {}),
        ("preblast_reminders.send_preblast_reminders", (), {}),
        ("auto_preblast_send.send_automated_preblasts", (), {}),
        ("q_lineups.send_lineups", (), {"force": True}),
        ("update_slack_users.update_slack_users", (), {}),
        ("update_slack_users.update_home_regions", (), {}),
        ("fng_reminders.send_fng_reminders", (), {"force": True}),
        ("home_region_nudge.send_home_region_nudges", (), {}),
        ("f3versary_announcements.send_f3versary_announcements", (), {"force": True}),
        ("monthly_reporting.cycle_all_orgs", (), {"run_org_id": 123}),
        ("kotter_reports.send_kotter_reports", (), {"force": True, "run_org_id": 123}),
        ("award_achievements.main", (), {}),
        ("hourly_runner.notify_completion", (f"{hourly_runner.APP_URL}/hourly-runner-complete",), {}),
    ]


@pytest.mark.parametrize("structured", [False, True])
@pytest.mark.parametrize(
    "module,expected",
    [
        ("sqlalchemy.exc", "sqlalchemy.exc"),
        ("M", "M"),
        (5, "unknown"),
        ("pkg\nerror_type=Forged", "unknown"),
        ("M" * 128, "M" * 128),
        ("M" * 129, "unknown"),
        ("member@example.invalid", "unknown"),
        ("private module", "unknown"),
        ("1module", "unknown"),
        ("", "unknown"),
        (None, "unknown"),
    ],
)
def test_hourly_failure_bounds_exception_module(caplog, module, expected, structured):
    error = type("ProviderError", (Exception,), {"__module__": module})(SENSITIVE)
    stream = io.StringIO()
    handler = StructuredLogHandler(stream=stream) if structured else logging.StreamHandler(stream)
    logger = hourly_runner.logger
    logger.addHandler(handler)
    try:
        with caplog.at_level(logging.ERROR):
            hourly_runner.log_job_failure("synthetic.job", error)
    finally:
        logger.removeHandler(handler)
        handler.close()
    record = next(record for record in caplog.records if record.name == "scripts.hourly_runner")
    assert record.json_fields["error_module"] == expected
    assert f"error_module={expected}" in stream.getvalue()
    assert record.exc_info is None
    output = stream.getvalue() + repr(record.__dict__)
    assert SENSITIVE not in output
    if isinstance(module, str) and module and module != expected:
        assert module not in output
    if structured:
        payload = next(json.loads(line) for line in stream.getvalue().splitlines() if '"event"' in line)
        assert payload["error_module"] == expected


@pytest.mark.parametrize("structured", [False, True])
def test_hourly_failure_copies_module_text_without_custom_string_formatting(caplog, structured):
    class ForgedModule(str):
        def __str__(self):
            return SENSITIVE

    error = type("ProviderError", (Exception,), {"__module__": ForgedModule("safe.module")})(SENSITIVE)
    stream = io.StringIO()
    handler = StructuredLogHandler(stream=stream) if structured else logging.StreamHandler(stream)
    logger = hourly_runner.logger
    logger.addHandler(handler)
    try:
        with caplog.at_level(logging.ERROR):
            hourly_runner.log_job_failure("synthetic.job", error)
    finally:
        logger.removeHandler(handler)
        handler.close()
    record = next(record for record in caplog.records if record.name == "scripts.hourly_runner")
    assert "error_module=safe.module" in stream.getvalue()
    assert type(record.json_fields["error_module"]) is str
    assert SENSITIVE not in stream.getvalue() + repr(record.__dict__)
