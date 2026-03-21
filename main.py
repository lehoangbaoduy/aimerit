import asyncio
import logging
import uuid

logging.basicConfig(level=logging.INFO)
from typing import Annotated

from fastapi import FastAPI, Form, HTTPException, Request, UploadFile
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles
from fastapi.templating import Jinja2Templates

import email_sender
import ocr_processor
import pdf_generator

app = FastAPI()
app.mount("/static", StaticFiles(directory="static"), name="static")
templates = Jinja2Templates(directory="templates")

# session_id -> (filename, pdf_bytes) — in-memory, clears on restart
_pdf_sessions: dict[str, tuple[str, bytes]] = {}


@app.get("/")
async def index(request: Request):
    return templates.TemplateResponse("index.html", {"request": request})


@app.post("/process-images")
async def process_images_route(images: list[UploadFile]):
    if not images:
        raise HTTPException(status_code=400, detail="No images provided")
    image_bytes_list = [await img.read() for img in images]
    result = await asyncio.to_thread(ocr_processor.process_images, image_bytes_list)
    return result


@app.post("/generate-pdf")
async def generate_pdf_route(
    images: list[UploadFile],
    formula_number: Annotated[str, Form()],
    date: Annotated[str, Form()],
    normalized_date: Annotated[str, Form()],
):
    if not images:
        raise HTTPException(status_code=400, detail="No images provided")
    image_bytes_list = [await img.read() for img in images]
    try:
        filename, pdf_bytes = await asyncio.to_thread(
            pdf_generator.generate_pdf, image_bytes_list, formula_number, normalized_date
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))

    session_id = str(uuid.uuid4())
    _pdf_sessions[session_id] = (filename, pdf_bytes)
    return {"filename": filename, "session_id": session_id}


@app.post("/send-email")
async def send_email_route(
    session_id: Annotated[str, Form()],
    recipient_email: Annotated[str, Form()],
):
    entry = _pdf_sessions.get(session_id)
    if not entry:
        raise HTTPException(status_code=404, detail="PDF not found")
    filename, pdf_bytes = entry
    formula_number = filename.rsplit("_", 1)[0]
    try:
        await asyncio.to_thread(
            email_sender.send_email, pdf_bytes, filename, recipient_email, formula_number
        )
    except Exception as exc:
        raise HTTPException(status_code=500, detail=str(exc))
    return {"success": True}


@app.get("/exports/{session_id}")
async def download_pdf(session_id: str):
    entry = _pdf_sessions.get(session_id)
    if not entry:
        raise HTTPException(status_code=404, detail="PDF not found")
    filename, pdf_bytes = entry
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": f'attachment; filename="{filename}"'},
    )
