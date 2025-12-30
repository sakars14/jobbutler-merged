from __future__ import annotations
import imaplib, email, re, os
from datetime import datetime, timedelta
from email.header import decode_header, make_header
from bs4 import BeautifulSoup
from dotenv import load_dotenv

from src.harvest.sources import to_rows, dedupe
from src.storage.db import upsert_jobs

# ---- helpers ---------------------------------------------------------------

def _since_date(days: int) -> str:
    # IMAP date like 01-Jan-2025
    return (datetime.utcnow() - timedelta(days=days)).strftime("%d-%b-%Y")

def _login():
    load_dotenv()
    host = os.getenv("IMAP_HOST", "imap.gmail.com")
    user = os.getenv("IMAP_USER")
    pw   = os.getenv("IMAP_PASS")
    M = imaplib.IMAP4_SSL(host)
    M.login(user, pw)
    return M

def _h(val) -> str:
    """Decode RFC-2047/MIME headers to plain str."""
    if val is None: return ""
    try:
        return str(make_header(decode_header(val)))
    except Exception:
        try:
            return val.decode(errors="ignore")
        except Exception:
            return str(val)

_JOB_ID = re.compile(r"jobs/view/(\d+)")

def _canonicalize_link(href: str) -> str | None:
    """
    Accepts both .../jobs/view/<id>/... and .../comm/jobs/view/<id>/...
    Returns canonical: https://www.linkedin.com/jobs/view/<id>/
    """
    if "linkedin.com" not in href or "jobs/view" not in href:
        return None
    m = _JOB_ID.search(href)
    if not m:
        return None
    jid = m.group(1)
    return f"https://www.linkedin.com/jobs/view/{jid}/"

def _extract_from_html(html: str) -> list[dict]:
    soup = BeautifulSoup(html, "lxml")
    jobs = []
    for a in soup.find_all("a", href=True):
        canon = _canonicalize_link(a["href"])
        if not canon:
            continue
        title = (a.get_text(" ", strip=True) or "LinkedIn Job").strip()
        jobs.append({
            "url": canon,
            "title": title,
            "company": "",
            "location": "",
            "source": "linkedin_email",
            "jd_text": "",
            "posted_at": datetime.utcnow().isoformat(timespec="seconds"),
        })
    return jobs

def _extract_from_text(text: str) -> list[dict]:
    jobs = []
    # Find any linkedin link that contains jobs/view/<id>
    for m in re.finditer(r"https?://[^\s)>\"]*linkedin\.com[^\s)>\"]*jobs/view/\d+[^\s)>\"]*", text):
        canon = _canonicalize_link(m.group(0))
        if not canon:
            continue
        # Try to grab a preceding line as the title (often line above 'View job:')
        start = m.start()
        prev_line = text[:start].splitlines()[-1].strip()
        title = prev_line if prev_line and len(prev_line) < 140 else "LinkedIn Job"
        jobs.append({
            "url": canon,
            "title": title,
            "company": "",
            "location": "",
            "source": "linkedin_email",
            "jd_text": "",
            "posted_at": datetime.utcnow().isoformat(timespec="seconds"),
        })
    return jobs

# ---- entry point -----------------------------------------------------------

def ingest(days: int = 30, max_msgs: int = 200) -> int:
    M = _login()
    # INBOX is fine for Gmail alerts; if you store alerts elsewhere, adjust here.
    typ, _ = M.select("INBOX")
    if typ != "OK":
        M.logout()
        return 0

    typ, data = M.search(None, f'(SINCE "{_since_date(days)}")')
    if typ != "OK":
        M.logout()
        return 0

    msg_ids = data[0].split()
    if max_msgs:
        msg_ids = msg_ids[-max_msgs:]

    all_jobs = []
    for mid in reversed(msg_ids):
        typ, msg_data = M.fetch(mid, "(RFC822)")
        if typ != "OK" or not msg_data or msg_data[0] is None:
            continue

        msg = email.message_from_bytes(msg_data[0][1])
        from_addr = email.utils.parseaddr(_h(msg.get("From")))[1].lower()
        subj = _h(msg.get("Subject")).lower()

        # Keep only likely LinkedIn alerts
        if "linkedin" not in from_addr and "linkedin" not in subj:
            continue
        if not any(k in subj for k in ["job", "jobs", "alert", "recommended", "hiring", "savedsearch"]):
            # LinkedIn marks class/headers differently; broaden slightly.
            pass

        html_bytes = None
        text_bytes = None
        if msg.is_multipart():
            for part in msg.walk():
                ctype = part.get_content_type()
                if ctype == "text/html":
                    html_bytes = part.get_payload(decode=True)
                elif ctype == "text/plain":
                    text_bytes = part.get_payload(decode=True)
        else:
            ctype = msg.get_content_type()
            if ctype == "text/html":
                html_bytes = msg.get_payload(decode=True)
            elif ctype == "text/plain":
                text_bytes = msg.get_payload(decode=True)

        # Prefer HTML but also parse text/plain (your sample has great links in text)
        if html_bytes:
            try:
                all_jobs.extend(_extract_from_html(html_bytes.decode(errors="ignore")))
            except Exception:
                pass
        if text_bytes:
            try:
                all_jobs.extend(_extract_from_text(text_bytes.decode(errors="ignore")))
            except Exception:
                pass

    M.close(); M.logout()

    # Deduplicate and upsert
    all_jobs = dedupe(all_jobs)
    upsert_jobs(to_rows(all_jobs))
    return len(all_jobs)