# src/main.py

from __future__ import annotations
import argparse, json, os, re, sqlite3, subprocess, sys
from pathlib import Path
from dotenv import load_dotenv

# --- storage / harvest / alerts / prefill imports (these should already exist in your repo)
from src.storage.db import init_db as db_init, upsert_jobs, fetch_all_jobs, get_conn, execute, is_postgres, get_db_label, maintain_jobs, dedupe_jobs
from src.storage import gmail_connections
from src.harvest.sources import dedupe, to_rows
from src.harvest.remoteok import harvest_remoteok
from src.harvest.adzuna import harvest_adzuna              # uses profile + ADZUNA_* from .env
from src.harvest.greenhouse import harvest_greenhouse      # takes list of board tokens
from src.harvest.lever import harvest_lever                # takes list of company handles
from src.ranking.scoring import score_job                  # << use score_job; rank_jobs defined below
from src.alerts.email_alert import send_alert
from src.prefill.prefill import build_prefill_map

ROOT = Path(__file__).resolve().parents[1]  # repo root
DEFAULT_SQLITE_PATH = ROOT / "job_butler.sqlite3"

# -----------------------
# Utilities
# -----------------------
def load_profile(root: Path = ROOT) -> dict:
    p = root / "profile.json"
    return json.loads(p.read_text(encoding="utf-8")) if p.exists() else {}

def ensure_seeds_table():
    con = get_conn()
    if is_postgres():
        schema = """
            CREATE TABLE IF NOT EXISTS seeds (
              id SERIAL PRIMARY KEY,
              url TEXT UNIQUE,
              title_hint TEXT,
              company_hint TEXT,
              notes TEXT,
              created_at TIMESTAMP DEFAULT NOW()
            )
        """
    else:
        schema = """
            CREATE TABLE IF NOT EXISTS seeds (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              url TEXT UNIQUE,
              title_hint TEXT,
              company_hint TEXT,
              notes TEXT,
              created_at TEXT DEFAULT (datetime('now'))
            )
        """
    with con:
        con.execute(schema)
    con.close()

def detect_provider(url: str) -> tuple[str|None, str|None]:
    """
    Return (provider, token) for GH/Lever seeds:
      greenhouse => boards.greenhouse.io/<token>
      lever      => jobs.lever.co/<token>
    """
    u = url.lower()
    gh = re.search(r"boards\.greenhouse\.io/([^/?#]+)", u)
    if gh: return ("greenhouse", gh.group(1))
    lv = re.search(r"jobs\.lever\.co/([^/?#]+)", u)
    if lv: return ("lever", lv.group(1))
    return (None, None)

def _seed_keywords() -> set[str]:
    """Collect normalized title keywords from seeds for --filter-similar."""
    con = get_conn()
    rows = con.execute("SELECT title_hint FROM seeds").fetchall()
    con.close()
    kws: set[str] = set()
    for r in rows:
        t = (r["title_hint"] or "").strip()
        if t:
            for k in re.split(r"[,\|/;]+", t.lower()):
                k = k.strip()
                if len(k) >= 3: kws.add(k)
    return kws

def rank_jobs(jobs: list[dict], profile: dict) -> list[dict]:
    """
    Ranks jobs by calling score_job(j, profile). Assumes scoring.py applies seed boost.
    Adds _score to each job dict and returns sorted list (desc).
    """
    ranked: list[dict] = []
    for j in jobs:
        s = float(score_job(j, profile))
        jj = dict(j)
        jj["_score"] = round(s, 4)
        ranked.append(jj)
    ranked.sort(key=lambda x: x["_score"], reverse=True)
    return ranked

# -----------------------
# Commands
# -----------------------
def cmd_init_db(args):
    db_init()
    ensure_seeds_table()
    gmail_connections.ensure_table()
    con = get_conn()
    try:
        row = con.execute("SELECT COUNT(*) AS count FROM jobs").fetchone()
        jobs_count = row["count"] if row else 0
    finally:
        con.close()
    print(f"[ok] DB initialized: {get_db_label()} (jobs={jobs_count})")

def cmd_harvest_live(args):
    prof = load_profile()
    jobs = []

    if args.remoteok:
        print("[harvest] RemoteOK …")
        jobs += harvest_remoteok()

    if args.adzuna:
        print("[harvest] Adzuna …")
        jobs += harvest_adzuna(prof, pages=args.pages, results_per_page=args.rpp)

    gh = [b.strip() for b in (args.greenhouse or "").split(",") if b.strip()]
    if gh:
        print(f"[harvest] Greenhouse boards: {','.join(gh)}")
        jobs += harvest_greenhouse(gh)

    lv = [c.strip() for c in (args.lever or "").split(",") if c.strip()]
    if lv:
        print(f"[harvest] Lever companies: {','.join(lv)}")
        jobs += harvest_lever(lv)

    jobs = dedupe(jobs)
    upsert_jobs(to_rows(jobs))
    print(f"[ok] Inserted {len(jobs)} live jobs.")

