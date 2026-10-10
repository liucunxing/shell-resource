#!/usr/bin/env bash
# Linux entrypoint. Run with bash; no chmod +x is required.
set -Eeuo pipefail
umask 077

ROOT=$(cd -- "$(dirname -- "${BASH_SOURCE[0]}")/.." && pwd)
cd "$ROOT"
STEP=0
STAGE="参数检查"
LOG_FILE=""
COMPOSE_READY=0
PORT_OVERRIDE=""
INIT_ONLY=0
WAIT_SECONDS=180
COMPOSE=(docker compose --project-directory "$ROOT" --env-file "$ROOT/deploy/.env" -f "$ROOT/compose.yaml")

usage() {
    cat <<'HELP'
用法：sudo bash deploy/deploy.sh [--init] [--port 8080] [--wait 180]
  --init       仅创建缺失的配置模板，保留已有配置；填写 settings.toml 后再部署
  --port N     覆盖并保存主机访问端口到 deploy/.env（1–65535）
  --wait N     等待健康检查的秒数，默认 180
  --help       查看帮助
默认读取 deploy/.env 中的 APP_PORT。脚本使用当前代码构建，不自动拉取代码或执行数据库迁移。
日志保存到 logs/deploy/，失败立即终止并报告步骤。
HELP
}

log() { printf '[%s] %s\n' "$(date '+%F %T')" "$*"; }
step() { STEP=$((STEP + 1)); STAGE=$1; log "[$STEP/8] 开始：$STAGE"; }
done_step() { log "[$STEP/8] 完成：$STAGE"; }
fail() { log "错误：$*" >&2; exit 1; }
on_exit() {
    local code=$?
    if ((code != 0)); then
        log "[$STEP/8] 失败：$STAGE（退出码 $code）"
        [[ -z "$LOG_FILE" ]] || log "完整日志：$LOG_FILE"
        if ((COMPOSE_READY)); then
            log "排查命令：sudo docker compose --env-file deploy/.env ps"
            log "排查命令：sudo docker compose --env-file deploy/.env logs --tail=100 app"
        fi
        log "修复后重新运行相同命令；脚本不会自动删除容器或清空数据库。"
    fi
}
trap on_exit EXIT
trap 'log "命令执行失败，脚本行号：$LINENO" >&2' ERR
trap 'exit 130' INT
trap 'exit 143' TERM

while (($#)); do
    case "$1" in
        --init) INIT_ONLY=1; shift ;;
        --port|--wait)
            [[ $# -ge 2 ]] || fail "$1 缺少参数"
            [[ "$2" =~ ^[1-9][0-9]{0,4}$ ]] || fail "$1 必须为正整数"
            if [[ "$1" == --port ]]; then
                (( $2 <= 65535 )) || fail "端口必须为 1–65535"
                PORT_OVERRIDE=$2
            else
                WAIT_SECONDS=$2
            fi
            shift 2 ;;
        --help|-h) usage; exit 0 ;;
        *) usage; fail "未知参数：$1" ;;
    esac
done

step "检查工具和工作目录"
for tool in python3 git tee stat; do
    command -v "$tool" >/dev/null || fail "缺少命令：$tool"
done
mkdir -p logs/deploy
LOG_FILE="$ROOT/logs/deploy/$(date '+%Y%m%d-%H%M%S')-$$.log"
exec > >(tee -a "$LOG_FILE") 2>&1
log "工作目录：$ROOT"
log "日志：$LOG_FILE"
done_step

step "准备配置和发布版本"
if ((INIT_ONLY)); then
    [[ -f deploy/.env ]] || cp deploy/.env.example deploy/.env
    if [[ ! -f deploy/settings.toml ]]; then
        cp deploy/settings.example.toml deploy/settings.toml
        if ((EUID == 0)); then
            CONFIG_UID=${SUDO_UID:-10001}
            CONFIG_GID=${SUDO_GID:-10001}
            [[ "$CONFIG_UID" != 0 ]] || CONFIG_UID=10001
            [[ "$CONFIG_GID" != 0 ]] || CONFIG_GID=10001
            chown "$CONFIG_UID:$CONFIG_GID" deploy/settings.toml
        fi
    fi
