from __future__ import annotations
from fastapi import FastAPI, Body, Query, HTTPException, Depends, Request
from fastapi.responses import RedirectResponse, JSONResponse
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
from datetime import datetime, timezone, timedelta
from typing import Generator
import contextlib
import json, os, subprocess, time, secrets, smtplib, sys, re, traceback
from email.message import EmailMessage
from urllib.parse import urlencode, parse_qs
from uuid import uuid4

import requests  # already in requirements.txt
from firebase_admin import firestore as admin_firestore

#from src.storage.gmail_connections import upsert_gmail_connection
from src.storage.gmail_connections import (
    upsert_gmail_connection,
    get_gmail_connection,
    get_fresh_access_token,
)

from src.ranking.scoring import rank_jobs
from src.gmail.job_alerts import ingest_gmail_job_alerts
from src.storage.db import (
    get_conn,
    get_pg_pool,
    close_pg_pool,
    init_db,
    execute as db_execute,
    is_postgres,
    maintain_jobs,
    dedupe_jobs,
    upsert_jobs,
    ensure_harvest_packs,
)
from src.harvest.sources import dedupe, to_rows
from src.harvest.packs import run_harvest_pack
from src.utils.firebase_admin_client import (
    get_firestore_client,
    get_uid_by_phone,
    get_uid_by_email,
)
from src.utils.instamojo import compute_instamojo_mac

from dotenv import load_dotenv
load_dotenv()

app = FastAPI(title="Job Butler API")

def db_conn() -> Generator:
    if is_postgres():
        pool = get_pg_pool()
        with pool.connection() as conn:
            yield conn
    else:
        conn = get_conn()
        try:
            yield conn
        finally:
            with contextlib.suppress(Exception):
                conn.close()

@app.on_event("startup")
def _startup_init_db() -> None:
    try:
        init_db()
    except Exception as exc:
        print(f"[warn] init_db failed: {exc}")

@app.on_event("shutdown")
def _shutdown() -> None:
    close_pg_pool()

def _get_cors_origins() -> list[str]:
    base = [
        "http://localhost:5173",
        "http://127.0.0.1:5173",
        "https://www.jobbutler.in",
        "https://jobbutler.in",
    ]
    raw = os.getenv("CORS_ALLOWED_ORIGINS") or ""
    extra = [o.strip() for o in raw.split(",") if o.strip()]
    origins = []
    for origin in [*base, *extra]:
        if origin not in origins:
            origins.append(origin)
    return origins

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
    if is_postgres():
        pool = get_pg_pool()
        with pool.connection() as conn:
            return [dict(r) for r in db_execute(conn, sql, params).fetchall()]
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

class PackUpdateIn(BaseModel):
    name: str | None = None
    description: str | None = None
    is_enabled: bool | None = None
    config: dict | None = None

class PackCreateIn(BaseModel):
    name: str
    description: str | None = None
    is_enabled: bool = True
    config: dict | None = None
    slug: str | None = None

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

def _parse_pack_config(raw):
    if isinstance(raw, dict):
        return raw
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except Exception:
            return {}
    return {}

def _pack_row_to_dict(row) -> dict:
    data = dict(row)
    data["config"] = _parse_pack_config(data.get("config"))
    if "sources" not in data["config"]:
        sources = []
        if data["config"].get("remoteok"):
            sources.append("remoteok")
        if data["config"].get("adzuna_in"):
            sources.append("adzuna_in")
        if data["config"].get("greenhouse"):
            sources.append("greenhouse")
        if data["config"].get("lever"):
            sources.append("lever")
        data["config"]["sources"] = sources
    if "is_enabled" in data:
        data["is_enabled"] = bool(data["is_enabled"])
    return data

def _slugify(value: str) -> str:
    slug = re.sub(r"[^a-z0-9]+", "-", value.lower()).strip("-")
    return slug

