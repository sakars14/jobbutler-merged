from __future__ import annotations
import imaplib, email, os, datetime as dt
from email import policy
from dotenv import load_dotenv
from src.storage.db import upsert_jobs
from src.harvest.sources import to_rows, dedupe
from .email_parser import parse_naukri_email_html

load_dotenv()

SENDERS = [
    "naukri",
    "naukri.com",
    "jobseeker@naukri.com",
    "noreply@naukri.com",
]

MAILBOXES = ["INBOX", "[Gmail]/All Mail"]  # try All Mail if INBOX misses

def _imap_login():
    host = os.getenv("IMAP_HOST", "imap.gmail.com")
    user = os.getenv("IMAP_USER")
    pwd  = os.getenv("IMAP_PASS")
    if not user or not pwd:
        raise RuntimeError("IMAP_USER/IMAP_PASS not set in .env")
    M = imaplib.IMAP4_SSL(host, 993)
    M.login(user, pwd)
    return M

def _since_date(days: int) -> str:
    d = dt.datetime.utcnow() - dt.timedelta(days=days)
    return d.strftime("%d-%b-%Y")  # e.g. 01-Jan-2025

def _search_uids_union(M, since: str) -> list[bytes]:
    uids = set()
    for s in SENDERS:
        typ, data = M.search(None, "SINCE", since, "FROM", s)
        if typ == "OK" and data and data[0]:
            for u in data[0].split():
                uids.add(u)
    return sorted(uids)  # stable order

def ingest(days: int = 10, max_msgs: int = 50) -> int:
    M = _imap_login()
    try:
        since = _since_date(days)
        all_jobs = []
        got_any = False

        for mb in MAILBOXES:
            try:
                M.select(mb)
            except imaplib.IMAP4.error:
                continue
            uids = _search_uids_union(M, since)
            if not uids:
                continue
            got_any = True
            uids = uids[-max_msgs:]
            for uid in uids:
                typ, data = M.fetch(uid, "(RFC822)")
                if typ != "OK" or not data or not data[0]:
                    continue
                raw = data[0][1]
                msg = email.message_from_bytes(raw, policy=policy.default)
                parts = []
                if msg.is_multipart():
                    for part in msg.walk():
                        if part.get_content_type() == "text/html":
                            parts.append(part.get_content())
                else:
                    if msg.get_content_type() == "text/html":
                        parts.append(msg.get_content())
                for html in parts:
                    try:
                        jobs = parse_naukri_email_html(html)
                    except Exception:
                        jobs = []
                    all_jobs.extend(jobs)

            # if we found some in this mailbox, no need to scan the next
            if all_jobs:
                break

        if not got_any:
            print("[naukri] No matching emails found in INBOX or All Mail.")
            return 0

        rows = to_rows(dedupe([type("Obj",(object,),j) for j in all_jobs]))
        upsert_jobs(rows)
        return len(rows)
    finally:
        try:
            M.logout()
        except Exception:
            pass