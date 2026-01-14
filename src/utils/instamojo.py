from __future__ import annotations

import hashlib
import hmac


def compute_instamojo_mac(payload: dict, salt: str) -> str:
    if not payload or not salt:
        return ""
    items = [(k, v) for k, v in payload.items() if k.lower() != "mac"]
    items.sort(key=lambda kv: kv[0].lower())
    message = "|".join(str(v) for _, v in items)
    return hmac.new(salt.encode("utf-8"), message.encode("utf-8"), hashlib.sha1).hexdigest()


def verify_instamojo_webhook_mac(payload: dict, salt: str) -> bool:
    provided = payload.get("mac") or payload.get("MAC")
    if not provided:
        return False
    digest = compute_instamojo_mac(payload, salt)
    return bool(digest) and hmac.compare_digest(digest, str(provided))
