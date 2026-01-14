from __future__ import annotations

import os
import time
from typing import Any, Dict, List

from .adzuna import harvest_adzuna
from .greenhouse import harvest_greenhouse
from .lever import harvest_lever
from .remoteok import harvest_remoteok
from .sources import JobPosting, dedupe

SOURCE_LIMITS = {
    "remoteok": {"max_seconds": 20, "max_items": 200},
    "adzuna": {"max_seconds": 45, "max_items": 300, "pages": 1, "rpp": 50},
    "greenhouse": {"max_seconds": 30, "max_items": 250, "max_companies": 12},
    "lever": {"max_seconds": 30, "max_items": 250, "max_companies": 12},
}

def _cap(items: List[JobPosting], max_items: int) -> List[JobPosting]:
    if max_items <= 0:
        return items
    return items[:max_items]

def _run_source(
    name: str,
    fn,
    max_items: int,
    errors: List[Dict[str, str]],
) -> List[JobPosting]:
    start = time.time()
    try:
        items = fn()
    except Exception as exc:
        errors.append({"source": name, "error": str(exc)})
        return []
    elapsed = time.time() - start
    limit = SOURCE_LIMITS.get(name, {})
    if limit.get("max_seconds") and elapsed > limit["max_seconds"]:
        print(f"[packs] {name} exceeded time budget ({elapsed:.1f}s)")
    return _cap(items, max_items)

def run_harvest_pack(
    config: Dict[str, Any],
    profile: dict,
) -> tuple[List[JobPosting], List[Dict[str, str]]]:
    out: List[JobPosting] = []
    errors: List[Dict[str, str]] = []

    if config.get("remoteok"):
        out.extend(
            _run_source(
                "remoteok",
                harvest_remoteok,
                SOURCE_LIMITS["remoteok"]["max_items"],
                errors,
            )
        )

    if config.get("adzuna_in"):
        limit = SOURCE_LIMITS["adzuna"]
        previous = os.getenv("ADZUNA_COUNTRIES")
        os.environ["ADZUNA_COUNTRIES"] = "in"
        try:
            out.extend(
                _run_source(
                    "adzuna",
                    lambda: harvest_adzuna(
                        profile,
                        pages=limit["pages"],
                        results_per_page=limit["rpp"],
                    ),
                    limit["max_items"],
                    errors,
                )
            )
        finally:
            if previous is None:
                os.environ.pop("ADZUNA_COUNTRIES", None)
            else:
                os.environ["ADZUNA_COUNTRIES"] = previous

    greenhouse = config.get("greenhouse") or []
    if isinstance(greenhouse, list) and greenhouse:
        limit = SOURCE_LIMITS["greenhouse"]
        boards = greenhouse[: limit["max_companies"]]
        out.extend(
            _run_source(
                "greenhouse",
                lambda: harvest_greenhouse(boards),
                limit["max_items"],
                errors,
            )
        )

    lever = config.get("lever") or []
    if isinstance(lever, list) and lever:
        limit = SOURCE_LIMITS["lever"]
        companies = lever[: limit["max_companies"]]
        out.extend(
            _run_source(
                "lever",
                lambda: harvest_lever(companies),
                limit["max_items"],
                errors,
            )
        )

    return dedupe(out), errors
