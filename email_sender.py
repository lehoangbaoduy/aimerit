import logging
import smtplib
from email.message import EmailMessage

import config

logger = logging.getLogger(__name__)


def send_email(
    pdf_bytes: bytes,
    filename: str,
    recipient_email: str,
    formula_number: str,
) -> None:
    """
    Send an email with the PDF attached via SMTP SSL.
    Raises on failure so the caller can return an appropriate error response.
    """
    msg = EmailMessage()
    msg["Subject"] = f"Document: Formula {formula_number}"
    msg["From"] = config.SMTP_FROM
    msg["To"] = recipient_email
    msg.set_content(
        f"Please find the scanned document for Formula {formula_number} attached."
    )
    msg.add_attachment(
        pdf_bytes,
        maintype="application",
        subtype="pdf",
        filename=filename,
    )

    logger.info("Connecting to %s:%s as %s", config.SMTP_HOST, config.SMTP_PORT, config.SMTP_USER)
    try:
        with smtplib.SMTP_SSL(config.SMTP_HOST, config.SMTP_PORT, timeout=8) as smtp:
            smtp.login(config.SMTP_USER, config.SMTP_PASSWORD)
            smtp.send_message(msg)
        logger.info("Email sent to %s", recipient_email)
    except Exception as exc:
        logger.error("SMTP error: %s", exc)
        raise
