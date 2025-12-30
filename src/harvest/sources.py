from __future__ import annotations
from dataclasses import dataclass, asdict, is_dataclass
from typing import List, Dict, Any

@dataclass
class JobPosting:
    source: str
    company: str
    title: str
    location: str
    url: str
    external_id: str | None
    posted_at: str | None
    jd_text: str
    salary: str | None = None
    tags: str | None = None
    visa: str | None = None

def _get_url(obj) -> str:
    if isinstance(obj, dict):
        return (obj.get("url") or "").strip()
    if is_dataclass(obj):
        return (getattr(obj, "url", "") or "").strip()
    return (getattr(obj, "url", "") or "").strip()

def dedupe(jobs: List[Any]) -> List[Any]:
    seen = set(); out = []
    for j in jobs:
        key = _get_url(j).lower()
        if key and key not in seen:
            seen.add(key); out.append(j)
    return out

_FIELDS = ["source","company","title","location","url","external_id","posted_at","jd_text","salary","tags","visa"]

def to_rows(jobs: List[Any]) -> List[Dict[str, Any]]:
    rows: List[Dict[str, Any]] = []
    for j in jobs:
        if isinstance(j, dict):
            row = {k: j.get(k) for k in _FIELDS}
        elif is_dataclass(j):
            row = asdict(j)
        else:
            d = getattr(j, "__dict__", {}) or {}
            row = {k: d.get(k) for k in _FIELDS}
        rows.append(row)
    return rows