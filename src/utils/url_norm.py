from __future__ import annotations

import hashlib
from urllib.parse import urlparse, urlunparse, parse_qsl, urlencode

_TRACKING_KEYS = {
    "gclid",
    "fbclid",
    "ref",
    "source",
    "src",
    "referrer",
    "igshid",
    "mc_cid",
    "mc_eid",
}


def normalize_url(url: str) -> str:
    if not url:
        return ""
    raw = url.strip()
    try:
        parsed = urlparse(raw)
    except Exception:
        return raw

    if not parsed.scheme and not parsed.netloc:
        return raw

    scheme = (parsed.scheme or "").lower()
    netloc = (parsed.netloc or "").lower()
    path = parsed.path or ""
    if path.endswith("/") and path != "/":
        path = path[:-1]

    kept = []
    for key, value in parse_qsl(parsed.query, keep_blank_values=True):
        k = (key or "").lower()
        if k.startswith("utm_") or k in _TRACKING_KEYS:
            continue
        kept.append((key, value))
    kept.sort()
    query = urlencode(kept, doseq=True)

    return urlunparse((scheme, netloc, path, "", query, ""))


def url_hash(url: str) -> str | None:
    normalized = normalize_url(url)
    if not normalized:
        return None
    return hashlib.sha256(normalized.encode("utf-8")).hexdigest()
