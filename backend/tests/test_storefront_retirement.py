"""Old published data stays persisted, with no remaining storefront HTTP access."""
import json

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import select

from app.database import images, products, rates
from app.gallery import gallery_images
from app.shop_contact import shop_contact
from test_api import client, login, seed


IMAGE_ID = "a" * 40
GALLERY_ID = "b" * 40


def snapshot(connection):
    return {table.name: [dict(row) for row in connection.execute(select(table)).mappings()]
        for table in (products, images, rates, gallery_images, shop_contact)}


@pytest.mark.parametrize("authenticated", [False, True], ids=["guest", "owner"])
def test_retired_storefront_routes_cannot_expose_or_mutate_existing_published_data(client, authenticated):
    headers = login(client)
    workspace = seed(client, headers)
    engine = client.app.state.engine
    with engine.begin() as connection:
        connection.execute(products.insert().values(id="lot-1", data=json.dumps({"published": True,
            "title": "legacy-publication-secret"}), updated_at=1))
        connection.execute(images.insert().values(id=IMAGE_ID, product_id="lot-1", created_at=1))
        connection.execute(rates.insert().values(id="manual", value="100000", updated_at="2026-01-01T10:00:00Z",
            checked_at=1, source="legacy-rate-secret"))
        connection.execute(gallery_images.insert().values(id=GALLERY_ID, slot=0, title="legacy-gallery-secret",
            published=True, created_at=1))
        connection.execute(shop_contact.insert().values(id=1, phone="09123456789",
            address="legacy-address-secret", hours="10-18"))
        before = snapshot(connection)
    media = client.app.state.settings.upload_dir / f"{IMAGE_ID}.webp"
    gallery_media = client.app.state.settings.upload_dir / f"gallery-{GALLERY_ID}.webp"
    media.write_bytes(b"legacy-image-secret")
    gallery_media.write_bytes(b"legacy-gallery-image-secret")

    browser = client if authenticated else TestClient(client.app)
    read_routes = (
        "/api/public/products", "/api/public/products/lot-1", "/api/public/rate",
        "/api/public/gallery", "/api/public/contact", f"/api/media/{IMAGE_ID}",
        f"/api/gallery-media/{GALLERY_ID}", "/api/owner/products",
        "/api/owner/gallery", "/api/owner/contact",
    )
    for route in read_routes:
        response = browser.get(route)
        assert response.status_code == 404, (route, response.text)
        assert all(secret not in response.text for secret in (
            "private supplier note", "private-phone", "legacy-publication-secret", "legacy-image-secret",
            "legacy-gallery-secret", "legacy-address-secret", "legacy-gallery-image-secret"))

    write_routes = (
        ("PUT", "/api/owner/products/lot-1", {"title": "changed", "category": "rings", "published": True}),
        ("PATCH", "/api/owner/products/lot-1/visibility", {"published": True}),
        ("DELETE", f"/api/owner/products/lot-1/images/{IMAGE_ID}", None),
        ("PUT", "/api/owner/rate", {"value": 200000}),
        ("PATCH", f"/api/owner/gallery/{GALLERY_ID}", {"title": "changed", "published": False}),
        ("DELETE", f"/api/owner/gallery/{GALLERY_ID}", None),
        ("PUT", "/api/owner/contact", {"phone": "09123456789", "address": "changed"}),
    )
    for method, route, body in write_routes:
        response = browser.request(method, route, json=body, headers=headers)
        assert response.status_code == 404, (method, route, response.text)
    for route in ("/api/owner/products/lot-1/images", "/api/owner/gallery"):
        response = browser.post(route, files={"file": ("new.webp", b"new-image", "image/webp")}, headers=headers)
        assert response.status_code == 404, (route, response.text)

    assert client.get("/api/owner/workspace").json() == workspace
    with engine.connect() as connection:
        assert snapshot(connection) == before
    assert media.read_bytes() == b"legacy-image-secret"
    assert gallery_media.read_bytes() == b"legacy-gallery-image-secret"
