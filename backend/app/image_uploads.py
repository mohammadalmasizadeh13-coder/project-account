"""Decode uploaded photographs and store only bounded, metadata-free WebP bytes."""
import io
import warnings

from fastapi import HTTPException
from PIL import Image, ImageOps, UnidentifiedImageError


MAX_IMAGE_BYTES = 5 * 1024 * 1024
Image.MAX_IMAGE_PIXELS = 20_000_000


def sanitized_image(file):
    raw = file.file.read(MAX_IMAGE_BYTES + 1)
    if len(raw) > MAX_IMAGE_BYTES:
        raise HTTPException(413, "حجم تصویر باید حداکثر ۵ مگابایت باشد.")
    try:
        with warnings.catch_warnings():
            warnings.simplefilter("error", Image.DecompressionBombWarning)
            with Image.open(io.BytesIO(raw)) as original:
                if original.format not in {"JPEG", "PNG", "WEBP"} or original.width < 32 or original.height < 32 or original.width > 10000 or original.height > 10000:
                    raise ValueError("Unsupported image")
                original.load()
                picture = ImageOps.exif_transpose(original).convert("RGB")
                picture.thumbnail((2000, 2000))
                output = io.BytesIO()
                picture.save(output, format="WEBP", quality=88, exif=b"")
                return output.getvalue()
    except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError, Image.DecompressionBombWarning):
        raise HTTPException(422, "تصویر معتبر نیست؛ از JPG، PNG یا WebP با ابعاد مجاز استفاده کنید.")
