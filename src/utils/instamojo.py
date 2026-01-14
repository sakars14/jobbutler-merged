from __future__ import annotations

import hashlib
import hmac


def verify_instamojo_webhook_mac(payload: dict, salt: str) -> bool:
    if not payload or not salt:
        return False
    provided = payload.get("mac") or payload.get("MAC")
    if not provided:
        return False

    items = [(k, v) for k, v in payload.items() if k.lower() != "mac"]
    items.sort(key=lambda kv: kv[0].lower())
    message = "|".join(str(v) for _, v in items)
    digest = hmac.new(salt.encode("utf-8"), message.encode("utf-8"), hashlib.sha1).hexdigest()
    return hmac.compare_digest(digest, str(provided))
