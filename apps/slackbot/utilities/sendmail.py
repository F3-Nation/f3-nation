import logging
import os
import smtplib
import ssl
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, List
from urllib.parse import unquote, urlsplit

logger = logging.getLogger(__name__)


def send_via_sendgrid(
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str | None = None,
) -> bool:
    """Send HTML mail using EMAIL_SERVER, retaining the legacy callable name.

    Args:
        to_email: Recipient email address
        subject: Email subject line
        html_content: HTML body content
        from_email: Sender override; otherwise EMAIL_FROM or noreply@f3nation.com

    Returns:
        True if SMTP submission and cleanup finish without reported errors,
        False otherwise. SMTP acceptance does not confirm final inbox delivery.
        Cleanup failure or partial refusal can return False after acceptance.
    """
    server_url = os.getenv("EMAIL_SERVER")
    if not server_url:
        logger.warning("slackbot.email.not_configured")
        return False

    if not to_email:
        logger.warning("slackbot.email.recipient_missing")
        return False

    stage = "validation"
    try:
        endpoint = urlsplit(server_url)
        if (
            endpoint.scheme not in {"smtp", "smtps"}
            or not endpoint.hostname
            or endpoint.path not in {"", "/"}
            or endpoint.query
            or endpoint.fragment
            or any(character.isspace() or ord(character) < 32 for character in server_url)
        ):
            raise ValueError("Invalid SMTP endpoint")

        port = endpoint.port
        if port is None:
            port = 465 if endpoint.scheme == "smtps" else 587
        if not 1 <= port <= 65535:
            raise ValueError("Invalid SMTP port")

        username = unquote(endpoint.username, errors="strict") if endpoint.username is not None else None
        password = unquote(endpoint.password, errors="strict") if endpoint.password is not None else None
        if username is not None or password is not None:
            if (
                not username
                or not password
                or any(ord(character) < 32 or ord(character) == 127 for character in username + password)
            ):
                raise ValueError("Invalid SMTP credentials")

        stage = "message"
        message = EmailMessage()
        message["From"] = from_email if from_email is not None else os.getenv("EMAIL_FROM") or "noreply@f3nation.com"
        message["To"] = to_email
        message["Subject"] = subject
        message.set_content(html_content, subtype="html")

        implicit_tls = endpoint.scheme == "smtps"
        stage = "connect"
        if implicit_tls:
            connection = smtplib.SMTP_SSL(endpoint.hostname, port, timeout=10, context=ssl.create_default_context())
        else:
            connection = smtplib.SMTP(endpoint.hostname, port, timeout=10)
        with connection as server:
            # Only an unauthenticated loopback catcher may receive plaintext.
            if not implicit_tls and (
                username is not None or endpoint.hostname not in {"localhost", "127.0.0.1", "::1"}
            ):
                stage = "tls"
                server.starttls(context=ssl.create_default_context())
            if username is not None:
                stage = "authentication"
                server.login(username, password)
            stage = "send"
            refused = server.send_message(message)
            stage = "close"

        if refused:
            logger.warning("slackbot.email.recipient_refused")
            return False
        logger.info("slackbot.email.sent")
        return True
    except Exception as error:
        logger.error(
            "slackbot.email.send_failed stage=%s error_type=%s",
            stage,
            type(error).__name__,
            extra={
                "json_fields": {
                    "event": "slackbot.email.send_failed",
                    "stage": stage,
                    "error_type": type(error).__name__,
                }
            },
        )
        return False


def send(
    subject: str,
    body: str,
    email_server: str,
    email_server_port: int,
    email_user: str,
    email_password: str,
    email_to: str,
    attachments: List[Dict[str, Any]],
):
    """Construct and sends an email.

    Args:
        subject (str): email subject
        body (str): email body
        email_server (str): email server
        email_server_port (str): email server port
        email_user (str): email user address
        email_password (str): email password
        email_to (str): email recipient address
        attachments (List[Dict[str, Any]]): list of attachments, each attachment is a dict with keys "filepath" and
            "meta", where meta includes filename, maintype, and subtype
    """
    msg = EmailMessage()
    msg.set_content(body)

    msg["Subject"] = subject
    msg["From"] = email_user
    msg["To"] = email_to

    for file in attachments:
        with Path(file["filepath"]).open("rb") as f:
            msg.add_attachment(f.read(), **file["meta"])

    if email_server and email_server_port and email_user and email_password and email_to:
        server = smtplib.SMTP(email_server, email_server_port)
        server.starttls()
        server.login(email_user, email_password)
        server.send_message(msg)
        server.close()