def cmd_ingest_naukri_imap(args):
    from src.naukri.email_ingest_imap import ingest as ingest_naukri
    n = ingest_naukri(days=args.since, max_msgs=args.max)
    print(f"[ok] Ingested {n} Naukri jobs from email alerts.")

def cmd_ingest_linkedin_imap(args):
    try:
        from src.linkedin.email_ingest_imap import ingest as ingest_li
    except Exception:
        print("[warn] LinkedIn IMAP add-on not found. Skip.", file=sys.stderr)
        return
    n = ingest_li(days=args.since, max_msgs=args.max)
    print(f"[ok] Ingested {n} LinkedIn jobs from email alerts.")

def cmd_score(args):
    prof = load_profile()
    jobs = fetch_all_jobs()
    if args.source:
        jobs = [j for j in jobs if (j.get("source") or "").startswith(args.source)]
    ranked = rank_jobs(jobs, prof)
    for i, j in enumerate(ranked[: args.top], 1):
        s = j.get("_score")
        print(f"{i:02d}. [{s:.2f}] {j.get('title')} — {j.get('company')} | {j.get('location')} | {j.get('source')}")
        print(f"    {j.get('url')}")
    if args.alert:
        send_alert(ranked, top=args.top)

def cmd_alert(args):
    prof = load_profile()
    ranked = rank_jobs(fetch_all_jobs(), prof)
    send_alert(ranked, top=args.top)
    print(f"[ok] Alert sent (top {args.top}).")

def cmd_prefill(args):
    mapping = build_prefill_map(ROOT, load_profile(), args.ats)
    print(json.dumps(mapping, indent=2))

def cmd_maintain_jobs(args):
    marked_inactive, archived = maintain_jobs()
    print(f"[ok] jobs maintained: marked_inactive={marked_inactive} archived={archived}")

def cmd_dedupe_jobs(args):
    deleted = dedupe_jobs()
    print(f"[ok] jobs deduped: removed={deleted}")

def cmd_list(args):
    jobs = fetch_all_jobs()
    if args.source:
        jobs = [j for j in jobs if (j.get("source") or "").startswith(args.source)]
    if args.contains:
        needle = args.contains.lower()
        def match(j):
            text = " ".join([
                str(j.get("title","")), str(j.get("company","")),
                str(j.get("location","")), str(j.get("source",""))
            ]).lower()
            return needle in text
        jobs = [j for j in jobs if match(j)]
    if args.rank:
        jobs = rank_jobs(jobs, load_profile())
    for i, j in enumerate(jobs[: args.limit], 1):
        s = f" | score={j.get('_score'):.2f}" if args.rank and j.get("_score") is not None else ""
        print(f"{i:02d} [{j.get('source')}] {j.get('title')} — {j.get('company')} | {j.get('location')}{s}")
        print(f"    {j.get('url')}")

# --- Seeds
def cmd_seed_add(args):
    ensure_seeds_table()
    con = get_conn()
    if is_postgres():
        sql = "INSERT INTO seeds(url, title_hint, company_hint, notes) VALUES(?,?,?,?) ON CONFLICT (url) DO NOTHING"
    else:
        sql = "INSERT OR IGNORE INTO seeds(url, title_hint, company_hint, notes) VALUES(?,?,?,?)"
    execute(con, sql, (args.url.strip(), args.title, args.company, args.notes))
    con.commit(); con.close()
    print("[ok] Seed saved:", args.url)

def cmd_seed_list(args):
    ensure_seeds_table()
    con = get_conn()
    rows = execute(con, "SELECT * FROM seeds ORDER BY created_at DESC LIMIT ?", (args.limit,)).fetchall()
    for r in rows:
        print(f"{r['id']:03d} {r['url']} | title_hint={r['title_hint']} company_hint={r['company_hint']} notes={r['notes']} @ {r['created_at']}")
    con.close()

