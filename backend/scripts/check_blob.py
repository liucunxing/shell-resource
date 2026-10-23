"""Read-only Blob deployment gate. Output contains no credentials or resource names."""

import asyncio
import json
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from azure.storage.blob.aio import BlobServiceClient

from app.core.config import Settings, get_settings
from app.storage.azure_blob import safe_storage_error_metadata

CHECK_TIMEOUT_SECONDS = 25


async def check_blob(settings: Settings) -> tuple[dict[str, object], int]:
    account_url = (settings.azure_blob_account_url or "").strip()
    key = (
        settings.azure_blob_account_key.get_secret_value()
        if settings.azure_blob_account_key
        else ""
    )
    container = (settings.azure_blob_container_name or "").strip()
    template = (settings.azure_blob_workbench_template_name or "").strip()
    required = bool(
        account_url or key or container or template or settings.azure_blob_test_upload_enabled
    )
    if not required:
        return {"result": "skipped", "reason": "not_configured"}, 0
    if not all((account_url, key.strip(), container)):
        return {"result": "failed", "reason": "incomplete_configuration"}, 1

    stage = "container"
    try:
        async with asyncio.timeout(CHECK_TIMEOUT_SECONDS):
            async with BlobServiceClient(
                account_url=account_url,
                credential=key,
                retry_total=0,
                connection_timeout=5,
                read_timeout=10,
                logging_enable=False,
            ) as client:
                await client.get_container_client(container).get_container_properties(timeout=10)
                if template:
                    stage = "template"
                    await client.get_blob_client(
                        container=container, blob=template
                    ).get_blob_properties(timeout=10)
    except Exception as exc:
        return {"result": "failed", "stage": stage, **safe_storage_error_metadata(exc)}, 1
    return {"result": "passed", "container_checked": True, "template_checked": bool(template)}, 0


def main() -> int:
    # SDK diagnostics can contain response bodies or URLs; this CLI emits only its JSON result.
    logging.disable(logging.CRITICAL)
    try:
        result, exit_code = asyncio.run(check_blob(get_settings()))
    except Exception as exc:
        result = {"result": "failed", "stage": "configuration", **safe_storage_error_metadata(exc)}
        exit_code = 1
    print(json.dumps(result, ensure_ascii=False))
    return exit_code


if __name__ == "__main__":
    raise SystemExit(main())
