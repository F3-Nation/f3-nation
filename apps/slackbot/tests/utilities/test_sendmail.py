import json
import logging
import os
import ssl
import sys
from types import SimpleNamespace
from unittest.mock import ANY, MagicMock, call

import pytest
from google.cloud.logging_v2.handlers import StructuredLogHandler

sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "../..")))

from utilities import sendmail


@pytest.fixture
def transport(monkeypatch):
    monkeypatch.setenv("EMAIL_SERVER", "smtp://localhost:1025")
    monkeypatch.setenv("EMAIL_FROM", "F3 Local <no-reply@f3local.dev>")
    monkeypatch.setenv("SENDGRID_API_KEY", "synthetic-legacy-key")

    # Stub the removed SDK to detect reintroduction of the HTTP transport.
    legacy = MagicMock()
    legacy.return_value.send.return_value.status_code = 202
    monkeypatch.setitem(sys.modules, "sendgrid", SimpleNamespace(SendGridAPIClient=legacy))
    monkeypatch.setitem(sys.modules, "sendgrid.helpers.mail", SimpleNamespace(Mail=MagicMock()))

    client = MagicMock()
    client.__enter__.return_value = client
    client.send_message.return_value = {}
    smtp = MagicMock(return_value=client)
    smtp_ssl = MagicMock(return_value=client)
    monkeypatch.setattr(sendmail.smtplib, "SMTP", smtp)
    monkeypatch.setattr(sendmail.smtplib, "SMTP_SSL", smtp_ssl)
    return SimpleNamespace(client=client, smtp=smtp, smtp_ssl=smtp_ssl, legacy=legacy)


def test_local_smtp_sends_unicode_html_using_configured_sender(transport, caplog):
    with caplog.at_level(logging.INFO):
        result = sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic café 🏃", "<p>Hello café 🏃</p>")

    assert result is True
    transport.smtp.assert_called_once_with("localhost", 1025, timeout=10)
    transport.smtp_ssl.assert_not_called()
    transport.client.starttls.assert_not_called()
    transport.client.login.assert_not_called()
    transport.client.send_message.assert_called_once()
    message = transport.client.send_message.call_args.args[0]
    assert message["From"] == "F3 Local <no-reply@f3local.dev>"
    assert message["To"] == "recipient@f3local.dev"
    assert message["Subject"] == "Synthetic café 🏃"
    assert message.get_content_type() == "text/html"
    assert message.get_content().rstrip() == "<p>Hello café 🏃</p>"
    assert message.as_bytes()
    transport.client.__exit__.assert_called_once()
    transport.legacy.assert_not_called()
    assert "slackbot.email.sent" in caplog.text
    assert "recipient@f3local.dev" not in caplog.text
    assert "café" not in caplog.text


@pytest.mark.parametrize("keyword", [False, True], ids=["positional", "keyword"])
def test_explicit_sender_takes_precedence_over_email_from(transport, keyword):
    sender = "F3 Support <support@f3local.dev>"
    if keyword:
        result = sendmail.send_via_sendgrid(
            to_email="recipient@f3local.dev", subject="Synthetic", html_content="<p>Body</p>", from_email=sender
        )
    else:
        result = sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>", sender)

    assert result is True
    assert transport.client.send_message.call_args.args[0]["From"] == sender


@pytest.mark.parametrize("configured_sender", [None, ""], ids=["missing", "empty"])
def test_omitted_email_from_preserves_legacy_default(transport, monkeypatch, configured_sender):
    if configured_sender is None:
        monkeypatch.delenv("EMAIL_FROM")
    else:
        monkeypatch.setenv("EMAIL_FROM", configured_sender)

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is True
    assert transport.client.send_message.call_args.args[0]["From"] == "noreply@f3nation.com"


def test_smtp_auth_decodes_credentials_and_requires_verified_starttls_before_login(transport, monkeypatch):
    monkeypatch.setenv("EMAIL_SERVER", "smtp://api%40key:synthetic%3Akey%2F%25%2B@smtp.example.com:587")

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is True

    transport.smtp.assert_called_once_with("smtp.example.com", 587, timeout=10)
    assert transport.client.method_calls == [
        call.starttls(context=ANY),
        call.login("api@key", "synthetic:key/%+"),
        call.send_message(ANY),
    ]
    context = transport.client.starttls.call_args.kwargs["context"]
    assert isinstance(context, ssl.SSLContext)
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED


