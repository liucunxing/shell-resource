from pathlib import Path

from fastapi import FastAPI
from fastapi.testclient import TestClient
from tests.local_preview import install_local_preview


def preview_app(tmp_path: Path) -> FastAPI:
    (tmp_path / "index.html").write_text(
        '<html><head><script type="module" src="/assets/app.js"></script></head></html>',
        encoding="utf-8",
    )
    app = FastAPI()
    install_local_preview(app, tmp_path)
    return app


def test_loopback_entry_injects_test_users_before_application(tmp_path: Path) -> None:
    client = TestClient(
        preview_app(tmp_path), base_url="http://127.0.0.1:8019", client=("127.0.0.1", 50000)
    )
    response = client.get("/")
    assert response.status_code == 200
    assert response.headers["cache-control"] == "no-store"
    assert response.text.index("__RESOURCE_LOCAL_PREVIEW__") < response.text.index('type="module"')
    assert "owner-a@example.test" in response.text
    assert "admin@example.test" in response.text
    assert client.get("/portal-embed/").status_code == 404
    assert client.get("/api/v1/workbench/workspace").status_code == 404


def test_non_loopback_requests_never_receive_preview_config(tmp_path: Path) -> None:
    app = preview_app(tmp_path)
    for host, address in [("https://example.com", "127.0.0.1"), ("http://localhost", "10.0.0.5")]:
        client = TestClient(app, base_url=host, client=(address, 50000))
        response = client.get("/")
        assert response.status_code == 404
        assert "__RESOURCE_LOCAL_PREVIEW__" not in response.text


def test_prototype_entry_uses_supplied_synthetic_roles_and_source_label(tmp_path: Path) -> None:
    import json

    (tmp_path / "index.html").write_text("<html><head></head></html>", encoding="utf-8")
    app = FastAPI()
    install_local_preview(
        app,
        tmp_path,
        users=[{"email": "wang-lei@example.test", "label": "王磊 · Owner"}],
        default_email="wang-lei@example.test",
        data_label="V19 原型演示数据",
    )
    client = TestClient(app, base_url="http://localhost:8020", client=("127.0.0.1", 50000))
    html = client.get("/").text
    config = json.loads(html.split("__RESOURCE_LOCAL_PREVIEW__=", 1)[1].split(";</script>", 1)[0])
    assert config == {
        "defaultEmail": "wang-lei@example.test",
        "users": [{"email": "wang-lei@example.test", "label": "王磊 · Owner"}],
        "dataLabel": "V19 原型演示数据",
    }
    assert "owner-a@example.test" not in html
