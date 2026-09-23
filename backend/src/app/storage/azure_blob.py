import logging
from dataclasses import dataclass

from azure.core.exceptions import AzureError, ResourceExistsError, ResourceNotFoundError
from azure.storage.blob import ContentSettings
from azure.storage.blob.aio import BlobServiceClient

logger = logging.getLogger(__name__)


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
        except ResourceExistsError as exc:
            raise BlobAlreadyExistsError("Azure Blob already exists") from exc
        except AzureError as exc:
            logger.exception(
                "Azure Blob upload failed for container=%s error_type=%s",
                self.container_name,
                type(exc).__name__,
            )
            raise BlobStorageError("Azure Blob upload failed") from exc

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
        except ResourceNotFoundError as exc:
            raise BlobNotFoundError("Azure Blob does not exist") from exc
        except AzureError as exc:
            logger.exception(
                "Azure Blob download failed for container=%s error_type=%s",
                self.container_name,
                type(exc).__name__,
            )
            raise BlobStorageError("Azure Blob download failed") from exc

        return BlobDownloadResult(
            blob_name=blob_name,
            data=data,
            content_type=properties.content_settings.content_type or "application/octet-stream",
        )
