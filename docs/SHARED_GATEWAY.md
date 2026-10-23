# 服务器共享 HTTPS 网关

本 ECS 的公网入口由一个独立 Docker Compose 项目统一管理：

```text
Internet
  └─ 80/443  →  /opt/digitalshell-gateway (Nginx, host network)
                 ├─ resource.digitalshell.com.cn → 127.0.0.1:18080 (shell-forecast)
                 └─ oneportal.digitalshell.com.cn → 127.0.0.1:18081
                      /opt/shell-oneportal frontend (Nginx, container 8080)
                        └─ /api/ → backend:8080 (Java, Docker 内网)
```

只有共享网关监听公网 `80/443`。应用可以使用内部 Nginx 提供静态文件和 API 代理，但必须只发布 `127.0.0.1` 端口；OnePortal 后端不发布宿主机端口。这样增加新平台时只需分配一个本机端口和一个 `server_name` 路由，不会抢占入口端口。

本文是部署操作手册，不是线上验收完成记录。OnePortal 按受控 UAT 方式交付，使用现有管理员账号密码，保留会话、CSRF 和角色校验；企业 SSO 尚未接入，不能据此宣称生产身份接入已完成。

## 首次迁移到共享网关（历史迁移流程）

已经使用共享网关的服务器跳过本节，按下文日常维护和应用发布流程操作。

以下命令在 ECS 中以 `ecs-user` 执行。先确认当前代码已包含 `gateway/` 目录，且 `resource` 应用已按新的 Compose 配置监听 `127.0.0.1:18080`。

```bash
cd /opt/shell-forecast
git fetch --prune origin
git checkout --detach origin/main
sudo bash deploy/deploy.sh --port 18080
curl --noproxy '*' --fail http://127.0.0.1:18080/health
```

安装网关程序文件；此命令不会覆盖已有 `.env` 或证书：

```bash
cd /opt/shell-forecast
sudo bash gateway/install.sh /opt/digitalshell-gateway
sudo chown -R ecs-user:ecs-user /opt/digitalshell-gateway
```

复制当前证书到网关目录。不要把证书、私钥、`gateway/.env` 提交到 Git：

```bash
sudo install -m 0644 -o ecs-user -g ecs-user deploy/certs/fullchain.pem /opt/digitalshell-gateway/certs/fullchain.pem
sudo install -m 0600 -o ecs-user -g ecs-user deploy/certs/private.key /opt/digitalshell-gateway/certs/private.key
```

检查证书确实覆盖两个域名。若任一命令失败，请先向证书提供方申请包含两个名称或 `*.digitalshell.com.cn` 的证书，**不要切换网关**：

```bash
sudo openssl x509 -in /opt/digitalshell-gateway/certs/fullchain.pem -noout -checkhost resource.digitalshell.com.cn
sudo openssl x509 -in /opt/digitalshell-gateway/certs/fullchain.pem -noout -checkhost oneportal.digitalshell.com.cn
cd /opt/digitalshell-gateway
sudo bash deploy.sh --check
```

旧项目私有 Nginx 仍占用 80/443，必须先仅停止它。以下命令按 Compose 标签精确定位，不会停止 `app`：

```bash
LEGACY_NGINX=$(sudo docker ps -q \
  --filter label=com.docker.compose.project=shell-forecast \
  --filter label=com.docker.compose.service=nginx)
printf '旧 Nginx 容器 ID：%s\n' "$LEGACY_NGINX"
test -n "$LEGACY_NGINX" && sudo docker stop "$LEGACY_NGINX"
```

启动网关。脚本会检查端口、上游只为 `127.0.0.1`、证书域名、Nginx 配置、两个域名的网关健康接口，以及 resource 应用健康接口：

```bash
cd /opt/digitalshell-gateway
sudo bash deploy.sh
```

最后从服务器与外部浏览器验证：

```bash
curl --noproxy '*' --fail --resolve resource.digitalshell.com.cn:443:127.0.0.1 https://resource.digitalshell.com.cn/health
curl --noproxy '*' --fail --resolve oneportal.digitalshell.com.cn:443:127.0.0.1 https://oneportal.digitalshell.com.cn/nginx-health
sudo docker compose --env-file .env ps
sudo docker compose --env-file .env logs --tail=100 nginx
```

