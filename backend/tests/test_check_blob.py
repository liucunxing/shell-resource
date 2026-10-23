import asyncio
import importlib.util
import json
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from azure.core.exceptions import ClientAuthenticationError, ResourceNotFoundError

from app.core.config import Settings

spec = importlib.util.spec_from_file_location(
    "check_blob", Path(__file__).resolve().parents[1] / "scripts/check_blob.py"
)
assert spec and spec.loader
check = importlib.util.module_from_spec(spec)
spec.loader.exec_module(check)


def settings(**values: object) -> Settings:
    return Settings.model_validate({"app_env": "test", "database_url": "sqlite://", **values})


def configured(**values: object) -> Settings:
    return settings(
        **{
            "azure_blob_account_url": "https://secret-account.invalid",
            "azure_blob_account_key": "secret-key",
            "azure_blob_container_name": "secret-container",
            **values,
        }
    )


@pytest.fixture
def client(monkeypatch: pytest.MonkeyPatch) -> MagicMock:
    service = MagicMock()
    service.__aenter__ = AsyncMock(return_value=service)
    service.__aexit__ = AsyncMock(return_value=False)
    service.get_container_client.return_value.get_container_properties = AsyncMock()
    service.get_blob_client.return_value.get_blob_properties = AsyncMock()
    constructor = MagicMock(return_value=service)
    monkeypatch.setattr(check, "BlobServiceClient", constructor)
    return constructor


def test_unconfigured_disabled_blob_is_skipped(client: MagicMock) -> None:
    result, status = asyncio.run(check.check_blob(settings()))
    assert status == 0
    assert result == {"result": "skipped", "reason": "not_configured"}
    client.assert_not_called()


@pytest.mark.parametrize(
    "values",
    [
        {"azure_blob_account_url": "https://secret.invalid"},
        {"azure_blob_account_key": "secret-key"},
        {"azure_blob_container_name": "secret-container"},
        {"azure_blob_workbench_template_name": "secret-template"},
        {"azure_blob_test_upload_enabled": True},
    ],
)
def test_partial_configuration_blocks_without_network(
    values: dict[str, object], client: MagicMock
) -> None:
    result, status = asyncio.run(check.check_blob(settings(**values)))
    assert status == 1
    assert result == {"result": "failed", "reason": "incomplete_configuration"}
    client.assert_not_called()


@pytest.mark.parametrize("template", [None, "secret-template"])
def test_success_uses_read_only_properties_and_bounded_transport(
    template: str | None, client: MagicMock
) -> None:
    result, status = asyncio.run(
        check.check_blob(configured(azure_blob_workbench_template_name=template))
    )
    assert status == 0
    assert result == {
        "result": "passed",
        "container_checked": True,
        "template_checked": bool(template),
    }
    assert client.call_args.kwargs["retry_total"] == 0
    assert client.call_args.kwargs["connection_timeout"] == 5
    assert client.call_args.kwargs["read_timeout"] == 10
    service = client.return_value
    service.get_container_client.return_value.get_container_properties.assert_awaited_once_with(
        timeout=10
    )
    blob_properties = service.get_blob_client.return_value.get_blob_properties
    if template:
        blob_properties.assert_awaited_once_with(timeout=10)
    else:
        service.get_blob_client.assert_not_called()
    assert "secret" not in json.dumps(result)


@pytest.mark.parametrize("stage,http_status", [("container", 403), ("template", 404)])
def test_failed_auth_or_missing_template_blocks_without_leaking_body(
    stage: str, http_status: int, client: MagicMock
) -> None:
    exc = (ClientAuthenticationError if http_status == 403 else ResourceNotFoundError)(
        "MAC secret-signature StringToSign secret-key"
    )
    exc.status_code = http_status
    exc.error_code = "AuthenticationFailed" if http_status == 403 else "BlobNotFound"
    exc.response = SimpleNamespace(
        headers={"x-ms-request-id": "12345678-1234-1234-1234-123456789abc"}
    )
    service = client.return_value
    target = (
        service.get_container_client.return_value.get_container_properties
        if stage == "container"
        else service.get_blob_client.return_value.get_blob_properties
    )
    target.side_effect = exc
    result, status = asyncio.run(
        check.check_blob(configured(azure_blob_workbench_template_name="secret-template"))
    )
    assert status == 1
    assert result["result"] == "failed"
    assert result["stage"] == stage
    assert result["status"] == http_status
    assert result["error_code"] == exc.error_code
    assert "secret" not in json.dumps(result)


def test_total_timeout_is_bounded(monkeypatch: pytest.MonkeyPatch, client: MagicMock) -> None:
    async def slow(**kwargs: object) -> None:
        await asyncio.sleep(10)

    monkeypatch.setattr(check, "CHECK_TIMEOUT_SECONDS", 0.001)
    client.return_value.get_container_client.return_value.get_container_properties.side_effect = (
        slow
    )
    result, status = asyncio.run(check.check_blob(configured()))
    assert status == 1
    assert result["error_type"] == "TimeoutError"


def test_cli_emits_json_and_returns_failure_without_configuration_body(
    monkeypatch: pytest.MonkeyPatch, capsys: pytest.CaptureFixture[str]
) -> None:
    monkeypatch.setattr(check, "get_settings", MagicMock(side_effect=ValueError("secret-key")))
    monkeypatch.setattr(check.logging, "disable", lambda _: None)
    assert check.main() == 1
    captured = capsys.readouterr()
    assert json.loads(captured.out)["stage"] == "configuration"
    assert "secret" not in captured.out + captured.err
