import os, sqlite3, json
from pathlib import Path

from src.utils.url_norm import url_hash as compute_url_hash

try:
    import psycopg
    from psycopg.rows import dict_row
    from psycopg_pool import ConnectionPool
except Exception:
    psycopg = None
    dict_row = None
    ConnectionPool = None

DB_PATH = os.environ.get("JOB_BUTLER_DB", str(Path(__file__).resolve().parents[2] / "job_butler.sqlite3"))
_PG_POOL = None

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

def get_pg_pool():
    global _PG_POOL
    if _PG_POOL is not None:
        return _PG_POOL
    url = _get_database_url()
    if not _is_postgres_url(url):
        raise RuntimeError("DATABASE_URL must be set to a Postgres URL to use the pool.")
    _require_psycopg()
    if ConnectionPool is None:
        raise RuntimeError("psycopg_pool is required for Postgres pooling.")
    _PG_POOL = ConnectionPool(
        conninfo=url,
        min_size=1,
        max_size=10,
        kwargs={"row_factory": dict_row, "autocommit": True},
    )
    return _PG_POOL

def close_pg_pool() -> None:
    global _PG_POOL
    if _PG_POOL is not None:
        _PG_POOL.close()
        _PG_POOL = None

SQLITE_SCHEMA = """
PRAGMA journal_mode=WAL;
CREATE TABLE IF NOT EXISTS jobs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  source TEXT NOT NULL,
  company TEXT,
  title TEXT,
  location TEXT,
  url TEXT UNIQUE,
  url_hash TEXT,
  external_id TEXT,
  posted_at TEXT,
  jd_text TEXT,
  salary TEXT,
  tags TEXT,
  visa TEXT,
  score REAL,
  created_at TEXT DEFAULT (datetime('now')),
  first_seen_at TEXT,
  last_seen_at TEXT DEFAULT (datetime('now')),
  is_active INTEGER DEFAULT 1,
  archived_at TEXT
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
  url TEXT,
  url_hash TEXT,
  external_id TEXT,
  posted_at TEXT,
  jd_text TEXT,
  salary TEXT,
  tags TEXT,
  visa TEXT,
  score REAL,
  created_at TIMESTAMP DEFAULT NOW(),
  first_seen_at TIMESTAMPTZ,
  last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
  is_active BOOLEAN DEFAULT TRUE,
  archived_at TIMESTAMPTZ
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

DEFAULT_PACK_SOURCES = [
    "remoteok",
    "adzuna",
    "greenhouse:databricks",
    "greenhouse:stripe",
    "greenhouse:coinbase",
    "greenhouse:brex",
    "greenhouse:figma",
    "greenhouse:discord",
    "greenhouse:robinhood",
]

DEFAULT_PACK_KEYWORDS = [
    "data analyst",
    "data scientist",
    "software engineer",
    "backend",
    "frontend",
    "full stack",
    "python",
    "sql",
    "java",
    "node",
    "react",
]

def _build_default_pack_config() -> dict:
    config = {
        "remoteok": False,
        "adzuna_in": False,
        "greenhouse": [],
        "lever": [],
        "roleKeywords": DEFAULT_PACK_KEYWORDS,
    }
    for source in DEFAULT_PACK_SOURCES:
        if source == "remoteok":
            config["remoteok"] = True
        elif source == "adzuna":
            config["adzuna_in"] = True
        elif source.startswith("greenhouse:"):
            config["greenhouse"].append(source.split(":", 1)[1])
        elif source.startswith("lever:"):
            config["lever"].append(source.split(":", 1)[1])
    return config

DEFAULT_HARVEST_PACK = {
    "slug": "tech_core",
    "name": "Tech Core",
    "description": "Core tech boards + alerts.",
    "config": _build_default_pack_config(),
}

JOB_COLUMNS = [
    "id",
    "source",
    "company",
    "title",
    "location",
    "url",
    "url_hash",
    "external_id",
    "posted_at",
    "jd_text",
    "salary",
    "tags",
    "visa",
    "score",
    "created_at",
    "first_seen_at",
    "last_seen_at",
    "is_active",
    "archived_at",
]

def _get_job_stale_days() -> int:
    try:
        return int(os.getenv("JOB_STALE_DAYS", "14"))
    except ValueError:
        return 14

def _get_job_archive_days() -> int:
    try:
        return int(os.getenv("JOB_ARCHIVE_DAYS", "30"))
    except ValueError:
        return 30

def _ensure_sqlite_job_columns(conn) -> None:
    cols = {row[1] for row in conn.execute("PRAGMA table_info(jobs)").fetchall()}
    updates = []
    if "score" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN score REAL")
    if "url" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN url TEXT")
    if "external_id" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN external_id TEXT")
    if "url_hash" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN url_hash TEXT")
    if "first_seen_at" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN first_seen_at TEXT")
    if "last_seen_at" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN last_seen_at TEXT")
    if "is_active" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN is_active INTEGER DEFAULT 1")
    if "archived_at" not in cols:
        updates.append("ALTER TABLE jobs ADD COLUMN archived_at TEXT")
    for stmt in updates:
        conn.execute(stmt)

def _ensure_jobs_archive(conn) -> None:
    if is_postgres():
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs_archive (
              id BIGINT,
              source TEXT NOT NULL,
              company TEXT,
              title TEXT,
              location TEXT,
              url TEXT,
              url_hash TEXT,
              external_id TEXT,
              posted_at TEXT,
              jd_text TEXT,
              salary TEXT,
              tags TEXT,
              visa TEXT,
              score REAL,
              created_at TIMESTAMP,
              first_seen_at TIMESTAMPTZ,
              last_seen_at TIMESTAMPTZ,
              is_active BOOLEAN,
              archived_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
            )
            """
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_archive_url ON jobs_archive(url)"
        )
        conn.execute("ALTER TABLE jobs_archive ADD COLUMN IF NOT EXISTS url_hash TEXT")
    else:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS jobs_archive (
              id INTEGER,
              source TEXT NOT NULL,
              company TEXT,
              title TEXT,
              location TEXT,
              url TEXT,
              url_hash TEXT,
              external_id TEXT,
              posted_at TEXT,
              jd_text TEXT,
              salary TEXT,
              tags TEXT,
              visa TEXT,
              score REAL,
              created_at TEXT,
              first_seen_at TEXT,
              last_seen_at TEXT,
              is_active INTEGER,
              archived_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            "CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_archive_url ON jobs_archive(url)"
        )
        cols = {row[1] for row in conn.execute("PRAGMA table_info(jobs_archive)").fetchall()}
        if "url_hash" not in cols:
            conn.execute("ALTER TABLE jobs_archive ADD COLUMN url_hash TEXT")