def cmd_seed_harvest(args):
    """
    For each seed URL:
      - Detect GH/Lever token and harvest that board.
      - Optional: --filter-similar keeps only jobs whose titles match seed title keywords.
    """
    ensure_seeds_table()
    con = get_conn()
    seeds = con.execute("SELECT * FROM seeds ORDER BY created_at DESC").fetchall()
    con.close()
    if not seeds:
        print("[info] No seeds saved yet.")
        return

    total = 0
    keywords = _seed_keywords() if args.filter_similar else set()

    for s in seeds:
        url = s["url"]
        provider, token = detect_provider(url)
        if provider == "greenhouse" and token:
            print(f"[seed] greenhouse:{token} ← {url}")
            jobs = harvest_greenhouse([token])
        elif provider == "lever" and token:
            print(f"[seed] lever:{token} ← {url}")
            jobs = harvest_lever([token])
        else:
            print(f"[seed] no ATS detected for {url} (skipping)")
            continue

        if args.filter_similar and keywords:
            def similar(j):
                title = (getattr(j, "title", None) or j.get("title","")).lower()
                return any(k in title for k in keywords)
            jobs = [j for j in jobs if similar(j)]

        jobs = dedupe(jobs)
        upsert_jobs(to_rows(jobs))
        total += len(jobs)

    print(f"[ok] Inserted {total} ATS jobs from seeds.")

def _sqlite_table_exists(conn, name: str) -> bool:
    cur = execute(
        conn,
        "SELECT 1 FROM sqlite_master WHERE type='table' AND name=?",
        (name,),
    )
    return cur.fetchone() is not None

def _migrate_table(src_conn, dst_conn, table: str, columns: list[str], conflict_target: str | None = None) -> tuple[int, int]:
    cols = ", ".join(columns)
    rows = src_conn.execute(f"SELECT {cols} FROM {table}").fetchall()
    if not rows:
        return 0, 0
    placeholders = ", ".join(["?"] * len(columns))
    sql = f"INSERT INTO {table} ({cols}) VALUES ({placeholders})"
    if conflict_target:
        sql += f" ON CONFLICT ({conflict_target}) DO NOTHING"
    inserted = 0
    with dst_conn:
        for r in rows:
            values = [r[c] for c in columns]
            cur = execute(dst_conn, sql, values)
            if cur.rowcount and cur.rowcount > 0:
                inserted += cur.rowcount
    return len(rows), inserted

def _migrate_gmail_connections(src_conn, dst_conn) -> tuple[int, int, int]:
    cols = ["uid", "email", "refresh_token", "access_token", "token_expiry", "created_at", "updated_at"]
    rows = src_conn.execute(f"SELECT {', '.join(cols)} FROM gmail_connections").fetchall()
    if not rows:
        return 0, 0, 0
    inserted = 0
    updated = 0
    with dst_conn:
        for r in rows:
            uid = r["uid"]
            existing = execute(dst_conn, "SELECT id FROM gmail_connections WHERE uid = ?", (uid,)).fetchone()
            if existing:
                execute(
                    dst_conn,
                    """
                    UPDATE gmail_connections
                       SET email = ?,
                           refresh_token = ?,
                           access_token = ?,
                           token_expiry = ?,
                           updated_at = ?
                     WHERE uid = ?
                    """,
                    (r["email"], r["refresh_token"], r["access_token"], r["token_expiry"], r["updated_at"], uid),
                )
                updated += 1
            else:
                execute(
                    dst_conn,
                    """
                    INSERT INTO gmail_connections
                        (uid, email, refresh_token, access_token, token_expiry, created_at, updated_at)
                    VALUES (?, ?, ?, ?, ?, ?, ?)
                    """,
                    [r[c] for c in cols],
                )
                inserted += 1
    return len(rows), inserted, updated

def cmd_migrate_sqlite_to_postgres(args):
    if not is_postgres():
        print("[error] DATABASE_URL must point to Postgres to run this migration.", file=sys.stderr)
        return
    sqlite_path = Path(args.sqlite_path)
    if not sqlite_path.exists():
        print(f"[error] SQLite DB not found: {sqlite_path}", file=sys.stderr)
        return

    db_init()
    ensure_seeds_table()
    gmail_connections.ensure_table()

    src_conn = sqlite3.connect(sqlite_path)
    src_conn.row_factory = sqlite3.Row
    dst_conn = get_conn()

    try:
        tables = [
            ("jobs", ["source", "company", "title", "location", "url", "external_id", "posted_at", "jd_text", "salary", "tags", "visa", "created_at"], "url"),
            ("actions", ["job_url", "action", "details", "created_at"], None),
            ("alerts", ["job_url", "score", "created_at"], None),
            ("seeds", ["url", "title_hint", "company_hint", "notes", "created_at"], "url"),
        ]
        for table, cols, conflict in tables:
            if not _sqlite_table_exists(src_conn, table):
                print(f"[skip] {table}: not found in sqlite")
                continue
            total, inserted = _migrate_table(src_conn, dst_conn, table, cols, conflict)
            print(f"[ok] {table}: {inserted}/{total} rows migrated")

        if _sqlite_table_exists(src_conn, "gmail_connections"):
            total, inserted, updated = _migrate_gmail_connections(src_conn, dst_conn)
            print(f"[ok] gmail_connections: {inserted} inserted, {updated} updated, {total} total")
        else:
            print("[skip] gmail_connections: not found in sqlite")
    finally:
        src_conn.close()
        dst_conn.close()

