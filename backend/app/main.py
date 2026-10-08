import json
import secrets
import time
from contextlib import asynccontextmanager
from typing import Any
from uuid import UUID

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import delete, select, update

from .accounts import register_account_routes
from .account_profile import stamp_workspace_gallery
from .customer_details import guard_customer_details
from .database import imports, initialize, make_engine, read_workspace, sessions, users, workspace_requests, workspaces
from .document_edits import register_document_routes
from .inventory import create_stock, delete_stock, edit_stock, guard_linked_inventory_changes, guard_new_document_identity, inventory_requests, sync_misc_purchase_caches
from .invoices import prepare_invoices, reserve_invoice_numbers
from .pricing import number
from .partners import canonical_partner_records, guard_partner_documents, register_partner_routes
from .security import (COOKIE_NAME, account_request_id, bootstrap_owner, digest, filter_workspace, get_user, has_permission,
    hash_password, issue_session, login_throttle, normalize_username, public_user, require_mutation, require_origin,
    require_owner_mutation, set_session_cookie, verify_password)
from .settings import Settings


MAX_REQUEST_BYTES = 8 * 1024 * 1024
DUMMY_HASH = hash_password(secrets.token_urlsafe(32))


class LoginInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=1, max_length=256)


class WorkspaceData(BaseModel):
    model_config = ConfigDict(extra="forbid")
    documents: list[dict[str, Any]] = Field(default_factory=list, max_length=50000)
    customers: list[dict[str, Any]] = Field(default_factory=list, max_length=50000)
    partners: list[dict[str, Any]] = Field(default_factory=list, max_length=50000)
    prices: dict[str, Any] = Field(default_factory=dict)
    openingSetup: dict[str, Any] = Field(default_factory=dict)
    goldPurchases: list[dict[str, Any]] = Field(default_factory=list, max_length=50000)
    cheques: list[dict[str, Any]] = Field(default_factory=list, max_length=50000)

    @field_validator("partners")
    @classmethod
    def valid_partners(cls, value):
        return canonical_partner_records(value, validate_balances=True)

    @model_validator(mode="after")
    def validate_documents(self):
        identities = set()
        for document in self.documents:
            identifier = document.get("id")
            if not isinstance(identifier, (str, int)) or isinstance(identifier, bool) or not str(identifier) or len(str(identifier)) > 200 or str(identifier) in identities:
                raise ValueError("شناسه اسناد باید معتبر و یکتا باشد.")
            identities.add(str(identifier))
        return self


class WorkspaceInput(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, strict=True)
    data: WorkspaceData
    requestId: UUID | None = None


class WorkspaceImport(BaseModel):
    model_config = ConfigDict(extra="forbid")
    data: WorkspaceData
    sourceUsername: str = Field(min_length=1, max_length=200)


class InventoryRevision(BaseModel):
    model_config = ConfigDict(extra="forbid")
    revision: int = Field(ge=0, strict=True)


class InventoryChanges(InventoryRevision):
    changes: dict[str, Any] = Field(min_length=1, max_length=30)


class InventoryCreate(InventoryRevision):
    item: dict[str, Any] = Field(min_length=1, max_length=40)
    requestId: UUID


def encode_workspace(data):
    try:
        encoded = json.dumps(data, ensure_ascii=False, allow_nan=False)
    except ValueError:
        raise HTTPException(422, "مقدار عددی نامعتبر است.")
    if len(encoded.encode()) > 6 * 1024 * 1024:
        raise HTTPException(413, "حجم دفتر حسابداری بیش از حد مجاز است.")
    return encoded


def semantically_empty(data):
    if any(data.get(field) for field in ("documents", "customers", "partners", "goldPurchases", "cheques")):
        return False
    if any(value not in (None, "") for value in data.get("prices", {}).values()):
        return False
    # Completing/skipping the empty setup screen is not accounting data.
    ignored = {"completed", "completedAt", "skipped"}
    return not any(value not in (None, "", False, [], {}) for key, value in data.get("openingSetup", {}).items() if key not in ignored)


class BodyLimitExceeded(Exception):
    pass


class BodyLimitMiddleware:
    def __init__(self, app):
        self.app = app

    async def __call__(self, scope, receive, send):
        if scope["type"] != "http":
            return await self.app(scope, receive, send)
        headers = dict(scope.get("headers", []))
        try:
            content_length = int(headers.get(b"content-length", b"0"))
        except ValueError:
            content_length = MAX_REQUEST_BYTES + 1
        if content_length > MAX_REQUEST_BYTES:
            return await JSONResponse({"detail": "حجم درخواست بیش از حد مجاز است."}, status_code=413)(scope, receive, send)
        consumed = 0

        async def limited_receive():
            nonlocal consumed
            message = await receive()
            consumed += len(message.get("body", b""))
            if consumed > MAX_REQUEST_BYTES:
                raise BodyLimitExceeded()
            return message

        try:
            await self.app(scope, limited_receive, send)
        except BodyLimitExceeded:
            await JSONResponse({"detail": "حجم درخواست بیش از حد مجاز است."}, status_code=413)(scope, receive, send)


