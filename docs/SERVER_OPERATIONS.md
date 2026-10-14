# 资源投资工作台服务器运维手册

本文是 resource 应用的日常发布入口；公网 HTTPS 与域名路由由服务器级共享网关管理：

```text
公网 https://resource.digitalshell.com.cn:443
    → nginx 容器
    → app:8000（Docker 内部）

服务器本机 127.0.0.1:18080
    → app:8000（部署脚本与本机诊断）
```

公网安全组保留 TCP 22、80、443；18080 不再需要公网放行。Git 命令以 `ecs-user` 执行，只有 Docker、部署和证书命令使用 `sudo`。不要执行 `sudo git ...`，否则可能造成 `.git/index` 权限异常。

## 日常代码发布

适用：本地代码已经合入远程 `main`，且本次没有数据库迁移，或迁移已经按发布说明和 DBA 备份方案处理。

在服务器执行：

```bash
cd /opt/shell-forecast

# 1. 确认服务器工作区干净；有输出时先保留并核对，不要强制覆盖。
git status --short

# 2. 记录可回滚的当前代码，并拉取远程 main。
PREVIOUS_RELEASE=$(git rev-parse HEAD)
git fetch --prune origin
git log --oneline HEAD..origin/main

# 3. 检查本次是否带数据库迁移。
git diff --name-only HEAD..origin/main -- backend/migrations

# 4. 没有迁移文件，或迁移已单独处理后，切换到远程 main。
git checkout --detach origin/main
git rev-parse --short=12 HEAD

# 5. 构建新镜像、更新 app、等待健康检查。
sudo bash deploy/deploy.sh --port 18080
```

`deploy/deploy.sh` 会重新构建并更新应用镜像；它不会拉取 Git 代码、不会自动执行数据库迁移、不会清空数据库，也不会重启共享网关。首次切换或证书/路由变更按 [共享 HTTPS 网关操作手册](SHARED_GATEWAY.md) 执行。

如果 `git status --short` 报 `.git/index: Permission denied`，修复 Git 元数据属主后再继续：

```bash
sudo chown -R ecs-user:ecs-user .git
sudo chmod -R u+rwX .git
git status --short
```

如果 `git fetch` 因网络超时失败，可以重试相同命令。不要通过不受信任的 GitHub 镜像拉取代码。

### 有数据库迁移时

若第 3 步输出 `backend/migrations/...`，停止在切换代码前，先查看本次发布说明和迁移内容。确认 DBA 已完成备份后，切换代码并查看当前迁移版本：

```bash
sudo docker compose --env-file deploy/.env run --rm --no-deps app alembic current
```

只有发布说明明确要求、迁移已评审且备份可恢复时，才执行：

```bash
sudo docker compose --env-file deploy/.env run --rm --no-deps app alembic upgrade head
sudo docker compose --env-file deploy/.env run --rm --no-deps app alembic current
```

之后再运行 `sudo bash deploy/deploy.sh --port 18080`。不要自动执行 `alembic downgrade`。

## 发布或重启后的检查

部署脚本成功后，执行以下命令确认应用容器、共享 HTTPS 入口和日志：

```bash
cd /opt/shell-forecast
sudo docker compose --env-file deploy/.env ps
sudo docker compose --env-file deploy/.env logs --tail=100 app
curl --noproxy '*' --fail https://resource.digitalshell.com.cn/health
```

预期：`app` 为 `healthy`，公网健康接口返回成功。网关状态请在 `/opt/digitalshell-gateway` 通过 `sudo docker compose --env-file .env ps` 查看。

从本地 Windows PowerShell 再验证一次公网入口：

```powershell
Test-NetConnection resource.digitalshell.com.cn -Port 443
curl.exe --fail https://resource.digitalshell.com.cn/health
```

实时查看日志：

```bash
sudo docker compose --env-file deploy/.env logs --tail=100 -f app
```

按 `Ctrl+C` 只会退出日志查看，不会停止容器。

## 不改代码时的重启

修改 `deploy/settings.toml` 中的数据库、百炼或 Databricks 等后端配置后，执行：

```bash
cd /opt/shell-forecast
sudo docker compose --env-file deploy/.env restart app
curl --noproxy '*' --fail http://127.0.0.1:18080/health
```

仅重启不会加载新的前端或后端源码；源码改动必须走“日常代码发布”。修改前端构建变量（如 `VITE_YIWEN_IFRAME_URL`）也必须重新运行 `deploy.sh` 构建镜像。

## 证书有效期和续期

证书由共享网关持有。每次检查服务器当前实际证书：

```bash
sudo openssl x509 -in /opt/digitalshell-gateway/certs/fullchain.pem -noout -dates
```

建议在到期前至少 14 天向运维索取同时覆盖两个域名的 PEM 证书链和私钥。替换前先备份，再复制新文件并验证两个域名，最后重启共享网关：

```bash
sudo cp -a /opt/digitalshell-gateway/certs /opt/digitalshell-gateway/certs.backup-$(date +%F)
sudo install -m 0644 -o ecs-user -g ecs-user /path/to/fullchain.pem /opt/digitalshell-gateway/certs/fullchain.pem
sudo install -m 0600 -o ecs-user -g ecs-user /path/to/private.key /opt/digitalshell-gateway/certs/private.key
sudo openssl x509 -in /opt/digitalshell-gateway/certs/fullchain.pem -noout -checkhost resource.digitalshell.com.cn
sudo openssl x509 -in /opt/digitalshell-gateway/certs/fullchain.pem -noout -checkhost oneportal.digitalshell.com.cn
cd /opt/digitalshell-gateway
sudo docker compose --env-file .env up -d --force-recreate nginx
```

不要提交或传播 `/opt/digitalshell-gateway/certs/`、证书 ZIP、`.key`、`.pem`、`deploy/.env`、`deploy/settings.toml`。

## 快速排错和回滚

```bash
# 容器状态和最近日志
sudo docker compose --env-file deploy/.env ps
sudo docker compose --env-file deploy/.env logs --tail=200 app

# 本机 HTTPS 验证，绕过 DNS 但仍验证证书
curl --noproxy '*' --fail --resolve resource.digitalshell.com.cn:443:127.0.0.1 https://resource.digitalshell.com.cn/health

# 查看最近部署日志
ls -lt logs/deploy | head
```

若新代码导致应用异常，且数据库没有不兼容变更，可回滚应用代码和镜像：

```bash
cd /opt/shell-forecast
git checkout --detach "$PREVIOUS_RELEASE"
sudo bash deploy/deploy.sh --port 18080
```

`PREVIOUS_RELEASE` 只在同一个 Shell 会话中有效。若已经关闭该终端，先通过 `git reflog`、部署日志中的“上一配置的镜像标签”或发布记录找回上一提交，再执行回滚。数据库回滚必须单独评审，不能因为应用回滚而自动执行。

## 相关文档

- [共享 HTTPS 网关首次部署与恢复](SHARED_GATEWAY.md)
- [Docker 部署与数据库初始化](DOCKER_DEPLOYMENT.md)
