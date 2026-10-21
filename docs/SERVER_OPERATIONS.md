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

### Insight 问题编号与日志保留

Insight 生成失败会显示“问题编号”。用该编号查询应用日志，可关联分析方案、规划年度、范围/用户哈希、处理阶段、模型供应商请求号及安全诊断；日志不记录邮箱、请求正文或模型正文。

```bash
# 将示例值替换为页面显示的 32 位问题编号
INSIGHT_REQUEST_ID=页面显示的问题编号
sudo docker compose --env-file deploy/.env logs --no-color app | grep -F -- "$INSIGHT_REQUEST_ID"
# 查询部署前保存的旧容器日志（只在有归档后执行）
sudo grep -F -- "$INSIGHT_REQUEST_ID" logs/runtime/*.log
sudo ls -lt logs/runtime
```

应用容器使用 Docker `json-file`，每份日志最多约 10 MB、最多 5 份。这是按大小轮转，**不是按天保留**；超出窗口的旧日志会被 Docker 轮转淘汰。该设置在本次容器更新后生效，不会恢复已经丢失的日志。

部署脚本在替换旧应用容器前，将 Docker 当时仍保留的完整 stdout/stderr 日志连同时间戳归档到 `logs/runtime/`。归档失败会在替换应用前终止；首次部署无旧容器时正常跳过。归档是替换前的快照，快照完成到旧容器退出之间新产生的少量日志不保证包含在内。直接手动删除或重建容器会绕过这一步，应使用部署脚本。

归档目录权限为 0700、文件遵循脚本的 `umask 077`，不打印日志正文到部署日志。目录已被 Git 和 Docker 构建上下文排除。脚本不自动删除历史归档；运维应按组织保留要求审核磁盘容量和归档清理。`.partial` 表示归档未成功，保留以便受控排查，不能当作完整历史记录。

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


## 用户多部门版本：20261014_01

本版本需要数据库迁移，不能只替换应用镜像。用户表 `data.user_permissions.department` 由 `varchar(32)` 转为 `varchar(32)[]`；预算、分配、发布表中的项目部门保持单值。

在维护窗口按上文“有数据库迁移时”流程完成可恢复备份、构建新镜像，停止旧版应用后使用新镜像执行 `alembic upgrade head`，再启动新版应用。旧版应用不能读取新数组字段，须协调应用与数据库切换。

迁移将旧单值（如 `MKT`）转换为单元素数组 `{MKT}`，空值转换为空数组，保留用户主键与邮箱。接口仍接受旧单字符串输入，统一输出数组；业务线对全部授权部门生效。

回滚脚本检测到任一多部门用户时会拒绝降级，避免丢弃第二个部门。此时须先评审权限恢复方案，不可直接截取数组第一项。

验收：人员新增/编辑两个部门后重新进入仍回显；Owner 可编辑两个部门的本人项目，Lead 可切换两个部门总览；访问未授权部门应拒绝；取消授权后旧入口应拒绝。已有预算用户仅可调整部门且必须保留仍有项目的部门。
