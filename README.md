# 资源投资工作台 V1.4

Quick Win 一期：年度预算分配、其他预算、Excel 回传、草稿保存、同步快照、角色范围查询、管理员配置和百炼六点 Insight。复用现有 React 页面，后端使用 FastAPI + PostgreSQL；同一应用站点可提供前端静态文件和 API。

```text
frontend/   React + Vite，默认连接 API；demo 模式独立
backend/    Controller → Service → Repository → DO
docs/       本期业务契约和协作说明
```

正式数据保存在 PostgreSQL `data` schema。整项草稿保存使用事务和修订号；不平衡草稿可保存，同步时必须平衡。管理层读取每项最新同步快照，后续草稿修改不会改写快照。

## 开发与运行

1. 按 [后端说明](backend/README.md) 安装、填写本地配置并核对数据库结构。
2. 在 `frontend` 执行 `npm ci`、`npm run build`。
3. 在 `backend` 启动 Uvicorn，配置 `serve_frontend = true` 后访问 `http://127.0.0.1:8000/`。
4. 开发环境在页面输入已配置权限的邮箱。后台逐请求读取 `data.user_permissions`，再在 SQL 查询中过滤范围。

前后端接口联调只维护 [接口文档](backend/docs/接口文档.md)。前端开发、独立演示模式见 [前端说明](frontend/README.md)。

按当前约定先本地试用：在 `backend` 执行 `.\.venv\Scripts\python.exe -m uvicorn tests.browser_fixture:app --app-dir src --host 127.0.0.1 --port 8014`，访问 `http://127.0.0.1:8014/`，使用 `owner-a@example.test` 登录。合成数据会保存在本地 SQLite；页面可切换开发邮箱。角色账号和配置见后端说明，验证证据见 [本地验收记录](docs/quickwin-validation.md)。

## 本地密钥

在已被 Git 忽略的 `backend/config/settings.toml` 的 `[development]` 段填写 `ai_api_key`、`ai_base_url`、`ai_model`，默认模型 `qwen-plus`。Base URL 使用百炼控制台给出的兼容地址。数据库连接和存储密钥也仅保存在该文件；修改后重启后端。不要把密钥放进前端 `VITE_*` 配置。

## 交付边界

当前开发身份使用 `X-User-Email`；`production` 环境明确拒绝此身份方式，可信登录接入仍是正式上线前的必要工作。Tracking、小 One 真实问数、审批和实时协同不在一期范围。

本机 PostgreSQL 5432 访问超时，尚未核对或执行远端增量 SQL；真实百炼调用需要填写 key 和地址。自动化测试与本地合成数据验证不能替代这两项外部联调。增量脚本和检查命令见后端说明。
