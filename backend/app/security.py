import hashlib
import hmac
import json
import secrets
import threading
import time
import unicodedata

from fastapi import HTTPException, Request
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from .database import LEGACY_ACCOUNT_ID, attempts, sessions, users


COOKIE_NAME = "noor_session"
PASSWORD_CHECKS = threading.BoundedSemaphore(2)
WORKSPACE_FIELDS = ("documents", "customers", "partners", "prices", "goldPurchases", "cheques")
PERMISSIONS = frozenset(f"{field}.{action}" for field in WORKSPACE_FIELDS for action in ("read", "write"))


def display_username(value):
    return " ".join(unicodedata.normalize("NFKC", value).replace("ي", "ی").replace("ك", "ک").split())


def normalize_username(value):
    return display_username(value).casefold()


def normalize_permissions(values):
    selected = set(values)
    if not selected <= PERMISSIONS:
        raise ValueError("مجوز انتخاب‌شده معتبر نیست.")
    selected.update(f"{field}.read" for field in WORKSPACE_FIELDS if f"{field}.write" in selected)
    return sorted(selected)


def public_user(user, include_active=False):
    result = {"id": user["id"], "username": user["username"], "role": user["role"],
        "accountId": user["account_id"], "legacyAccount": user["account_id"] == LEGACY_ACCOUNT_ID,
        "permissions": sorted(PERMISSIONS) if user["role"] == "owner" else sorted(set(json.loads(user["permissions"])) & PERMISSIONS)}
    if include_active:
        result["active"] = user["active"]
    return result


def credential_version(user):
    return digest(f"{user['id']}:{user['version']}:{user['password_hash']}")


def bootstrap_owner(engine, username, password_hash):
    username = display_username(username)
    if not username or not password_hash:
        return
    from sqlalchemy import literal
    with engine.begin() as connection:
        values = {"id": "gallery-owner", "username": username, "normalized_username": normalize_username(username),
            "account_id": LEGACY_ACCOUNT_ID,
            "role": "owner", "password_hash": password_hash, "permissions": "[]", "active": True, "version": 1}
        try:
            with connection.begin_nested():
                connection.execute(users.insert().from_select(list(values), select(*(literal(value) for value in values.values())).where(
                    ~select(users.c.id).where(users.c.account_id == LEGACY_ACCOUNT_ID, users.c.role == "owner").exists())))
        except IntegrityError:
            pass


def hash_password(password):
    salt = secrets.token_hex(16)
    digest = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=32768, r=8, p=3, maxmem=64 * 1024 * 1024).hex()
    return f"scrypt$32768$8$3${salt}${digest}"


def verify_password(password, encoded):
    if not PASSWORD_CHECKS.acquire(blocking=False):
        raise HTTPException(429, "سرور در حال بررسی ورود است؛ چند لحظه بعد دوباره تلاش کنید.", headers={"Retry-After": "2"})
    try:
        algorithm, n, r, p, salt, expected = encoded.split("$")
        if algorithm != "scrypt" or (int(n), int(r), int(p)) != (32768, 8, 3):
            return False
        actual = hashlib.scrypt(password.encode(), salt=bytes.fromhex(salt), n=int(n), r=int(r), p=int(p), maxmem=64 * 1024 * 1024).hex()
        return hmac.compare_digest(actual, expected)
    except (ValueError, TypeError):
        return False
    finally:
        PASSWORD_CHECKS.release()


def digest(value):
    return hashlib.sha256(value.encode()).hexdigest()


def require_origin(request: Request):
    if request.headers.get("origin", "").rstrip("/") not in request.app.state.settings.origins:
        raise HTTPException(403, "مبدأ درخواست مجاز نیست.")