def _normalize_phone(raw: str | None) -> str | None:
    if not raw:
        return None
    raw = raw.strip()
    if raw.startswith("+"):
        return raw
    digits = re.sub(r"\D", "", raw)
    if not digits:
        return None
    if digits.startswith("0"):
        digits = digits.lstrip("0")
    if len(digits) == 10:
        return f"+91{digits}"
    if digits.startswith("91") and len(digits) == 12:
        return f"+91{digits[2:]}"
    return f"+{digits}"

async def _parse_instamojo_payload(request: Request) -> dict[str, str]:
    try:
        body = await request.body()
    except Exception:
        body = b""
    if not body:
        return {}

    content_type = (request.headers.get("content-type") or "").lower()
    if "application/json" in content_type:
        try:
            raw = json.loads(body.decode("utf-8"))
        except Exception:
            raw = {}
        if not isinstance(raw, dict):
            return {}
        return {str(k): str(v) for k, v in raw.items()}

    parsed = parse_qs(body.decode("utf-8"), keep_blank_values=True)
    return {k: str(v[0]) if v else "" for k, v in parsed.items()}


def _infer_instamojo_plan(payload: dict, plan_param: str | None) -> str | None:
    raw_plan = (plan_param or "").strip().lower()
    if raw_plan in {"1m", "monthly", "month", "1-month", "one_month"}:
        return "1m"
    if raw_plan in {"3m", "quarterly", "quarter", "3-month", "three_month"}:
        return "3m"

    purpose = (payload.get("purpose") or "").lower()
    if "3 month" in purpose or "quarter" in purpose:
        return "3m"
    if "1 month" in purpose or "monthly" in purpose:
        return "1m"

    amount_raw = payload.get("amount") or ""
    try:
        amount = float(amount_raw)
    except (TypeError, ValueError):
        amount = 0.0
    if amount >= 1000:
        return "3m"
    if amount > 0:
        return "1m"
    return None


def _normalize_status(raw: str | None) -> str:
    return (raw or "").strip().lower()


def _is_success_status(raw: str | None) -> bool:
    return _normalize_status(raw) in {
        "success",
        "successful",
        "credit",
        "completed",
        "paid",
    }


def _extract_instamojo_status(payload: dict) -> tuple[str, str]:
    raw = (
        payload.get("payment_status")
        or payload.get("status")
        or payload.get("paymentStatus")
        or ""
    )
    return raw, _normalize_status(raw)


def _activate_billing(db, uid: str, plan: str, payment_id: str | None, payload: dict) -> None:
    days = 90 if plan == "3m" else 30
    period = "quarterly" if plan == "3m" else "monthly"
    now = datetime.now(timezone.utc)
    ends_at = now + timedelta(days=days)
    payment_meta = {
        "payment_id": payment_id or payload.get("payment_id"),
        "payment_request_id": payload.get("payment_request_id"),
        "amount": payload.get("amount"),
        "purpose": payload.get("purpose"),
        "status": payload.get("payment_status") or payload.get("status"),
        "buyer_phone": payload.get("buyer_phone"),
        "buyer_email": payload.get("buyer_email") or payload.get("buyer"),
    }

    doc_ref = db.collection("billing").document(uid)
    doc_ref.set(
        {
            "status": "active",
            "plan": "pro",
            "period": period,
            "subscriptionStartedAt": admin_firestore.SERVER_TIMESTAMP,
            "subscriptionEndsAt": ends_at,
            "lastPayment": payment_meta,
            "trialEndsAt": None,
            "trialStartedAt": None,
            "trialUsed": True,
            "updatedAt": admin_firestore.SERVER_TIMESTAMP,
        },
        merge=True,
    )

def _list_packs(conn, enabled_only: bool = False) -> list[dict]:
    sql = "SELECT * FROM harvest_packs WHERE deleted_at IS NULL"
    params: tuple = ()
    if enabled_only:
        sql += " AND is_enabled = ?"
        params = (True if is_postgres() else 1,)
    sql += " ORDER BY created_at ASC"
    try:
        rows = db_execute(conn, sql, params).fetchall()
    except Exception as exc:
        msg = str(exc).lower()
        if "harvest_packs" in msg and ("does not exist" in msg or "no such table" in msg):
            return []
        raise
    return [_pack_row_to_dict(r) for r in rows]