def _backfill_url_hash(conn) -> int:
    rows = execute(
        conn,
        """
        SELECT id, url
          FROM jobs
         WHERE url IS NOT NULL
           AND url != ''
           AND (url_hash IS NULL OR url_hash = '')
        """,
    ).fetchall()
    updated = 0
    for row in rows:
        h = compute_url_hash(row["url"])
        if not h:
            continue
        execute(
            conn,
            "UPDATE jobs SET url_hash = ? WHERE id = ?",
            (h, row["id"]),
        )
        updated += 1
    return updated

def _ensure_job_indexes(conn) -> None:
    if is_postgres():
        conn.execute("ALTER TABLE jobs DROP CONSTRAINT IF EXISTS jobs_url_key")
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_external_id
              ON jobs (source, external_id)
             WHERE external_id IS NOT NULL
            """
        )
        conn.execute(
            """
            CREATE UNIQUE INDEX IF NOT EXISTS idx_jobs_source_url_hash
              ON jobs (source, url_hash)
             WHERE external_id IS NULL AND url_hash IS NOT NULL
            """
        )

def _ensure_harvest_packs(conn) -> None:
    if is_postgres():
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS harvest_packs (
              id SERIAL PRIMARY KEY,
              slug TEXT UNIQUE,
              name TEXT,
              description TEXT,
              is_enabled BOOLEAN DEFAULT TRUE,
              config JSONB NOT NULL,
              last_run_at TIMESTAMPTZ,
              deleted_at TIMESTAMPTZ,
              created_at TIMESTAMPTZ DEFAULT NOW(),
              updated_at TIMESTAMPTZ DEFAULT NOW()
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS harvest_pack_runs (
              id SERIAL PRIMARY KEY,
              pack_slug TEXT,
              started_at TIMESTAMPTZ,
              finished_at TIMESTAMPTZ,
              status TEXT,
              inserted_count INTEGER,
              updated_count INTEGER,
              inactive_marked_count INTEGER,
              archived_count INTEGER,
              error_text TEXT
            )
            """
        )
        conn.execute(
            "ALTER TABLE harvest_packs ADD COLUMN IF NOT EXISTS deleted_at TIMESTAMPTZ"
        )
        existing = conn.execute(
            "SELECT 1 FROM harvest_packs WHERE slug IN ('tech_core', 'tech-core')"
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT INTO harvest_packs (slug, name, description, is_enabled, config)
                VALUES (%s, %s, %s, TRUE, %s::jsonb)
                ON CONFLICT (slug) DO NOTHING
                """,
                (
                    DEFAULT_HARVEST_PACK["slug"],
                    DEFAULT_HARVEST_PACK["name"],
                    DEFAULT_HARVEST_PACK["description"],
                    json.dumps(DEFAULT_HARVEST_PACK["config"]),
                ),
            )
        _cleanup_default_pack_config(conn)
    else:
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS harvest_packs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              slug TEXT UNIQUE,
              name TEXT,
              description TEXT,
              is_enabled INTEGER DEFAULT 1,
              config TEXT NOT NULL,
              last_run_at TEXT,
              deleted_at TEXT,
              created_at TEXT DEFAULT (datetime('now')),
              updated_at TEXT DEFAULT (datetime('now'))
            )
            """
        )
        conn.execute(
            """
            CREATE TABLE IF NOT EXISTS harvest_pack_runs (
              id INTEGER PRIMARY KEY AUTOINCREMENT,
              pack_slug TEXT,
              started_at TEXT,
              finished_at TEXT,
              status TEXT,
              inserted_count INTEGER,
              updated_count INTEGER,
              inactive_marked_count INTEGER,
              archived_count INTEGER,
              error_text TEXT
            )
            """
        )
        cols = {row[1] for row in conn.execute("PRAGMA table_info(harvest_packs)").fetchall()}
        if "deleted_at" not in cols:
            conn.execute("ALTER TABLE harvest_packs ADD COLUMN deleted_at TEXT")
        existing = conn.execute(
            "SELECT 1 FROM harvest_packs WHERE slug IN (?, ?)",
            ("tech_core", "tech-core"),
        ).fetchone()
        if not existing:
            conn.execute(
                """
                INSERT OR IGNORE INTO harvest_packs (slug, name, description, is_enabled, config)
                VALUES (?, ?, ?, 1, ?)
                """,
                (
                    DEFAULT_HARVEST_PACK["slug"],
                    DEFAULT_HARVEST_PACK["name"],
                    DEFAULT_HARVEST_PACK["description"],
                    json.dumps(DEFAULT_HARVEST_PACK["config"]),
                ),
            )
        _cleanup_default_pack_config(conn)

