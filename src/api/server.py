from __future__ import annotations
from fastapi import FastAPI, Body, Query, HTTPException
from fastapi.responses import RedirectResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import json, os, subprocess, time, secrets, smtplib
from email.message import EmailMessage
from urllib.parse import urlencode

import requests  # already in requirements.txt

#from src.storage.gmail_connections import upsert_gmail_connection
from src.storage.gmail_connections import (
    upsert_gmail_connection,
    get_gmail_connection,
    get_fresh_access_token,
)

from src.ranking.scoring import rank_jobs
from src.gmail.job_alerts import ingest_gmail_job_alerts
from src.storage.db import get_conn, execute as db_execute

from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="Job Butler API")

def _get_cors_origins() -> list[str]:
    raw = os.getenv("CORS_ALLOWED_ORIGINS")
    if raw:
        origins = [o.strip() for o in raw.split(",") if o.strip()]
        if origins:
            return origins
    return ["http://localhost:5173", "http://localhost:3000"]

def _get_frontend_base_url() -> str:
    return (os.getenv("FRONTEND_BASE_URL") or "http://localhost:5173").rstrip("/")

def _get_google_client_id() -> str | None:
    return os.getenv("GOOGLE_OAUTH_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID")

def _get_google_client_secret() -> str | None:
    return os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET")

# In-memory state store for OAuth flows (dev only).
# In production, you'd want this in Redis/DB or signed cookies.
OAUTH_STATE: dict[str, str] = {}

app.add_middleware(
    CORSMiddleware,
    allow_origins=_get_cors_origins(),
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

def q(sql, params=()):
    con = get_conn()
    rows = [dict(r) for r in db_execute(con, sql, params).fetchall()]
    con.close()
    return rows

class PersonaIn(BaseModel):
    uid: str
    persona: dict

class SupportNotifyIn(BaseModel):
    uid: str
    name: str
    phone: str
    email: str | None = None
    message: str
    createdAtISO: str

def load_profile_for_uid(uid: str | None) -> dict:
    """Load persona for a given uid, falling back to profile.json if needed."""
    profile: dict | None = None

    # 1) Try user-specific persona
    if uid:
        persona_path = os.path.join("personas", f"{uid}.json")
        if os.path.exists(persona_path):
            try:
                with open(persona_path, "r", encoding="utf-8") as f:
                    profile = json.load(f)
            except Exception:
                profile = None

    # 2) Fallback to global profile.json
    if profile is None:
        try:
            with open("profile.json", "r", encoding="utf-8") as f:
                profile = json.load(f)
        except Exception:
            profile = {}

    return profile or {}

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/persona")
def save_persona(p: PersonaIn):
    os.makedirs("personas", exist_ok=True)
    with open(f"personas/{p.uid}.json", "w", encoding="utf-8") as f:
        json.dump(p.persona, f, indent=2)
    return {"saved": True}

@app.get("/persona")
def get_persona(uid: str = Query(...)):
    """Return the persona for this uid, or fall back to profile.json."""
    return load_profile_for_uid(uid)

@app.get("/jobs")
def jobs(
    uid: str | None = Query(default=None),
    source: str | None = Query(
        default=None,
        description="prefix: remoteok, greenhouse:figma, lever:, adzuna:in, naukri_email, linkedin_email",
    ),
    contains: str | None = None,
    limit: int = 50,
    use_scoring: bool = True,
):
    # 1) Base: fetch jobs by recency (same as before)
    rows = q("SELECT * FROM jobs ORDER BY COALESCE(posted_at, created_at) DESC")

    # 2) Optional filters: source + text search (same as before)
    if source:
        rows = [r for r in rows if (r.get("source") or "").startswith(source)]
    if contains:
        needle = contains.lower()
        rows = [
            r
            for r in rows
            if needle
            in (
                (r.get("title", "") or "")
                + (r.get("company", "") or "")
                + (r.get("location", "") or "")
            ).lower()
        ]

    # 3) Load persona/global profile and apply scoring
    profile = load_profile_for_uid(uid)
    if use_scoring and profile:
        rows = rank_jobs(rows, profile)

    return rows[:limit]

@app.get("/auth/gmail/start")
def gmail_auth_start(uid: str = Query(...)):
    """
    Start Gmail OAuth for a given uid.
    Returns the Google auth URL; frontend should redirect the browser there.
    """
    client_id = _get_google_client_id()
    redirect_uri = os.getenv("GOOGLE_OAUTH_REDIRECT_URI")

    if not client_id or not redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth env vars not set (GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_REDIRECT_URI).",
        )

    # Short-lived state token to tie callback back to this uid
    state = secrets.token_urlsafe(16)
    OAUTH_STATE[state] = uid

    scope = "https://www.googleapis.com/auth/gmail.readonly"

    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": scope,
        "access_type": "offline",
        "include_granted_scopes": "true",
        "prompt": "consent",
        "state": state,
    }

    auth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urlencode(params)
    return {"auth_url": auth_url}