`/nginx-health` 返回 200 只说明网关路由和 TLS 可用，不代表应用已经运行。OnePortal 未部署时根路径可能返回 502；接入完成的验收必须检查 `/api/health`、页面和认证行为，不能接受 502 作为交付结果。网关脚本不会代替 OnePortal 业务验收。

## 网关日常维护

网关部署目录独立于应用仓库；更改仓库内的 `gateway/` 后，需显式同步才会生效：

```bash
cd /opt/shell-forecast
sudo bash gateway/install.sh /opt/digitalshell-gateway
cd /opt/digitalshell-gateway
sudo bash deploy.sh --check
sudo bash deploy.sh
```

`--check` 使用隔离网络的临时容器验证模板、证书及私钥，不占用 80/443。正式部署仅在预检成功后更新网关。保留原入口的 20MB 上传限制和 300 秒请求超时。现有镜像可用时直接复用；镜像版本升级时先修改 `.env` 中的 `GATEWAY_NGINX_IMAGE`。

当前安全镜像为 `digitalshell-gateway:1.30.6-brotli1.2.1`。它由仓库 `gateway/Dockerfile`（安装后为 `/opt/digitalshell-gateway/Dockerfile`）从固定 digest 的官方 Nginx 1.30.6 构建，并补充 Brotli 1.2.1（该固定基础镜像仍含 1.2.0）。此默认目标镜像不存在时，`deploy.sh` 在预检前自动构建；其他显式镜像标签缺失时脚本尝试拉取，不会把新构建冒充为旧版本。首次从旧网关升级时，`install.sh` 保留已有 `.env`，因此必须显式更新其中的 `GATEWAY_NGINX_IMAGE`。后续修改 Dockerfile 应使用新镜像标签；回滚时把该变量恢复为保留的旧镜像，再执行 `deploy.sh`。

旧项目公网 Nginx 在迁移后保持停止状态，可设为 `sudo docker update --restart=no shell-forecast-nginx-1` 避免重启宿主机后争抢入口。它仅保留为历史灾备，不是常规回滚方案。

## 之后发布 resource 项目

网关不需要重启。仅更新应用：

```bash
cd /opt/shell-forecast
git fetch --prune origin
git checkout --detach origin/main
sudo bash deploy/deploy.sh --port 18080
curl --noproxy '*' --fail http://127.0.0.1:18080/health
curl --noproxy '*' --fail https://resource.digitalshell.com.cn/health
```

## 发布 OnePortal 受控 UAT

应用仓库位于 `/opt/shell-oneportal`，具体配置校验和发布流程以该仓库 `deploy/README.md` 为准。部署前准备权限受限的现有 `.env`，保留原管理数据库与管理员账号密码，不打印密钥或完整 Compose 配置。确认数据库 Flyway 历史满足应用 UAT 校验要求，不能通过跳过校验或切换空数据库绕过启动失败。

OnePortal 的 Compose 只发布 `127.0.0.1:18081:8080`，由 frontend 容器提供 React 静态文件并将 `/api/` 转发到内部 `backend:8080`。下面命令在已检出并测试目标提交后执行；若 Docker 需要提权，保持 `ONEPORTAL_RELEASE` 传递给 Compose：

```bash
cd /opt/shell-oneportal
export ONEPORTAL_RELEASE="$(git rev-parse --short=12 HEAD)"
python3 deploy/check-env.py
docker compose -f deploy/compose.yaml build
docker compose -f deploy/compose.yaml up -d --no-build --wait --wait-timeout 180
docker compose -f deploy/compose.yaml ps
curl --noproxy '*' --fail http://127.0.0.1:18081/api/health
curl --noproxy '*' --fail https://oneportal.digitalshell.com.cn/api/health
curl --noproxy '*' --fail https://oneportal.digitalshell.com.cn/
```

已有运行网关预留 `oneportal.digitalshell.com.cn → 127.0.0.1:18081`，应用启动后即可接入，无需为此次接入重启网关。健康接口是 **`/api/health`，不是 `/health`**；后者可能命中前端页面回退，返回 200 也不能证明后端正常。

