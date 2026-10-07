"""Independent homepage photographs, unrelated to inventory or the accounting ledger."""
import secrets
import time

from fastapi import Depends, File, Form, HTTPException, Request, UploadFile
from fastapi.responses import FileResponse
from pydantic import BaseModel, ConfigDict, Field, field_validator
from sqlalchemy import Boolean, CheckConstraint, Column, Float, Integer, String, Table, delete, select, update
from sqlalchemy.exc import IntegrityError

from .database import metadata
from .image_uploads import sanitized_image
from .security import require_storefront, require_storefront_mutation


MAX_GALLERY_IMAGES = 12
DEFAULT_TITLE = "گالری نور گلد"
gallery_images = Table("noor_gallery_images", metadata,
    Column("id", String(40), primary_key=True),
    Column("slot", Integer, nullable=False, unique=True),
    Column("title", String(200), nullable=False),
    Column("published", Boolean, nullable=False),
    Column("created_at", Float, nullable=False),
    CheckConstraint("slot >= 0 AND slot < 12", name="gallery_slot_limit"))


def gallery_title(value):
    cleaned = value.strip()
    if len(cleaned) > 200:
        raise ValueError("عنوان تصویر باید حداکثر ۲۰۰ نویسه باشد.")
    return cleaned or DEFAULT_TITLE


class GalleryPatch(BaseModel):
    model_config = ConfigDict(extra="forbid")
    title: str = Field(default=DEFAULT_TITLE, max_length=200)
    published: bool = Field(default=True, strict=True)

    @field_validator("title")
    @classmethod
    def clean_title(cls, value):
        return gallery_title(value)


def image_record(row, *, owner=False):
    result = {"id": row["id"], "url": f"/api/gallery-media/{row['id']}", "title": row["title"]}
    if owner:
        result["published"] = row["published"]
    return result


def valid_image_id(identifier):
    if len(identifier) != 40 or any(character not in "0123456789abcdef" for character in identifier):
        raise HTTPException(404, "تصویر پیدا نشد.")


def register_gallery_routes(application):
    engine, settings = application.state.engine, application.state.settings

    def list_images(*, owner=False):
        statement = select(gallery_images).order_by(gallery_images.c.created_at.desc(), gallery_images.c.id.desc())
        if not owner:
            statement = statement.where(gallery_images.c.published.is_(True))
        with engine.connect() as connection:
            return {"images": [image_record(row, owner=owner) for row in connection.execute(statement).mappings()]}

    @application.get("/api/public/gallery")
    def public_gallery():
        return list_images()

    @application.get("/api/owner/gallery", dependencies=[Depends(require_storefront)])
    def owner_gallery():
        return list_images(owner=True)

    @application.post("/api/owner/gallery", status_code=201, dependencies=[Depends(require_storefront_mutation)])
    def upload_gallery_image(file: UploadFile = File(...), title: str = Form(default=DEFAULT_TITLE, max_length=200), published: bool = Form(default=True)):
        photo = sanitized_image(file)
        identifier = secrets.token_hex(20)
        path = settings.upload_dir / f"gallery-{identifier}.webp"
        record = {"id": identifier, "title": gallery_title(title), "published": published, "created_at": time.time()}
        try:
            with engine.begin() as connection:
                occupied = set(connection.execute(select(gallery_images.c.slot)).scalars())
                available = next((slot for slot in range(MAX_GALLERY_IMAGES) if slot not in occupied), None)
                if available is None:
                    raise HTTPException(422, "حداکثر ۱۲ تصویر برای گالری بالای صفحه مجاز است.")
                # A unique bounded slot also enforces the limit across concurrent uploads.
                connection.execute(gallery_images.insert().values(**record, slot=available))
                path.write_bytes(photo)
        except IntegrityError:
            path.unlink(missing_ok=True)
            raise HTTPException(409, "فهرست تصاویر تغییر کرده است؛ دوباره تلاش کنید.")
        except Exception:
            path.unlink(missing_ok=True)
            raise
        return {"image": image_record(record, owner=True)}

    @application.patch("/api/owner/gallery/{identifier}", dependencies=[Depends(require_storefront_mutation)])
    def patch_gallery_image(identifier: str, payload: GalleryPatch):
        valid_image_id(identifier)
        changes = payload.model_dump(exclude_unset=True)
        with engine.begin() as connection:
            if changes:
                connection.execute(update(gallery_images).where(gallery_images.c.id == identifier).values(**changes))
            row = connection.execute(select(gallery_images).where(gallery_images.c.id == identifier)).mappings().first()
            if row is None:
                raise HTTPException(404, "تصویر پیدا نشد.")
            return {"image": image_record(row, owner=True)}

    @application.delete("/api/owner/gallery/{identifier}", dependencies=[Depends(require_storefront_mutation)])
    def delete_gallery_image(identifier: str):
        valid_image_id(identifier)
        with engine.begin() as connection:
            result = connection.execute(delete(gallery_images).where(gallery_images.c.id == identifier))
            if not result.rowcount:
                raise HTTPException(404, "تصویر پیدا نشد.")
        (settings.upload_dir / f"gallery-{identifier}.webp").unlink(missing_ok=True)
        return {"ok": True}

    @application.get("/api/gallery-media/{identifier}")
    def gallery_media(identifier: str, request: Request):
        valid_image_id(identifier)
        with engine.connect() as connection:
            row = connection.execute(select(gallery_images).where(gallery_images.c.id == identifier)).mappings().first()
        if row is None:
            raise HTTPException(404, "تصویر پیدا نشد.")
        if not row["published"]:
            try:
                require_storefront(request)
            except HTTPException:
                raise HTTPException(404, "تصویر پیدا نشد.")
        path = settings.upload_dir / f"gallery-{identifier}.webp"
        if not path.is_file():
            raise HTTPException(404, "تصویر پیدا نشد.")
        return FileResponse(path, media_type="image/webp", headers={"Content-Disposition": "inline"})
