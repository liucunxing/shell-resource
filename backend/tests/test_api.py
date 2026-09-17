from collections.abc import AsyncIterator
from unittest.mock import AsyncMock

from fastapi.testclient import TestClient
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db_session
from app.main import create_app

app = create_app()
client = TestClient(app)


def test_health_uses_unified_response() -> None:
    response = client.get("/health")
    assert response.status_code == 200
    body = response.json()
    assert body["code"] == 200
    assert body["msg"] == "响应成功"
    assert body["data"]["status"] == "ok"


def test_ping() -> None:
    response = client.get("/api/v1/test/ping")
    assert response.status_code == 200
    body = response.json()
    assert body["data"]["message"] == "pong"
    assert body["data"]["environment"] == "test"


def test_echo() -> None:
    response = client.post("/api/v1/test/echo", json={"message": "hello"})
    assert response.status_code == 200
    assert response.json() == {
        "code": 200,
        "msg": "响应成功",
        "data": {"message": "hello"},
    }


def test_database_value_uses_all_layers_and_unified_response() -> None:
    session = AsyncMock(spec=AsyncSession)
    session.scalar.return_value = 1

    async def override_db_session() -> AsyncIterator[AsyncSession]:
        yield session

    app.dependency_overrides[get_db_session] = override_db_session
    try:
        response = client.get("/api/v1/test/database-value")
    finally:
        app.dependency_overrides.clear()

    assert response.status_code == 200
    assert response.json() == {
        "code": 200,
        "msg": "响应成功",
        "data": 1,
    }
    session.scalar.assert_awaited_once()


def test_validation_error_uses_unified_response() -> None:
    response = client.post("/api/v1/test/echo", json={"message": ""})
    assert response.status_code == 422
    body = response.json()
    assert body["code"] == 422
    assert body["msg"] == "请求参数校验失败"
    assert "errors" in body["data"]


def test_not_found_uses_unified_response() -> None:
    response = client.get("/not-found")
    assert response.status_code == 404
    assert response.json()["code"] == 404


def test_swagger_and_openapi_are_available() -> None:
    assert client.get("/docs").status_code == 200
    schema = client.get("/openapi.json")
    assert schema.status_code == 200
    assert "/api/v1/test/ping" in schema.json()["paths"]
    assert "/api/v1/test/database-value" in schema.json()["paths"]