def _cleanup_default_pack_config(conn) -> None:
    row = execute(
        conn,
        "SELECT slug, config FROM harvest_packs WHERE slug IN (?, ?)",
        ("tech_core", "tech-core"),
    ).fetchone()
    if not row:
        return
    raw = row["config"]
    config = raw if isinstance(raw, dict) else json.loads(raw or "{}")
    lever_list = list(config.get("lever") or [])
    greenhouse_list = list(config.get("greenhouse") or [])
    banned_lever = {"discord", "robinhood", "databricks"}
    new_lever = [c for c in lever_list if c not in banned_lever]
    added_greenhouse = []
    for name in ("discord", "robinhood"):
        if name not in greenhouse_list:
            greenhouse_list.append(name)
            added_greenhouse.append(name)
    if new_lever == lever_list and not added_greenhouse:
        return
    config["lever"] = new_lever
    config["greenhouse"] = greenhouse_list
    if "sources" in config:
        sources = set(config.get("sources") or [])
        if not new_lever and "lever" in sources:
            sources.discard("lever")
        if greenhouse_list:
            sources.add("greenhouse")
        config["sources"] = sorted(sources)
    if is_postgres():
        conn.execute(
            "UPDATE harvest_packs SET config = %s::jsonb, updated_at = NOW() WHERE slug = %s",
            (json.dumps(config), row["slug"]),
        )
    else:
        conn.execute(
            "UPDATE harvest_packs SET config = ?, updated_at = datetime('now') WHERE slug = ?",
            (json.dumps(config), row["slug"]),
        )

