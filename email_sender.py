import logging
import base64

import resend

import config

logger = logging.getLogger(__name__)


def send_email(
    pdf_bytes: bytes,
    filename: str,
    recipient_email: str,
    formula_number: str,
) -> None:
    resend.api_key = config.RESEND_API_KEY

    logger.info("Sending email to %s via Resend", recipient_email)
    try:
        resend.Emails.send({
            "from": config.SMTP_FROM,
            "to": [recipient_email],
            "subject": f"Document: Formula {formula_number}",
            "text": f"Please find the scanned document for Formula {formula_number} attached.",
            "attachments": [{
                "filename": filename,
                "content": list(pdf_bytes),
            }],
        })
        logger.info("Email sent to %s", recipient_email)
    except Exception as exc:
        logger.error("Resend error: %s", exc)
        raise
