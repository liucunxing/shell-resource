from fastapi import HTTPException, UploadFile, status

from app.schemas.vo.blob import BlobUploadVO
from app.storage.azure_blob import (
    AzureBlobStorage,
    BlobAlreadyExistsError,
    BlobStorageError,
)


class BlobTestService:
    """Development-only service that verifies Azure Blob uploads end to end."""

    def __init__(self, storage: AzureBlobStorage, max_upload_bytes: int) -> None:
        self.storage = storage
        self.max_upload_bytes = max_upload_bytes

    async def upload(self, file: UploadFile) -> BlobUploadVO:
        original_filename = self._normalize_filename(file.filename)
        content_type = file.content_type or "application/octet-stream"
        data = await file.read(self.max_upload_bytes + 1)

        if not data:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="上传文件不能为空",
            )
        if len(data) > self.max_upload_bytes:
            raise HTTPException(
                status_code=status.HTTP_413_CONTENT_TOO_LARGE,
                detail=f"上传文件不能超过 {self.max_upload_bytes} 字节",
            )

        blob_name = original_filename
        try:
            result = await self.storage.upload(
                blob_name=blob_name,
                data=data,
                content_type=content_type,
            )
        except BlobAlreadyExistsError as exc:
            raise HTTPException(
                status_code=status.HTTP_409_CONFLICT,
                detail="同名文件已存在，请更换文件名后重试",
            ) from exc
        except BlobStorageError as exc:
            raise HTTPException(
                status_code=status.HTTP_502_BAD_GATEWAY,
                detail="Azure Blob 存储上传失败",
            ) from exc

        return BlobUploadVO(
            original_filename=original_filename,
            blob_name=result.blob_name,
            container_name=result.container_name,
            size=result.size,
            content_type=result.content_type,
            etag=result.etag,
        )

    @staticmethod
    def _normalize_filename(filename: str | None) -> str:
        normalized = (filename or "").replace("\\", "/").rsplit("/", 1)[-1].strip()
        normalized = "".join("_" if ord(char) < 32 else char for char in normalized)
        if not normalized:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="上传文件名不能为空",
            )
        return normalized[:200]