def ensure_harvest_packs(conn=None) -> None:
    owns_conn = False
    if conn is None:
        conn = get_conn()
        owns_conn = True
    _ensure_harvest_packs(conn)
    if not is_postgres():
        conn.commit()
    if owns_conn:
        conn.close()

def get_conn():
    url = _get_database_url()
    if _is_postgres_url(url):
        _require_psycopg()
        conn = psycopg.connect(url, row_factory=dict_row)
        conn.autocommit = True
        return conn
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
    try:
        schema = POSTGRES_SCHEMA if is_postgres() else SQLITE_SCHEMA
        for stmt in schema.split(";"):
            if stmt.strip():
                conn.execute(stmt)
        if is_postgres():
            conn.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS url TEXT")
            conn.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS external_id TEXT")
            conn.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS first_seen_at TIMESTAMPTZ")
            conn.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS last_seen_at TIMESTAMPTZ")
            conn.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS is_active BOOLEAN")
            conn.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS archived_at TIMESTAMPTZ")
            conn.execute("ALTER TABLE jobs ADD COLUMN IF NOT EXISTS url_hash TEXT")
            conn.execute(
                """
                UPDATE jobs
                   SET first_seen_at = COALESCE(first_seen_at, created_at, NOW()),
                       last_seen_at = COALESCE(last_seen_at, created_at, NOW()),
                       is_active = COALESCE(is_active, TRUE)
                """
            )
            conn.execute("UPDATE jobs SET external_id = NULL WHERE external_id = ''")
            conn.execute("ALTER TABLE jobs ALTER COLUMN last_seen_at SET DEFAULT NOW()")
            conn.execute("ALTER TABLE jobs ALTER COLUMN last_seen_at SET NOT NULL")
            _ensure_jobs_archive(conn)
            dedupe_jobs(conn)
            _ensure_job_indexes(conn)
            ensure_harvest_packs(conn)
        else:
            _ensure_sqlite_job_columns(conn)
            conn.execute(
                """
                UPDATE jobs
                   SET first_seen_at = COALESCE(first_seen_at, created_at, datetime('now')),
                       last_seen_at = COALESCE(last_seen_at, created_at, datetime('now')),
                       is_active = COALESCE(is_active, 1)
                """
            )
            conn.execute("UPDATE jobs SET external_id = NULL WHERE external_id = ''")
            _ensure_jobs_archive(conn)
            _backfill_url_hash(conn)
            _ensure_job_indexes(conn)
            ensure_harvest_packs(conn)
        if not is_postgres():
            conn.commit()
    finally:
        conn.close()

def _prepare_job_row(row: dict) -> dict:
    url = (row.get("url") or "").strip()
    row["url"] = url or None
    ext = row.get("external_id")
    if ext is not None:
        ext = str(ext).strip()
        row["external_id"] = ext or None
    if not row.get("url_hash"):
        row["url_hash"] = compute_url_hash(url) if url else None
    return row

