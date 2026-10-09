"""Exercise the explicit local Insight fixture with real Qwen, never a business database."""

from __future__ import annotations

import argparse
import json
import time
from pathlib import Path

import httpx

ROOT = Path(__file__).resolve().parents[1]
BASE = "http://127.0.0.1:8027/api/v1/workbench"
OWNER = "insight-owner@example.test"
SCOPE = "owner:" + OWNER


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--live", action="store_true")
    parser.add_argument("--presets", nargs="+", default=["comprehensive", "quadrant", "structure"])
    args = parser.parse_args()
    if not args.live:
        parser.error("Pass --live to generate reports through the local fixture and real Qwen")
    output = ROOT / ".cache/insight-integration/results"
    output.mkdir(parents=True, exist_ok=True)
    checks = []

    def check(name: str, passed: bool) -> None:
        checks.append({"check": name, "passed": passed})
        print(json.dumps(checks[-1]), flush=True)
        if not passed:
            raise AssertionError(name)

    with httpx.Client(base_url=BASE, timeout=150, headers={"X-User-Email": OWNER}) as client:
        before = client.get("/workspace", params={"planning_year": 2027})
        before.raise_for_status()
        initial = before.json()["data"]["state"]["initiatives"]
        check("synthetic_owner_only", [row["id"] for row in initial] == ["1"])
        for preset in args.presets:
            started = time.perf_counter()
            response = client.post(
                "/insights/generate",
                json={
                    "scope": SCOPE,
                    "planning_year": 2027,
                    "preset_id": preset,
                },
            )
            if response.status_code != 200:
                print(
                    json.dumps(
                        {"status": response.status_code, "message": response.json().get("msg")}
                    ),
                    flush=True,
                )
            check(f"{preset}:http_200", response.status_code == 200)
            record = response.json()["data"]
            record["acceptance_elapsed_seconds"] = round(time.perf_counter() - started, 2)
            (output / f"{preset}.json").write_text(
                json.dumps(record, ensure_ascii=False, indent=2) + "\n", encoding="utf-8"
            )
            check(f"{preset}:six_checks", len(record["result"]["checks"]) == 6)
            check(f"{preset}:current", record["stale"] is False)
            check(f"{preset}:scoped", "999999" not in json.dumps(record["evidence"]))
        for preset in args.presets:
            response = client.get(
                "/insights",
                params={
                    "scope": SCOPE,
                    "planning_year": 2027,
                    "preset_id": preset,
                },
            )
            response.raise_for_status()
            data = response.json()["data"]
            check(f"{preset}:saved_after_other_presets", data["record"]["presetId"] == preset)
            check(f"{preset}:prompt_readonly", data["prompt"]["editable"] is False)
        check(
            "other_owner_hidden",
            client.get(
                "/insights",
                params={
                    "scope": "initiative:2",
                    "planning_year": 2027,
                },
            ).status_code
            == 404,
        )
        check(
            "unknown_preset_rejected",
            client.post(
                "/insights/generate",
                json={
                    "scope": SCOPE,
                    "planning_year": 2027,
                    "preset_id": "unknown",
                },
            ).status_code
            == 422,
        )
        check(
            "user_prompt_write_rejected",
            client.put(
                "/insights/prompt",
                json={
                    "scope": SCOPE,
                    "planning_year": 2027,
                    "text": "not allowed",
                    "expected_version": 0,
                },
            ).status_code
            == 403,
        )
        manager = {"X-User-Email": "insight-manager@example.test"}
        check(
            "management_cannot_generate",
            client.post(
                "/insights/generate",
                headers=manager,
                json={"scope": "global", "planning_year": 2027},
            ).status_code
            == 403,
        )
        preview = client.get(
            "/insights", headers=manager, params={"scope": "global", "planning_year": 2027}
        )
        check(
            "management_preview_only",
            preview.status_code == 200 and preview.json()["data"]["record"]["status"] == "preview",
        )
        after = client.get("/workspace", params={"planning_year": 2027})
        check("budgets_unchanged", after.json()["data"]["state"]["initiatives"] == initial)
    (output / "checks.json").write_text(json.dumps(checks, indent=2), encoding="utf-8")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
