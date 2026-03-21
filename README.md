# AIMerit

A mobile-first web app for scanning manufacturing documents, extracting formula numbers and dates via AI, generating PDFs, and sending them by email — all from an iPhone.

## Features

- **Camera scanning** — uses the phone's back camera with a draggable crop rectangle
- **Multi-page support** — capture multiple pages per document, with a live stacked thumbnail preview
- **AI OCR** — Claude Vision extracts formula number and date (including handwritten values)
- **Review & correct** — confirm or edit extracted fields before generating the PDF
- **PDF generation** — creates a named PDF (`FormulaXX_mm.dd.yyyy.pdf`) entirely in memory
- **Email delivery** — sends the PDF as an email attachment via Gmail
- **No storage** — PDFs are never written to disk; everything lives in memory

## Tech Stack

| Layer | Technology |
|---|---|
| Backend | FastAPI + uvicorn |
| Frontend | Vanilla HTML5 / JS / CSS |
| OCR | Claude Vision API (`claude-sonnet-4-6`) |
| PDF | fpdf2 |
| Email | smtplib (Gmail SMTP SSL) |
| Image processing | Pillow |
| Hosting | Railway |

## Getting Started (local)

**1. Clone and install**
```bash
git clone https://github.com/YOUR_USERNAME/merit-ocr.git
cd merit-ocr
python -m venv .venv
.venv\Scripts\activate      # Windows
pip install -r requirements.txt
```

**2. Configure environment**
```bash
cp .env.example .env
```

Edit `.env`:
```
ANTHROPIC_API_KEY=sk-ant-...
SMTP_HOST=smtp.gmail.com
SMTP_PORT=465
SMTP_USER=your@gmail.com
SMTP_PASSWORD=xxxx xxxx xxxx xxxx
SMTP_FROM=your@gmail.com
```

> Gmail requires an [App Password](https://myaccount.google.com/apppasswords) (not your regular password). 2-Step Verification must be enabled.

**3. Run**
```bash
uvicorn main:app --host 0.0.0.0 --port 8000
```

Open `http://localhost:8000` in a browser.

> **iPhone testing requires HTTPS.** Use [ngrok](https://ngrok.com) or deploy to Railway (see below).

## Deployment (Railway)

1. Push to GitHub
2. Go to [railway.app](https://railway.app) → New Project → Deploy from GitHub
3. Add environment variables in the **Variables** tab
4. Go to **Settings → Networking → Generate Domain**
5. Open the `https://` URL in **Safari on iPhone** → tap Allow for camera

Redeploy any time with `git push`.

## Document Format

The app is optimised for documents where the **top-left corner of page 1** contains a grid with:

- **Formula number** — format `MMXX-XXX` or `MMXX-XXXX` (e.g. `AB12-345`)
- **Date** — usually handwritten by the user next to a printed `Date:` label, followed by initials

Claude handles crossed-out dates, circled dates, multiple formula numbers, and partially legible handwriting.

## Environment Variables

| Variable | Description | Default |
|---|---|---|
| `ANTHROPIC_API_KEY` | Anthropic API key | required |
| `CLAUDE_MODEL` | Claude model to use | `claude-sonnet-4-6` |
| `SMTP_HOST` | SMTP server hostname | `smtp.gmail.com` |
| `SMTP_PORT` | SMTP port | `465` |
| `SMTP_USER` | SMTP login username | required |
| `SMTP_PASSWORD` | SMTP app password | required |
| `SMTP_FROM` | From address in emails | same as `SMTP_USER` |

## Cost

- **Claude API** — ~$0.007 per scan (fractions of a cent)
- **Railway** — free tier available
- **Gmail SMTP** — free
- **Storage** — none (PDFs are in-memory only)
