from fastapi.testclient import TestClient

from app.main import create_app
from test_portal_receiver import receiver_settings


def test_large_api_and_portal_responses_negotiate_gzip_without_changing_content(monkeypatch):
    monkeypatch.setattr("app.main.get_settings", receiver_settings)
    app = create_app()
    payload = {"rows": [{"id": i, "label": "example" * 20} for i in range(100)]}

    @app.get("/compression-check")
    def main_response():
        return payload

    portal = app.state.portal_embed

    @portal.get("/compression-check")
    def portal_response():
        return payload

    with TestClient(app) as client:
        for path in ("/compression-check", "/portal-embed/compression-check"):
            compressed = client.get(path, headers={"Accept-Encoding": "gzip"})
            plain = client.get(path, headers={"Accept-Encoding": "identity"})
            assert compressed.status_code == plain.status_code == 200
            assert compressed.json() == plain.json() == payload
            assert compressed.headers["content-encoding"] == "gzip"
            if path.startswith("/portal-embed"):
                assert compressed.headers["cache-control"] == "no-store"
            assert "Accept-Encoding" in compressed.headers["vary"]
            assert "content-encoding" not in plain.headers
            assert int(compressed.headers["content-length"]) < len(plain.content) / 5


def test_small_health_response_is_not_compressed():
    with TestClient(create_app()) as client:
        response = client.get("/health", headers={"Accept-Encoding": "gzip"})
        assert response.status_code == 200
        assert "content-encoding" not in response.headers
