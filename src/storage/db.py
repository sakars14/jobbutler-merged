import os, sqlite3
from pathlib import Path

try:
    import psycopg
    from psycopg.rows import dict_row
except Exception:
    psycopg = None
    dict_row = None

DB_PATH = os.environ.get("JOB_BUTLER_DB", str(Path(__file__).resolve().parents[2] / "job_butler.sqlite3"))

def _get_database_url() -> str | None:
    # Set DATABASE_URL to a postgres://... URL in production to use Postgres.
    return os.getenv("DATABASE_URL")

def _is_postgres_url(url: str | None) -> bool:
    return bool(url) and (url.startswith("postgres://") or url.startswith("postgresql://"))

def is_postgres() -> bool:
    return _is_postgres_url(_get_database_url())

def get_db_label() -> str:
    return "postgres" if is_postgres() else DB_PATH

def _require_psycopg() -> None:
    if psycopg is None:
        raise RuntimeError("psycopg is required for Postgres. Add psycopg[binary] to requirements.txt.")

SQLITE_SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  company TEXT,
  title TEXT,
  location TEXT,
  url TEXT UNIQUE,
  external_id TEXT,
  posted_at TEXT,
  jd_text TEXT,
  salary TEXT,
  tags TEXT,
  visa TEXT,
  score REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);

CREATE TABLE IF NOT EXISTS actions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_url TEXT,
  action TEXT,
  details TEXT,
  created_at TEXT DEFAULT (datetime('now'))
);

CREATE TABLE IF NOT EXISTS alerts (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  job_url TEXT,
  score REAL,
  created_at TEXT DEFAULT (datetime('now'))
);
"""

POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS jobs (
  id SERIAL PRIMARY KEY,
  source TEXT NOT NULL,
  company TEXT,
  title TEXT,
  location TEXT,
  url TEXT UNIQUE,
  external_id TEXT,
  posted_at TEXT,
  jd_text TEXT,
  salary TEXT,
  tags TEXT,
  visa TEXT,
  score REAL,
  created_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_jobs_source ON jobs(source);
CREATE INDEX IF NOT EXISTS idx_jobs_company ON jobs(company);
CREATE INDEX IF NOT EXISTS idx_jobs_posted_at ON jobs(posted_at);

CREATE TABLE IF NOT EXISTS actions (
  id SERIAL PRIMARY KEY,
  job_url TEXT,
  action TEXT,
  details TEXT,
  created_at TIMESTAMP DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS alerts (
  id SERIAL PRIMARY KEY,
  job_url TEXT,
  score REAL,
  created_at TIMESTAMP DEFAULT NOW()
);
"""

def get_conn():
    url = _get_database_url()
    if _is_postgres_url(url):
        _require_psycopg()
        return psycopg.connect(url, row_factory=dict_row)
    conn = sqlite3.connect(DB_PATH)
    conn.row_factory = sqlite3.Row
    return conn

def get_db():
    return get_conn()

def execute(conn, sql, params=None):
    if params is None:
        params = ()
    if is_postgres() and not isinstance(conn, sqlite3.Connection):
        sql = sql.replace("?", "%s")
    return conn.execute(sql, params)

def init_db():
    conn = get_conn()
    with conn:
        schema = POSTGRES_SCHEMA if is_postgres() else SQLITE_SCHEMA
        for stmt in schema.split(";"):
            if stmt.strip():
                conn.execute(stmt)
    conn.close()

def upsert_jobs(rows):
    conn = get_conn()
    with conn:
        for r in rows:
            if is_postgres():
                conn.execute(
                    """INSERT INTO jobs(source,company,title,location,url,external_id,posted_at,jd_text,salary,tags,visa)
                       VALUES(%(source)s,%(company)s,%(title)s,%(location)s,%(url)s,%(external_id)s,%(posted_at)s,%(jd_text)s,%(salary)s,%(tags)s,%(visa)s)
                       ON CONFLICT (url) DO NOTHING""",
                    r,
                )
            else:
                conn.execute(
                    """INSERT OR IGNORE INTO jobs(source,company,title,location,url,external_id,posted_at,jd_text,salary,tags,visa)
                       VALUES(:source,:company,:title,:location,:url,:external_id,:posted_at,:jd_text,:salary,:tags,:visa)""",
                    r,
                )
    conn.close()

def fetch_all_jobs():
    conn = get_conn()
    cur = conn.execute("SELECT * FROM jobs ORDER BY COALESCE(posted_at, created_at) DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close(); return rows