# -----------------------
# Entrypoint / CLI
# -----------------------
def main():
    load_dotenv()

    ap = argparse.ArgumentParser("Job Butler")
    sub = ap.add_subparsers()

    # init-db
    p0 = sub.add_parser("init-db")
    p0.set_defaults(func=cmd_init_db)

    # harvest-live
    p_live = sub.add_parser("harvest-live")
    p_live.add_argument("--remoteok", action="store_true")
    p_live.add_argument("--adzuna", action="store_true")
    p_live.add_argument("--pages", type=int, default=1)
    p_live.add_argument("--rpp", type=int, default=50)
    p_live.add_argument("--greenhouse", type=str, help="comma-separated board tokens, e.g., notion,figma")
    p_live.add_argument("--lever", type=str, help="comma-separated company handles, e.g., brex,robinhood")
    p_live.set_defaults(func=cmd_harvest_live)

    # email ingest (Naukri / LinkedIn)
    p_ni = sub.add_parser("ingest-naukri-imap")
    p_ni.add_argument("--since", type=int, default=7)
    p_ni.add_argument("--max", type=int, default=50)
    p_ni.set_defaults(func=cmd_ingest_naukri_imap)

    p_li = sub.add_parser("ingest-linkedin-imap")
    p_li.add_argument("--since", type=int, default=30)
    p_li.add_argument("--max", type=int, default=200)
    p_li.set_defaults(func=cmd_ingest_linkedin_imap)

    # scoring / alert
    p2 = sub.add_parser("score")
    p2.add_argument("--top", type=int, default=10)
    p2.add_argument("--alert", action="store_true")
    p2.add_argument("--source", type=str, help="prefix filter, e.g., greenhouse:figma, lever:, adzuna:in")
    p2.set_defaults(func=cmd_score)

    p3 = sub.add_parser("alert")
    p3.add_argument("--top", type=int, default=10)
    p3.set_defaults(func=cmd_alert)

    # prefill
    p4 = sub.add_parser("prefill")
    p4.add_argument("--ats", required=True, choices=["greenhouse", "lever"])
    p4.set_defaults(func=cmd_prefill)

    # list
    p5 = sub.add_parser("list")
    p5.add_argument("--limit", type=int, default=50)
    p5.add_argument("--source", type=str)
    p5.add_argument("--contains", type=str)
    p5.add_argument("--rank", action="store_true")
    p5.set_defaults(func=cmd_list)

    # seeds
    ps_add = sub.add_parser("seed-add")
    ps_add.add_argument("--url", required=True)
    ps_add.add_argument("--title", default=None)
    ps_add.add_argument("--company", default=None)
    ps_add.add_argument("--notes", default=None)
    ps_add.set_defaults(func=cmd_seed_add)

    ps_list = sub.add_parser("seed-list")
    ps_list.add_argument("--limit", type=int, default=200)
    ps_list.set_defaults(func=cmd_seed_list)

    ps_h = sub.add_parser("seed-harvest")
    ps_h.add_argument("--filter-similar", action="store_true", help="keep only jobs similar to seed title keywords")
    ps_h.set_defaults(func=cmd_seed_harvest)

    # migrate sqlite to postgres
    p_mig = sub.add_parser("migrate-sqlite-to-postgres")
    p_mig.add_argument("--sqlite_path", default=str(DEFAULT_SQLITE_PATH))
    p_mig.set_defaults(func=cmd_migrate_sqlite_to_postgres)

    # maintain jobs
    p_maintain = sub.add_parser("maintain-jobs")
    p_maintain.set_defaults(func=cmd_maintain_jobs)

    p_dedupe = sub.add_parser("dedupe-jobs")
    p_dedupe.set_defaults(func=cmd_dedupe_jobs)

    args = ap.parse_args()
    if hasattr(args, "func"):
        args.func(args)
    else:
        ap.print_help()

if __name__ == "__main__":
    main()
