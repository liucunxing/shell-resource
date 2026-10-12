#!/usr/bin/env bash
# Docker Compose HTTPS setup / certificate renewal. Uses the existing app image.
set -Eeuo pipefail
umask 077
ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
STEP=0
ZIP=""
MODE=enable
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/deploy/.env" -f "$ROOT/compose.yaml" --profile https)
log() { printf '[%s] [%s/8] %s\n' "$(date '+%F %T')" "$STEP" "$*"; }
fail() { log "错误：$*" >&2; exit 1; }
trap 'log "失败，脚本行号 $LINENO。查看 nginx/app 日志；备份在 deploy/backups。" >&2' ERR
while (($#)); do
    case "$1" in
        --cert-zip) [[ $# -ge 2 ]] || fail '--cert-zip 缺少路径'; ZIP=$2; shift 2 ;;
        --check) MODE=check; shift ;;
        --verify) MODE=verify; shift ;;
        --help|-h) printf '%s\n' 'sudo bash deploy/https.sh --cert-zip /home/ecs-user/digitalshell.com.cn_nginx.zip' 'sudo bash deploy/https.sh --check    # 校验证书和 Compose 配置，不启停服务' 'sudo bash deploy/https.sh --verify   # 验证已运行的本机 HTTPS 入口'; exit 0 ;;
        *) fail "未知参数：$1" ;;
    esac
done
[[ $MODE == enable || -z $ZIP ]] || fail '--cert-zip 不能与 --check/--verify 同时使用'
if [[ $MODE == enable ]]; then
    command -v tee >/dev/null || fail '缺少命令：tee'
    mkdir -p logs/deploy
    LOG_FILE="$ROOT/logs/deploy/https-$(date '+%Y%m%d-%H%M%S')-$$.log"
    exec > >(tee -a "$LOG_FILE") 2>&1
    log "完整日志：$LOG_FILE"
fi

STEP=1; log '检查工具、配置和 Docker'
for tool in python3 docker curl ss openssl; do command -v "$tool" >/dev/null || fail "缺少命令：$tool"; done
[[ -f deploy/.env && -f deploy/settings.toml ]] || fail '缺少已有的 deploy/.env 或 settings.toml'
docker info >/dev/null
"${COMPOSE[@]}" config --quiet
CONFIG=$("${COMPOSE[@]}" config --format json)
read -r DOMAIN HTTP_PORT HTTPS_PORT NGINX_IMAGE APP_BIND APP_PORT < <(printf '%s' "$CONFIG" | python3 -c '
import json,sys
c=json.load(sys.stdin); n=c["services"]["nginx"]; ports={p["target"]:p["published"] for p in n["ports"]}
a=c["services"]["app"]["ports"][0]
print(n["environment"]["HTTPS_DOMAIN"], ports[80], ports[443], n["image"], a.get("host_ip","0.0.0.0"), a["published"])
')
DOMAIN=${DOMAIN%$'\r'}; APP_PORT=${APP_PORT%$'\r'}
[[ $DOMAIN =~ ^[a-zA-Z0-9]([a-zA-Z0-9.-]*[a-zA-Z0-9])?$ ]] || fail '域名格式错误'
# HTTP redirect is configured for the requested standard HTTPS URL.
[[ $HTTPS_PORT == 443 ]] || fail '此入口使用标准 HTTPS 443；自定义端口需同时修改重定向配置'
[[ $APP_PORT != "$HTTP_PORT" && $APP_PORT != "$HTTPS_PORT" ]] || fail '应用主机端口不能与 Nginx 入口相同；请先用 deploy.sh --port 18080 发布'
verify() {
    curl --noproxy '*' --fail --show-error --silent --max-time 30 \
        --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" "https://$DOMAIN/health"
    printf '\n'
    curl --noproxy '*' --fail --show-error --silent --max-time 30 \
        --resolve "$DOMAIN:$HTTPS_PORT:127.0.0.1" -o /dev/null "https://$DOMAIN/"
    log "本机 HTTPS 健康和页面检查成功：https://$DOMAIN/"
}
if [[ $MODE == verify ]]; then STEP=8; verify; exit 0; fi

STEP=2; log '导入或检查证书（不打印私钥）'
if [[ -n $ZIP ]]; then
    python3 deploy/https_config.py import --zip "$ZIP" --domain "$DOMAIN"
else
    python3 deploy/https_config.py check --domain "$DOMAIN"
    [[ $MODE == check ]] || python3 deploy/https_config.py backup
fi
if [[ $MODE == check ]]; then log '证书和 Compose 配置检查通过'; exit 0; fi

STEP=3; log '检查 80/443 是否被其他服务占用'
CURRENT=$("${COMPOSE[@]}" ps -q nginx)
for port in "$HTTP_PORT" "$HTTPS_PORT"; do
    OWN=0
    while IFS= read -r id; do
        [[ -n $id ]] || continue
        [[ $id == "$CURRENT" ]] || fail "端口 $port 被其他容器使用：$id"
        OWN=1
    done < <(docker ps --no-trunc -q --filter "publish=$port")
    if [[ -n $(ss -H -ltn "sport = :$port") ]] && (( ! OWN )); then
        fail "端口 $port 被主机服务占用；不会停止其他服务"
    fi
done

STEP=4; log "准备 Nginx 镜像：$NGINX_IMAGE"
if ! docker image inspect "$NGINX_IMAGE" >/dev/null 2>&1; then
    "${COMPOSE[@]}" pull nginx
else
    log '使用已有的固定版本镜像，避免重复拉取'
fi

STEP=5; log '在临时容器内检查 Nginx 配置和证书'
"${COMPOSE[@]}" run --rm --no-deps -T nginx nginx -t

STEP=6; log '启用 HTTPS profile，将应用 HTTP 端口限定在本机'
python3 deploy/https_config.py enable
# Fail if inherited shell variables would undo the saved loopback binding.
CONFIG=$("${COMPOSE[@]}" config --format json)
printf '%s' "$CONFIG" | python3 -c '
import json,sys
p=json.load(sys.stdin)["services"]["app"]["ports"]
if any(item.get("host_ip") != "127.0.0.1" for item in p):
    sys.exit("APP_BIND_ADDRESS 被 shell 环境覆盖；取消该环境变量后重新执行")
'

STEP=7; log '更新端口映射并启动 Nginx，保留当前应用镜像'
"${COMPOSE[@]}" up -d --no-build --force-recreate --wait --wait-timeout 180 app nginx

STEP=8; log '验证 HTTPS 证书链、应用健康与页面'
verify
"${COMPOSE[@]}" ps
log '本机切换成功；请从本地浏览器验证公网 DNS、安全组及防火墙的 443 入口。'
log '后续更新代码仍执行 sudo bash deploy/deploy.sh --port 18080。'
