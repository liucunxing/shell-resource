#!/usr/bin/env bash
# Install or refresh tracked gateway files without overwriting .env or certificates.
set -Eeuo pipefail
umask 077

SOURCE=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
TARGET=${1:-/opt/digitalshell-gateway}
[[ "$TARGET" == /* && "$TARGET" != / ]] || { printf '目标必须是绝对目录。\n' >&2; exit 1; }

OWNER_UID=${SUDO_UID:-$(id -u)}
OWNER_GID=${SUDO_GID:-$(id -g)}
install -d -m 0750 -o "$OWNER_UID" -g "$OWNER_GID" "$TARGET" "$TARGET/nginx" "$TARGET/certs"
install -m 0644 -o "$OWNER_UID" -g "$OWNER_GID" "$SOURCE/compose.yaml" "$TARGET/compose.yaml"
install -m 0644 -o "$OWNER_UID" -g "$OWNER_GID" "$SOURCE/Dockerfile" "$TARGET/Dockerfile"
install -m 0644 -o "$OWNER_UID" -g "$OWNER_GID" "$SOURCE/.dockerignore" "$TARGET/.dockerignore"
install -m 0755 -o "$OWNER_UID" -g "$OWNER_GID" "$SOURCE/deploy.sh" "$TARGET/deploy.sh"
install -m 0644 -o "$OWNER_UID" -g "$OWNER_GID" "$SOURCE/nginx/default.conf.template" "$TARGET/nginx/default.conf.template"
if [[ ! -f "$TARGET/.env" ]]; then
    install -m 0600 -o "$OWNER_UID" -g "$OWNER_GID" "$SOURCE/.env.example" "$TARGET/.env"
fi
printf '已同步网关程序文件到 %s；.env 和 certs 未覆盖。\n' "$TARGET"