@pytest.mark.parametrize("host", ["smtp.example.com", "localhost", "127.0.0.1", "[::1]"])
def test_authenticated_smtp_requires_starttls_even_on_nonstandard_port(transport, monkeypatch, host):
    monkeypatch.setenv("EMAIL_SERVER", f"smtp://user:synthetic@{host}:2525")

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is True

    assert transport.client.method_calls[:2] == [call.starttls(context=ANY), call.login("user", "synthetic")]


@pytest.mark.parametrize(
    "endpoint",
    [
        "smtp://smtp.example.com:25",
        "smtp://smtp.example.com:587",
        "smtp://smtp.example.com:2525",
        "smtp://localhost.example.com:1025",
        "smtp://localhost.:1025",
        "smtp://127.0.0.2:1025",
        "smtp://127.1:1025",
    ],
)
def test_remote_smtp_requires_tls_even_without_credentials(transport, monkeypatch, endpoint):
    monkeypatch.setenv("EMAIL_SERVER", endpoint)

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is True

    transport.client.starttls.assert_called_once_with(context=ANY)
    transport.client.login.assert_not_called()


@pytest.mark.parametrize("host", ["127.0.0.1", "[::1]"])
def test_unauthenticated_loopback_allows_local_plaintext_smtp(transport, monkeypatch, host):
    monkeypatch.setenv("EMAIL_SERVER", f"smtp://{host}:1025")

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is True

    transport.smtp.assert_called_once_with(host.strip("[]"), 1025, timeout=10)
    transport.client.send_message.assert_called_once()
    transport.client.starttls.assert_not_called()
    transport.client.login.assert_not_called()


@pytest.mark.parametrize(
    "endpoint,port,credentials",
    [
        ("smtps://user:synthetic@smtp.example.com", 465, ("user", "synthetic")),
        ("smtps://user:synthetic@smtp.example.com:2465", 2465, ("user", "synthetic")),
        ("smtps://smtp.example.com", 465, None),
    ],
)
def test_smtps_uses_verified_implicit_tls(transport, monkeypatch, endpoint, port, credentials):
    monkeypatch.setenv("EMAIL_SERVER", endpoint)

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is True

    transport.smtp.assert_not_called()
    transport.smtp_ssl.assert_called_once_with("smtp.example.com", port, timeout=10, context=ANY)
    context = transport.smtp_ssl.call_args.kwargs["context"]
    assert context.check_hostname is True
    assert context.verify_mode == ssl.CERT_REQUIRED
    transport.client.starttls.assert_not_called()
    if credentials:
        transport.client.login.assert_called_once_with(*credentials)
    else:
        transport.client.login.assert_not_called()


@pytest.mark.parametrize("port_suffix,port", [("", 587), (":25", 25)])
def test_smtp_uses_submission_default_or_explicit_port(transport, monkeypatch, port_suffix, port):
    monkeypatch.setenv("EMAIL_SERVER", f"smtp://localhost{port_suffix}")

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is True

    transport.smtp.assert_called_once_with("localhost", port, timeout=10)


@pytest.mark.parametrize(
    "endpoint",
    [
        None,
        "",
        "localhost:1025",
        "https://localhost:1025",
        "smtp://",
        "smtp://:1025",
        "smtp://localhost:invalid",
        "smtp://localhost:0",
        "smtp://localhost:65536",
        "smtp://[invalid]:1025",
        "smtp://localhost:1025/path",
        "smtp://localhost:1025?tls=false",
        "smtp://localhost:1025#fragment",
        "smtp://user@smtp.example.com:587",
        "smtp://:synthetic@smtp.example.com:587",
        "smtp://user:@smtp.example.com:587",
        "smtp://user:synthetic%0Akey@smtp.example.com:587",
        "smtp://user%0D:synthetic@smtp.example.com:587",
        "smtp://user:synthetic%FF@smtp.example.com:587",
        "smtp://user:synthetic%7F@smtp.example.com:587",
        "smtp://local host:1025",
        "smtp://localhost:1025\n",
    ],
)
def test_missing_or_malformed_endpoint_fails_without_opening_any_transport(transport, monkeypatch, endpoint):
    if endpoint is None:
        monkeypatch.delenv("EMAIL_SERVER")
    else:
        monkeypatch.setenv("EMAIL_SERVER", endpoint)

    assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is False

    transport.smtp.assert_not_called()
    transport.smtp_ssl.assert_not_called()
    transport.legacy.assert_not_called()


