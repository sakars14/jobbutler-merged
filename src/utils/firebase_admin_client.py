from __future__ import annotations

import json
import os

import firebase_admin
from firebase_admin import auth, credentials, firestore


def _init_app():
    if firebase_admin._apps:
        return firebase_admin.get_app()

    raw = os.getenv("FIREBASE_SERVICE_ACCOUNT_JSON")
    if raw:
        try:
            info = json.loads(raw)
        except json.JSONDecodeError as exc:
            raise RuntimeError("FIREBASE_SERVICE_ACCOUNT_JSON is invalid JSON") from exc
        cred = credentials.Certificate(info)
        return firebase_admin.initialize_app(cred)

    creds_path = os.getenv("GOOGLE_APPLICATION_CREDENTIALS")
    if creds_path:
        cred = credentials.Certificate(creds_path)
        return firebase_admin.initialize_app(cred)

    raise RuntimeError(
        "Firebase admin not configured. Set FIREBASE_SERVICE_ACCOUNT_JSON or GOOGLE_APPLICATION_CREDENTIALS."
    )


def get_firestore_client():
    app = _init_app()
    return firestore.client(app)


def get_uid_by_phone(phone: str) -> str | None:
    app = _init_app()
    try:
        user = auth.get_user_by_phone_number(phone, app=app)
    except auth.UserNotFoundError:
        return None
    return user.uid
