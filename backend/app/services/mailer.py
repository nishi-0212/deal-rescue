"""Optional SMTP sending for approved drafts."""
from __future__ import annotations

import asyncio
import smtplib
from email.message import EmailMessage

from ..config import get_settings


class MailNotConfigured(RuntimeError):
    pass


def _send(to: str, subject: str, body: str) -> None:
    s = get_settings()
    msg = EmailMessage()
    msg["From"], msg["To"], msg["Subject"] = s.smtp_from, to, subject
    msg.set_content(body)
    with smtplib.SMTP(s.smtp_host, s.smtp_port, timeout=20) as smtp:
        smtp.starttls()
        if s.smtp_user:
            smtp.login(s.smtp_user, s.smtp_password)
        smtp.send_message(msg)


async def send_email(to: str, subject: str, body: str) -> None:
    if not get_settings().smtp_enabled:
        raise MailNotConfigured("Email sending is not set up on the server")
    await asyncio.to_thread(_send, to, subject, body)
