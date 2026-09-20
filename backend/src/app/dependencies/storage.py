from typing import Annotated

from fastapi import Depends, HTTPException, status

from app.core.config import Settings, get_settings
from app.storage.azure_blob import AzureBlobStorage


def get_blob_storage(
    settings: Annotated[Settings, Depends(get_settings)],
) -> AzureBlobStorage:
    """Build the Blob adapter without exposing credentials to route code."""
    if settings.app_env == "production" or not settings.azure_blob_test_upload_enabled:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="测试上传接口未启用",
        )

    account_url = (settings.azure_blob_account_url or "").strip()
    account_key = (
        settings.azure_blob_account_key.get_secret_value()
        if settings.azure_blob_account_key
        else ""
    )
    container_name = (settings.azure_blob_container_name or "").strip()
    if not account_url or not account_key or not container_name:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail="Azure Blob 存储配置不完整",
        )

    return AzureBlobStorage(
        account_url=account_url,
        account_key=account_key,
        container_name=container_name,
    )
