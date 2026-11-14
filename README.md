# 资源投资工作台 V19 工程迭代

本轮基于 `origin/feature_11_11_cx`（`6e70ba5`）与 2026-11-14 最新 V19 原型更新。
支持独立规划版本、Owner 三步拆分与提交冻结、部门齐交确认/撤回/定向退回、管理层已确认组合、
来源版本与 SD/RSM 对比，以及人员归属和历史费用权限配置。实现范围、验证证据与边界见
[V19 工程验收记录](docs/V19_VALIDATION.md)。

> 服务器发布、重启、健康检查、日志和证书续期，请先阅读 [服务器运维手册](docs/SERVER_OPERATIONS.md)。

Quick Win 一期：年度预算分配、其他预算、Excel 回传、草稿保存、同步快照、角色范围查询、管理员配置和百炼六点 Insight。复用现有 React 页面，后端使用 FastAPI + PostgreSQL；同一应用站点可提供前端静态文件和 API。

```text
frontend/   React + Vite，默认连接 API；demo 模式独立
backend/    Controller → Service → Repository → DO
docs/       本期业务契约和协作说明
```

正式数据保存在 PostgreSQL `data` schema。整项草稿保存使用事务和修订号；不平衡草稿可保存，提交时必须平衡。管理层只读取部门已确认的提交快照；撤回确认保留 Owner 已提交状态，定向退回后才允许编辑。

## 开发与运行

1. 按 [后端说明](backend/README.md) 安装、填写本地配置并核对数据库结构。
2. 在 `frontend` 执行 `npm ci`、`npm run build`。
3. 在 `backend` 启动 Uvicorn，配置 `serve_frontend = true` 后访问 `http://127.0.0.1:8000/`。
4. 通过现有 Portal 邮箱入口或配置的 JWT 入口建立身份。后台逐请求读取 `data.user_permissions` 并校验角色与业务范围。

前后端接口联调只维护 [接口文档](backend/docs/接口文档.md)。前端开发、独立演示模式见 [前端说明](frontend/README.md)。

管理员可从“管理后台 → 人员与权限”模拟查看不同用户的只读视角，操作与验证范围见 [管理员模拟用户视角](docs/ADMIN_USER_PREVIEW.md)。

Portal JWT 独立入口的配置、迁移、联调与回滚见 [Portal 接入说明](deploy/portal-jwt.md)。该能力默认关闭，现有帆软 URL 邮箱入口保留；本轮仅接入资源工具。

V19 本地试用：编译前端后，在 `backend` 使用已安装项目依赖的 Python 执行
`python -m uvicorn tests.v19_browser_fixture:app --app-dir src --host 127.0.0.1 --port 8019`，
访问 `http://127.0.0.1:8019/?user_email=owner-a@example.test`。
独立 SQLite 仅保存合成数据；其他角色入口和验证证据见 [V19 工程验收记录](docs/V19_VALIDATION.md)。

## 本地密钥

在已被 Git 忽略的 `backend/config/settings.toml` 的 `[development]` 段填写 `ai_api_key`、`ai_base_url`、`ai_model`，默认模型 `qwen-plus`。Base URL 使用百炼控制台给出的兼容地址。数据库连接和存储密钥也仅保存在该文件；修改后重启后端。不要把密钥放进前端 `VITE_*` 配置。

## 交付边界

当前开发身份使用 `X-User-Email`；`production` 环境明确拒绝此身份方式，可信登录接入仍是正式上线前的必要工作。Tracking、小 One 真实问数、审批和实时协同不在一期范围。

2026-11-14 19:50（+08:00）已将远端 PostgreSQL `resource_dev` 升级到 `20261114_03`，
原有业务值核对一致；31 项 PG 隔离验收及四角色真实库只读接口检查通过。
20 个历史用户的所属 Sector/Department 需按真实归属配置，未配置时不展示费用明细。
应用服务器尚未部署，真实 SSO、AI 调用和业务 UAT 尚待验证。
迁移演练、执行方式与证据见 [V19 工程验收记录](docs/V19_VALIDATION.md)。

## Docker 单机部署

`Dockerfile` 会先构建前端，再把静态文件与 FastAPI 后端放入同一个非 root 运行容器；`compose.yaml` 负责配置、健康检查、端口和自动重启。服务器部署、数据库初始化、升级、验收与回滚步骤见 [Docker 部署手册](docs/DOCKER_DEPLOYMENT.md)。

首次执行 `sudo bash deploy/deploy.sh --init` 并填写 `deploy/settings.toml`，之后执行 `sudo bash deploy/deploy.sh --port 18080` 一键构建和启动。脚本实时输出 8 个阶段，失败立即停止；完整日志保存在 `logs/deploy/`。本项目仅监听服务器本机地址，公网 HTTPS 由共享网关处理。

同一台服务器的多个平台通过 [共享 HTTPS 网关操作手册](docs/SHARED_GATEWAY.md) 接入；网关独占 80/443，证书保留在服务器 `/opt/digitalshell-gateway/certs/`，不进入 Git 或镜像。
