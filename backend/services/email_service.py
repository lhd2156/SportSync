"""
SportSync email service.

Provides a thin SMTP wrapper for transactional emails such as
password reset codes. Uses stdlib so no extra dependency is required.
"""

from __future__ import annotations

import logging
import smtplib
from email.message import EmailMessage
from html import escape

from config import settings

logger = logging.getLogger(__name__)


def email_delivery_configured() -> bool:
    """Return whether the configured transactional email transport can send mail."""
    provider = settings.email_delivery_provider.strip().lower()
    if provider == "smtp":
        return _smtp_delivery_configured()
    if provider == "ses":
        return _ses_delivery_configured()
    return _smtp_delivery_configured() or _ses_delivery_configured()


def _smtp_delivery_configured() -> bool:
    return all(
        [
            settings.smtp_host.strip(),
            settings.smtp_username.strip(),
            settings.smtp_password.strip(),
            settings.smtp_from_email.strip(),
        ]
    )


def _ses_delivery_configured() -> bool:
    return bool(settings.smtp_from_email.strip() and settings.aws_region.strip())


def _build_email_message(*, to_email: str, subject: str, html_body: str, text_body: str) -> EmailMessage:
    message = EmailMessage()
    message["Subject"] = subject
    message["From"] = (
        f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        if settings.smtp_from_name.strip()
        else settings.smtp_from_email
    )
    message["To"] = to_email
    message.set_content(text_body)
    message.add_alternative(html_body, subtype="html")
    return message


def send_email(*, to_email: str, subject: str, html_body: str, text_body: str) -> None:
    """Send an email via the configured transactional email transport."""
    if not email_delivery_configured():
        raise RuntimeError("Transactional email delivery is not configured.")

    provider = settings.email_delivery_provider.strip().lower()
    if provider == "ses":
        _send_email_via_ses(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )
        return

    if provider == "auto" and not _smtp_delivery_configured() and _ses_delivery_configured():
        _send_email_via_ses(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )
        return

    message = _build_email_message(
        to_email=to_email,
        subject=subject,
        html_body=html_body,
        text_body=text_body,
    )

    if settings.smtp_use_ssl:
        with smtplib.SMTP_SSL(settings.smtp_host, settings.smtp_port, timeout=20) as server:
            server.login(settings.smtp_username, settings.smtp_password)
            server.send_message(message)
        return

    with smtplib.SMTP(settings.smtp_host, settings.smtp_port, timeout=20) as server:
        server.ehlo()
        if settings.smtp_use_tls:
            server.starttls()
            server.ehlo()
        server.login(settings.smtp_username, settings.smtp_password)
        server.send_message(message)


def _send_email_via_ses(*, to_email: str, subject: str, html_body: str, text_body: str) -> None:
    import boto3

    client_kwargs: dict[str, object] = {
        "region_name": settings.aws_region.strip() or None,
        "aws_access_key_id": settings.aws_access_key_id.strip() or None,
        "aws_secret_access_key": settings.aws_secret_access_key.strip() or None,
    }
    client = boto3.client("sesv2", **client_kwargs)
    sender = (
        f"{settings.smtp_from_name} <{settings.smtp_from_email}>"
        if settings.smtp_from_name.strip()
        else settings.smtp_from_email
    )

    send_kwargs: dict[str, object] = {
        "FromEmailAddress": sender,
        "Destination": {"ToAddresses": [to_email]},
        "Content": {
            "Simple": {
                "Subject": {"Data": subject, "Charset": "UTF-8"},
                "Body": {
                    "Text": {"Data": text_body, "Charset": "UTF-8"},
                    "Html": {"Data": html_body, "Charset": "UTF-8"},
                },
            }
        },
    }
    configuration_set = settings.aws_ses_configuration_set.strip()
    if configuration_set:
        send_kwargs["ConfigurationSetName"] = configuration_set

    client.send_email(**send_kwargs)


def send_password_reset_code_email(*, to_email: str, code: str, expires_minutes: int) -> None:
    """Send the one-time password reset code email."""
    escaped_code = escape(code)
    subject = "SportSync reset code"
    text_body = (
        "SportSync password reset\n\n"
        f"Verification code: {code}\n"
        f"Expires in: {expires_minutes} minutes\n\n"
        "Enter this code in the SportSync reset form.\n"
        "If you did not request this, you can ignore this email."
    )
    html_body = f"""
    <html>
      <body style="margin:0; padding:24px; font-family: Arial, sans-serif; background:#0B1020; color:#F7F7F8;">
        <div style="max-width:520px; margin:0 auto; background:#121726; border:1px solid #1F2940; border-radius:18px; padding:32px;">
          <div style="display:flex; align-items:center; gap:12px; margin:0 0 24px;">
            <div style="width:36px; height:36px; border-radius:999px; border:2px solid #3B82F6; color:#3B82F6; display:flex; align-items:center; justify-content:center; font-weight:700; font-size:18px; line-height:1;">S</div>
            <div style="font-size:22px; font-weight:700; color:#FFFFFF; letter-spacing:-0.02em;">SportSync</div>
          </div>

          <h1 style="margin:0 0 10px; font-size:24px; line-height:1.2; color:#FFFFFF;">Password reset code</h1>
          <p style="margin:0 0 20px; color:#B8C1D7; line-height:1.6;">
            Enter this verification code in the SportSync reset form.
          </p>

          <div style="margin:0 0 20px; padding:18px 16px; border-radius:14px; background:#0D1425; border:1px solid #263450; text-align:center;">
            <div style="font-size:12px; text-transform:uppercase; letter-spacing:0.26em; color:#8EA0C9; margin:0 0 10px;">Verification code</div>
            <div style="letter-spacing:0.28em; font-size:32px; font-weight:700; color:#FFFFFF;">{escaped_code}</div>
          </div>

          <p style="margin:0 0 8px; color:#F7F7F8; line-height:1.6;">
            Expires in <strong>{expires_minutes} minutes</strong>.
          </p>

          <p style="margin:0 0 20px; color:#8B96B3; line-height:1.6;">
            If you did not request this change, you can safely ignore this email.
          </p>

          <div style="padding-top:20px; border-top:1px solid #1F2940; color:#8B96B3; font-size:13px; line-height:1.6;">
            SportSync account security
          </div>
        </div>
      </body>
    </html>
    """
    try:
        send_email(
            to_email=to_email,
            subject=subject,
            html_body=html_body,
            text_body=text_body,
        )
    except Exception:
        logger.exception("Failed sending password reset code email to %s", to_email)
        raise