@app.get("/auth/gmail/callback")
def gmail_auth_callback(
    code: str = Query(...),
    state: str = Query(...),
):
    """
    OAuth2 callback endpoint for Gmail.

    Google will redirect to GOOGLE_OAUTH_REDIRECT_URI with ?code=...&state=...
    We:
      1) validate state
      2) exchange code for tokens
      3) optionally fetch the Gmail address
      4) store tokens in gmail_connections for this uid
    """
    if state not in OAUTH_STATE:
        raise HTTPException(status_code=400, detail="Invalid or expired OAuth state")

    uid = OAUTH_STATE.pop(state)

    client_id = _get_google_client_id()
    client_secret = _get_google_client_secret()
    redirect_uri = os.getenv("GOOGLE_OAUTH_REDIRECT_URI")

    if not client_id or not client_secret or not redirect_uri:
        raise HTTPException(
            status_code=500,
            detail="Google OAuth env vars not set (GOOGLE_OAUTH_CLIENT_ID/SECRET/REDIRECT_URI).",
        )

    # 1) Exchange the auth code for tokens
    token_resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "code": code,
            "client_id": client_id,
            "client_secret": client_secret,
            "redirect_uri": redirect_uri,
            "grant_type": "authorization_code",
        },
        timeout=10,
    )

    if token_resp.status_code != 200:
        raise HTTPException(
            status_code=500,
            detail=f"Token exchange failed: {token_resp.text}",
        )

    token_data = token_resp.json()
    access_token = token_data.get("access_token")
    refresh_token = token_data.get("refresh_token")
    expires_in = token_data.get("expires_in")  # seconds

    if not refresh_token:
        # For offline access, we expect a refresh_token at least once.
        # If missing, user may have previously granted access; for dev, treat as error.
        raise HTTPException(
            status_code=500,
            detail="No refresh_token received from Google. Try revoking app access and re-connecting.",
        )

    token_expiry = int(time.time()) + int(expires_in or 0)

    # 2) (Optional) Fetch Gmail address to show in UI
    email = None
    if access_token:
        try:
            profile_resp = requests.get(
                "https://www.googleapis.com/gmail/v1/users/me/profile",
                headers={"Authorization": f"Bearer {access_token}"},
                timeout=10,
            )
            if profile_resp.status_code == 200:
                email = profile_resp.json().get("emailAddress")
        except Exception:
            # Don't crash if profile lookup fails; email stays None
            pass

    # 3) Persist tokens for this uid
    upsert_gmail_connection(
        uid=uid,
        email=email,
        refresh_token=refresh_token,
        access_token=access_token,
        token_expiry=token_expiry,
    )

    frontend_base = _get_frontend_base_url()
    return RedirectResponse(f"{frontend_base}/dashboard?gmail=connected")

@app.get("/auth/gmail/status")
def gmail_auth_status(uid: str = Query(...)):
    """
    Return basic info about Gmail connection for this uid.
    Used by UI to show 'Connected as <email>'.
    """
    conn = get_gmail_connection(uid)
    if not conn:
        return {"connected": False}

    return {
        "connected": True,
        "email": conn.get("email"),
        "token_expiry": conn.get("token_expiry"),
        "has_refresh_token": bool(conn.get("refresh_token")),
    }

@app.post("/support/notify")
def support_notify(payload: SupportNotifyIn):
    host = os.getenv("SUPPORT_SMTP_HOST")
    port = os.getenv("SUPPORT_SMTP_PORT")
    user = os.getenv("SUPPORT_SMTP_USER")
    password = os.getenv("SUPPORT_SMTP_PASS")
    from_email = os.getenv("SUPPORT_SMTP_FROM") or os.getenv("SUPPORT_FROM_EMAIL") or user

    if not host or not port or not user or not password or not from_email:
        return {"ok": False, "reason": "smtp_not_configured"}

    msg = EmailMessage()
    msg["Subject"] = "Job Butler Support Request"
    msg["From"] = from_email
    msg["To"] = ", ".join(["srivastavasakar@gmail.com", "info@jobbutler.in"])

    body_lines = [
        f"uid: {payload.uid}",
        f"name: {payload.name}",
        f"phone: {payload.phone}",
        f"email: {payload.email or ''}",
        f"createdAtISO: {payload.createdAtISO}",
        "",
        "message:",
        payload.message,
    ]
    msg.set_content("\n".join(body_lines))

    try:
        with smtplib.SMTP(host, int(port)) as server:
            server.starttls()
            server.login(user, password)
            server.send_message(msg)
    except Exception:
        return {"ok": False, "reason": "smtp_error"}

    return {"ok": True}

@app.post("/seed")
def add_seed(url: str = Body(..., embed=True)):
    subprocess.run(["python", "src/main.py", "seed-add", "--url", url], check=False)
    return {"queued": True}

@app.post("/harvest")
def harvest(
    remoteok: bool = False,
    adzuna: bool = False,
    greenhouse: str | None = None,
    lever: str | None = None,
):
    args = ["python", "src/main.py", "harvest-live"]
    if remoteok:
        args.append("--remoteok")
    if adzuna:
        args.append("--adzuna")
    if greenhouse:
        args += ["--greenhouse", greenhouse]
    if lever:
        args += ["--lever", lever]
    subprocess.run(args, check=False)
    return {"done": True}

@app.post("/harvest/gmail")
def harvest_gmail(
    uid: str = Body(..., embed=True),
    max_messages: int = Body(50, embed=True),
):
    """
    Manually trigger Gmail job-alert ingest for a given uid.
    For now, used for testing with e.g. 'test-sakarsoul'.
    """
    try:
        inserted = ingest_gmail_job_alerts(uid=uid, max_messages=max_messages)
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Gmail harvest failed: {e}")

    return {"inserted": inserted}
