from __future__ import annotations
from fastapi import FastAPI, Query, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import sqlite3, json
from pathlib import Path

# --- existing helpers from your project
from storage.db import fetch_all_jobs
from harvest.sources import to_rows, dedupe  # not strictly needed here

DB_PATH = "job_butler.sqlite3"
PROFILE_JSON = Path("profile.json")          # demo persona store (global/guest)

app = FastAPI(title="Job Butler API (demo)")

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:5173", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# ---------- models ----------
class PersonaIn(BaseModel):
    uid: str = "guest"
    persona: dict

class SeedIn(BaseModel):
    uid: str = "guest"
    url: str
    title: str | None = None
    company: str | None = None
    notes: str | None = None

# ---------- persona ----------
@app.post("/persona")
def save_persona(p: PersonaIn):
    # Demo: save to profile.json (global). Later: upsert into personas(uid, persona_json)
    PROFILE_JSON.write_text(json.dumps(p.persona, indent=2), encoding="utf-8")
    return {"ok": True}

@app.get("/persona")
def get_persona(uid: str = "guest"):
    if PROFILE_JSON.exists():
        return json.loads(PROFILE_JSON.read_text(encoding="utf-8"))
    return {}

# ---------- jobs (read-only) ----------
@app.get("/jobs")
def list_jobs(contains: str | None = None,
              source: str | None = None,
              limit: int = Query(50, ge=1, le=500)):
    jobs = fetch_all_jobs()
    if source:
        jobs = [j for j in jobs if (j.get("source") or "").startswith(source)]
    if contains:
        needle = contains.lower()
        def match(j):
            text = " ".join([
                str(j.get("title","")), str(j.get("company","")),
                str(j.get("location","")), str(j.get("source",""))
            ]).lower()
        #   return boolean
            return needle in text
        jobs = [j for j in jobs if match(j)]
    return jobs[:limit]

# ---------- seeds (SQLite 'seeds' table, global/guest for demo) ----------
def _ensure_seeds():
    con = sqlite3.connect(DB_PATH)
    con.execute("""CREATE TABLE IF NOT EXISTS seeds(
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        url TEXT UNIQUE,
        title_hint TEXT,
        company_hint TEXT,
        notes TEXT,
        created_at TEXT DEFAULT (datetime('now'))
    )""")
    con.commit(); con.close()

@app.post("/seed")
def add_seed(s: SeedIn):
    _ensure_seeds()
    con = sqlite3.connect(DB_PATH)
    try:
        con.execute(
            "INSERT OR IGNORE INTO seeds(url, title_hint, company_hint, notes) VALUES(?,?,?,?)",
            (s.url.strip(), s.title, s.company, s.notes),
        )
        con.commit()
    finally:
        con.close()
    return {"ok": True}

@app.get("/seeds")
def list_seeds(uid: str = "guest"):
    _ensure_seeds()
    con = sqlite3.connect(DB_PATH); con.row_factory = sqlite3.Row
    rows = con.execute("SELECT id,url,title_hint,company_hint,notes,created_at FROM seeds ORDER BY created_at DESC").fetchall()
    con.close()
    return [dict(r) for r in rows]

@app.delete("/seeds/{seed_id}")
def delete_seed(seed_id: int, uid: str = "guest"):
    _ensure_seeds()
    con = sqlite3.connect(DB_PATH)
    cur = con.execute("DELETE FROM seeds WHERE id=?", (seed_id,))
    con.commit(); con.close()
    if cur.rowcount == 0:
        raise HTTPException(status_code=404, detail="Seed not found")
    return {"ok": True}

@app.delete("/seeds/clear")
def clear_seeds(uid: str = "guest"):
    _ensure_seeds()
    con = sqlite3.connect(DB_PATH)
    con.execute("DELETE FROM seeds")
    con.commit(); con.close()
    return {"ok": True}