import base64
import io
import json
import logging
import re
from datetime import datetime

import anthropic
from PIL import Image, ImageEnhance

import config

logger = logging.getLogger(__name__)

# Lazily initialised so a missing key shows a clear error at call-time, not import-time
_client: anthropic.Anthropic | None = None


def _get_client() -> anthropic.Anthropic:
    global _client
    if _client is None:
        if not config.ANTHROPIC_API_KEY:
            raise ValueError(
                "ANTHROPIC_API_KEY is not set — add it to your .env file"
            )
        _client = anthropic.Anthropic(api_key=config.ANTHROPIC_API_KEY)
    return _client

PROMPT = """You are a document data extraction assistant specializing in reading both printed and handwritten text.

The critical information is always located in the TOP-LEFT corner of the first page, inside a square grid or table of fields.

Extract exactly two fields from that top-left grid:

1. Formula number — a printed label such as "Formula #", "Formula No.", or "F-" followed by an alphanumeric identifier.
The formula number follows the pattern "MMXX-XXX" or "MMXX-XXXX" — two letters, two digits, a hyphen, then 3 or 4 digits (e.g. "AB12-345", "MR24-1234").
There may be MORE than one formula number: the original printed value plus one or more additional formula numbers handwritten or typed next to it by the user.
If multiple formula numbers are present, return them all as a single comma-separated string (e.g. "AB12-345, CD34-678").
If only one formula number is present, return it as a plain string.

2. Date — the value next to a printed "Date:", "Dated:", or similar label in the grid.
IMPORTANT: this value is almost always HANDWRITTEN by the user, written to the right of the label. The handwriting may be messy, slanted, or partially legible. Look very carefully at any marks to the right of the date label. Accept any date format (e.g. 01/15/2025, 1/15/25, Jan 15 2025, 15-Jan-25).
If the handwriting is unclear, make your best guess rather than returning null — even a partial date like "Jan 2025" or "1/15" is better than nothing.
Also, the initial date value could be clear to you (like 24-May-25) but the user will cross it out and rewrite a different date (like 1/15/25) — in that case, return the final handwritten date, not the initial printed one.
Also, the initial printed date could be empty and the user will write a handwritten date in that empty space — in that case, return the handwritten date.
Also, the user could circle the printed date, it means the date is correct and you should return it as-is, even if it's a partial date like "May 2025".
CRITICAL: After writing the date, the user ALWAYS writes their initials immediately after (e.g. "1/15/25 KT", "19-Jan-26 JB", "01.15.2025MR"). These are 1–3 capital letters and are NOT part of the date. Strip them completely — return only the date digits/month/year, nothing after. For example: "1/15/25 KT" → return "1/15/25". "19Jan26JB" → return "19Jan26".

Respond ONLY with valid JSON, no other text:
{"formula_number": "...", "date": "..."}

IMPORTANT: because the document could be big so the user has to zoom out and capture the entire page, the date and formula number may be small and low-res in the image you receive. Do your best to read them accurately, but if you're unsure, it's better to return null rather than make a guess.
If you can't find a field at all, return null for that field. If the field has been crossed out, DO NOT USE THAT FIELD AT ALL — instead, look for any handwritten text nearby that could be the replacement value. If you find a clear handwritten replacement, return that value. If you find a messy or partially legible handwritten replacement, make your best guess at what it says and return that. But if you can't find any clear handwritten replacement, return null for that field rather than using the crossed-out printed value.
If a field truly cannot be found at all, use null for that field."""

DATE_FORMATS = [
    "%m/%d/%Y", "%m-%d-%Y",
    "%m/%d/%y", "%m-%d-%y",
    "%B %d, %Y", "%B %d %Y",
    "%b %d, %Y", "%b %d %Y",
    "%d %B %Y", "%d %b %Y",
    "%B %d, %y", "%b %d, %y",
    "%d-%b-%Y", "%d-%b-%y",
    "%d%b%Y",   "%d%b%y",
]


def _preprocess_image(image_bytes: bytes, crop_top_left: bool = False) -> bytes:
    """Resize image so longest side <= 1920px and return JPEG bytes.
    If crop_top_left is True, crops to top-left 55% × 40%, enhances contrast
    and sharpness, and upscales to at least 1200px on the longest side so
    small captures don't arrive at Claude as tiny, unreadable images.
    """
    img = Image.open(io.BytesIO(image_bytes))
    if img.mode not in ("RGB", "L"):
        img = img.convert("RGB")
    w, h = img.size
    if crop_top_left:
        img = img.crop((0, 0, int(w * 0.55), int(h * 0.40)))
        # Boost contrast and sharpness to help with handwritten text
        img = ImageEnhance.Contrast(img).enhance(1.5)
        img = ImageEnhance.Sharpness(img).enhance(2.0)
        w, h = img.size
        # Upscale if the crop is too small for reliable OCR
        if max(w, h) < 1200:
            scale = 1200 / max(w, h)
            img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
            w, h = img.size
    max_side = 1920
    if max(w, h) > max_side:
        scale = max_side / max(w, h)
        img = img.resize((int(w * scale), int(h * scale)), Image.LANCZOS)
    buf = io.BytesIO()
    img.save(buf, format="JPEG", quality=92)
    return buf.getvalue()


def normalize_date(raw: str) -> str | None:
    """Convert a raw date string to MM.DD.YYYY. Returns None if unparseable."""
    if not raw:
        return None
    cleaned = " ".join(raw.split()).strip(".,;")
    for fmt in DATE_FORMATS:
        try:
            dt = datetime.strptime(cleaned, fmt)
            return dt.strftime("%m.%d.%Y")
        except ValueError:
            continue
    return None


def process_images(image_bytes_list: list[bytes]) -> dict:
    """
    Send all captured pages to Claude Vision and extract formula number + date.
    Returns: {formula_number, date, normalized_date, confidence}
    """
    # Page 1: send only the top-left header grid to Claude for OCR
    # Remaining pages: send full image
    preprocessed = [
        _preprocess_image(b, crop_top_left=(i == 0))
        for i, b in enumerate(image_bytes_list)
    ]

    content = [{"type": "text", "text": PROMPT}]
    for img_bytes in preprocessed:
        content.append({
            "type": "image",
            "source": {
                "type": "base64",
                "media_type": "image/jpeg",
                "data": base64.standard_b64encode(img_bytes).decode(),
            },
        })

    try:
        client = _get_client()
        response = client.messages.create(
            model=config.CLAUDE_MODEL,
            max_tokens=256,
            messages=[{"role": "user", "content": content}],
        )
        text = next(b.text for b in response.content if b.type == "text")

        match = re.search(r"\{[^{}]*\}", text, re.DOTALL)
        if match:
            data = json.loads(match.group())
            formula = data.get("formula_number") or None
            date_raw = data.get("date") or None
            normalized = normalize_date(date_raw) if date_raw else None
            return {
                "formula_number": formula,
                "date": date_raw,
                "normalized_date": normalized,
                "confidence": "high" if (formula and date_raw) else "low",
            }
        # Model responded but JSON wasn't parseable — treat as low confidence
        return {
            "formula_number": None,
            "date": None,
            "normalized_date": None,
            "confidence": "low",
        }
    except Exception as exc:
        logger.error("Claude OCR failed: %s", exc)
        return {
            "formula_number": None,
            "date": None,
            "normalized_date": None,
            "confidence": "unavailable",
        }
