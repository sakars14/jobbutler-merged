from __future__ import annotations
from dataclasses import dataclass, asdict, is_dataclass
from typing import List, Dict, Any

from src.utils.url_norm import normalize_url, url_hash

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
    url_hash: str | None = None
    salary: str | None = None
    tags: str | None = None
    visa: str | None = None

def _get_field(obj, name: str):
    if isinstance(obj, dict):
        return obj.get(name)
    if is_dataclass(obj):
        return getattr(obj, name, None)
    return getattr(obj, name, None)

def _get_url(obj) -> str:
    if isinstance(obj, dict):
        return (obj.get("url") or "").strip()
    if is_dataclass(obj):
        return (getattr(obj, "url", "") or "").strip()
    return (getattr(obj, "url", "") or "").strip()

def dedupe(jobs: List[Any]) -> List[Any]:
    seen = set(); out = []
    for j in jobs:
        source = (_get_field(j, "source") or "").strip().lower()
        external_id = _get_field(j, "external_id")
        if external_id:
            key = f"{source}|id|{str(external_id).strip().lower()}"
        else:
            norm = normalize_url(_get_url(j)).lower()
            key = f"{source}|url|{norm}" if norm else ""
        if key and key not in seen:
            seen.add(key); out.append(j)
    return out

_FIELDS = ["source","company","title","location","url","url_hash","external_id","posted_at","jd_text","salary","tags","visa"]

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
        url = (row.get("url") or "").strip()
        row["url"] = url or None
        ext = row.get("external_id")
        if ext is not None:
            ext = str(ext).strip()
            row["external_id"] = ext or None
        if not row.get("url_hash"):
            row["url_hash"] = url_hash(url) if url else None
        rows.append(row)
    return rows