@app.get("/health")
def health():
    return {"ok": True}

@app.post("/api/billing/instamojo/webhook")
async def instamojo_webhook(request: Request):
    payload = await _parse_instamojo_payload(request)
    salt = os.getenv("INSTAMOJO_SALT", "")
    mac_provided = payload.get("mac") or payload.get("MAC") or ""
    mac_calc = compute_instamojo_mac(payload, salt) if salt else ""
    mac_ok = bool(mac_calc) and bool(mac_provided) and mac_calc.lower() == mac_provided.lower()

    status_raw, status_norm = _extract_instamojo_status(payload)

    try:
        db = get_firestore_client()
    except Exception as exc:
        print(f"[instamojo] firestore not configured: {exc}")
        raise HTTPException(status_code=500, detail="firebase admin not configured")

    payment_id = payload.get("payment_id")
    payment_request_id = payload.get("payment_request_id")
    doc_id = payment_id or payment_request_id or str(uuid4())
    payment_doc = {
        "provider": "instamojo",
        "paymentId": payment_id,
        "paymentRequestId": payment_request_id,
        "paymentStatus": status_raw,
        "amount": payload.get("amount"),
        "purpose": payload.get("purpose"),
        "buyerName": payload.get("buyer_name"),
        "buyerPhone": payload.get("buyer_phone"),
        "buyerEmail": payload.get("buyer_email") or payload.get("buyer"),
        "macOk": mac_ok,
        "raw": payload,
        "receivedAt": admin_firestore.SERVER_TIMESTAMP,
    }
    db.collection("instamojoPayments").document(str(doc_id)).set(payment_doc, merge=True)

    if not mac_ok:
        print("[instamojo] invalid MAC")
        return {"ok": True, "mac_ok": False}

    if not _is_success_status(status_norm):
        return {"ok": True}

    buyer_phone = _normalize_phone(payload.get("buyer_phone"))
    buyer_email = payload.get("buyer_email") or payload.get("buyer")
    uid = None
    if buyer_phone:
        uid = get_uid_by_phone(buyer_phone)
    if not uid and buyer_email:
        uid = get_uid_by_email(buyer_email)
    if not uid:
        print("[instamojo] no user for buyer")
        return {"ok": True}

    plan = _infer_instamojo_plan(payload, payload.get("plan"))
    if not plan:
        print("[instamojo] unable to infer plan")
        return {"ok": True}

    _activate_billing(db, uid, plan, payment_id, payload)
    return {"ok": True}


class InstamojoConfirmIn(BaseModel):
    uid: str
    plan: str | None = None
    payment_id: str | None = None
    payment_request_id: str | None = None


@app.post("/api/billing/instamojo/confirm")
def instamojo_confirm(body: InstamojoConfirmIn):
    payment_id = body.payment_id or body.payment_request_id
    if not payment_id:
        return {"ok": False, "pending": False, "error": "missing_payment_id"}

    try:
        db = get_firestore_client()
    except Exception as exc:
        print(f"[instamojo] firestore not configured: {exc}")
        raise HTTPException(status_code=500, detail="firebase admin not configured")

    doc = db.collection("instamojoPayments").document(payment_id).get()
    if not doc.exists:
        return JSONResponse(
            status_code=202,
            content={"ok": False, "pending": True, "error": "pending_webhook"},
        )

    data = doc.to_dict() or {}
    payload = data.get("raw") or {}
    mac_ok = data.get("macOk", False) is True
    if not mac_ok:
        return {"ok": False, "pending": False, "error": "invalid_mac"}

    status_raw = (
        data.get("paymentStatus")
        or data.get("status")
        or payload.get("payment_status")
        or payload.get("status")
        or payload.get("paymentStatus")
        or ""
    )
    status_norm = _normalize_status(status_raw)
    if not _is_success_status(status_norm):
        print(
            f"[instamojo] activate payment_id={payment_id} status={status_raw} "
            f"norm={status_norm} macOk={mac_ok}"
        )
        return {"ok": False, "pending": False, "error": "payment_not_success"}
    plan = _infer_instamojo_plan(payload, body.plan)
    if not plan:
        return {"ok": False, "pending": False, "error": "plan_unknown"}

    _activate_billing(db, body.uid, plan, payment_id, payload)
    return {"ok": True}