验收还应覆盖静态资源、前端深层路由、匿名访问 `/api/admin/overview` 返回 401、现有管理员登录及只读管理页面、退出登录、缺少 CSRF 的写请求被拒绝。不要以验收为由发布 UC 变更、修改数据库账号或调用付费服务。保留 `shell-oneportal_evidence` 附件卷，发布和回滚都不得执行 `down -v`。

若将来需要第三个应用，新增一个未占用的本机端口和一个 Nginx `server_name` 块，随后在 `/opt/digitalshell-gateway` 同步 `gateway/` 的程序文件并执行 `sudo bash deploy.sh`。不要给应用自身分配 80 或 443。

## 故障定位和重启后验收

先确认监听和容器状态，再逐层检查，避免把应用未运行误判成网关配置错误：

```bash
sudo ss -ltnp | grep -E ':(80|443|18080|18081)\b'
sudo docker ps --format 'table {{.Names}}\t{{.Status}}\t{{.Ports}}'
curl --noproxy '*' --fail http://127.0.0.1:18080/health
curl --noproxy '*' --fail http://127.0.0.1:18081/api/health
curl --noproxy '*' --fail https://resource.digitalshell.com.cn/health
curl --noproxy '*' --fail https://oneportal.digitalshell.com.cn/api/health
```

| 现象 | 优先检查 |
| --- | --- |
| `/nginx-health` 200，应用 502 | 本机上游是否监听、应用容器健康状态、网关 upstream 是否对应 18080/18081 |
| OnePortal 根路径可用，`/api/health` 失败 | frontend 到 backend 的内网代理、后端启动日志、数据库连接及迁移校验 |
| 本机应用健康，外部域名失败 | 网关日志、证书域名/有效期、DNS 和公网入口配置 |
| 登录或管理接口 401/403 | 会话 Cookie、转发 HTTPS 信息、CSRF 和角色；不得直接取消安全校验 |
| 宿主机重启后入口失败 | Docker 启动、容器 restart policy、旧公网 Nginx 是否抢占 80/443 |

网关日志用 `/opt/digitalshell-gateway` 下 `sudo docker compose --env-file .env logs --tail=100 nginx`；OnePortal 日志在应用目录设置对应 `ONEPORTAL_RELEASE` 后用 `docker compose -f deploy/compose.yaml logs --tail=100 frontend backend`。日志对外分享前须脱敏。重启后还需从外部浏览器验证两个应用，不只检查容器进程存活。

## 回滚边界

常规回滚保留共享网关和两个域名路由，仅回退故障组件：

- resource：恢复发布前保存的 `deploy/.env` 应用镜像配置，在 `/opt/shell-forecast` 执行 `sudo docker compose --env-file deploy/.env -f compose.yaml up -d --no-build --wait`，然后验证本机和公网 `/health`。
- OnePortal：设置 `ONEPORTAL_RELEASE` 为保留的已验证旧镜像标签，在 `/opt/shell-oneportal` 执行 `docker compose -f deploy/compose.yaml up -d --no-build --wait --wait-timeout 180`，验证 `/api/health` 和认证行为。首次部署没有旧版本，停止该项目两个容器只会恢复为“上游缺失”，并不算可用服务恢复；保留数据库和附件卷。
- 网关：恢复已备份的网关 `.env` 中镜像标签，以及本次变更前的模板/Compose 文件；执行 `sudo bash deploy.sh --check`，通过后执行 `sudo bash deploy.sh`，验证两个应用。不要只回退镜像却保留不兼容的新模板。

`gateway/deploy.sh` 从不停止其他项目。只有共享网关无法恢复、明确接受失去 OnePortal 入口且已核对旧容器配置时，才考虑历史私有 Nginx 全入口灾备。使用事先记录的真实旧容器 ID；它的旧镜像可能不含最新安全修复：

```bash
cd /opt/digitalshell-gateway
sudo docker compose --env-file .env down
sudo docker start <旧_Nginx_容器_ID>
```

不要在恢复过程中执行 `docker system prune`、删除数据库卷或修改应用的 `deploy/settings.toml`。
