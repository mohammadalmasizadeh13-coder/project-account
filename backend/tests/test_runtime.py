import pytest

from app.runtime import source_revision
from test_api import ORIGIN, client


def test_source_revision_detects_edits_additions_and_removals(tmp_path):
    source = tmp_path / "routes.py"
    source.write_text("old routes", encoding="utf-8")
    original = source_revision(tmp_path)
    source.write_text("new routes", encoding="utf-8")
    edited = source_revision(tmp_path)
    assert edited != original
    extra = tmp_path / "deletions.py"
    extra.write_text("delete routes", encoding="utf-8")
    assert source_revision(tmp_path) != edited
    extra.unlink()
    assert source_revision(tmp_path) == edited
    (tmp_path / "ignored.pyc").write_bytes(b"cache")
    assert source_revision(tmp_path) == edited


def test_health_reports_loaded_sources_without_exposing_paths(client, monkeypatch):
    loaded = client.get("/api/health").json()
    assert loaded == {"status": "ok", "service": "noor-gold-api", "sourceRevision": source_revision()}
    monkeypatch.setattr("app.main.source_revision", lambda: "changed-after-start")
    assert client.get("/api/health").json() == loaded


@pytest.mark.parametrize("path", [
    "/api/owner/documents/missing", "/api/owner/inventory/missing",
    "/api/owner/partners/missing/invoices/missing", "/api/owner/partners/missing/settlements/missing",
])
def test_delete_routes_are_registered_and_require_a_session(client, path):
    response = client.request("DELETE", path, headers={"Origin": ORIGIN})
    assert response.status_code == 401
