from fastapi.testclient import TestClient

from app.main import create_app

client = TestClient(create_app())


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
    assert body["data"]["environment"] == "development"


def test_echo() -> None:
    response = client.post("/api/v1/test/echo", json={"message": "hello"})
    assert response.status_code == 200
    assert response.json() == {
        "code": 200,
        "msg": "响应成功",
        "data": {"message": "hello"},
    }


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

