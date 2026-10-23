import logging
import re
from dataclasses import dataclass

from azure.core.exceptions import AzureError, ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import ContentSettings
from azure.storage.blob.aio import BlobServiceClient

logger = logging.getLogger(__name__)


def safe_storage_error_metadata(exc: Exception) -> dict[str, str | int]:
    """Keep Azure response bodies, signatures and URLs out of application logs."""
    status_code = getattr(exc, "status_code", None)
    error_code = getattr(exc, "error_code", None)
    error_code = getattr(error_code, "value", error_code)
    if not isinstance(error_code, str) or not re.fullmatch(
        r"[A-Za-z][A-Za-z0-9]{0,79}", error_code
    ):
        error_code = "unknown"
    response = getattr(exc, "response", None)
    headers = getattr(response, "headers", {}) or {}
    request_id = headers.get("x-ms-request-id", "")
    if not isinstance(request_id, str) or not re.fullmatch(
        r"[0-9a-fA-F]{8}(?:-[0-9a-fA-F]{4}){3}-[0-9a-fA-F]{12}", request_id
    ):
        request_id = "unknown"
    return {
        "error_type": type(exc).__name__,
        "status": status_code
        if type(status_code) is int and 100 <= status_code <= 599
        else "unknown",
        "error_code": error_code,
        "request_id": request_id,
    }


def _log_storage_error(operation: str, exc: AzureError) -> None:
    metadata = safe_storage_error_metadata(exc)
    logger.error(
        "Azure Blob %s failed error_type=%s status=%s error_code=%s request_id=%s",
        operation,
        metadata["error_type"],
        metadata["status"],
        metadata["error_code"],
        metadata["request_id"],
    )


class BlobStorageError(RuntimeError):
    """Safe application-level error for Azure Blob operations."""


class BlobAlreadyExistsError(BlobStorageError):
    """Raised when a caller tries to upload a duplicate blob name."""


class BlobNotFoundError(BlobStorageError):
    """Raised when a requested blob does not exist."""


@dataclass(frozen=True, slots=True)
class BlobUploadResult:
    blob_name: str
    container_name: str
    size: int
    content_type: str
    etag: str


@dataclass(frozen=True, slots=True)
class BlobDownloadResult:
    blob_name: str
    data: bytes
    content_type: str


class AzureBlobStorage:
    """Small asynchronous adapter around Azure Blob Storage."""

    def __init__(self, account_url: str, account_key: str, container_name: str) -> None:
        self.account_url = account_url
        self.account_key = account_key
        self.container_name = container_name

    async def upload(
        self,
        *,
        blob_name: str,
        data: bytes,
        content_type: str,
    ) -> BlobUploadResult:
        try:
            async with BlobServiceClient(
                account_url=self.account_url,
                credential=self.account_key,
            ) as service_client:
                blob_client = service_client.get_blob_client(
                    container=self.container_name,
                    blob=blob_name,
                )
                properties = await blob_client.upload_blob(
                    data,
                    overwrite=False,
                    content_settings=ContentSettings(content_type=content_type),
                )
        except ResourceExistsError:
            raise BlobAlreadyExistsError("Azure Blob already exists") from None
        except AzureError as exc:
            _log_storage_error("upload", exc)
            raise BlobStorageError("Azure Blob upload failed") from None

        return BlobUploadResult(
            blob_name=blob_name,
            container_name=self.container_name,
            size=len(data),
            content_type=content_type,
            etag=str(properties.get("etag", "")).strip('"'),
        )

    async def download(self, *, blob_name: str) -> BlobDownloadResult:
        try:
            async with BlobServiceClient(
                account_url=self.account_url,
                credential=self.account_key,
            ) as service_client:
                blob_client = service_client.get_blob_client(
                    container=self.container_name,
                    blob=blob_name,
                )
                stream = await blob_client.download_blob()
                properties = await blob_client.get_blob_properties()
                data = await stream.readall()
        except ResourceNotFoundError:
            raise BlobNotFoundError("Azure Blob does not exist") from None
        except AzureError as exc:
            _log_storage_error("download", exc)
            raise BlobStorageError("Azure Blob download failed") from None

        return BlobDownloadResult(
            blob_name=blob_name,
            data=data,
            content_type=properties.content_settings.content_type or "application/octet-stream",
        )
