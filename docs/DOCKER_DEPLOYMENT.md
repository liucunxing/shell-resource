# Shell Forecast Docker 单机部署手册

本文用于把 Shell Forecast 部署到 Linux 服务器 `172.19.49.45`。当前方案是单机 Docker Compose：一个镜像包含 React 编译产物和 FastAPI，PostgreSQL 使用外部数据库，不在本机自动创建或清空数据库。

## 一键部署（推荐入口）

服务器准备好 Docker Engine、Compose plugin、Git、Python 3、curl、ss（iproute2）后，在已检出发布代码的仓库目录运行。首次只生成配置模板：

```bash
cd /opt/shell-forecast
sudo bash deploy/deploy.sh --init
sudo vi deploy/settings.toml
```

初始化脚本会将 `deploy/.env` 和 `deploy/settings.toml` 的属主设为执行 `sudo` 前的部署账号，并设为仅属主可读写。若早期版本已将 `.env` 建为 root 属主，执行一次：

```bash
sudo chown ecs-user:ecs-user deploy/.env
sudo chmod 600 deploy/.env
```

填写 `[development]` 的真实 PostgreSQL 连接，以及需要启用的外部服务配置；数据库建表或迁移按下文第 7 节准备一次。随后一条命令部署：

```bash
sudo bash deploy/deploy.sh --port 8080
```

成功后访问 `http://172.19.49.45:8080/`。主机防火墙也要放行所选端口。脚本实时显示当前阶段、时间、Docker 构建输出和健康状态：

```text
[时间] [1/8] 开始：检查工具和工作目录
[时间] [2/8] 开始：准备配置和发布版本
[时间] [3/8] 开始：检查主机端口占用
[时间] [4/8] 开始：构建前端和后端镜像
[时间] [5/8] 开始：检查容器配置和数据库
[时间] [6/8] 开始：启动或更新应用容器
[时间] [7/8] 开始：等待容器健康（最多 180s）
[时间] [8/8] 开始：验证主机 HTTP 入口
```

任意命令失败立即停止，打印步骤名、退出码、脚本行号（命令执行失败时）、日志位置和排查命令。日志实时保存到 `logs/deploy/日期时间-进程号.log`，可用 `sudo tail -f <日志路径>` 跟踪；日志目录不进入 Git 或镜像。

端口优先级：`--port` > 当前 shell 的 `APP_PORT` > `deploy/.env` 的 `APP_PORT` > 默认 80。`--port` 会写回 `deploy/.env`，后续重启沿用。容器内部保持 8000，无需修改代码或前端 API 地址。

```bash
# 改为 18080，先检查是否被其他服务占用
sudo bash deploy/deploy.sh --port 18080

# 使用上次保存的端口，健康等待上限改为 300 秒
sudo bash deploy/deploy.sh --wait 300

# 参数说明
bash deploy/deploy.sh --help
```

端口被其他容器或进程占用时，脚本在构建前报错；不会自动停止对方或偷偷换端口。本项目旧容器占用的端口允许原地更新。端口检查采用保守策略：其他接口监听同一端口也会拒绝；检查后若发生竞争占用，启动阶段仍会报告 Docker 的绑定错误。

脚本使用当前目录代码，每次生成“commit 前 12 位 + 时间”的新镜像标签，保留旧镜像供回滚；不会自动拉取分支。`--init` 只复制缺失的配置，已有密钥不会被覆盖。部署时会更新 `.env` 中的镜像标签和与配置文件属主对应的运行 UID/GID；直接以 root 初始化时，新配置归属非 root UID 10001，以便容器非 root 运行。一键入口固定使用 `deploy/settings.toml`。

数据库阶段调用只读检查，不自动建表、stamp 或迁移；`connected: true` 只证明连接和结构查询成功，具体结构仍按第 7 节核对。构建和数据库检查成功后才替换现有容器；启动后失败会留下现场供诊断，不自动回滚。后面的逐步命令供手动部署和排查时使用。

## 1. 当前发布边界