fi
[[ -f deploy/.env && -f deploy/settings.toml ]] || fail "配置缺失。先运行 sudo bash deploy/deploy.sh --init，再填写 deploy/settings.toml。"
# Never source a dotenv file as shell code. Only update our own non-secret keys.
python3 - "$PORT_OVERRIDE" <<'PY'
import os
import pathlib
import re
import subprocess
import sys
from datetime import datetime

path = pathlib.Path('deploy/.env')
text = path.read_text(encoding='utf-8-sig')
settings = pathlib.Path('deploy/settings.toml').stat()
updates = {'APP_UID': str(settings.st_uid), 'APP_GID': str(settings.st_gid)}
revision = subprocess.check_output(
    ['git', '-c', f'safe.directory={os.getcwd()}', 'rev-parse', '--short=12', 'HEAD'],
    text=True,
).strip()
previous_tag = re.search(r'^IMAGE_TAG=(.*)$', text, flags=re.M)
if previous_tag:
    print('上一配置的镜像标签（回滚时参考）：' + previous_tag.group(1))
# A timestamp prevents repeated builds of the same checkout overwriting rollback images.
updates['IMAGE_TAG'] = revision + '-' + datetime.now().strftime('%Y%m%d%H%M%S')
if sys.argv[1]:
    updates['APP_PORT'] = sys.argv[1]
for key, value in updates.items():
    pattern = rf'^{key}=.*$'
    if re.search(pattern, text, flags=re.M):
        text = re.sub(pattern, f'{key}={value}', text, flags=re.M)
    else:
        text += f'\n{key}={value}\n'
with path.open('w', encoding='utf-8', newline='\n') as file:
    file.write(text)
os.chmod(path, 0o600)
os.chmod('deploy/settings.toml', 0o600)
print(f'代码提交：{revision}；镜像标签：{updates["IMAGE_TAG"]}')
PY
if ((INIT_ONLY)); then
    log "配置模板已就绪（已有文件未覆盖）。请填写 deploy/settings.toml 中实际使用的配置段。"
    log "然后运行：sudo bash deploy/deploy.sh --port ${PORT_OVERRIDE:-8080}"
    exit 0
fi
for tool in docker curl ss; do
    command -v "$tool" >/dev/null || fail "缺少命令：$tool"
done
docker info >/dev/null
docker compose version
# Make an explicit command-line port take precedence over inherited shell variables.
if [[ -n "$PORT_OVERRIDE" ]]; then export APP_PORT=$PORT_OVERRIDE; fi
"${COMPOSE[@]}" config --quiet
COMPOSE_READY=1
# Resolve dotenv precedence through Compose itself; do not print full config/secrets.
CONFIG=$("${COMPOSE[@]}" config --format json)
printf '%s' "$CONFIG" | python3 -c '
import json, pathlib, sys
c = json.load(sys.stdin)
actual = pathlib.Path(c["secrets"]["app_settings"]["file"]).resolve()
expected = pathlib.Path("deploy/settings.toml").resolve()
if actual != expected:
    sys.exit("此一键脚本使用 deploy/settings.toml；请将 APP_SETTINGS_SOURCE 恢复为 ./deploy/settings.toml")