@app.get("/admin/metrics")
@app.get("/api/admin/metrics")
def admin_metrics(conn=Depends(db_conn)):
    try:
        row = db_execute(conn, "SELECT COUNT(*) AS count FROM jobs").fetchone()
        total_jobs = row["count"] if row else 0

        if is_postgres():
            row = db_execute(
                conn,
                "SELECT COUNT(*) AS count FROM jobs WHERE created_at >= NOW() - INTERVAL '1 day'",
            ).fetchone()
        else:
            row = db_execute(
                conn,
                "SELECT COUNT(*) AS count FROM jobs WHERE created_at >= datetime('now','-1 day')",
            ).fetchone()
        jobs_last_24h = row["count"] if row else 0

        by_source = [
            dict(r)
            for r in db_execute(
                conn,
                """
                SELECT COALESCE(source, '') AS source, COUNT(*) AS count
                  FROM jobs
                 GROUP BY source
                 ORDER BY count DESC
                """,
            ).fetchall()
        ]

        if is_postgres():
            daily_counts = [
                dict(r)
                for r in db_execute(
                    conn,
                    """
                    SELECT to_char(created_at::date, 'YYYY-MM-DD') AS date,
                           COUNT(*) AS count
                      FROM jobs
                     WHERE created_at >= NOW() - INTERVAL '14 days'
                     GROUP BY 1
                     ORDER BY 1
                    """,
                ).fetchall()
            ]
        else:
            daily_counts = [
                dict(r)
                for r in db_execute(
                    conn,
                    """
                    SELECT date(created_at) AS date,
                           COUNT(*) AS count
                      FROM jobs
                     WHERE created_at >= datetime('now','-14 days')
                     GROUP BY date
                     ORDER BY date
                    """,
                ).fetchall()
            ]

        return {
            "total_jobs": total_jobs,
            "jobs_last_24h": jobs_last_24h,
            "by_source": by_source,
            "daily_counts": daily_counts,
            "totalJobs": total_jobs,
            "jobsLast24h": jobs_last_24h,
            "jobsBySource": by_source,
            "dailyHarvested": daily_counts,
            "users": None,
            "trialsActive": None,
        }
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

def _run_pack(pack: dict, conn) -> dict:
    started_at = datetime.now(timezone.utc)
    status = "ok"
    error_text = None
    inserted = 0
    updated = 0
    marked_inactive = 0
    archived = 0
    source_errors: list[dict] = []

    try:
        profile = load_profile_for_uid(None)
        jobs, source_errors = run_harvest_pack(pack.get("config", {}) or {}, profile)
        rows = to_rows(dedupe(jobs))

        row = db_execute(conn, "SELECT COUNT(*) AS count FROM jobs").fetchone()
        before = row["count"] if row else 0

        if rows:
            upsert_jobs(rows, conn)

        row = db_execute(conn, "SELECT COUNT(*) AS count FROM jobs").fetchone()
        after = row["count"] if row else 0

        inserted = max(after - before, 0)
        updated = max(len(rows) - inserted, 0)
        marked_inactive, archived = maintain_jobs(conn)
        if source_errors and status == "ok":
            status = "partial"
    except Exception as exc:
        status = "error"
        error_text = str(exc)

    finished_at = datetime.now(timezone.utc)
    db_execute(
        conn,
        """
        INSERT INTO harvest_pack_runs
            (pack_slug, started_at, finished_at, status, inserted_count, updated_count,
             inactive_marked_count, archived_count, error_text)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        """,
        (
            pack.get("slug"),
            started_at,
            finished_at,
            status,
            inserted,
            updated,
            marked_inactive,
            archived,
            error_text,
        ),
    )
    if status == "ok":
        if is_postgres():
            db_execute(
                conn,
                "UPDATE harvest_packs SET last_run_at = NOW(), updated_at = NOW() WHERE slug = ?",
                (pack.get("slug"),),
            )
        else:
            db_execute(
                conn,
                "UPDATE harvest_packs SET last_run_at = datetime('now'), updated_at = datetime('now') WHERE slug = ?",
                (pack.get("slug"),),
            )
    conn.commit()

    return {
        "slug": pack.get("slug"),
        "status": status,
        "inserted": inserted,
        "updated": updated,
        "marked_inactive": marked_inactive,
        "archived": archived,
        "error": error_text,
        "source_errors": source_errors,
        "started_at": started_at.isoformat(),
        "finished_at": finished_at.isoformat(),
    }

