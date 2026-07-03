import logging
import os
import smtplib
from email.message import EmailMessage
from pathlib import Path
from typing import Any, Dict, List

logger = logging.getLogger(__name__)


def send_via_sendgrid(
    to_email: str,
    subject: str,
    html_content: str,
    from_email: str = "noreply@f3nation.com",
) -> bool:
    """Send an email using SendGrid API.

    Args:
        to_email: Recipient email address
        subject: Email subject line
        html_content: HTML body content
        from_email: Sender email address (default: noreply@f3nation.com)

    Returns:
        True if email was sent successfully, False otherwise
    """
    api_key = os.getenv("SENDGRID_API_KEY")
    if not api_key:
        logger.warning("SENDGRID_API_KEY not configured, skipping email send")
        return False

    if not to_email:
        logger.warning("No recipient email provided, skipping email send")
        return False

    try:
        from sendgrid import SendGridAPIClient
        from sendgrid.helpers.mail import Mail

        message = Mail(
            from_email=from_email,
            to_emails=to_email,
            subject=subject,
            html_content=html_content,
        )
        sg = SendGridAPIClient(api_key)
        response = sg.send(message)
        logger.info(f"SendGrid email sent to {to_email}, status: {response.status_code}")
        return response.status_code in (200, 201, 202)
    except Exception as e:
        logger.error(f"Failed to send email via SendGrid: {e}")
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