def upsert_jobs(rows, conn=None):
    owns_conn = False
    if conn is None:
        conn = get_conn()
        owns_conn = True
    for r in rows:
        r = _prepare_job_row(dict(r))
        if is_postgres():
            if r.get("external_id"):
                conn.execute(
                    """INSERT INTO jobs(source,company,title,location,url,url_hash,external_id,posted_at,jd_text,salary,tags,visa,first_seen_at,last_seen_at,is_active)
                       VALUES(%(source)s,%(company)s,%(title)s,%(location)s,%(url)s,%(url_hash)s,%(external_id)s,%(posted_at)s,%(jd_text)s,%(salary)s,%(tags)s,%(visa)s,NOW(),NOW(),TRUE)
                       ON CONFLICT (source, external_id) WHERE external_id IS NOT NULL DO UPDATE SET
                         company = COALESCE(NULLIF(EXCLUDED.company,''), jobs.company),
                         location = COALESCE(NULLIF(EXCLUDED.location,''), jobs.location),
                         title = COALESCE(NULLIF(EXCLUDED.title,''), jobs.title),
                         salary = COALESCE(NULLIF(EXCLUDED.salary,''), jobs.salary),
                         jd_text = COALESCE(NULLIF(EXCLUDED.jd_text,''), jobs.jd_text),
                         posted_at = COALESCE(NULLIF(EXCLUDED.posted_at,''), jobs.posted_at),
                         tags = COALESCE(NULLIF(EXCLUDED.tags,''), jobs.tags),
                         visa = COALESCE(NULLIF(EXCLUDED.visa,''), jobs.visa),
                         url = COALESCE(NULLIF(EXCLUDED.url,''), jobs.url),
                         url_hash = COALESCE(EXCLUDED.url_hash, jobs.url_hash),
                         last_seen_at = NOW(),
                         is_active = TRUE,
                         archived_at = NULL,
                         first_seen_at = COALESCE(jobs.first_seen_at, NOW())""",
                    r,
                )
            elif r.get("url_hash"):
                conn.execute(
                    """INSERT INTO jobs(source,company,title,location,url,url_hash,external_id,posted_at,jd_text,salary,tags,visa,first_seen_at,last_seen_at,is_active)
                       VALUES(%(source)s,%(company)s,%(title)s,%(location)s,%(url)s,%(url_hash)s,%(external_id)s,%(posted_at)s,%(jd_text)s,%(salary)s,%(tags)s,%(visa)s,NOW(),NOW(),TRUE)
                       ON CONFLICT (source, url_hash) WHERE external_id IS NULL AND url_hash IS NOT NULL DO UPDATE SET
                         company = COALESCE(NULLIF(EXCLUDED.company,''), jobs.company),
                         location = COALESCE(NULLIF(EXCLUDED.location,''), jobs.location),
                         title = COALESCE(NULLIF(EXCLUDED.title,''), jobs.title),
                         salary = COALESCE(NULLIF(EXCLUDED.salary,''), jobs.salary),
                         jd_text = COALESCE(NULLIF(EXCLUDED.jd_text,''), jobs.jd_text),
                         posted_at = COALESCE(NULLIF(EXCLUDED.posted_at,''), jobs.posted_at),
                         tags = COALESCE(NULLIF(EXCLUDED.tags,''), jobs.tags),
                         visa = COALESCE(NULLIF(EXCLUDED.visa,''), jobs.visa),
                         url = COALESCE(NULLIF(EXCLUDED.url,''), jobs.url),
                         url_hash = COALESCE(EXCLUDED.url_hash, jobs.url_hash),
                         last_seen_at = NOW(),
                         is_active = TRUE,
                         archived_at = NULL,
                         first_seen_at = COALESCE(jobs.first_seen_at, NOW())""",
                    r,
                )
            else:
                conn.execute(
                    """INSERT INTO jobs(source,company,title,location,url,url_hash,external_id,posted_at,jd_text,salary,tags,visa,first_seen_at,last_seen_at,is_active)
                       VALUES(%(source)s,%(company)s,%(title)s,%(location)s,%(url)s,%(url_hash)s,%(external_id)s,%(posted_at)s,%(jd_text)s,%(salary)s,%(tags)s,%(visa)s,NOW(),NOW(),TRUE)""",
                    r,
                )
        else:
            conn.execute(
                """INSERT OR IGNORE INTO jobs(source,company,title,location,url,url_hash,external_id,posted_at,jd_text,salary,tags,visa,first_seen_at,last_seen_at,is_active)
                   VALUES(:source,:company,:title,:location,:url,:url_hash,:external_id,:posted_at,:jd_text,:salary,:tags,:visa,datetime('now'),datetime('now'),1)""",
                r,
            )
            if r.get("url"):
                conn.execute(
                    """UPDATE jobs
                          SET company = COALESCE(NULLIF(:company,''), company),
                              location = COALESCE(NULLIF(:location,''), location),
                              title = COALESCE(NULLIF(:title,''), title),
                              salary = COALESCE(NULLIF(:salary,''), salary),
                              jd_text = COALESCE(NULLIF(:jd_text,''), jd_text),
                              posted_at = COALESCE(NULLIF(:posted_at,''), posted_at),
                              tags = COALESCE(NULLIF(:tags,''), tags),
                              visa = COALESCE(NULLIF(:visa,''), visa),
                              url_hash = COALESCE(NULLIF(:url_hash,''), url_hash),
                              last_seen_at = datetime('now'),
                              is_active = 1,
                              archived_at = NULL,
                              first_seen_at = COALESCE(first_seen_at, datetime('now'))
                        WHERE url = :url""",
                    r,
                )
    if not is_postgres():
        conn.commit()
    if owns_conn:
        conn.close()

