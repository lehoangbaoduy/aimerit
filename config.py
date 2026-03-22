import os
from dotenv import load_dotenv

load_dotenv()

# Claude API settings
ANTHROPIC_API_KEY = os.getenv("ANTHROPIC_API_KEY", "")
CLAUDE_MODEL = os.getenv("CLAUDE_MODEL", "claude-sonnet-4-6")

# Email settings (Resend)
RESEND_API_KEY = os.getenv("RESEND_API_KEY", "")
SMTP_FROM = os.getenv("SMTP_FROM", "")
