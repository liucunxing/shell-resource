#!/usr/bin/env bash
# Before replacing a pre-volume container, seed the exact files its tabs still reference.
set -Eeuo pipefail
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
compose=(docker compose --project-directory "$ROOT" --env-file "$ROOT/deploy/.env" -f "$ROOT/compose.yaml")
previous=$("${compose[@]}" ps -a -q app)
[[ -n "$previous" ]] || exit 0
staging=$(mktemp -d)
trap 'rm -rf -- "$staging"' EXIT
while IFS= read -r container; do
    mounted=$(docker inspect --format '{{range .Mounts}}{{if eq .Destination "/app/frontend/dist/assets"}}{{.Name}}{{end}}{{end}}' "$container")
    [[ -z "$mounted" ]] || continue
    docker cp "$container:/app/frontend/dist/assets/." "$staging"
    "${compose[@]}" run --rm --no-deps -T -v "$staging:/previous-assets:ro" frontend-assets /previous-assets
done <<< "$previous"