def maintain_jobs(conn=None):
    stale_days = _get_job_stale_days()
    archive_days = _get_job_archive_days()
    owns_conn = False
    if conn is None:
        conn = get_conn()
        owns_conn = True
    marked_inactive = 0
    archived = 0
    _ensure_jobs_archive(conn)
    if is_postgres():
        cur = conn.execute(
            f"""
            UPDATE jobs
               SET is_active = FALSE
             WHERE COALESCE(is_active, TRUE) = TRUE
               AND last_seen_at < NOW() - INTERVAL '{stale_days} days'
            """
        )
        marked_inactive = max(cur.rowcount or 0, 0)
        cols = ", ".join([c for c in JOB_COLUMNS if c != "id"])
        cur = conn.execute(
            f"""
            INSERT INTO jobs_archive ({cols})
            SELECT {cols}
              FROM jobs
             WHERE COALESCE(is_active, TRUE) = FALSE
               AND last_seen_at < NOW() - INTERVAL '{archive_days} days'
            ON CONFLICT (url) DO NOTHING
            """
        )
        archived = max(cur.rowcount or 0, 0)
        conn.execute(
            f"""
            DELETE FROM jobs
             WHERE COALESCE(is_active, TRUE) = FALSE
               AND last_seen_at < NOW() - INTERVAL '{archive_days} days'
            """
        )
    else:
        cur = conn.execute(
            """
            UPDATE jobs
               SET is_active = 0
             WHERE COALESCE(is_active, 1) = 1
               AND last_seen_at < datetime('now', ?)
            """,
            (f"-{stale_days} days",),
        )
        marked_inactive = max(cur.rowcount or 0, 0)
        cols = ", ".join([c for c in JOB_COLUMNS if c != "id"])
        conn.execute(
            f"""
            INSERT OR IGNORE INTO jobs_archive ({cols})
            SELECT {cols}
              FROM jobs
             WHERE COALESCE(is_active, 1) = 0
               AND last_seen_at < datetime('now', ?)
            """,
            (f"-{archive_days} days",),
        )
        cur = conn.execute("SELECT changes()")
        row = cur.fetchone()
        archived = row[0] if row else 0
        conn.execute(
            """
            DELETE FROM jobs
             WHERE COALESCE(is_active, 1) = 0
               AND last_seen_at < datetime('now', ?)
            """,
            (f"-{archive_days} days",),
        )
    if not is_postgres():
        conn.commit()
    if owns_conn:
        conn.close()
    return marked_inactive, archived

def dedupe_jobs(conn=None) -> int:
    if not is_postgres():
        return 0
    owns_conn = False
    if conn is None:
        conn = get_conn()
        owns_conn = True
    deleted = 0
    execute(conn, "UPDATE jobs SET external_id = NULL WHERE external_id = ''")
    _backfill_url_hash(conn)
    cur = conn.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY source, external_id
                       ORDER BY last_seen_at DESC NULLS LAST, id DESC
                   ) AS rn
              FROM jobs
             WHERE external_id IS NOT NULL
        )
        DELETE FROM jobs
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        """
    )
    deleted += max(cur.rowcount or 0, 0)
    cur = conn.execute(
        """
        WITH ranked AS (
            SELECT id,
                   ROW_NUMBER() OVER (
                       PARTITION BY source, url_hash
                       ORDER BY last_seen_at DESC NULLS LAST, id DESC
                   ) AS rn
              FROM jobs
             WHERE external_id IS NULL
               AND url_hash IS NOT NULL
        )
        DELETE FROM jobs
         WHERE id IN (SELECT id FROM ranked WHERE rn > 1)
        """
    )
    deleted += max(cur.rowcount or 0, 0)
    if owns_conn:
        conn.close()
    return deleted

def fetch_all_jobs():
    conn = get_conn()
    cur = conn.execute("SELECT * FROM jobs ORDER BY COALESCE(posted_at, created_at) DESC")
    rows = [dict(r) for r in cur.fetchall()]
    conn.close(); return rows