def create_app(settings=None):
    settings = settings or Settings()
    engine = make_engine(settings.database_url)

    @asynccontextmanager
    async def lifespan(application):
        initialize(engine)
        bootstrap_owner(engine, settings.owner_username, settings.owner_password_hash)
        settings.upload_dir.mkdir(parents=True, exist_ok=True)
        yield
        engine.dispose()

    application = FastAPI(title="حسابداری نور", version="2.0.0", lifespan=lifespan, docs_url=None, redoc_url=None, openapi_url=None)
    application.state.settings = settings
    application.state.engine = engine
    application.add_middleware(BodyLimitMiddleware)
    application.add_middleware(CORSMiddleware, allow_origins=list(settings.origins), allow_credentials=True,
        allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE"], allow_headers=["Content-Type", "X-CSRF-Token", "X-Account-ID"])
    register_account_routes(application)

    @application.middleware("http")
    async def response_headers(request, call_next):
        response = await call_next(request)
        response.headers["X-Content-Type-Options"] = "nosniff"
        response.headers["Referrer-Policy"] = "same-origin"
        response.headers["Cache-Control"] = "no-store"
        return response

    @application.exception_handler(RequestValidationError)
    async def validation_error(request, error):
        return JSONResponse(status_code=422, content={"detail": "اطلاعات واردشده معتبر نیست؛ فیلدها و محدودیت‌ها را بررسی کنید."})

    @application.get("/api/health")
    def health():
        return {"status": "ok", "service": "noor-gold-api"}

    @application.post("/api/auth/login", dependencies=[Depends(require_origin)])
    def login(payload: LoginInput, request: Request, response: Response):
        login_throttle(engine, request.client.host if request.client else "unknown")
        with engine.connect() as connection:
            user = connection.execute(select(users).where(users.c.normalized_username == normalize_username(payload.username))).mappings().first()
        password_matches = verify_password(payload.password, user["password_hash"] if user else DUMMY_HASH)
        if not user or not user["active"] or not password_matches:
            raise HTTPException(401, "نام کاربری یا رمز عبور درست نیست.")
        previous = request.cookies.get(COOKIE_NAME)
        with engine.begin() as connection:
            connection.execute(delete(sessions).where(sessions.c.expires_at < time.time()))
            if previous:
                connection.execute(delete(sessions).where(sessions.c.token_hash == digest(previous)))
            token, result = issue_session(connection, user, settings)
        set_session_cookie(response, token, settings)
        return result

    @application.get("/api/auth/session")
    def session(identity=Depends(get_user)):
        return {"user": public_user(identity["user"]), "csrfToken": identity["csrf"]}

    @application.post("/api/auth/logout")
    def logout(response: Response, owner=Depends(require_mutation)):
        with engine.begin() as connection:
            connection.execute(delete(sessions).where(sessions.c.token_hash == owner["token_hash"]))
        response.delete_cookie(COOKIE_NAME, path="/", secure=settings.cookie_secure, httponly=True, samesite="lax")
        return {"ok": True}

    def workspace_response(workspace, identity, connection=None):
        result = filter_workspace(workspace, identity)
        if identity["user"]["role"] == "owner":
            if connection is None:
                with engine.connect() as reader:
                    result["legacyImported"] = reader.execute(select(imports.c.id).where(imports.c.account_id == identity["user"]["account_id"]).limit(1)).first() is not None
            else:
                result["legacyImported"] = connection.execute(select(imports.c.id).where(imports.c.account_id == identity["user"]["account_id"]).limit(1)).first() is not None
        return result

    register_partner_routes(application, workspace_response, encode_workspace)
    register_document_routes(application, workspace_response, encode_workspace)

    @application.get("/api/owner/workspace")
    def get_workspace(identity=Depends(get_user)):
        with engine.connect() as connection:
            return workspace_response(read_workspace(connection, identity["user"]["account_id"]), identity, connection)

    @application.put("/api/owner/workspace")
    def put_workspace(payload: WorkspaceInput, identity=Depends(require_mutation)):
        changes = payload.data.model_dump(exclude_unset=True)
        if identity["user"]["role"] != "owner" and any(field == "openingSetup" or not has_permission(identity, f"{field}.write") for field in changes):
            raise HTTPException(403, "اجازهٔ ویرایش یکی از بخش‌های ارسال‌شده را ندارید.")
        request_id = account_request_id(identity["user"]["account_id"], str(payload.requestId)) if payload.requestId else None
        body_hash = None
        if request_id:
            try:
                body_hash = digest(json.dumps(changes, sort_keys=True, ensure_ascii=False, allow_nan=False))
            except ValueError:
                raise HTTPException(422, "مقدار عددی نامعتبر است.")

        def replay(connection):
            if not request_id:
                return None
            previous = connection.execute(select(workspace_requests).where(workspace_requests.c.request_id == request_id, workspace_requests.c.account_id == identity["user"]["account_id"])).mappings().first()
            if previous is None:
                return None
            if previous["actor_id"] != identity["user"]["id"] or previous["body_hash"] != body_hash:
                raise HTTPException(409, "شناسهٔ این درخواست قبلاً برای ثبت دیگری استفاده شده است؛ درخواست جدید ثبت کنید.")
            # Return today's workspace; replaying an earlier save must never undo later documents.
            return workspace_response(read_workspace(connection, identity["user"]["account_id"]), identity, connection)

        with engine.begin() as connection:
            previous_result = replay(connection)
            if previous_result is not None:
                return previous_result
            current = read_workspace(connection, identity["user"]["account_id"])
            if current["revision"] != payload.revision:
                previous_result = replay(connection)
                if previous_result is not None:
                    return previous_result
                raise HTTPException(409, "دفتر در صفحه دیگری تغییر کرده است؛ پیش از ذخیره دوباره آخرین نسخه را بارگذاری کنید.")
            data = {**current["data"], **changes}
            if "partners" in changes and changes["partners"] != current["data"]["partners"]:
                raise HTTPException(409, "دفتر همکاران فقط از بخش همکاران قابل تغییر است.")
            if "customers" in changes:
                guard_customer_details(current["data"]["customers"], data["customers"])
            if "documents" in changes:
                guard_customer_details(current["data"]["documents"], data["documents"], documents=True)
                guard_partner_documents(current["data"]["documents"], data["documents"])
                guard_linked_inventory_changes(current["data"]["documents"], data["documents"])
                guard_new_document_identity(current["data"]["documents"], data["documents"])
                data["documents"] = prepare_invoices(current["data"]["documents"], data["documents"], connection, account_id=identity["user"]["account_id"], prices=data.get("prices", {}))
                if "customers" in changes:
                    sync_misc_purchase_caches(data, current["data"]["documents"])
            encoded = encode_workspace(data)
            result = connection.execute(update(workspaces).where(workspaces.c.account_id == identity["user"]["account_id"], workspaces.c.revision == payload.revision).values(data=encoded, revision=payload.revision + 1))
            if result.rowcount != 1:
                # A simultaneous retry may have committed while this write waited for its lock.
                previous_result = replay(connection)
                if previous_result is not None:
                    # Invoice numbers reserved by this losing retry must not be consumed.
                    connection.rollback()
                    return previous_result
                raise HTTPException(409, "دفتر در صفحه دیگری تغییر کرده است؛ پیش از ذخیره دوباره آخرین نسخه را بارگذاری کنید.")
            if request_id:
                connection.execute(workspace_requests.insert().values(request_id=request_id, account_id=identity["user"]["account_id"], actor_id=identity["user"]["id"],
                    body_hash=body_hash, revision=payload.revision + 1, created_at=time.time()))
        return workspace_response({"revision": payload.revision + 1, "data": data}, identity)

    def mutate_inventory(identifier, payload, identity, removing=False):
        with engine.begin() as connection:
            current = read_workspace(connection, identity["user"]["account_id"])
            if current["revision"] != payload.revision:
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
            data = delete_stock(current["data"], identifier, identity) if removing else edit_stock(current["data"], identifier, payload.changes, identity)
            data["documents"] = prepare_invoices(current["data"]["documents"], data["documents"], connection, allow_single_stock_edit=True, account_id=identity["user"]["account_id"])
            encoded = encode_workspace(data)
            result = connection.execute(update(workspaces).where(workspaces.c.account_id == identity["user"]["account_id"], workspaces.c.revision == payload.revision).values(data=encoded, revision=payload.revision + 1))
            if result.rowcount != 1:
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
        return workspace_response({"revision": payload.revision + 1, "data": data}, identity)

    @application.patch("/api/owner/inventory/{identifier}")
    def patch_inventory(identifier: str, payload: InventoryChanges, identity=Depends(require_mutation)):
        return mutate_inventory(identifier, payload, identity)

    @application.post("/api/owner/inventory", status_code=201)
    def add_inventory(payload: InventoryCreate, response: Response, identity=Depends(require_mutation)):
        if not has_permission(identity, "documents.write"):
            raise HTTPException(403, "اجازهٔ افزودن جنس به صندوق ندارید.")
        try:
            body_hash = digest(json.dumps(payload.item, sort_keys=True, ensure_ascii=False, allow_nan=False))
        except ValueError:
            raise HTTPException(422, "اطلاعات عددی جنس معتبر نیست.")
        request_id = account_request_id(identity["user"]["account_id"], str(payload.requestId))
        with engine.begin() as connection:
            current = read_workspace(connection, identity["user"]["account_id"])
            previous = connection.execute(select(inventory_requests).where(inventory_requests.c.request_id == request_id, inventory_requests.c.account_id == identity["user"]["account_id"])).mappings().first()
            if previous:
                if previous["actor_id"] != identity["user"]["id"] or previous["body_hash"] != body_hash:
                    raise HTTPException(409, "شناسهٔ این درخواست قبلاً برای ثبت دیگری استفاده شده است؛ فرم جدید باز کنید.")
                if not any(str(document["id"]) == previous["created_id"] for document in current["data"]["documents"]):
                    raise HTTPException(409, "این درخواست قبلاً ثبت شده اما جنس آن حذف شده است؛ برای ثبت دوباره فرم جدید باز کنید.")
                response.status_code = 200
                return {**workspace_response(current, identity, connection), "createdId": previous["created_id"]}
            if current["revision"] != payload.revision:
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
            data, created_id = create_stock(current["data"], payload.item, identity)
            stamp_workspace_gallery(current["data"], data, connection, identity["user"]["account_id"])
            encoded = encode_workspace(data)
            updated = connection.execute(update(workspaces).where(workspaces.c.account_id == identity["user"]["account_id"], workspaces.c.revision == payload.revision).values(data=encoded, revision=payload.revision + 1))
            if updated.rowcount != 1:
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ ابتدا آخرین نسخه را بارگذاری کنید.")
            connection.execute(inventory_requests.insert().values(request_id=request_id, account_id=identity["user"]["account_id"], actor_id=identity["user"]["id"],
                body_hash=body_hash, created_id=created_id, created_at=time.time()))
        return {**workspace_response({"revision": payload.revision + 1, "data": data}, identity), "createdId": created_id}

    @application.delete("/api/owner/inventory/{identifier}")
    def remove_inventory(identifier: str, payload: InventoryRevision, identity=Depends(require_mutation)):
        return mutate_inventory(identifier, payload, identity, removing=True)

    @application.post("/api/owner/workspace/import")
    def import_workspace(payload: WorkspaceImport, identity=Depends(require_owner_mutation)):
        data = payload.data.model_dump()
        encoded = encode_workspace(data)
        with engine.begin() as connection:
            current = read_workspace(connection, identity["user"]["account_id"])
            if current["data"] == data:
                return {**workspace_response(current, identity, connection), "imported": False}
            if not semantically_empty(current["data"]):
                raise HTTPException(409, "دفتر سرور دارای اطلاعات است؛ برای جلوگیری از حذف داده، انتقال خودکار انجام نشد.")
            # Remittance-only partner invoices have numbers without inventory rows.
            # Include them when restoring the sequence from a workspace backup.
            numbered_rows = [*data["documents"], *(entry for partner in data["partners"] for entry in partner["entries"])]
            minimum_number = max((int(value) for row in numbered_rows if (value := number(row.get("invoiceNumber"))) > 0
                and value <= 9007199254740991 and value == value.to_integral_value()), default=0)
            reserve_invoice_numbers(connection, minimum_number, 0, identity["user"]["account_id"])
            revision = current["revision"] + 1
            result = connection.execute(update(workspaces).where(workspaces.c.account_id == identity["user"]["account_id"], workspaces.c.revision == current["revision"]).values(data=encoded, revision=revision))
            if result.rowcount != 1:
                raise HTTPException(409, "دفتر همزمان تغییر کرده است؛ انتقال انجام نشد.")
            connection.execute(imports.insert().values(id=secrets.token_hex(16), account_id=identity["user"]["account_id"], source_username=payload.sourceUsername,
                actor_id=identity["user"]["id"], created_at=time.time(), revision=revision))
        return {**workspace_response({"revision": revision, "data": data}, identity), "imported": True}

    return application


app = create_app()