'
read -r PORT BIND < <(printf '%s' "$CONFIG" | python3 -c '
import json, sys
c = json.load(sys.stdin)
p = c["services"]["app"]["ports"][0]
print(p["published"], p.get("host_ip", "0.0.0.0"))
')
BIND=${BIND%$'\r'}
[[ "$PORT" =~ ^[1-9][0-9]{0,4}$ ]] && (( PORT <= 65535 )) || fail "APP_PORT 无效"
log "入口配置：$BIND:$PORT → 容器 8000"
if [[ -n "$(git -c "safe.directory=$ROOT" status --porcelain)" ]]; then
    log "注意：工作目录有未提交改动，本次镜像包含这些本地改动。"
fi
done_step

step "检查主机端口占用"
CURRENT=$("${COMPOSE[@]}" ps -q app)
OWN_PORT=0
PORT_CONTAINERS=$(docker ps --no-trunc -q --filter "publish=$PORT")
while IFS= read -r container; do
    [[ -n "$container" ]] || continue
    if [[ "$container" == "$CURRENT" ]]; then
        OWN_PORT=1
    else
        fail "端口 $PORT 已被容器 $container 占用，请改用 --port 8080 或其他空闲端口。"
    fi
done <<< "$PORT_CONTAINERS"
LISTENERS=$(ss -H -ltn "sport = :$PORT")
if [[ -n "$LISTENERS" ]] && (( ! OWN_PORT )); then
    printf '%s\n' "$LISTENERS"
    fail "端口 $PORT 已有进程监听。使用 --port 指定空闲端口；不会停止占用进程。"
fi
if ((OWN_PORT)); then log "端口由本项目旧容器使用，允许原地更新。"; fi
done_step

step "构建前端和后端镜像"
"${COMPOSE[@]}" --progress plain build --pull app
done_step

step "检查容器配置和数据库"
# Validate with the image's Python 3.11 and actual runtime user before replacing the old app.
"${COMPOSE[@]}" run --rm --no-deps -T app python -c '
import sys
sys.path.insert(0, "src")
from app.core.config import get_settings
s = get_settings()
if any(v in s.database_url.get_secret_value() for v in ("POSTGRES_HOST", "ENCODED_PASSWORD")):
    sys.exit("数据库配置仍有占位符，请填写 deploy/settings.toml")
if s.app_env == "production":
    sys.exit("当前版本尚未接入生产 SSO，production 会拒绝业务请求；请先完成 SSO 或使用受控 UAT 配置。")
print("运行配置可读取，环境：" + s.app_env)
'
"${COMPOSE[@]}" run --rm --no-deps -T app python scripts/check_database.py
done_step

step "启动或更新应用容器"
"${COMPOSE[@]}" up -d --no-build app
done_step

step "等待容器健康（最多 ${WAIT_SECONDS}s）"
CONTAINER=$("${COMPOSE[@]}" ps -q app)
[[ -n "$CONTAINER" ]] || fail "未找到应用容器"
DEADLINE=$((SECONDS + WAIT_SECONDS))
while :; do
    STATE=$(docker inspect --format '{{.State.Status}} {{if .State.Health}}{{.State.Health.Status}}{{end}}' "$CONTAINER")
    log "容器状态：$STATE"
    [[ "$STATE" == 'running healthy' ]] && break
    [[ "$STATE" != exited* && "$STATE" != dead* ]] || fail "容器已退出"
    ((SECONDS < DEADLINE)) || fail "等待健康检查超时"
    sleep 5
done
done_step

step "验证主机 HTTP 入口"
HOST=$BIND
[[ "$HOST" != '0.0.0.0' ]] || HOST=127.0.0.1
[[ "$HOST" != '::' ]] || HOST=::1
[[ "$HOST" != *:* ]] || HOST="[$HOST]"
curl --noproxy '*' --fail --show-error --silent --max-time 15 "http://$HOST:$PORT/health"
printf '\n'
curl --noproxy '*' --fail --show-error --silent --max-time 15 -o /dev/null "http://$HOST:$PORT/"
"${COMPOSE[@]}" ps
done_step
log "部署成功，访问地址：http://<服务器IP>:$PORT/（目标服务器：172.19.49.45）"
log "日志：$LOG_FILE"