- 手册生成时，`main`、`origin/main`、`feature/liucxs_from_v14-quickwin` 和其远端均指向业务代码提交 `baa8cbd134400b14ef63f690e4b4652c739301c6`。
- 本手册和 Docker 文件是在该提交之上新增的，因此必须先提交这些部署文件。服务器最终应检出“包含 Docker 文件的发布提交”，而不是只检出 `baa8cbd`。
- 部署分支使用 `main`。个人分支只用于开发；发布前应把已验收的部署文件合入 `main`，并记录最终发布 commit。
- 当前可信 SSO 尚未实现。`APP_ENV=production` 会让所有工作台业务 API 返回 401。现阶段只能在受控内网以 `APP_ENV=development` 做 UAT，并继续使用页面输入邮箱、后端查询 `data.user_permissions` 的临时身份方式。
- 正式投产前必须完成 SSO、HTTPS 和入口访问控制。不能通过去掉 401 或信任公网传入的 `X-User-Email` 来绕过认证。

## 2. 部署结构

```text
浏览器
  -> http://172.19.49.45:80
  -> Docker 端口映射
  -> Uvicorn :8000
       |- /                  React 静态页面
       |- /api/v1/workbench  FastAPI 业务接口
       `- /health            容器存活检查

应用容器
  -> 外部 PostgreSQL:5432
  -> 可选：百炼 / Azure Blob / Databricks（按实际配置）
```

同源部署不需要在浏览器中配置跨域地址，前端默认调用 `/api/v1/workbench`。镜像中不包含真实密码；运行时从只读的 `deploy/settings.toml` 挂载配置。

## 3. 上线前准备

先确认服务器操作系统、CPU 架构、磁盘和网络：

```bash
cat /etc/os-release
uname -m
df -h
free -h
ip addr
```

建议最低资源用于当前单实例 UAT：2 vCPU、4 GB 内存、20 GB 可用磁盘。服务器需要：

- 入站：运维来源到 TCP 22；受控内网用户到 TCP 80。正式启用 TLS 后使用 443，并限制或关闭 80。
- 出站：目标 PostgreSQL 5432；如启用相应能力，还需要百炼、Azure 中国区 Blob、Databricks 的 HTTPS 443。
- DNS 和时间同步正常，时区使用 `Asia/Shanghai`。
- Git 能访问代码仓库，Docker 构建能访问 npm 和 Python 包源；隔离网络应提前准备内部镜像仓库和依赖代理。

服务器应安装 Docker Engine、Buildx 和 Compose plugin。根据服务器实际发行版使用 Docker 官方对应安装文档；不要使用已经标为 legacy 的 `docker-compose` standalone。安装后验证：

```bash
sudo systemctl enable --now docker
sudo docker version
sudo docker compose version
```

Docker 官方文档：

- Linux Engine：https://docs.docker.com/engine/install/
- Compose plugin：https://docs.docker.com/compose/install/linux/

## 4. 准备发布代码

### 4.1 本地发布前

部署文件通过评审并合入 `main` 后，记录最终提交：

```bash
git checkout main
git pull --ff-only origin main
git status --short
git rev-parse HEAD
```

`git status --short` 必须为空。将 `git rev-parse HEAD` 的完整值记为 `RELEASE_COMMIT`。不要用未提交工作区或会继续移动的分支名代替发布 commit。

### 4.2 服务器首次拉取

以下示例使用 `/opt/shell-forecast`，仓库地址按当前 remote：

```bash
sudo mkdir -p /opt/shell-forecast
sudo chown "$(id -u):$(id -g)" /opt/shell-forecast
git clone --branch main https://github.com/liucunxing/shell-resource.git /opt/shell-forecast
cd /opt/shell-forecast
git fetch --prune origin
git checkout --detach RELEASE_COMMIT
git rev-parse HEAD
git status --short
```

将示例中的 `RELEASE_COMMIT` 替换成已记录的完整 commit。检出 detached commit 是为了确保发布内容不会随 `main` 后续移动。

## 5. 配置运行参数和密钥

```bash
cd /opt/shell-forecast
cp deploy/.env.example deploy/.env
cp deploy/settings.example.toml deploy/settings.toml
chmod 600 deploy/.env deploy/settings.toml
```

编辑 `deploy/.env`：

```dotenv
IMAGE_TAG=RELEASE_COMMIT的前12位
APP_ENV=development
APP_BIND_ADDRESS=0.0.0.0
APP_PORT=80
WEB_CONCURRENCY=2
APP_UID=1000
APP_GID=1000
```

示例中的 `1000` 不能盲用。先用 `id -u` 和 `id -g` 取得纯数字，再填入上面两项。容器使用相同的数值 UID/GID 运行，以便读取主机上权限为 600 的配置文件。

编辑 `deploy/settings.toml` 的 `[development]`：

- `database_url`：真实 PostgreSQL 连接。密码中的特殊字符需要 URL 编码；是否使用 `ssl=require` 以数据库要求为准。
- `db_echo=false`：服务器不要输出 SQL 参数。
- `ai_*`、`azure_blob_*`、`databricks_*`：只在已开通并验证对应能力时填写。
- `frontend_dist_path=/app/frontend/dist` 保持不变。
- 同站点访问时 `cors_origins=[]` 即可。

检查文件中没有遗留占位符：

```bash
grep -nE 'REPLACE|POSTGRES_HOST|ENCODED_PASSWORD|DATABASE' deploy/settings.toml deploy/.env
```

此命令只能定位占位符，不要把配置内容贴到工单或聊天中。Compose secret 只是避免把密钥烘焙到镜像或直接放入环境变量；`deploy/settings.toml` 在主机上仍是明文文件，所以必须限制文件权限并控制服务器账号。

## 6. 构建与静态检查

```bash
cd /opt/shell-forecast
sudo docker compose --env-file deploy/.env config --quiet
sudo docker compose --env-file deploy/.env build --pull app
sudo docker image inspect "shell-forecast:$(grep '^IMAGE_TAG=' deploy/.env | cut -d= -f2)"
```

可用下面命令核对镜像记录的代码版本：

```bash
sudo docker image inspect \
  --format '{{ index .Config.Labels "org.opencontainers.image.revision" }}' \
  "shell-forecast:$(grep '^IMAGE_TAG=' deploy/.env | cut -d= -f2)"
