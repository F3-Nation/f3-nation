from __future__ import annotations

import sys
from types import SimpleNamespace

import google.cloud.storage
import pytest

import analytics.cli as cli
import analytics.diagnostics as diagnostics
from analytics.publication import PointerConflictError
from analytics.settings import PointerSettings, SettingsError


def test_rollback_command_requires_explicit_product_release_and_generation(monkeypatch):
    calls = []
    events = []

    class Publisher:
        def __init__(self, client, settings, **_kwargs):
            calls.append((client, settings))

        def rollback_pointer(self, release_id, *, expected_generation, source_order, producer_revision, created_at):
            calls.append((release_id, expected_generation, source_order, producer_revision, created_at))
            return {"releaseId": release_id, "releaseSequence": 4}

    monkeypatch.setenv("ANALYTICS_ENVIRONMENT", "nonprod")
    monkeypatch.setenv("ANALYTICS_CATALOG_BUCKET", "f3-analytics-nonprod")
    monkeypatch.setattr(
        cli,
        "JsonLogger",
        lambda: SimpleNamespace(
            info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
        ),
    )
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli, "GcsPublisher", Publisher, raising=False)
    monkeypatch.setattr(google.cloud.storage, "Client", lambda: "storage")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "analytics-etl",
            "rollback-pointer",
            "--product",
            "analytics",
            "--release-id",
            "retained-release",
            "--expected-generation",
            "7",
        ],
    )

    assert cli.main() == 0
    assert calls[0][1].bucket_name == "f3-analytics-nonprod"
    assert calls[1][0:2] == ("retained-release", "7")
    assert events[0][0] == "analytics.etl.pointer_rollback_succeeded"
    assert events[0][1]["pointer_release_sequence"] == 4
    assert "pointer_generation" not in events[0][1]


def test_rollback_command_returns_failure_on_pointer_cas_conflict(monkeypatch):
    class Publisher:
        def __init__(self, *_args, **_kwargs):
            pass

        def rollback_pointer(self, *_args, **_kwargs):
            raise PointerConflictError("conflict")

    monkeypatch.setenv("ANALYTICS_ENVIRONMENT", "nonprod")
    monkeypatch.setenv("ANALYTICS_CATALOG_BUCKET", "f3-analytics-nonprod")
    monkeypatch.setattr(
        cli,
        "JsonLogger",
        lambda: SimpleNamespace(info=lambda *args, **kwargs: None, error=lambda *args, **kwargs: None),
    )
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli, "GcsPublisher", Publisher, raising=False)
    monkeypatch.setattr(google.cloud.storage, "Client", lambda: "storage")
    monkeypatch.setattr(
        sys,
        "argv",
        [
            "analytics-etl",
            "rollback-pointer",
            "--product",
            "pax-vault",
            "--release-id",
            "release",
            "--expected-generation",
            "2",
        ],
    )

    assert cli.main() == 1


def test_pointer_settings_reject_missing_or_wrong_bucket_without_database_config():
    with pytest.raises(SettingsError, match="ANALYTICS_CATALOG_BUCKET"):
        PointerSettings.from_env({"ANALYTICS_ENVIRONMENT": "nonprod"})
    with pytest.raises(SettingsError, match="does not match"):
        PointerSettings.from_env(
            {
                "ANALYTICS_ENVIRONMENT": "production",
                "ANALYTICS_CATALOG_BUCKET": "f3-analytics-nonprod",
                "ANALYTICS_PRODUCER_REVISION": "release-abc",
            }
        )
    assert (
        PointerSettings.from_env(
            {"ANALYTICS_ENVIRONMENT": "nonprod", "ANALYTICS_CATALOG_BUCKET": "f3-analytics-nonprod"}
        ).bucket_name
        == "f3-analytics-nonprod"
    )


