import re
from typing import Any
from urllib.parse import urlparse

import httpx

from app.core.config import Settings


class DatabricksConfigurationError(RuntimeError):
    """Raised when the server-side Databricks connection is incomplete."""


class DatabricksDirectoryError(RuntimeError):
    """Raised when the distributor directory cannot be queried safely."""


class DatabricksDistributorRepository:
    """Read the approved distributor directory through Databricks SQL REST APIs."""

    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    async def list_distributors(self, sectors: tuple[str, ...]) -> list[dict[str, str | None]]:
        host, warehouse_id, client_id, client_secret = self._connection()
        sector_values = sorted({sector.strip().upper() for sector in sectors if sector.strip()})
        if not sector_values:
            return []
        quoted_sectors = ", ".join(
            "'" + sector.replace("'", "''") + "'" for sector in sector_values
        )
        timeout = httpx.Timeout(self.settings.databricks_timeout_seconds)
        try:
            async with httpx.AsyncClient(timeout=timeout) as client:
                token_response = await client.post(
                    f"{host}/oidc/v1/token",
                    auth=(client_id, client_secret),
                    data={"grant_type": "client_credentials", "scope": "sql"},
                )
                token_response.raise_for_status()
                access_token = str(token_response.json().get("access_token") or "")
                if not access_token:
                    raise DatabricksDirectoryError("Databricks OAuth response has no token")

                headers = {"Authorization": f"Bearer {access_token}"}
                response = await client.post(
                    f"{host}/api/2.0/sql/statements",
                    headers=headers,
                    json={
                        "warehouse_id": warehouse_id,
                        "statement": (
                            "SELECT distributor_code, distributor_name "
                            f"FROM {self.settings.databricks_view_name} "
                            "WHERE sector IN (" + quoted_sectors + ") "
                            "AND distributor_code IS NOT NULL "
                            "ORDER BY distributor_code"
                        ),
                        "format": "JSON_ARRAY",
                        "disposition": "INLINE",
                        "wait_timeout": "50s",
                        "on_wait_timeout": "CANCEL",
                    },
                )
                response.raise_for_status()
                payload = response.json()
                self._require_success(payload)
                rows = self._rows(payload)
                next_link = (payload.get("result") or {}).get("next_chunk_internal_link")
                while next_link:
                    chunk_response = await client.get(f"{host}{next_link}", headers=headers)
                    chunk_response.raise_for_status()
                    chunk = chunk_response.json()
                    rows.extend(self._rows(chunk))
                    next_link = chunk.get("next_chunk_internal_link")
        except DatabricksDirectoryError:
            raise
        except (httpx.HTTPError, ValueError, TypeError) as error:
            raise DatabricksDirectoryError("Databricks distributor query failed") from error

        result: list[dict[str, str | None]] = []
        seen_codes: set[str] = set()
        for row in rows:
            if not row or row[0] is None:
                continue
            code = str(row[0]).strip()
            if not code or code in seen_codes:
                continue
            seen_codes.add(code)
            name = None if len(row) < 2 or row[1] is None else str(row[1]).strip() or None
            result.append({"distributor_code": code, "distributor_name": name})
        return result

    def _connection(self) -> tuple[str, str, str, str]:
        raw_host = self.settings.databricks_server_hostname.strip().rstrip("/")
        if raw_host and "://" not in raw_host:
            raw_host = f"https://{raw_host}"
        parsed = urlparse(raw_host)
        path_match = re.fullmatch(
            r"/?sql/1\.0/warehouses/([^/]+)", self.settings.databricks_http_path.strip()
        )
        secret = (
            self.settings.databricks_client_secret.get_secret_value()
            if self.settings.databricks_client_secret
            else ""
        )
        view_name = self.settings.databricks_view_name.strip()
        valid_view_name = re.fullmatch(
            r"[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*",
            view_name,
        )
        if (
            parsed.scheme != "https"
            or not parsed.netloc
            or parsed.path not in {"", "/"}
            or path_match is None
            or not self.settings.databricks_client_id.strip()
            or not secret
            or valid_view_name is None
        ):
            raise DatabricksConfigurationError("Databricks distributor directory is not configured")
        return (
            raw_host,
            path_match.group(1),
            self.settings.databricks_client_id.strip(),
            secret,
        )

    @staticmethod
    def _require_success(payload: dict[str, Any]) -> None:
        state = str((payload.get("status") or {}).get("state") or "")
        if state != "SUCCEEDED":
            raise DatabricksDirectoryError(
                f"Databricks statement ended in state {state or 'UNKNOWN'}"
            )

    @staticmethod
    def _rows(payload: dict[str, Any]) -> list[list[Any]]:
        result = payload.get("result") if "result" in payload else payload
        rows = (result or {}).get("data_array") or []
        if not isinstance(rows, list) or any(not isinstance(row, list) for row in rows):
            raise DatabricksDirectoryError("Databricks returned an invalid result shape")
        return rows