@pytest.mark.parametrize(
    "arguments",
    [
        {"to_email": "recipient@f3local.dev\nBcc: unexpected@f3local.dev"},
        {"subject": "Synthetic\r\nBcc: unexpected@f3local.dev"},
        {"from_email": "sender@f3local.dev\nBcc: unexpected@f3local.dev"},
    ],
)
def test_invalid_headers_report_message_stage_before_connection(transport, arguments, caplog):
    message = {"to_email": "recipient@f3local.dev", "subject": "Synthetic", "html_content": "<p>Body</p>"}
    message.update(arguments)

    with caplog.at_level(logging.ERROR):
        assert sendmail.send_via_sendgrid(**message) is False

    record = next(record for record in caplog.records if record.getMessage().startswith("slackbot.email.send_failed"))
    assert record.json_fields == {
        "event": "slackbot.email.send_failed",
        "stage": "message",
        "error_type": "ValueError",
    }
    recorded = json.dumps(record.__dict__, default=str)
    assert "recipient@f3local.dev" not in recorded
    assert "unexpected@f3local.dev" not in recorded

    transport.smtp.assert_not_called()
    transport.smtp_ssl.assert_not_called()


@pytest.mark.parametrize(
    "operation,stage,error",
    [
        pytest.param(
            "connect",
            "connect",
            ConnectionRefusedError("synthetic-password recipient@f3local.dev Synthetic private body"),
            id="connection",
        ),
        pytest.param(
            "starttls",
            "tls",
            ssl.SSLError("synthetic-password recipient@f3local.dev Synthetic private body"),
            id="tls",
        ),
        pytest.param(
            "login",
            "authentication",
            sendmail.smtplib.SMTPAuthenticationError(
                535, b"synthetic-password recipient@f3local.dev Synthetic private body"
            ),
            id="authentication",
        ),
        pytest.param(
            "send_message",
            "send",
            sendmail.smtplib.SMTPRecipientsRefused(
                {"recipient@f3local.dev": (550, b"synthetic-password Synthetic private body")}
            ),
            id="recipient_refusal",
        ),
        pytest.param(
            "exit",
            "close",
            sendmail.smtplib.SMTPResponseException(
                421, b"synthetic-password recipient@f3local.dev Synthetic private body"
            ),
            id="quit",
        ),
    ],
)
def test_smtp_failures_report_safe_diagnostic_metadata(transport, monkeypatch, caplog, operation, stage, error):
    monkeypatch.setenv("EMAIL_SERVER", "smtp://apikey:synthetic-password@smtp.example.com:587")
    if operation == "connect":
        transport.smtp.side_effect = error
    elif operation == "exit":
        transport.client.__exit__.side_effect = error
    else:
        getattr(transport.client, operation).side_effect = error

    with caplog.at_level(logging.ERROR):
        result = sendmail.send_via_sendgrid(
            "recipient@f3local.dev", "Synthetic private subject", "Synthetic private body"
        )

    assert result is False
    record = next(record for record in caplog.records if record.getMessage().startswith("slackbot.email.send_failed"))
    assert record.msg == "slackbot.email.send_failed stage=%s error_type=%s"
    assert record.json_fields == {
        "event": "slackbot.email.send_failed",
        "stage": stage,
        "error_type": type(error).__name__,
    }
    local_output = logging.Formatter().format(record)
    assert local_output == f"slackbot.email.send_failed stage={stage} error_type={type(error).__name__}"
    assert record.exc_info is None
    assert record.stack_info is None
    recorded = json.dumps(record.__dict__, default=str)
    for private_value in ("synthetic-password", "recipient@f3local.dev", "Synthetic private"):
        assert private_value not in caplog.text
        assert private_value not in recorded
    transport.legacy.assert_not_called()
    if operation != "connect":
        transport.client.__exit__.assert_called_once()
    if operation == "starttls":
        transport.client.login.assert_not_called()
        transport.client.send_message.assert_not_called()


def test_invalid_configuration_reports_validation_stage_without_endpoint_details(transport, monkeypatch, caplog):
    monkeypatch.setenv("EMAIL_SERVER", "smtp://apikey:synthetic-password@smtp.example.com:invalid")

    with caplog.at_level(logging.ERROR):
        assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is False

    record = next(record for record in caplog.records if record.getMessage().startswith("slackbot.email.send_failed"))
    assert record.json_fields == {
        "event": "slackbot.email.send_failed",
        "stage": "validation",
        "error_type": "ValueError",
    }
    recorded = json.dumps(record.__dict__, default=str)
    for private_value in ("apikey", "synthetic-password", "smtp.example.com", "recipient@f3local.dev"):
        assert private_value not in recorded
    transport.smtp.assert_not_called()
    transport.smtp_ssl.assert_not_called()