def test_run_defaults_to_both_products_and_continues_after_first_failure(monkeypatch):
    from analytics.materializations import PRODUCTS
    from analytics.pipeline import BatchRunError

    settings = SimpleNamespace(environment="test")
    attempted = []
    run_ids = []
    selector_products = []
    logger = SimpleNamespace(info=lambda *args, **kwargs: None, error=lambda *args, **kwargs: None)

    def fake_run(_settings, _client, *, run_id, product, **_kwargs):
        attempted.append(product)
        run_ids.append(run_id)
        if product == PRODUCTS[0]:
            raise BatchRunError({"dataset": RuntimeError("failure")})

    def select(_names, *, product):
        selector_products.append(product)
        if product == PRODUCTS[0]:
            raise ValueError("Pax Vault SQL unavailable")
        return ()

    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(cli, "_storage_client", lambda: object())
    monkeypatch.setattr(cli, "select_materializations", select)
    monkeypatch.setattr("analytics.pipeline.run", fake_run)
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "run"])

    assert cli.main() == 1
    assert selector_products == list(PRODUCTS)
    assert attempted == [PRODUCTS[1]]
    assert len(set(run_ids)) == 1


def test_diagnostics_command_logs_completion_on_success(monkeypatch):
    settings = SimpleNamespace(environment="test")
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    events = []
    calls = []

    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli.Settings, "from_env", lambda: calls.append("settings") or settings)
    monkeypatch.setattr(
        diagnostics,
        "run_diagnostics",
        lambda received_settings, *, logger: (
            calls.append((received_settings, logger)) or {"postgres_scan": {"status": "succeeded"}}
        ),
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics"])

    assert cli.main() == 0
    assert calls == ["settings", (settings, logger)]
    assert events[0][0] == "analytics.etl.diagnostics_completed"
    assert events[0][1]["failed_count"] == 0


def test_diagnostics_command_logs_completion_and_returns_failure_for_partial_probe_failure(monkeypatch):
    settings = SimpleNamespace(environment="test")
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    events = []

    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli, "select_materializations", lambda _names: ())
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(
        diagnostics,
        "run_diagnostics",
        lambda received_settings, *, logger: {
            "postgres_scan": {"status": "succeeded"},
            "territory_count": {"status": "failed"},
        },
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics"])

    assert cli.main() == 1
    assert events[0][0] == "analytics.etl.diagnostics_completed"
    assert events[0][1]["failed_count"] == 1


def test_full_query_diagnostics_command_isolated_success_without_gcs_or_selectors(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    calls = []

    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(cli, "select_materializations", lambda _names: (_ for _ in ()).throw(AssertionError()))
    monkeypatch.setattr(cli, "_storage_client", lambda: (_ for _ in ()).throw(AssertionError("GCS")))
    monkeypatch.setattr(
        diagnostics,
        "run_full_query_diagnostics",
        lambda received_settings, *, logger, scanner_mode: (
            calls.append((received_settings, logger)),
            {"pv_kotter": {"status": "succeeded"}, "pv_events": {"status": "succeeded"}},
        )[1],
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query"])

    assert cli.main() == 0
    assert calls == [(settings, logger)]
    assert events == [
        (
            "analytics.etl.diagnostics_full_query_completed",
            {
                "run_id": "run",
                "environment": "test",
                "dataset_count": 2,
                "failed_count": 0,
                "scanner_mode": "binary-copy",
            },
        )
    ]


def test_full_query_diagnostics_forwards_text_copy_scanner_mode(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    scanner_modes = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(
        diagnostics,
        "run_full_query_diagnostics",
        lambda _settings, *, logger, scanner_mode: (
            scanner_modes.append(scanner_mode),
            {"pv_kotter": {"status": "succeeded"}, "pv_events": {"status": "succeeded"}},
        )[1],
    )
    monkeypatch.setattr(
        sys,
        "argv",
        ["analytics-etl", "diagnostics-full-query", "--scanner-mode=text-copy"],
    )

    assert cli.main() == 0
    assert scanner_modes == ["text-copy"]
    assert events[-1][1]["scanner_mode"] == "text-copy"


def test_full_query_diagnostics_forwards_single_thread_scanner_mode(monkeypatch):
    settings = SimpleNamespace(environment="test")
    scanner_modes = []
    logger = SimpleNamespace(info=lambda *args, **kwargs: None, error=lambda *args, **kwargs: None)
    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(
        diagnostics,
        "run_full_query_diagnostics",
        lambda _settings, *, logger, scanner_mode: (
            scanner_modes.append(scanner_mode),
            {"pv_kotter": {"status": "succeeded"}, "pv_events": {"status": "succeeded"}},
        )[1],
    )
    monkeypatch.setattr(
        sys,
        "argv",
        ["analytics-etl", "diagnostics-full-query", "--scanner-mode=single-thread"],
    )

    assert cli.main() == 0
    assert scanner_modes == ["single-thread"]


def test_full_query_diagnostics_command_returns_failure_and_rejects_selector(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(
        diagnostics,
        "run_full_query_diagnostics",
        lambda _settings, *, logger, scanner_mode: {
            "pv_kotter": {"status": "failed"},
            "pv_events": {"status": "succeeded"},
        },
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query"])
    assert cli.main() == 1
    assert events[0][0] == "analytics.etl.diagnostics_full_query_completed"
    assert events[0][1]["failed_count"] == 1
    assert events[0][1]["scanner_mode"] == "binary-copy"

    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query", "--materialization", "pv_events"])
    with pytest.raises(SystemExit):
        cli.main()


def test_staged_events_diagnostics_command_returns_status_without_gcs_or_selectors(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(cli, "_storage_client", lambda: (_ for _ in ()).throw(AssertionError("GCS")))
    monkeypatch.setattr(
        diagnostics,
        "run_staged_events_diagnostic",
        lambda _settings, *, logger: {"status": "failed", "error_type": "RuntimeError"},
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-staged-events"])

    assert cli.main() == 1
    assert events == [
        (
            "analytics.etl.diagnostics_staged_events_completed",
            {"run_id": "run", "environment": "test", "dataset_count": 1, "failed_count": 1},
        )
    ]

    monkeypatch.setattr(
        sys,
        "argv",
        ["analytics-etl", "diagnostics-staged-events", "--materialization", "pv_events"],
    )
    with pytest.raises(SystemExit):
        cli.main()


def test_ctas_events_diagnostics_command_returns_status_without_gcs_or_selectors(monkeypatch):
    settings = SimpleNamespace(environment="test")
    events = []
    logger = SimpleNamespace(
        info=lambda event, **context: events.append((event, context)), error=lambda *args, **kwargs: None
    )
    monkeypatch.setattr(cli, "JsonLogger", lambda: logger)
    monkeypatch.setattr(cli, "RunId", SimpleNamespace(create=lambda: "run"))
    monkeypatch.setattr(cli.Settings, "from_env", lambda: settings)
    monkeypatch.setattr(cli, "_storage_client", lambda: (_ for _ in ()).throw(AssertionError("GCS")))
    monkeypatch.setattr(
        diagnostics,
        "run_ctas_events_diagnostic",
        lambda _settings, *, logger: {"status": "succeeded", "row_count": 1},
    )
    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-ctas-events"])

    assert cli.main() == 0
    assert events[-1] == (
        "analytics.etl.diagnostics_ctas_events_completed",
        {"run_id": "run", "environment": "test", "dataset_count": 1, "failed_count": 0},
    )

    monkeypatch.setattr(
        sys,
        "argv",
        ["analytics-etl", "diagnostics-ctas-events", "--materialization", "pv_events"],
    )
    with pytest.raises(SystemExit):
        cli.main()

    monkeypatch.setattr(sys, "argv", ["analytics-etl", "diagnostics-full-query", "--scanner-mode", "invalid"])
    with pytest.raises(SystemExit):
        cli.main()
