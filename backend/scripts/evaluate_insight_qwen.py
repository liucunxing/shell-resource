"""Explicit, synthetic-only Qwen evaluation; never part of the offline test suite."""

from __future__ import annotations

import argparse
import asyncio
import importlib.util
import json
import time
import tomllib
from datetime import UTC, datetime
from pathlib import Path
from typing import Any
from urllib.parse import urlparse

import httpx

ROOT = Path(__file__).resolve().parents[1]
PACK = ROOT / "insight_capabilities" / "resource-investment-insight"


def write_json(path: Path, value: Any) -> None:
    path.write_text(json.dumps(value, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")


async def evaluate(args: argparse.Namespace) -> int:
    spec = importlib.util.spec_from_file_location(
        "evaluation_pack", PACK / "scripts/insight_pack.py"
    )
    if spec is None or spec.loader is None:
        raise RuntimeError("Insight package is unavailable")
    module = importlib.util.module_from_spec(spec)
    spec.loader.exec_module(module)
    pack = module.InsightPack(PACK)
    settings = tomllib.loads((ROOT / "config/settings.toml").read_text(encoding="utf-8"))[
        "development"
    ]
    token = settings.get("ai_api_key") or ""
    base = (settings.get("ai_base_url") or "").rstrip("/")
    parsed = urlparse(base)
    if not token or parsed.scheme != "https" or parsed.username or parsed.query or parsed.fragment:
        raise RuntimeError("A credential-free HTTPS endpoint and local API key are required")
    endpoint = base if base.endswith("/chat/completions") else base + "/chat/completions"
    model = settings.get("ai_model") or pack.manifest()["default_model"]
    output = Path(args.output).resolve()
    output.mkdir(parents=True, exist_ok=False)
    limit = asyncio.Semaphore(args.concurrency)

    async def run_case(case: str, preset: str) -> dict[str, Any]:
        evidence = module.load_json(PACK / "examples" / f"{case}.evidence.json")
        if evidence["provenance"]["kind"] != "synthetic":
            raise RuntimeError("Evaluation accepts synthetic fixtures only")
        payload, metadata = pack.compile(evidence, preset, model, False, args.response_format)
        write_json(output / f"{case}.{preset}.evidence.json", evidence)
        entry: dict[str, Any] = {"case": case, "preset": preset, "metadata": metadata}
        async with limit:
            started = time.perf_counter()
            try:
                async with httpx.AsyncClient(timeout=120) as client:
                    response = await client.post(
                        endpoint, headers={"Authorization": f"Bearer {token}"}, json=payload
                    )
                entry["http_status"] = response.status_code
                response.raise_for_status()
                envelope = response.json()
                choice = envelope["choices"][0]
                entry.update(
                    request_id=envelope.get("id"),
                    response_model=envelope.get("model"),
                    usage=envelope.get("usage", {}),
                    finish_reason=choice.get("finish_reason"),
                )
                if choice.get("finish_reason") != "stop":
                    raise module.PackError("Incomplete model output")
                result = json.loads(
                    choice["message"]["content"], parse_constant=module.reject_constant
                )
                # Save candidates for honest failure review; never publish them as valid records.
                entry["raw_result"] = result
                result, normalizations = module.normalize_result(result)
                entry["result"] = result
                entry["normalizations"] = normalizations
                pack.validate_result(result, evidence, preset)
                entry["status"] = "passed"
            except httpx.HTTPStatusError as exc:
                entry.update(status="failed", error=f"HTTP {exc.response.status_code}")
                try:
                    api_error = exc.response.json().get("error", {})
                    entry["error_code"] = str(api_error.get("code", ""))[:120]
                    # Keep only the provider's diagnostic, with credentials and URL removed.
                    entry["error_message"] = (
                        str(api_error.get("message", ""))[:1500]
                        .replace(token, "[redacted]")
                        .replace(base, "[endpoint]")
                    )
                except (ValueError, AttributeError):
                    pass
            except httpx.HTTPError as exc:
                entry.update(status="failed", error=type(exc).__name__)
            except (ValueError, KeyError, IndexError, TypeError) as exc:
                entry.update(
                    status="failed",
                    error=str(exc) if isinstance(exc, module.PackError) else type(exc).__name__,
                )
            entry["elapsed_seconds"] = round(time.perf_counter() - started, 2)
            entry["tested_at"] = datetime.now(UTC).isoformat()
            write_json(output / f"{case}.{preset}.result.json", entry)
            print(
                json.dumps(
                    {
                        key: entry.get(key)
                        for key in ("case", "preset", "status", "elapsed_seconds", "error")
                    }
                ),
                flush=True,
            )
            return entry

    results = await asyncio.gather(
        *(run_case(case, preset) for case in args.cases for preset in args.presets)
    )
    summary = {
        "model": model,
        "response_format": args.response_format,
        "thinking": False,
        "provenance": "synthetic fixtures only",
        "total": len(results),
        "passed": sum(row["status"] == "passed" for row in results),
        "total_tokens": sum(row.get("usage", {}).get("total_tokens", 0) for row in results),
        "results": [
            {key: value for key, value in row.items() if key not in {"result", "raw_result"}}
            for row in results
        ],
    }
    write_json(output / "summary.json", summary)
    print(json.dumps({key: summary[key] for key in ("model", "total", "passed", "total_tokens")}))
    return 0 if summary["passed"] == summary["total"] else 1


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument(
        "--live", action="store_true", help="Authorize actual billable API requests"
    )
    parser.add_argument(
        "--cases",
        nargs="+",
        choices=["baseline", "healthy", "missing", "overspend"],
        default=["baseline", "healthy", "missing", "overspend"],
    )
    parser.add_argument(
        "--presets",
        nargs="+",
        choices=["comprehensive", "quadrant", "structure"],
        default=["comprehensive", "quadrant", "structure"],
    )
    parser.add_argument("--response-format", choices=["schema", "object"], default="schema")
    parser.add_argument("--concurrency", type=int, choices=[1, 2], default=1)
    parser.add_argument(
        "--output",
        default=str(
            ROOT / ".cache" / "insight-live" / datetime.now(UTC).strftime("%Y%m%dT%H%M%SZ")
        ),
    )
    args = parser.parse_args()
    if not args.live:
        parser.error("No API call made. Pass --live to run synthetic evaluation against Qwen.")
    return asyncio.run(evaluate(args))


if __name__ == "__main__":
    raise SystemExit(main())