def get_user(request: Request):
    token = request.cookies.get(COOKIE_NAME, "")
    if not token or len(token) > 256:
        raise HTTPException(401, "برای دسترسی به حسابداری وارد حساب خود شوید.")
    with request.app.state.engine.connect() as connection:
        session = connection.execute(select(sessions).where(sessions.c.token_hash == digest(token))).mappings().first()
        user = connection.execute(select(users).where(users.c.normalized_username == normalize_username(session["username"]))).mappings().first() if session else None
    if not session or session["expires_at"] <= time.time() or not user or not user["active"] or session["credential_version"] != credential_version(user):
        raise HTTPException(401, "نشست شما منقضی شده است؛ دوباره وارد شوید.")
    expected_account = request.headers.get("x-account-id")
    if expected_account is not None and expected_account != user["account_id"]:
        raise HTTPException(401, "حساب فعال تغییر کرده است؛ دوباره وارد حساب مورد نظر شوید.")
    return {**dict(session), "user": dict(user)}


def get_owner(request: Request):
    identity = get_user(request)
    if identity["user"]["role"] != "owner":
        raise HTTPException(403, "این عملیات فقط برای مدیر حساب مجاز است.")
    return identity


def has_permission(identity, permission):
    return permission in PERMISSIONS and (identity["user"]["role"] == "owner" or permission in json.loads(identity["user"]["permissions"]))


def account_request_id(account_id, request_id):
    # Retain pre-migration receipts, while allowing the same client UUID in
    # different accounts without revealing whether another account used it.
    return request_id if account_id == LEGACY_ACCOUNT_ID else digest(f"{account_id}:{request_id}")


def require_storefront(request: Request):
    identity = get_user(request)
    if not has_permission(identity, "storefront.manage"):
        raise HTTPException(403, "اجازهٔ مدیریت ویترین ندارید.")
    return identity


def require_mutation(request: Request):
    require_origin(request)
    owner = get_user(request)
    supplied = request.headers.get("x-csrf-token", "")
    if len(supplied) > 128 or not hmac.compare_digest(supplied.encode(), owner["csrf"].encode()):
        raise HTTPException(403, "توکن امنیتی درخواست معتبر نیست؛ صفحه را دوباره باز کنید.")
    return owner


def require_owner_mutation(request: Request):
    identity = require_mutation(request)
    if identity["user"]["role"] != "owner":
        raise HTTPException(403, "این عملیات فقط برای مدیر حساب مجاز است.")
    return identity


def require_storefront_mutation(request: Request):
    identity = require_mutation(request)
    if not has_permission(identity, "storefront.manage"):
        raise HTTPException(403, "اجازهٔ مدیریت ویترین ندارید.")
    return identity


def filter_workspace(workspace, identity):
    if identity["user"]["role"] == "owner":
        return workspace
    return {"revision": workspace["revision"], "data": {field: value for field, value in workspace["data"].items()
        if field in WORKSPACE_FIELDS and has_permission(identity, f"{field}.read")}}


def issue_session(connection, user, settings):
    token, csrf = secrets.token_urlsafe(48), secrets.token_urlsafe(32)
    connection.execute(sessions.insert().values(token_hash=digest(token), csrf=csrf, username=user["username"],
        credential_version=credential_version(user), expires_at=time.time() + settings.session_seconds))
    return token, {"user": public_user(user), "csrfToken": csrf}


def set_session_cookie(response, token, settings):
    response.set_cookie(COOKIE_NAME, token, max_age=settings.session_seconds, secure=settings.cookie_secure, httponly=True, samesite="lax", path="/")


def login_throttle(engine, identity):
    now = time.time()
    bucket = int(now // 600)
    key = digest(f"{identity}:{bucket}")
    # Increment on the database, so parallel workers cannot each reset the limit.
    with engine.begin() as connection:
        connection.execute(delete(attempts).where(attempts.c.expires_at < now))
        result = connection.execute(update(attempts).where(attempts.c.key == key).values(count=attempts.c.count + 1))
        if not result.rowcount:
            try:
                with connection.begin_nested():
                    connection.execute(attempts.insert().values(key=key, count=1, expires_at=(bucket + 1) * 600))
            except IntegrityError:
                connection.execute(update(attempts).where(attempts.c.key == key).values(count=attempts.c.count + 1))
        count = connection.execute(select(attempts.c.count).where(attempts.c.key == key)).scalar_one()
    if count > 10:
        raise HTTPException(429, "تعداد تلاش‌های ورود زیاد است؛ چند دقیقه بعد دوباره تلاش کنید.", headers={"Retry-After": str(max(1, int((bucket + 1) * 600 - now)))})