```

构建会执行 `npm ci`、TypeScript 检查、Vite 生产构建和 Python 依赖安装。前端 `VITE_*` 值在构建期写入镜像，修改后必须重新 build，单纯重启容器不会生效。

## 7. 数据库准备

先只读检查连通性和表结构：

```bash
sudo docker compose --env-file deploy/.env run --rm --no-deps app \
  python scripts/check_database.py
```

根据数据库实际状态只选择以下一种路径。操作前由 DBA 完成备份，并记录备份位置和恢复命令。

### 路径 A：全新空库

由 DBA 使用 PostgreSQL 客户端执行 `backend/docs/database/data_preparation_v1.sql`。该脚本是完整建表脚本，只适用于空的 `data` 业务结构，不能覆盖已有数据。当前完整脚本已包含最新 `sector` 字段和四业务线约束，因此执行成功后只登记 Alembic 版本：

```bash
sudo docker compose --env-file deploy/.env run --rm --no-deps app alembic stamp head
```

不要在同一个全新库上再执行 `alembic upgrade head`，否则首个迁移会重复添加完整脚本已经创建的约束。

### 路径 B：已有旧结构，需要增量升级

先检查版本和实际字段/约束，再执行：

```bash
sudo docker compose --env-file deploy/.env run --rm --no-deps app alembic current
sudo docker compose --env-file deploy/.env run --rm --no-deps app alembic upgrade head
sudo docker compose --env-file deploy/.env run --rm --no-deps app alembic current
```

如果数据库已由人工 SQL 加过 `sector` 或同名约束，不要盲目执行或 `stamp`；先由 DBA 对照两份迁移脚本核实。Alembic 的首个 revision 是 `20261009_01`，不是整个历史库的建库基线。

正式库禁止执行 `quickwin_v14_test_seed.sql`。UAT 也只有在明确需要合成账号和数据时才能执行，并应使用独立数据库。

首次使用前必须存在真实的 `data.user_permissions` 和预算 Owner 映射。Owner/Lead 需要部门；Owner 恰好一个 Sector，Lead 可有一至四个 Sector；Management/Admin 的 Sector 必须为空。首个管理员账号应由 DBA 受控写入，后续再使用管理后台维护。

## 8. 启动

```bash
cd /opt/shell-forecast
sudo docker compose --env-file deploy/.env up -d --no-build app
sudo docker compose --env-file deploy/.env ps
sudo docker compose --env-file deploy/.env logs --tail=200 app
```

预期状态为 `Up ... (healthy)`。Compose 配置了 `restart: unless-stopped`，Docker 服务重启后会自动恢复容器。

## 9. 部署后验收

在服务器本机执行：

```bash
curl --fail --show-error http://127.0.0.1/health
curl --fail --show-error --head http://127.0.0.1/
sudo docker compose --env-file deploy/.env ps
sudo docker compose --env-file deploy/.env logs --tail=200 app
```

再从允许访问的客户端打开 `http://172.19.49.45/`：

