import asyncio
import logging
import traceback
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

import pytest
from azure.core.exceptions import (
    AzureError,
    ClientAuthenticationError,
    ResourceExistsError,
    ResourceNotFoundError,
)

from app.storage import azure_blob
from app.storage.azure_blob import (
    AzureBlobStorage,
    BlobAlreadyExistsError,
    BlobNotFoundError,
    BlobStorageError,
)


@pytest.mark.parametrize("operation", ["upload", "download"])
@pytest.mark.parametrize("http_error", [True, False])
def test_storage_failure_logs_only_safe_metadata(
    monkeypatch: pytest.MonkeyPatch,
    caplog: pytest.LogCaptureFixture,
    operation: str,
    http_error: bool,
) -> None:
    secret = "MAC secret-signature; StringToSign secret-path?sig=secret-token"
    exc = ClientAuthenticationError(secret) if http_error else AzureError(secret)
    if http_error:
        exc.status_code = 403
        exc.error_code = "AuthenticationFailed"
        exc.response = SimpleNamespace(
            headers={"x-ms-request-id": "12345678-1234-1234-1234-123456789abc"}
        )
    blob = SimpleNamespace(
        upload_blob=AsyncMock(side_effect=exc),
        download_blob=AsyncMock(side_effect=exc),
    )
    service = MagicMock()
    service.__aenter__ = AsyncMock(return_value=service)
    service.__aexit__ = AsyncMock(return_value=False)
    service.get_blob_client.return_value = blob
    monkeypatch.setattr(azure_blob, "BlobServiceClient", MagicMock(return_value=service))
    storage = AzureBlobStorage("https://account.invalid", "secret-key", "secret-container")
    caplog.set_level(logging.ERROR, logger=azure_blob.__name__)

    with pytest.raises(BlobStorageError, match=f"Azure Blob {operation} failed") as caught:
        if operation == "upload":
            asyncio.run(storage.upload(blob_name="file", data=b"data", content_type="text/plain"))
        else:
            asyncio.run(storage.download(blob_name="file"))

    assert len(caplog.records) == 1
    record = caplog.records[0]
    assert record.exc_info is None
    assert f"Azure Blob {operation} failed" in caplog.text
    assert f"error_type={type(exc).__name__}" in caplog.text
    if http_error:
        assert "status=403 error_code=AuthenticationFailed" in caplog.text
        assert "request_id=12345678-1234-1234-1234-123456789abc" in caplog.text
    else:
        assert "status=unknown error_code=unknown request_id=unknown" in caplog.text
    # Even if an outer handler logs the safe exception, its traceback omits Azure's body.
    rendered = "".join(traceback.format_exception(caught.value))
    for sensitive in (secret, "secret-key", "secret-container", "secret-token"):
        assert sensitive not in caplog.text
        assert sensitive not in rendered


def test_storage_error_metadata_rejects_unexpected_response_values(
    caplog: pytest.LogCaptureFixture,
) -> None:
    exc = ClientAuthenticationError("secret-body")
    exc.status_code = "403 secret-status"
    exc.error_code = "AuthenticationFailed\nsecret-code"
    exc.response = SimpleNamespace(headers={"x-ms-request-id": "secret-token?sig=123"})
    caplog.set_level(logging.ERROR, logger=azure_blob.__name__)

    azure_blob._log_storage_error("download", exc)

    assert "status=unknown error_code=unknown request_id=unknown" in caplog.text
    assert "secret" not in caplog.text
    assert caplog.records[0].exc_info is None


@pytest.mark.parametrize(
    "operation,original,expected",
    [
        ("upload", ResourceExistsError, BlobAlreadyExistsError),
        ("download", ResourceNotFoundError, BlobNotFoundError),
    ],
)
def test_expected_errors_do_not_chain_sensitive_azure_body(
    monkeypatch: pytest.MonkeyPatch,
    operation: str,
    original: type[AzureError],
    expected: type[BlobStorageError],
) -> None:
    monkeypatch.setattr(
        azure_blob, "BlobServiceClient", MagicMock(side_effect=original("secret-signature"))
    )
    storage = AzureBlobStorage("https://account.invalid", "secret-key", "container")
    with pytest.raises(expected) as caught:
        if operation == "upload":
            asyncio.run(storage.upload(blob_name="file", data=b"data", content_type="text/plain"))
        else:
            asyncio.run(storage.download(blob_name="file"))
    assert "secret-signature" not in "".join(traceback.format_exception(caught.value))