@app.post("/admin/harvest/run")
def admin_harvest_run():
    return {"ok": True, "message": "Not wired yet"}

@app.get("/api/admin/packs")
def admin_list_packs(conn=Depends(db_conn)):
    try:
        ensure_harvest_packs(conn)
        return {"packs": _list_packs(conn)}
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/api/admin/packs")
def admin_create_pack(payload: PackCreateIn, conn=Depends(db_conn)):
    name = (payload.name or "").strip()
    if not name:
        raise HTTPException(status_code=400, detail="name is required")

    slug_seed = (payload.slug or name).strip()
    slug_base = _slugify(slug_seed)
    if not slug_base:
        raise HTTPException(status_code=400, detail="invalid slug")

    try:
        ensure_harvest_packs(conn)
        slug = slug_base
        suffix = 2
        while db_execute(
            conn, "SELECT 1 FROM harvest_packs WHERE slug = ?", (slug,)
        ).fetchone():
            slug = f"{slug_base}-{suffix}"
            suffix += 1

        config = payload.config or {}
        if is_postgres():
            db_execute(
                conn,
                """
                INSERT INTO harvest_packs
                    (slug, name, description, is_enabled, config, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?::jsonb, NOW(), NOW())
                """,
                (slug, name, payload.description, payload.is_enabled, json.dumps(config)),
            )
        else:
            db_execute(
                conn,
                """
                INSERT INTO harvest_packs
                    (slug, name, description, is_enabled, config, created_at, updated_at)
                VALUES (?, ?, ?, ?, ?, datetime('now'), datetime('now'))
                """,
                (
                    slug,
                    name,
                    payload.description,
                    1 if payload.is_enabled else 0,
                    json.dumps(config),
                ),
            )
        conn.commit()

        row = db_execute(
            conn, "SELECT * FROM harvest_packs WHERE slug = ?", (slug,)
        ).fetchone()
        if not row:
            raise HTTPException(status_code=500, detail="pack creation failed")
        return _pack_row_to_dict(row)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

