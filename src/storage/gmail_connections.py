import os
import time
from typing import Optional, Dict, Any

import requests

from src.storage.db import get_conn, execute, is_postgres  # reuse existing DB helper

SQLITE_SCHEMA = """
CREATE TABLE IF NOT EXISTS gmail_connections (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    uid TEXT NOT NULL,
    email TEXT,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    token_expiry INTEGER,
    created_at TEXT DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_gmail_connections_uid ON gmail_connections(uid);
"""

POSTGRES_SCHEMA = """
CREATE TABLE IF NOT EXISTS gmail_connections (
    id SERIAL PRIMARY KEY,
    uid TEXT NOT NULL,
    email TEXT,
    refresh_token TEXT NOT NULL,
    access_token TEXT,
    token_expiry BIGINT,
    created_at TIMESTAMP DEFAULT NOW(),
    updated_at TIMESTAMP DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_gmail_connections_uid ON gmail_connections(uid);
"""


def _get_google_client_id() -> str | None:
    return os.getenv("GOOGLE_OAUTH_CLIENT_ID") or os.getenv("GOOGLE_CLIENT_ID")


def _get_google_client_secret() -> str | None:
    return os.getenv("GOOGLE_OAUTH_CLIENT_SECRET") or os.getenv("GOOGLE_CLIENT_SECRET")


def _ensure_table() -> None:
    """Create gmail_connections table if it doesn't exist."""
    conn = get_conn()
    schema = POSTGRES_SCHEMA if is_postgres() else SQLITE_SCHEMA
    with conn:
        for stmt in schema.split(";"):
            if stmt.strip():
                conn.execute(stmt)
    conn.close()

def ensure_table() -> None:
    _ensure_table()


def upsert_gmail_connection(
    uid: str,
    email: Optional[str],
    refresh_token: str,
    access_token: Optional[str],
    token_expiry: Optional[int],
) -> None:
    """
    Insert or update a Gmail connection row for this uid.
    """
    _ensure_table()
    conn = get_conn()

    cur = execute(conn, "SELECT id FROM gmail_connections WHERE uid = ?", (uid,))
    row = cur.fetchone()

    if row:
        execute(
            conn,
            """
            UPDATE gmail_connections
               SET email = ?,
                   refresh_token = ?,
                   access_token = ?,
                   token_expiry = ?,
                   updated_at = CURRENT_TIMESTAMP
             WHERE uid = ?
            """,
            (email, refresh_token, access_token, token_expiry, uid),
        )
    else:
        execute(
            conn,
            """
            INSERT INTO gmail_connections
                (uid, email, refresh_token, access_token, token_expiry)
            VALUES (?, ?, ?, ?, ?)
            """,
            (uid, email, refresh_token, access_token, token_expiry),
        )

    conn.commit()
    conn.close()


def get_gmail_connection(uid: str) -> Optional[Dict[str, Any]]:
    """Return the connection row for this uid, or None."""
    _ensure_table()
    conn = get_conn()
    cur = execute(conn, "SELECT * FROM gmail_connections WHERE uid = ?", (uid,))
    row = cur.fetchone()
    conn.close()
    return dict(row) if row else None


def get_fresh_access_token(uid: str) -> str:
    """
    Return a valid access_token for this uid.
    Refreshes it using refresh_token if expired or missing.
    """
    _ensure_table()
    conn = get_conn()
    cur = execute(conn, "SELECT * FROM gmail_connections WHERE uid = ?", (uid,))
    row = cur.fetchone()
    conn.close()

    if not row:
        raise RuntimeError(f"No gmail_connection found for uid={uid}")

    refresh_token = row["refresh_token"]
    access_token = row["access_token"]
    token_expiry = row["token_expiry"] or 0

    now = int(time.time())

    # If we still have a non-expired token, just reuse it
    if access_token and token_expiry > now + 60:
        return access_token

    client_id = _get_google_client_id()
    client_secret = _get_google_client_secret()

    if not client_id or not client_secret:
        raise RuntimeError("GOOGLE_OAUTH_CLIENT_ID / GOOGLE_OAUTH_CLIENT_SECRET not set")

    resp = requests.post(
        "https://oauth2.googleapis.com/token",
        data={
            "client_id": client_id,
            "client_secret": client_secret,
            "refresh_token": refresh_token,
            "grant_type": "refresh_token",
        },
        timeout=10,
    )

    if resp.status_code != 200:
        raise RuntimeError(f"Refresh token failed: {resp.text}")

    data = resp.json()
    new_access_token = data.get("access_token")
    expires_in = int(data.get("expires_in") or 0)
    new_expiry = now + expires_in

    if not new_access_token:
        raise RuntimeError("No access_token in refresh response")

    # Save new token + expiry
    conn = get_conn()
    execute(
        conn,
        """
        UPDATE gmail_connections
           SET access_token = ?,
               token_expiry = ?,
               updated_at = CURRENT_TIMESTAMP
         WHERE uid = ?
        """,
        (new_access_token, new_expiry, uid),
    )
    conn.commit()
    conn.close()

    return new_access_token
