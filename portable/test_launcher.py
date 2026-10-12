"""Portable runtime checks use disposable files and accounts only."""

import shutil
import sys

import pytest
from fastapi.testclient import TestClient

from portable import launcher


ORIGIN = "http://127.0.0.1:8765"
PASSWORD = "portable-test-password-only"
PAGE = "<!doctype html><title>Portable test</title><div id='root'></div>"


@pytest.fixture
def portable_paths(tmp_path):
    root = tmp_path / "portable source"
    frontend = root / "_internal" / "frontend"
    (frontend / "assets").mkdir(parents=True)
    (frontend / "index.html").write_text(PAGE, encoding="utf-8")
    (frontend / "assets" / "app.js").write_text("window.portableTest = true;", encoding="utf-8")
    paths = launcher.resolve_paths(app_dir=root, asset_dir=frontend)
    launcher.prepare_paths(paths)
    return paths


def test_frozen_paths_follow_the_executable_instead_of_the_working_directory(tmp_path, monkeypatch):
    root = tmp_path / "حسابداری لپ تاپ دوم"
    internal = root / "_internal"
    unrelated = tmp_path / "shortcut working directory"
    unrelated.mkdir()
    monkeypatch.chdir(unrelated)
    monkeypatch.setattr(sys, "frozen", True, raising=False)
    monkeypatch.setattr(sys, "executable", str(root / "Account.exe"))
    monkeypatch.setattr(sys, "_MEIPASS", str(internal), raising=False)

    paths = launcher.resolve_paths()

    assert paths.app_dir == root.resolve()
    assert paths.data_dir == root.resolve() / "data"
    assert paths.frontend_dir == internal.resolve() / "frontend"


def test_portable_settings_ignore_other_installations_environment(portable_paths, monkeypatch, tmp_path):
    foreign_database = tmp_path / "other-installation.db"
    foreign_uploads = tmp_path / "other-uploads"
    overrides = {
        "DATABASE_URL": f"sqlite:///{foreign_database}",
        "NOOR_UPLOAD_DIR": str(foreign_uploads),
        "FRONTEND_ORIGINS": "https://other-installation.example",
        "NOOR_COOKIE_SECURE": "true",
        "NOOR_OWNER_USERNAME": "unwanted-bootstrap-owner",
        "NOOR_OWNER_PASSWORD_HASH": "invalid-test-hash",
        "GOLD_RATE_URL": "https://other-installation.example/rate",
        "GOLD_RATE_TOKEN": "fake-test-token",
    }
    for name, value in overrides.items():
        monkeypatch.setenv(name, value)

    with TestClient(launcher.create_portable_app(portable_paths, port=8765), base_url=ORIGIN) as client:
        settings = client.app.state.settings
        assert client.get("/api/health").status_code == 200
        assert settings.database_url == f"sqlite:///{(portable_paths.data_dir / 'zarnegaar.db').as_posix()}"
        assert settings.upload_dir == portable_paths.data_dir / "uploads"
        assert set(settings.origins) == {ORIGIN, "http://localhost:8765"}
        assert settings.cookie_secure is False
        assert settings.owner_username == settings.owner_password_hash == ""
        assert settings.rate_url == settings.rate_token == ""

    assert not foreign_database.exists()
    assert not foreign_uploads.exists()


def test_frontend_and_deep_links_work_without_swallowing_api_errors(portable_paths):
    with TestClient(launcher.create_portable_app(portable_paths)) as client:
        for path in ("/", "/login", "/account/partners"):
            response = client.get(path)
            assert response.status_code == 200, path
            assert response.headers["content-type"].startswith("text/html")
            assert response.text == PAGE

        asset = client.get("/assets/app.js")
        assert asset.status_code == 200
        assert asset.text == "window.portableTest = true;"
        assert client.get("/api/health").json()["status"] == "ok"
        assert client.get("/api/owner/workspace").status_code == 401
        for path in ("/api/unknown", "/api", "/assets/missing.js"):
            response = client.get(path)
            assert response.status_code == 404, path
            assert response.text != PAGE


def test_static_server_never_exposes_private_files_or_parent_directories(portable_paths):
    marker = "PRIVATE PORTABLE TEST DATA"
    (portable_paths.app_dir / "private.txt").write_text(marker, encoding="utf-8")
    (portable_paths.app_dir / ".env").write_text(marker, encoding="utf-8")
    (portable_paths.data_dir / "private.txt").write_text(marker, encoding="utf-8")

    with TestClient(launcher.create_portable_app(portable_paths)) as client:
        for path in (
            "/data/zarnegaar.db", "/data/private.txt", "/.env", "/private.txt",
            "/_internal/frontend/index.html", "/assets/%2e%2e/%2e%2e/private.txt",
            "/assets/..%5c..%5cprivate.txt",
        ):
            response = client.get(path)
            assert response.status_code == 404, path
            assert marker not in response.text


def test_local_login_and_saved_accounts_survive_restarting_in_a_different_folder(portable_paths, tmp_path, monkeypatch):
    credentials = {"username": "portable-owner", "password": PASSWORD}
    customer = {"id": "portable-customer", "name": "Portable customer", "phone": "09120000000"}

    with TestClient(launcher.create_portable_app(portable_paths), base_url=ORIGIN) as client:
        blocked = client.post("/api/auth/register", json={**credentials, "galleryName": "Portable test"},
            headers={"Origin": "https://foreign.example"})
        assert blocked.status_code == 403
        registration = client.post("/api/auth/register", json={**credentials, "galleryName": "Portable test"},
            headers={"Origin": ORIGIN})
        assert registration.status_code == 201, registration.text
        cookie = registration.headers["set-cookie"].lower()
        assert "httponly" in cookie and "samesite=lax" in cookie
        assert "; secure" not in cookie
        assert client.get("/api/auth/session").status_code == 200

        workspace = client.get("/api/owner/workspace").json()
        mutation = {"revision": workspace["revision"], "data": {"customers": [customer]}}
        assert client.put("/api/owner/workspace", json=mutation, headers={"Origin": ORIGIN}).status_code == 403
        saved = client.put("/api/owner/workspace", json=mutation,
            headers={"Origin": ORIGIN, "X-CSRF-Token": registration.json()["csrfToken"]})
        assert saved.status_code == 200, saved.text
        saved_revision = saved.json()["revision"]

    destination = tmp_path / "لپ تاپ دوم" / "My accounting folder"
    shutil.copytree(portable_paths.app_dir, destination)
    unrelated = tmp_path / "unrelated current directory"
    unrelated.mkdir()
    monkeypatch.chdir(unrelated)
    relocated = launcher.resolve_paths(app_dir=destination, asset_dir=destination / "_internal" / "frontend")
    launcher.prepare_paths(relocated)

    with TestClient(launcher.create_portable_app(relocated), base_url=ORIGIN) as client:
        assert client.get("/account/partners").text == PAGE
        assert client.get("/api/auth/session").status_code == 401
        login = client.post("/api/auth/login", json=credentials, headers={"Origin": ORIGIN})
        assert login.status_code == 200, login.text
        workspace = client.get("/api/owner/workspace").json()
        assert workspace["revision"] == saved_revision
        assert workspace["data"]["customers"] == [customer]

    assert not (unrelated / "data").exists()
