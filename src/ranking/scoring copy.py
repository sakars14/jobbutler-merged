# src/ranking/scoring.py

from __future__ import annotations
import re
from datetime import datetime, timezone

from .seed_boost import seed_seedscore


# --- time / recency ---------------------------------------------------------

def _parse_dt(val) -> datetime | None:
    """
    Parse various ISO-ish strings or datetime objects and return
    a timezone-aware UTC datetime. Returns None if parsing fails.
    """
    if not val:
        return None

    if isinstance(val, datetime):
        return val if val.tzinfo else val.replace(tzinfo=timezone.utc)

    if isinstance(val, str):
        s = val.strip()
        # Accept both "...Z" and "+00:00" and plain "YYYY-MM-DDTHH:MM:SS"
        if s.endswith("Z"):
            s = s[:-1] + "+00:00"
        try:
            dt = datetime.fromisoformat(s)
        except Exception:
            return None
        return dt if dt.tzinfo else dt.replace(tzinfo=timezone.utc)

    return None


def normalize_age(posted_at: str | datetime | None, days: int = 30) -> float:
    """
    Recency score in [0,1]: 1.0 if posted today, linearly decays to 0.0 by N days.
    Timezone-safe (handles aware/naive timestamps).
    """
    dt = _parse_dt(posted_at)
    if not dt:
        return 0.0

    now = datetime.now(timezone.utc)
    # Use total_seconds for finer granularity; fall back to day bucket
    age_days = max(0.0, (now - dt).total_seconds() / 86400.0)
    if age_days >= days:
        return 0.0
    return max(0.0, 1.0 - (age_days / float(days)))


# --- text / keyword matching ------------------------------------------------

def keyword_score(text: str, keywords: list[str]) -> float:
    """
    Simple normalized keyword hit rate in [0,1].
    Case-insensitive substring match; harmless for empty inputs.
    """
    if not text or not keywords:
        return 0.0
    t = text.lower()
    hits = sum(1 for k in keywords if k and k.lower() in t)
    return min(1.0, hits / max(1, len(keywords)))


# --- main job score ---------------------------------------------------------

def score_job(j: dict, profile: dict) -> float:
    """
    Overall score in [0,1].
      - Title role match (0.4)
      - Keyword hits across title/JD/company (0.3)
      - Recency (0.3, fades by 30 days)
      - Seed boost: ensures seed-aligned jobs float to the top (max with base score)
    """
    title = (j.get("title") or "").lower()
    jd    = (j.get("jd_text") or "").lower()
    comp  = (j.get("company") or "").lower()

    # profile knobs
    roles = [r.lower() for r in (profile.get("roles_target") or [])]
    must  = profile.get("must_have") or []
    nice  = profile.get("nice_to_have") or []
    kw    = must + nice

    s = 0.0

    # 1) Title match against target roles
    if any(r in title for r in roles):
        s += 0.4

    # 2) Keywords across title+JD+company
    s += 0.3 * keyword_score(" ".join((title, jd, comp)), kw)

    # 3) Recency
    s += 0.3 * normalize_age(j.get("posted_at"))

    # 4) Seed boost: if a job is seed-aligned, force it to at least that seed score
    s = max(s, seed_seedscore(j, profile))  # 0..1

    return min(1.0, max(0.0, float(s)))


def rank_jobs(jobs: list[dict], profile: dict) -> list[dict]:
    """
    Convenience: compute score for each job and return a new list sorted desc by _score.
    Adds a '_score' float field to each returned dict.
    """
    ranked = []
    for j in jobs:
        try:
            sc = float(score_job(j, profile))
        except Exception:
            sc = 0.0
        jj = dict(j)
        jj["_score"] = round(sc, 4)
        ranked.append(jj)
    ranked.sort(key=lambda x: x.get("_score", 0.0), reverse=True)
    return ranked