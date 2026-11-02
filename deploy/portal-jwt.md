# Portal → 资源投资工具 JWT 接入

日期：2026-11-02。分支：`feature/portal-jwt-resource-entry`。

本次实现 `portal-embed/1.0` 第一层接入：Portal 签发 → 资源工具独立登录 → 会话校验 → SDK READY → 资源工作台。Data Agent 下一层留待后续；新 Portal 页面不使用旧的邮箱 URL 启动 Data Agent，帆软入口原有行为保留。

## 双入口与身份

| 内容 | 原帆软 | 新 Portal |
|---|---|---|
| 页面 | `/?user_email=...` | `/portal-embed/workbench#portal-instance=<UUID>` |
| 登录 | 原邮箱初始化 | `POST /portal-embed/login`，唯一表单字段 `assertion` |
| API | `/api/v1/workbench/**` | `/portal-embed/api/v1/workbench/**` |
| 身份 | 原 `X-User-Email` 机制 | 验签后创建的服务端会话，逐次检查本地个人权限 |
| 浏览器状态 | 原 `shell-resource-dev-email` | HttpOnly `RESOURCE_PORTAL_SESSION`，Path=`/portal-embed` |

新页面不读取、写入或清除旧邮箱缓存；新 API 不使用 URL/请求头邮箱；旧 API 不读取新 Cookie。新功能默认关闭，失败不回退旧鉴权。新入口强制连接 API，不会落到前端 demo 身份。

使用持久数据库会话及按实例存储的上下文；Cookie 只含随机凭据，数据库保存凭据哈希，不保存 JWT。每次登录轮换凭据，同用户多实例保留，换账号清理旧上下文。所有新业务请求须同时带 Cookie 和 `X-Portal-Instance`；ID 单独不能登录。旧标签页持旧实例时被拒绝，避免共享 Cookie 后静默变成新账号。

同一旧 Cookie 并发启动时，已失效凭据返回 `409 CONTEXT_INVALID`，不覆盖先完成请求的 Cookie；应使用浏览器当前 Cookie 重新从 Portal 打开，不承诺每个并发启动都成功。每会话最多保留 32 个实例；关闭 iframe 不删除接收端上下文，达到上限需退出再进入或等待会话过期。若 Set-Cookie 在传输中丢失，需等待浏览器旧 Cookie 过期或由用户清理该新入口 Cookie 后重新进入，不能回退邮箱登录。

UUID fragment 用于刷新恢复当前实例，不含 JWT 或邮箱。新标签页应保留该 fragment 或从 Portal 重新启动。不同 Portal 账号无法通过同一 Cookie 同时保持登录。帆软 A / Portal B 可以同时使用。

## 两端配置

将下列项填入资源工具**当前使用的**私有 `backend/config/settings.toml` / 部署时 `deploy/settings.toml` 对应段。不要为了本次功能改变 `APP_ENV`。本项目 Compose 直接挂载私有 settings 文件；不会把 `deploy/.env` 中任意新变量自动传给容器。

```toml
resource_portal_enabled = true
resource_portal_issuer = "https://portal.example.invalid" # 改为真实 Portal issuer
resource_portal_origin = "https://resource.digitalshell.com.cn"
resource_portal_parent_origins = ["https://portal.example.invalid"] # 改为真实前端 origin
resource_portal_app_id = "resource-investment" # Plan C 改为实际 managed_record.id
resource_portal_audience = "resource-investment"
resource_portal_kid = "resource-investment-01"
resource_portal_key = "<标准 Base64 编码的独立共享密钥>"
resource_portal_cookie_secure = true
resource_portal_cookie_samesite = "lax"
resource_portal_allow_loopback_http = false
resource_portal_session_ttl_seconds = 1800
```

也支持同名大写 `RESOURCE_PORTAL_*` 进程环境变量覆盖；`RESOURCE_PORTAL_PARENT_ORIGINS` 用逗号分隔 origin。示例中的 `.invalid` 必须替换。Portal 后端的 `PORTAL_KEY_RESOURCE_INVESTMENT` 与资源工具 `resource_portal_key` 必须 Base64 解码为相同的 32–128 字节；独立于其他应用和环境，不进前端或 Git。缺失/非法配置在启用时拒绝启动。

