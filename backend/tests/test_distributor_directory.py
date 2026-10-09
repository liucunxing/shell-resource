import httpx
import pytest
from fastapi import HTTPException
from pydantic import SecretStr

from app.core.config import get_settings
from app.repositories.distributor_directory_repository import (
    DatabricksDistributorRepository,
)
from app.services.distributor_directory_service import DistributorDirectoryService


@pytest.mark.asyncio
async def test_databricks_directory_uses_oauth_and_statement_api(
    monkeypatch: pytest.MonkeyPatch,
) -> None:
    settings = get_settings().model_copy(
        update={
            "databricks_server_hostname": "https://workspace.example.test",
            "databricks_http_path": "/sql/1.0/warehouses/warehouse-1",
            "databricks_client_id": "client-id",
            "databricks_client_secret": SecretStr("client-secret"),
        }
    )

    def handler(request: httpx.Request) -> httpx.Response:
        if request.url.path == "/oidc/v1/token":
            assert request.headers["authorization"].startswith("Basic ")
            assert b"scope=sql" in request.content
            return httpx.Response(200, json={"access_token": "short-lived-token"})
        assert request.url.path == "/api/2.0/sql/statements"
        assert request.headers["authorization"] == "Bearer short-lived-token"
        assert "WHERE sector IN ('PCMO')" in request.content.decode()
        return httpx.Response(
            200,
            json={
                "status": {"state": "SUCCEEDED"},
                "result": {
                    "data_array": [
                        ["D1", "Dealer One"],
                        ["D1", "Duplicate ignored"],
                        ["D2", None],
                    ]
                },
            },
        )

    original_client = httpx.AsyncClient
    monkeypatch.setattr(
        httpx,
        "AsyncClient",
        lambda **kwargs: original_client(
            transport=httpx.MockTransport(handler), **kwargs
        ),
    )

    result = await DatabricksDistributorRepository(settings).list_distributors(("PCMO",))

    assert result == [
        {"distributor_code": "D1", "distributor_name": "Dealer One"},
        {"distributor_code": "D2", "distributor_name": None},
    ]


@pytest.mark.asyncio
async def test_missing_databricks_configuration_returns_service_unavailable() -> None:
    settings = get_settings().model_copy(
        update={
            "databricks_server_hostname": "",
            "databricks_http_path": "",
            "databricks_client_id": "",
            "databricks_client_secret": None,
        }
    )

    with pytest.raises(HTTPException) as error:
        await DistributorDirectoryService(settings).list_distributors(("PCMO",))

    assert error.value.status_code == 503


@pytest.mark.asyncio
async def test_owner_without_a_sector_cannot_load_the_directory() -> None:
    with pytest.raises(HTTPException) as error:
        await DistributorDirectoryService(get_settings()).list_distributors(())

    assert error.value.status_code == 403