1. 输入已存在于 `data.user_permissions` 且启用的 UAT 邮箱。
2. 验证当前用户、角色、部门和 Sector 范围正确。
3. 验证工作台读取、草稿保存、再次读取。
4. 仅在独立 UAT 数据上验证同步、管理员修改和 Insight 生成。
5. 验证无权限邮箱返回 403，缺少邮箱返回 401。
6. 刷新页面并检查浏览器 Network 中 API 都走同一站点 `/api/v1/...`。

`/health` 只代表进程存活，不代表数据库、SSO、百炼、Blob 或 Databricks 可用；数据库检查和业务冒烟必须单独完成。

## 10. 日常运维

```bash
# 状态
sudo docker compose --env-file deploy/.env ps

# 实时日志（不要将包含业务信息的日志公开转发）
sudo docker compose --env-file deploy/.env logs --tail=200 -f app

# 重启，不重新构建
sudo docker compose --env-file deploy/.env restart app

# 停止
sudo docker compose --env-file deploy/.env stop app

# 启动已有容器
sudo docker compose --env-file deploy/.env start app
```

不要用 `docker compose down -v` 作为日常命令。当前 Compose 没有数据库卷，但该习惯在以后加入持久化组件时可能误删数据。

## 11. 升级

升级前记录旧的 commit、镜像 tag、数据库备份和当前迁移版本。然后：

```bash
cd /opt/shell-forecast
git fetch --prune origin
git checkout --detach NEW_RELEASE_COMMIT
git rev-parse HEAD
git status --short
```

把 `deploy/.env` 的 `IMAGE_TAG` 改为新 commit 的前 12 位。不要覆盖 `deploy/settings.toml`。随后：

```bash
sudo docker compose --env-file deploy/.env config --quiet
sudo docker compose --env-file deploy/.env build --pull app
sudo docker compose --env-file deploy/.env run --rm --no-deps app \
  python scripts/check_database.py
# 只有在发布说明明确要求且 DBA 已备份时，才执行 alembic upgrade head。
sudo docker compose --env-file deploy/.env up -d --no-build app
sudo docker compose --env-file deploy/.env ps
sudo docker compose --env-file deploy/.env logs --tail=200 app
```

再次执行第 9 节的验收。只修改 Python/前端源码后 `restart` 不会发布新代码，必须重新 build 并 `up -d`。

## 12. 回滚

应用回滚和数据库回滚分开处理。先确定数据库变更是否向后兼容；不要在未审查 downgrade SQL 和数据影响时自动执行 `alembic downgrade`。

应用镜像回滚：

```bash
cd /opt/shell-forecast
git checkout --detach PREVIOUS_RELEASE_COMMIT
# 将 deploy/.env 的 IMAGE_TAG 改回旧 tag；deploy/settings.toml 保持不变。
sudo docker compose --env-file deploy/.env up -d --no-build app
sudo docker compose --env-file deploy/.env ps
sudo docker compose --env-file deploy/.env logs --tail=200 app
```

前提是旧镜像仍保留在服务器。每次发布后至少保留当前和上一版镜像；确认新版本稳定后再人工清理更老的无用镜像。若数据库迁移与旧应用不兼容，应按事先验证的 DBA 恢复方案从备份恢复，而不是现场猜测 downgrade。

## 13. 正式投产前的未完成项

- 实现并验证企业 SSO，将可信身份映射到 `data.user_permissions`，再把 `APP_ENV` 切换为 `production`。
- 在入口反向代理或负载均衡上配置 HTTPS 证书、安全响应头、请求体限制和访问日志策略。
- 确认服务器、数据库及外部服务的防火墙白名单。
- 建立 PostgreSQL 备份、恢复演练和监控告警。
- 建立镜像仓库或可审计的制品传递方式，避免长期依赖服务器现场构建。
- 根据压测决定 `WEB_CONCURRENCY`；当前默认 2，不代表生产容量结论。