@app.put("/api/admin/packs/{slug}")
def admin_update_pack(slug: str, payload: PackUpdateIn, conn=Depends(db_conn)):
    try:
        ensure_harvest_packs(conn)
        updates = []
        params: list = []

        if payload.name is not None:
            updates.append("name = ?")
            params.append(payload.name)
        if payload.description is not None:
            updates.append("description = ?")
            params.append(payload.description)
        if payload.is_enabled is not None:
            updates.append("is_enabled = ?")
            params.append(payload.is_enabled if is_postgres() else int(payload.is_enabled))
        if payload.config is not None:
            if is_postgres():
                updates.append("config = ?::jsonb")
            else:
                updates.append("config = ?")
            params.append(json.dumps(payload.config))

        updates.append("updated_at = NOW()" if is_postgres() else "updated_at = datetime('now')")
        params.append(slug)

        sql = f"UPDATE harvest_packs SET {', '.join(updates)} WHERE slug = ?"
        db_execute(conn, sql, tuple(params))
        conn.commit()

        row = db_execute(conn, "SELECT * FROM harvest_packs WHERE slug = ?", (slug,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pack not found")
        return _pack_row_to_dict(row)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

@app.delete("/api/admin/packs/{slug}")
def admin_delete_pack(slug: str, conn=Depends(db_conn)):
    try:
        ensure_harvest_packs(conn)
        ts = "NOW()" if is_postgres() else "datetime('now')"
        db_execute(
            conn,
            f"UPDATE harvest_packs SET deleted_at = {ts}, is_enabled = ?, updated_at = {ts} WHERE slug = ?",
            (False if is_postgres() else 0, slug),
        )
        conn.commit()
        return {"ok": True, "slug": slug}
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/api/admin/packs/{slug}/run")
def admin_run_pack(slug: str, conn=Depends(db_conn)):
    try:
        ensure_harvest_packs(conn)
        row = db_execute(conn, "SELECT * FROM harvest_packs WHERE slug = ?", (slug,)).fetchone()
        if not row:
            raise HTTPException(status_code=404, detail="Pack not found")
        pack = _pack_row_to_dict(row)
    except HTTPException:
        raise
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
    return _run_pack(pack, conn)

@app.post("/api/admin/packs/run-enabled")
def admin_run_enabled_packs(conn=Depends(db_conn)):
    try:
        ensure_harvest_packs(conn)
        packs = _list_packs(conn, enabled_only=True)
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))
    if not packs:
        return {"ok": True, "ran_packs": 0, "message": "No enabled packs", "results": []}
    results = []
    for pack in packs:
        try:
            results.append(_run_pack(pack, conn))
        except Exception as exc:
            results.append(
                {
                    "slug": pack.get("slug"),
                    "status": "error",
                    "inserted": 0,
                    "updated": 0,
                    "marked_inactive": 0,
                    "archived": 0,
                    "error": str(exc),
                }
            )
    return {"ok": True, "ran_packs": len(results), "results": results}

@app.post("/api/admin/harvest-all")
@app.post("/api/admin/harvest/run")
def admin_harvest_all(conn=Depends(db_conn)):
    try:
        row = db_execute(conn, "SELECT COUNT(*) AS count FROM jobs").fetchone()
        before = row["count"] if row else 0

        subprocess.run([sys.executable, "-m", "src.main", "seed-harvest"], check=False)
        marked_inactive, archived = maintain_jobs(conn)

        row = db_execute(conn, "SELECT COUNT(*) AS count FROM jobs").fetchone()
        after = row["count"] if row else 0

        inserted = max(after - before, 0)
        return {
            "inserted": inserted,
            "updated": 0,
            "marked_inactive": marked_inactive,
            "archived": archived,
        }
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

@app.post("/api/admin/cleanup")
def admin_cleanup(conn=Depends(db_conn)):
    try:
        marked_inactive, archived = maintain_jobs(conn)
        deduped = dedupe_jobs(conn)
        return {
            "marked_inactive": marked_inactive,
            "archived": archived,
            "deduped": deduped,
        }
    except Exception as exc:
        traceback.print_exc()
        raise HTTPException(status_code=500, detail=str(exc))

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
@app.get("/api/jobs")
def jobs(
    uid: str | None = Query(default=None),
    source: str | None = Query(
        default=None,
        description="prefix: remoteok, greenhouse:figma, lever:, adzuna:in, naukri_email, linkedin_email",
    ),
    contains: str | None = None,
    limit: int = 50,
    offset: int = 0,
    use_scoring: bool = True,
):
    limit = max(1, min(limit, 200))
    offset = max(0, offset)
    # 1) Base: fetch jobs by recency (same as before)
    if is_postgres():
        # posted_at is TEXT in Postgres schema; created_at is TIMESTAMP.
        # Only cast posted_at when it looks like an ISO/date string, otherwise fall back to created_at.
        rows = q(
            """
            SELECT *
              FROM jobs
             ORDER BY
               CASE
                 WHEN posted_at IS NULL OR posted_at = '' THEN created_at
                 WHEN posted_at ~ '^[0-9]{4}-[0-9]{2}-[0-9]{2}' THEN posted_at::timestamptz
                 ELSE created_at
               END DESC,
               created_at DESC
            """
        )
    else:
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

    total = len(rows)
    page = rows[offset : offset + limit]
    next_offset = offset + limit if offset + limit < total else None

    return {"items": page, "nextOffset": next_offset, "total": total}

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
