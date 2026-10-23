#!/usr/bin/env bash
# Run from /opt/digitalshell-gateway. This script never stops another project.
set -Eeuo pipefail
umask 077

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")" && pwd)
cd "$ROOT"
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/.env" -f "$ROOT/compose.yaml")

fail() { printf '错误：%s\n' "$*" >&2; exit 1; }
MODE=${1:-deploy}
[[ "$MODE" == deploy || "$MODE" == --check ]] || fail '用法：sudo bash deploy.sh [--check]'
[[ -f .env ]] || fail '缺少 .env。先从 .env.example 创建并填写上游端口。'
[[ -f certs/fullchain.pem && -f certs/private.key ]] || fail '缺少 certs/fullchain.pem 或 certs/private.key。'
for tool in docker openssl curl ss python3; do command -v "$tool" >/dev/null || fail "缺少命令：$tool"; done

# Do not source .env. Compose resolves it and this independently prevents a public upstream.
CONFIG=$("${COMPOSE[@]}" config --format json)
python3 - "$CONFIG" <<'PY'
import json, re, sys
config = json.loads(sys.argv[1])
env = config['services']['nginx']['environment']
for key in ('RESOURCE_UPSTREAM', 'ONEPORTAL_UPSTREAM'):
    value = env[key]
    if not re.fullmatch(r'http://127\.0\.0\.1:[1-9][0-9]{0,4}', value) or int(value.rsplit(':', 1)[1]) > 65535:
        raise SystemExit(f'{key} 必须是 http://127.0.0.1:端口，实际为 {value!r}')
PY

for domain in resource.digitalshell.com.cn oneportal.digitalshell.com.cn; do
    openssl x509 -in certs/fullchain.pem -noout -checkhost "$domain" | grep -q 'does match' \
        || fail "证书不覆盖 $domain；请先更换包含两个域名（或 *.digitalshell.com.cn）的证书。"
done
openssl x509 -in certs/fullchain.pem -noout -checkend 0 || fail '证书已过期'
CERT_KEY=$(openssl x509 -in certs/fullchain.pem -pubkey -noout | openssl pkey -pubin -outform DER | openssl dgst -sha256)
PRIVATE_KEY=$(openssl pkey -in certs/private.key -pubout -outform DER | openssl dgst -sha256)
[[ "$CERT_KEY" == "$PRIVATE_KEY" ]] || fail '证书与私钥不匹配'

IMAGE=$(python3 -c 'import json,sys; print(json.loads(sys.argv[1])["services"]["nginx"]["image"])' "$CONFIG")
if ! docker image inspect "$IMAGE" >/dev/null 2>&1; then
    if [[ "$IMAGE" == 'digitalshell-gateway:1.30.6-brotli1.2.1' ]]; then
        "${COMPOSE[@]}" build --pull nginx
    else
        # Preserve explicit upstream images and rollback tags; never relabel a new build as an old version.
        "${COMPOSE[@]}" pull nginx
    fi
fi
"${COMPOSE[@]}" run --rm --no-deps -T nginx-check nginx -t
[[ "$MODE" != --check ]] || { printf '共享网关预检通过，现有入口未改动。\n'; exit 0; }

CURRENT=$("${COMPOSE[@]}" ps -q nginx)
for port in 80 443; do
    if ss -H -ltn "sport = :$port" | grep -q .; then
        if [[ -z "$CURRENT" ]]; then
            ss -H -ltn "sport = :$port"
            fail "端口 $port 已被占用。请先按 docs/SHARED_GATEWAY.md 停止旧项目私有 Nginx；本脚本不会自动停止它。"
        fi
    fi
done

# A changed template is a bind mount, so force recreation to run envsubst again.
"${COMPOSE[@]}" up -d --force-recreate --wait --wait-timeout 90 nginx

for domain in resource.digitalshell.com.cn oneportal.digitalshell.com.cn; do
    curl --noproxy '*' --fail --show-error --silent --max-time 15 \
        --resolve "$domain:443:127.0.0.1" "https://$domain/nginx-health" >/dev/null
done
curl --noproxy '*' --fail --show-error --silent --max-time 15 \
    --resolve 'resource.digitalshell.com.cn:443:127.0.0.1' \
    'https://resource.digitalshell.com.cn/health' >/dev/null
"${COMPOSE[@]}" ps
printf '共享网关已启动：resource 和 oneportal 域名均由它接入。\n'
