import json
import secrets

from fastapi import Depends, HTTPException, Request, Response
from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator
from sqlalchemy import delete, select, update
from sqlalchemy.exc import IntegrityError

from .account_profile import normalize_gallery_name
from .database import account_profiles, ensure_workspace, sessions, users
from .security import (COOKIE_NAME, digest, display_username, get_owner, hash_password, issue_session, login_throttle,
    normalize_permissions, normalize_username, public_user, require_mutation, require_owner_mutation,
    require_origin, set_session_cookie, verify_password)


class Credentials(BaseModel):
    model_config = ConfigDict(extra="forbid")
    username: str = Field(min_length=1, max_length=200)
    password: str = Field(min_length=8, max_length=256)

    @field_validator("username")
    @classmethod
    def valid_username(cls, value):
        normalized = display_username(value)
        if not normalized or len(normalized) > 200 or any(ord(character) < 32 for character in normalized):
            raise ValueError("نام کاربری معتبر نیست.")
        return normalized


class GalleryProfile(BaseModel):
    model_config = ConfigDict(extra="forbid")
    galleryName: str

    @field_validator("galleryName")
    @classmethod
    def valid_gallery_name(cls, value):
        return normalize_gallery_name(value)


class Registration(Credentials, GalleryProfile):
    pass


class UserCreate(Credentials):
    permissions: list[str] = Field(default_factory=list, max_length=20)
    active: bool = True

    @field_validator("permissions")
    @classmethod
    def valid_permissions(cls, value):
        return normalize_permissions(value)


class UserPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    permissions: list[str] | None = Field(default=None, max_length=20)
    active: bool | None = None
    password: str | None = Field(default=None, min_length=8, max_length=256)

    @field_validator("permissions")
    @classmethod
    def valid_permissions(cls, value):
        return normalize_permissions(value) if value is not None else None

    @model_validator(mode="after")
    def non_null_changes(self):
        if not self.model_fields_set or any(getattr(self, field) is None for field in self.model_fields_set):
            raise ValueError("تغییر معتبر مشخص نشده است.")
        return self


class PasswordChange(BaseModel):
    model_config = ConfigDict(extra="forbid")
    currentPassword: str = Field(min_length=1, max_length=256)
    newPassword: str = Field(min_length=8, max_length=256)


