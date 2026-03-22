import io
import re
import tempfile
import os

from fpdf import FPDF
from PIL import Image, ImageEnhance, ImageFilter


def _safe_name(value: str) -> str:
    """Strip characters unsafe for filenames."""
    return re.sub(r"[^\w\-\.,]", "", value)


def generate_pdf(
    image_bytes_list: list[bytes],
    formula_number: str,
    normalized_date: str,
) -> tuple[str, bytes]:
    """
    Create a PDF from the captured images entirely in memory.
    Returns (filename, pdf_bytes) — nothing is written to disk.
    """
    pdf = FPDF()
    pdf.set_auto_page_break(False)

    tmp_paths = []
    try:
        for img_bytes in image_bytes_list:
            img = Image.open(io.BytesIO(img_bytes))
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")

            # Document enhancement: brightness, contrast, sharpness
            img = ImageEnhance.Brightness(img).enhance(1.1)
            img = ImageEnhance.Contrast(img).enhance(1.25)
            img = img.filter(ImageFilter.UnsharpMask(radius=1.5, percent=150, threshold=3))

            w_px, h_px = img.size
            aspect = h_px / w_px

            page_w_mm = 210.0
            page_h_mm = min(page_w_mm * aspect, 297.0)
            pdf.add_page(format=(page_w_mm, page_h_mm))

            with tempfile.NamedTemporaryFile(suffix=".png", delete=False) as tmp:
                img.save(tmp.name, "PNG")
                tmp_paths.append(tmp.name)

            pdf.image(tmp_paths[-1], x=0, y=0, w=page_w_mm, h=page_h_mm)

        safe_formula = _safe_name(formula_number) if formula_number else "unknown"
        safe_date = _safe_name(normalized_date) if normalized_date else "nodate"
        filename = f"{safe_formula}_{safe_date}.pdf"

        return filename, bytes(pdf.output())

    finally:
        for p in tmp_paths:
            try:
                os.unlink(p)
            except OSError:
                pass
