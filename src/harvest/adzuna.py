from __future__ import annotations
import os, requests, time
from typing import List
from .sources import JobPosting, dedupe

DEFAULT_TITLES = [
    "Senior Data Analyst","Analytics Manager","Lead Data Analyst",
    "Product Analytics","Data Science Manager","AI Analyst","ML Analyst","Business Intelligence"
]

def _queries(profile: dict) -> list[str]:
    titles = profile.get("roles_target", []) or []
    must   = profile.get("must_have", []) or []
    # keep them short; Adzuna prefers compact 'what' terms
    uniq = []
    for q in [*titles, *DEFAULT_TITLES, *must]:
        q = (q or "").strip()
        if q and q.lower() not in [u.lower() for u in uniq]:
            uniq.append(q)
    return uniq[:12]  # cap to avoid too many calls

def harvest_adzuna(profile: dict, pages: int = 1, results_per_page: int = 50) -> List[JobPosting]:
    app_id = os.getenv("ADZUNA_APP_ID")
    app_key = os.getenv("ADZUNA_APP_KEY")
    if not app_id or not app_key:
        print("[adzuna] missing ADZUNA_APP_ID/ADZUNA_APP_KEY; skip")
        return []
    countries = [c.strip().lower() for c in os.getenv("ADZUNA_COUNTRIES","in,us,gb").split(",") if c.strip()]
    out: List[JobPosting] = []
    for country in countries:
        for q in _queries(profile):
            for page in range(1, pages+1):
                url = f"https://api.adzuna.com/v1/api/jobs/{country}/search/{page}"
                params = {
                    "app_id": app_id,
                    "app_key": app_key,
                    "results_per_page": results_per_page,
                    "what": q
                }
                try:
                    r = requests.get(url, params=params, timeout=20)
                    if r.status_code != 200:
                        print(f"[adzuna] {country} '{q}' p{page} status {r.status_code}")
                        continue
                    data = r.json() or {}
                except Exception as e:
                    print(f"[adzuna] {country} '{q}' error: {e}")
                    continue
                for d in data.get("results", []):
                    out.append(JobPosting(
                        source=f"adzuna:{country}",
                        company=(d.get("company") or {}).get("display_name",""),
                        title=d.get("title",""),
                        location=(d.get("location") or {}).get("display_name",""),
                        url=d.get("redirect_url") or "",
                        external_id=str(d.get("adref") or ""),
                        posted_at=d.get("created"),
                        jd_text=d.get("description") or "",
                        salary=None, tags=None, visa=None
                    ))
                time.sleep(0.3)  # be polite
    return dedupe(out)