def register_account_routes(application):
    engine, settings = application.state.engine, application.state.settings

    @application.post("/api/auth/register", status_code=201, dependencies=[Depends(require_origin)])
    def register(payload: Registration, request: Request, response: Response):
        login_throttle(engine, request.client.host if request.client else "unknown")
        account_id = secrets.token_hex(16)
        user = {"id": secrets.token_hex(16), "account_id": account_id,
            "username": payload.username, "normalized_username": normalize_username(payload.username),
            "role": "owner", "password_hash": hash_password(payload.password), "permissions": "[]", "active": True, "version": 1}
        try:
            with engine.begin() as connection:
                connection.execute(users.insert().values(**user))
                connection.execute(account_profiles.insert().values(account_id=account_id, gallery_name=payload.galleryName))
                ensure_workspace(connection, account_id)
                previous = request.cookies.get(COOKIE_NAME)
                if previous:
                    connection.execute(delete(sessions).where(sessions.c.token_hash == digest(previous)))
                token, result = issue_session(connection, user, settings)
        except IntegrityError:
            raise HTTPException(409, "این نام کاربری قبلاً ثبت شده است.")
        set_session_cookie(response, token, settings)
        return result

    @application.patch("/api/owner/profile")
    def update_profile(payload: GalleryProfile, identity=Depends(require_owner_mutation)):
        from sqlalchemy import literal
        account_id = identity["user"]["account_id"]
        with engine.begin() as connection:
            connection.execute(account_profiles.insert().from_select(["account_id", "gallery_name"],
                select(literal(account_id), literal(payload.galleryName)).where(
                    ~select(account_profiles.c.account_id).where(account_profiles.c.account_id == account_id).exists())))
            connection.execute(update(account_profiles).where(account_profiles.c.account_id == account_id).values(gallery_name=payload.galleryName))
        return {"user": public_user({**identity["user"], "gallery_name": payload.galleryName})}

    @application.get("/api/owner/users")
    def list_users(identity=Depends(get_owner)):
        with engine.connect() as connection:
            found = connection.execute(select(users).where(users.c.account_id == identity["user"]["account_id"]).order_by(users.c.role, users.c.username)).mappings().all()
        return {"users": [public_user({**user, "gallery_name": identity["user"]["gallery_name"]}, include_active=True) for user in found]}

    @application.post("/api/owner/users", status_code=201)
    def create_user(payload: UserCreate, identity=Depends(require_owner_mutation)):
        user = {"id": secrets.token_hex(16), "username": payload.username,
            "account_id": identity["user"]["account_id"],
            "normalized_username": normalize_username(payload.username), "role": "staff", "password_hash": hash_password(payload.password),
            "permissions": json.dumps(payload.permissions), "active": payload.active, "version": 1}
        try:
            with engine.begin() as connection:
                connection.execute(users.insert().values(**user))
        except IntegrityError:
            raise HTTPException(409, "این نام کاربری قبلاً ثبت شده است.")
        return {"user": public_user({**user, "gallery_name": identity["user"]["gallery_name"]}, include_active=True)}

    @application.patch("/api/owner/users/{identifier}")
    def edit_user(identifier: str, payload: UserPatch, identity=Depends(require_owner_mutation)):
        values = payload.model_dump(exclude_unset=True)
        if "password" in values:
            values["password_hash"] = hash_password(values.pop("password"))
        if "permissions" in values:
            values["permissions"] = json.dumps(values["permissions"])
        with engine.begin() as connection:
            user = connection.execute(select(users).where(users.c.id == identifier, users.c.account_id == identity["user"]["account_id"])).mappings().first()
            if not user:
                raise HTTPException(404, "کاربر پیدا نشد.")
            if user["role"] == "owner":
                raise HTTPException(403, "حساب مالک از این بخش قابل تغییر نیست؛ برای تغییر رمز از بخش رمز خود استفاده کنید.")
            result = connection.execute(update(users).where(users.c.id == identifier, users.c.account_id == identity["user"]["account_id"], users.c.version == user["version"]).values(**values, version=user["version"] + 1))
            if result.rowcount != 1:
                raise HTTPException(409, "حساب کاربر همزمان تغییر کرده است؛ دوباره بارگذاری کنید.")
            connection.execute(delete(sessions).where(sessions.c.username == user["username"]))
            updated = {**dict(user), **values, "version": user["version"] + 1}
        return {"user": public_user({**updated, "gallery_name": identity["user"]["gallery_name"]}, include_active=True)}

    @application.post("/api/auth/password")
    def change_password(payload: PasswordChange, request: Request, response: Response, identity=Depends(require_mutation)):
        login_throttle(engine, f"password-change:{identity['user']['id']}")
        user = identity["user"]
        if not verify_password(payload.currentPassword, user["password_hash"]):
            raise HTTPException(400, "رمز فعلی درست نیست.")
        updated = {**user, "password_hash": hash_password(payload.newPassword), "version": user["version"] + 1}
        with engine.begin() as connection:
            result = connection.execute(update(users).where(users.c.id == user["id"], users.c.version == user["version"]).values(password_hash=updated["password_hash"], version=updated["version"]))
            if result.rowcount != 1:
                raise HTTPException(409, "حساب همزمان تغییر کرده است؛ دوباره وارد شوید.")
            connection.execute(delete(sessions).where(sessions.c.username == user["username"]))
            token, result = issue_session(connection, updated, settings)
        set_session_cookie(response, token, settings)
        return result
