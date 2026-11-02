# Portal JWT 第一层接入验证

日期：2026-11-02。分支 `feature/portal-jwt-resource-entry`，基于资源工具 `main` 的 `be22ec91376d8b2292e692c412fd6b5b017eaae9`。

本轮只实施 Portal → 资源投资工具接收端。Portal 现有改造作为对接方使用，没有修改其业务源码；Data Agent 下一层尚未实现。新能力默认关闭，未部署、未配置真实密钥、未执行真实数据库迁移。

## 自动化与独立复核

| 检查 | 结果 |
|---|---|
| 后端 `.venv/Scripts/python -m pytest -o addopts= -q` | **467 passed**；3 项原有依赖弃用警告 |
| 严格协议验签 | 上述全量包含 **95 项**，其中 **42 个 Portal 跨实现向量**全部通过 |
| 接收器 HTTP 测试 | 上述全量包含 **43 项**：格式、Origin、Cookie、CSRF、个人权限、轮换、过期、并发冲突、新旧入口隔离等 |
| 前端 `npm test` | **38 文件，178 passed** |
| 前端 `npm run build` | TypeScript + Vite 通过；原有 ExcelJS 大 chunk 提示保留 |
| 改动后端路径 Ruff、验签模块 mypy | 通过 |
| Alembic heads / 增量 PostgreSQL 离线 SQL | 单一 head `20261102_01`；仅生成两张新会话/上下文表 SQL，未连真实库 |
| SDK 来源 | vendored TypeScript 源码与现有 Portal SDK 一致；本地 file 依赖，无邻接目录依赖 |
| 独立复核 | 通过；已修复并发旧 Cookie 产生第二会话、删除用户后 UI 未及时失效问题 |

新 receiver 以独立 FastAPI 子应用替换其内部身份依赖；父应用旧 API 不受该 override 影响。已有 Insight 的内部权限查询与旧 HTTP 邮箱认证分离，原 production 邮箱拒绝行为保留。

## 实际 Chromium 联调

使用真实 Portal Java local-demo 签发、现有 Portal React 页面及浏览器 SDK，连接本轮 Python 接收器和资源工具构建产物。数据来自 `backend/tests/portal_browser_fixture.py` 的临时 SQLite，仅有合成 Alice/Bob。三个服务只绑定本机 loopback；共享密钥每次进程启动随机生成，未写入凭据文件或输出证据。

| 场景 | 观察到的结果 |
|---|---|
| Alice 登录 Portal 后打开资源工具 | `POST /portal-embed/login`，表单只有 assertion，URL 无票据；303 bootstrap；context/session 验证后 READY；工作台显示 `alice@example.invalid` |
| 新 API 注入 Bob 的 X-User-Email | 返回 Alice，注入不改变会话主体 |
| 旧 API 仅带浏览器现有新 Cookie | 401，不能借新 Cookie 登录旧 API |
| 新工作台 URL 加 Bob 邮箱、预置旧邮箱缓存、刷新 | 仍为 Alice；旧 `shell-resource-dev-email` sentinel 原样保留 |
| 同浏览器同时打开帆软旧入口 Alice、新 Portal Bob | 两侧业务 API 分别返回 Alice/Bob，旧缓存保持 Alice |
| Portal Alice 切换 Bob，继续请求原 Alice 实例 | 409 CONTEXT_INVALID；原标签页清除业务 UI，提示重新从 Portal 进入 |
| Bob 保存自己的草稿 | 200，真实 SQLite 事务成功 |
| Bob 写操作缺少 CSRF | 403 |
| Bob 尝试保存 Alice 草稿 | 404，不越权 |
| 工作台刷新及“跳至工作区” | 实例 hash 保留，可重新加载正确身份；新入口不显示 Agent 入口 |
| 原始数据 CSV 导出 | 下载成功，下载前实际调用新会话/权限校验接口 |
| 资源工具“退出工作台” | 新 Cookie 被删除；Portal 收到失效事件回到登录；旧帆软 Alice API 仍 200、邮箱缓存不变 |

截图：`output/playwright/portal-jwt-alice.png`、`portal-jwt-bob.png`、`portal-jwt-old-tab-denied.png`。本地 CLI 执行脚本及脱敏结果位于忽略的 `output/portal-jwt/`。证据未保存 JWT、Cookie 值、共享密钥或真实身份。

## 验收边界

- 通过的是**本地真实浏览器 + 合成账号/数据库**的端到端链路，以及旧入口机制回归。未进入真实帆软产品页面，未连接真实 SSO/FineDB/业务数据库。
- Cookie/CSP 在本机 HTTP 明确开启 loopback 的环境验证；实际 HTTPS 域名、企业浏览器第三方 Cookie 策略需要 UAT。生产配置 Secure=true、loopback=false，测试检查了这些配置约束。
- PostgreSQL 增量 DDL 只离线生成；SQLite 测试不等于 PostgreSQL 并发锁验收。发布前需要在受控 PostgreSQL 验证迁移和多进程行为。未执行 Docker 镜像构建或部署。
- 窗口内票据可重试（time_bound），不是一次性消费；关闭 Portal iframe 不等于注销下游。新退出接口撤销新会话，不影响帆软邮箱缓存。
- 同 Cookie 竞争返回受控 409；每会话最多保留 32 个实例，达到上限需退出重进或过期。配置/回滚细节见 [接入说明](../deploy/portal-jwt.md)。