Portal 已完成的配置使用 `/portal-embed/login`、audience `resource-investment`、kid `resource-investment-01`、resource `home` → `/portal-embed/workbench`，required `claims.email`。Plan C 的 appId 使用真实管理记录 ID，receiver 的 appId 必须匹配；资源工具不从未验签票据动态选择信任配置。

可信邮箱映射到现有 `data.user_permissions` 个人账号，JWT `sub` 与邮箱固定在该会话；不自动建用户、不接受 JWT 角色/部门作为权限。本地 role/department/sector 决定业务范围。停用、删除或权限配置变化会在后续受保护请求中被拒绝，需重新从 Portal 进入。

## 数据库与部署

新增 Alembic revision `20261102_01`，仅创建 `data.portal_embed_sessions` 和 `data.portal_embed_contexts`。上线前按现有数据库发布流程审核、备份并执行 `alembic upgrade head`。本次开发测试不连接、不迁移真实数据库。

会话保存在数据库，可由多个应用进程共享；不依赖单进程内存。应用更新需两端协调密钥、时钟、TTL 和 Cookie 策略。票据 TTL 60 秒、容差 5 秒，采用 `time_bound`，有效窗口内允许重试；会话有独立过期时间，注销密钥不等于注销已建立的会话。

后端提供 bootstrap/workbench 的精确页面路由，其他静态资源仍由现有站点提供。现有网关 `location /` 已转发新增路径，无需替换旧帆软 location。代理必须保留 Origin；新路由的 CSP frame-ancestors 仅允许配置的 Portal 祖先，旧路径响应不变。若外层网关另加 X-Frame-Options/CSP，需要核对实际响应头，保留旧帆软所需来源。

同站 HTTPS 可按部署选择 Lax；跨站 iframe 通常需要 `none` + Secure，但第三方 Cookie 禁用仍可能阻止会话。应在实际企业浏览器验证。Cookie Path 用于发送范围隔离，不能隔离同源不可信脚本。

新增业务写操作和退出要求 `X-Portal-CSRF` 与精确资源工具 Origin；登录 POST 使用专门的父 Origin + JWT 校验。仅关闭 Portal iframe 不会注销资源工具会话；新入口退出只注销新会话，旧邮箱缓存保留。

## 本地测试

```powershell
# 在 backend 执行；测试固定选择无凭据 test profile
.\.venv\Scripts\python.exe -m pytest

# 在 frontend 执行；SDK 来源随仓库交付，无外部相邻目录依赖
npm.cmd ci
npm.cmd test
npm.cmd run build
```

真实浏览器本地夹具为 `backend/tests/portal_browser_fixture.py`，仅生成临时 SQLite、Alice/Bob 合成账号和预算；不读取开发 settings，不调用真实 AI、Databricks 或帆软库。Portal 使用其已实现的 local-demo 双账号模式。

本地 HTTP 双端显式启用 loopback 测试：资源后端 `RESOURCE_PORTAL_ALLOW_LOOPBACK_HTTP=true`、`RESOURCE_PORTAL_COOKIE_SECURE=false`；资源前端构建 `VITE_PORTAL_ALLOW_LOOPBACK_HTTP=true`。两端 issuer、前端 Origin、资源 origin 和随机共享密钥需一致。生产构建移除前端 loopback 开关；后端 production 禁止 loopback。

启动资源夹具：设置进程配置后，在 backend 运行 `python -m uvicorn tests.portal_browser_fixture:app --app-dir src --host 127.0.0.1 --port 18184`。先完成前端构建。夹具退出后删除临时 SQLite；它不用于部署。

测试证据和验收范围见 [本轮验证记录](../docs/portal-jwt-validation-20261102.md)。本地真实浏览器结果不能替代真实域名/SSO/权限库的 UAT。

## 回滚

先在 Portal 停用新 JWT 启动或恢复上一发布配置，再设置资源工具 `resource_portal_enabled=false` 并重启。保留新表以便平稳回滚；必要时按数据库流程仅清理新会话。不得清除旧邮箱存储、改变旧 API 或更改 APP_ENV。密钥撤销和已建立会话撤销分别处理。