def test_production_structured_log_serializes_safe_failure_metadata(transport, caplog):
    transport.client.send_message.side_effect = sendmail.smtplib.SMTPRecipientsRefused(
        {"recipient@f3local.dev": (550, b"synthetic-password Synthetic private body")}
    )

    with caplog.at_level(logging.ERROR):
        assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is False

    record = next(record for record in caplog.records if record.getMessage().startswith("slackbot.email.send_failed"))
    handler = StructuredLogHandler()
    try:
        assert handler.filter(record)
        serialized = handler.format(record)
    finally:
        handler.close()
    payload = json.loads(serialized)
    assert payload["event"] == "slackbot.email.send_failed"
    assert payload["message"] == "slackbot.email.send_failed stage=send error_type=SMTPRecipientsRefused"
    assert payload["stage"] == "send"
    assert payload["error_type"] == "SMTPRecipientsRefused"
    for private_value in ("synthetic-password", "recipient@f3local.dev", "Synthetic private"):
        assert private_value not in serialized


def test_remote_server_without_starttls_support_never_sends_plaintext(transport, monkeypatch, caplog):
    monkeypatch.setenv("EMAIL_SERVER", "smtp://smtp.example.com:587")
    transport.client.starttls.side_effect = sendmail.smtplib.SMTPNotSupportedError("Synthetic private provider reply")

    with caplog.at_level(logging.ERROR):
        assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is False

    transport.smtp.assert_called_once()
    transport.smtp_ssl.assert_not_called()
    transport.client.login.assert_not_called()
    transport.client.send_message.assert_not_called()
    transport.client.__exit__.assert_called_once()
    record = next(record for record in caplog.records if record.getMessage().startswith("slackbot.email.send_failed"))
    assert record.json_fields["stage"] == "tls"
    assert record.json_fields["error_type"] == "SMTPNotSupportedError"
    assert "Synthetic private" not in json.dumps(record.__dict__, default=str)


def test_smtps_connection_failure_does_not_fall_back_to_plaintext(transport, monkeypatch, caplog):
    monkeypatch.setenv("EMAIL_SERVER", "smtps://smtp.example.com")
    transport.smtp_ssl.side_effect = ssl.SSLCertVerificationError("Synthetic private provider reply")

    with caplog.at_level(logging.ERROR):
        assert sendmail.send_via_sendgrid("recipient@f3local.dev", "Synthetic", "<p>Body</p>") is False

    transport.smtp_ssl.assert_called_once()
    transport.smtp.assert_not_called()
    transport.client.login.assert_not_called()
    transport.client.send_message.assert_not_called()
    transport.client.__enter__.assert_not_called()
    record = next(record for record in caplog.records if record.getMessage().startswith("slackbot.email.send_failed"))
    assert record.json_fields["stage"] == "connect"
    assert record.json_fields["error_type"] == "SSLCertVerificationError"
    assert "Synthetic private" not in json.dumps(record.__dict__, default=str)


@pytest.mark.parametrize(
    "failure,event",
    [
        ("unconfigured", "slackbot.email.not_configured"),
        ("empty_recipient", "slackbot.email.recipient_missing"),
        ("refusal", "slackbot.email.recipient_refused"),
    ],
)
def test_skipped_or_refused_mail_warns_without_sensitive_details(transport, monkeypatch, caplog, failure, event):
    monkeypatch.setenv("EMAIL_SERVER", "smtp://apikey:synthetic-password@smtp.example.com:587")
    recipient = "recipient@f3local.dev"
    if failure == "unconfigured":
        monkeypatch.delenv("EMAIL_SERVER")
    elif failure == "empty_recipient":
        recipient = ""
    else:
        transport.client.send_message.return_value = {
            "recipient@f3local.dev": (550, b"synthetic-password Synthetic private refusal")
        }

    with caplog.at_level(logging.WARNING):
        assert sendmail.send_via_sendgrid(recipient, "Synthetic private subject", "Synthetic private body") is False

    record = next(record for record in caplog.records if record.name == sendmail.__name__)
    assert record.levelno == logging.WARNING
    assert record.getMessage() == event
    assert record.exc_info is None
    recorded = json.dumps(record.__dict__, default=str)
    for private_value in (
        "apikey",
        "synthetic-password",
        "smtp.example.com",
        "recipient@f3local.dev",
        "Synthetic private",
    ):
        assert private_value not in recorded
    if failure == "refusal":
        transport.client.__exit__.assert_called_once()
    else:
        transport.smtp.assert_not_called()
        transport.smtp_ssl.assert_not_called()
