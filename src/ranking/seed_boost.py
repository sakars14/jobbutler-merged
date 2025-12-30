from __future__ import annotations
import re
from typing import Dict, Set

from src.storage.db import get_conn

def _read_seeds() -> list[dict]:
    con = get_conn()
    try:
        rows = [dict(r) for r in con.execute("SELECT url, title_hint, company_hint FROM seeds").fetchall()]
    except Exception:
        con.close()
        return []
    con.close()
    return rows

def _parse_tokens(seeds: list[dict]) -> Dict[str, Set[str]]:
    gh_tokens, lv_tokens, comp_hints, title_kw = set(), set(), set(), set()
    for s in seeds:
        u = (s.get("url") or "").lower()
        m = re.search(r"boards\.greenhouse\.io/([^/?#]+)", u)
        if m: gh_tokens.add(m.group(1))
        m = re.search(r"jobs\.lever\.co/([^/?#]+)", u)
        if m: lv_tokens.add(m.group(1))
        c = (s.get("company_hint") or "").strip().lower()
        if c: comp_hints.add(c)
        th = (s.get("title_hint") or "").lower()
        if th:
            for t in re.split(r"[,\|/;]+", th):
                t = t.strip()
                if len(t) >= 3: title_kw.add(t)
    return {"gh": gh_tokens, "lv": lv_tokens, "comp": comp_hints, "title": title_kw}

_SEED_CACHE = None
def _get_cache():
    global _SEED_CACHE
    if _SEED_CACHE is None:
        _SEED_CACHE = _parse_tokens(_read_seeds())
    return _SEED_CACHE

def seed_seedscore(job: dict, profile: dict) -> float:
    cache = _get_cache()
    if not any(cache.values()):
        return 0.0
    src = (job.get("source") or "").lower()
    comp = (job.get("company") or "").lower()
    title = (job.get("title") or "").lower()
    jd = (job.get("jd_text") or "").lower()
    loc = (job.get("location") or "").lower()

    provider = (any(f"greenhouse:{t}" in src for t in cache["gh"]) or
                any(f"lever:{t}" in src for t in cache["lv"]))
    company = any(h in comp for h in cache["comp"]) if cache["comp"] else False
    title_hit = any(k in title for k in cache["title"]) if cache["title"] else False

    must = [s.lower() for s in (profile.get("must_have") or [])]
    nice = [s.lower() for s in (profile.get("nice_to_have") or [])]
    skills = must + nice
    skills_hit = any(k in jd or k in title for k in skills) if skills else False

    persona_locs = [l.lower() for l in (profile.get("locations") or [])]
    loc_hit = any(l in loc for l in persona_locs) if persona_locs and loc else False

    checks = [provider, company, title_hit, skills_hit, loc_hit]
    total = len(checks); matched = sum(1 for c in checks if c)

    if provider and (title_hit or skills_hit):
        return 1.0
    return matched / total if total else 0.0
