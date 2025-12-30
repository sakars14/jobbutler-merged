from __future__ import annotations

import base64
from typing import List, Tuple

import requests

from src.storage.gmail_connections import get_fresh_access_token
from src.storage.db import upsert_jobs
from src.harvest.sources import to_rows, dedupe
from src.naukri.email_parser import parse_naukri_email_html
from src.linkedin.email_ingest_imap import (
    _extract_from_html as linkedin_extract_from_html,
    _extract_from_text as linkedin_extract_from_text,
)

GMAIL_API_BASE = "https://gmail.googleapis.com/gmail/v1"


def _gmail_list_ids(access_token: str, query: str, max_results: int) -> List[str]:
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"q": query, "maxResults": max_results}
    resp = requests.get(
        f"{GMAIL_API_BASE}/users/me/messages",
        headers=headers,
        params=params,
        timeout=10,
    )
    if resp.status_code != 200:
        print("[gmail] list failed:", resp.text)
        return []
    data = resp.json()
    return [m["id"] for m in data.get("messages", [])]


def _decode_part(part: dict) -> str:
    data = (part.get("body") or {}).get("data")
    if not data:
        return ""
    return base64.urlsafe_b64decode(data.encode()).decode("utf-8", "ignore")


def _find_parts(payload: dict, mime_type: str) -> List[dict]:
    found: List[dict] = []
    if payload.get("mimeType") == mime_type:
        found.append(payload)
    for p in payload.get("parts") or []:
        found.extend(_find_parts(p, mime_type))
    return found


def _get_body_and_type(payload: dict) -> Tuple[str, str | None]:
    # Prefer HTML, fall back to plain text
    for mt in ("text/html", "text/plain"):
        parts = _find_parts(payload, mt)
        if parts:
            return _decode_part(parts[0]), mt
    return "", None


def _gmail_get_body(access_token: str, msg_id: str) -> Tuple[str, str | None]:
    headers = {"Authorization": f"Bearer {access_token}"}
    params = {"format": "full"}
    resp = requests.get(
        f"{GMAIL_API_BASE}/users/me/messages/{msg_id}",
        headers=headers,
        params=params,
        timeout=10,
    )
    if resp.status_code != 200:
        print("[gmail] get failed:", resp.text)
        return "", None
    msg = resp.json()
    payload = msg.get("payload") or {}
    return _get_body_and_type(payload)


def ingest_gmail_job_alerts(uid: str, max_messages: int = 50) -> int:
    """
    For a given uid:
      1) Get a fresh Gmail access token.
      2) Search for Naukri + LinkedIn job alert emails.
      3) Parse them into job postings.
      4) Upsert into jobs table.
    Returns the number of job rows inserted (after de-duplication).
    """
    access_token = get_fresh_access_token(uid)

    # We keep queries simple for now; can tune later.
    queries = [
        ("naukri", "from:(naukri.com) newer_than:30d"),
        ("linkedin", "from:(linkedin.com) newer_than:30d"),
    ]

    all_jobs: list[dict] = []

    for label, q in queries:
        ids = _gmail_list_ids(access_token, q, max_results=max_messages)
        if not ids:
            continue

        for msg_id in ids:
            body, ctype = _gmail_get_body(access_token, msg_id)
            if not body:
                continue

            try:
                if label == "naukri":
                    # Prefer HTML parsing for Naukri
                    if ctype == "text/html":
                        jobs = parse_naukri_email_html(body)
                        all_jobs.extend(jobs)
                elif label == "linkedin":
                    if ctype == "text/html":
                        jobs = linkedin_extract_from_html(body)
                    else:
                        jobs = linkedin_extract_from_text(body)
                    all_jobs.extend(jobs)
            except Exception as e:
                print(f"[gmail ingest] parse error for {label}: {e}")

    if not all_jobs:
        print("[gmail ingest] No jobs parsed from Gmail alerts.")
        return 0

    # Reuse existing pipeline: to_rows + dedupe + upsert_jobs
    rows = to_rows(dedupe([type("Obj", (object,), j) for j in all_jobs]))
    upsert_jobs(rows)
    print(f"[gmail ingest] Inserted {len(rows)} rows into jobs table.")
    return len(rows)
