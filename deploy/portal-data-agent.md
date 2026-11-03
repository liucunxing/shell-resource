# Portal 资源工具内嵌 Data Agent

本功能接在已有 Portal JWT 资源工具入口后。帆软原入口 `/?user_email=...`、原邮箱会话和原 Data Agent iframe 配置继续保留。Portal 入口不读取旧邮箱参数，也不使用旧 iframe 地址降级。

## 调用流程

1. Portal 使用原 JWT 接口启动资源工具，资源工具建立自己的受保护会话。
2. 用户首次打开资源工具中的“问数”时，资源工具先验证自己的会话，再通过 SDK 向 Portal 父页面请求。
3. Portal 父页面核对消息窗口、来源、实例与请求 ID，通过同源 Cookie/CSRF 调用原 `POST /api/data-agent/launch`，新增可选 `parentInstanceId`。
4. Portal 后端验证当前用户、父应用实例及双方权限，用已有 `DATA_AGENT_API_TOKEN` 调用厂商 `/api/yiaskAuth:issueUserToken`。用户邮箱来自 Portal 当前认证身份的可信 `profile.email`，厂商请求仅发送 `{email}`，返回 `user.email` 必须匹配。浏览器不能指定邮箱或用户名。
5. Portal 在上游返回后复查会话和权限，仅把当前用户的短期 iframe 地址回传给原实例。资源工具再次验证本地会话后显示 iframe。

这里的 Data Agent 用户票据由 Data Agent 签发；资源工具 JWT 不再次使用，资源工具也不保存厂商 API key。用户后续在 Data Agent 内的对话直接访问其服务。

## 配置位置

在 **Portal 后端**的部署环境/密钥管理中配置以下变量；本次没有修改任何环境或执行部署：

```dotenv
DATA_AGENT_BASE_URL=https://agent.example.invalid
DATA_AGENT_API_TOKEN=REPLACE_WITH_VENDOR_API_KEY
DATA_AGENT_APP_ID=data-agent
DATA_AGENT_RESOURCE_ID=home
DATA_AGENT_SPACE=default
DATA_AGENT_ALLOWED_PARENT_APP_IDS=resource-investment
```

已取消 `DATA_AGENT_IDENTITY_MAP_JSON` username 映射。单用户本地测试需显式设置 Portal 的 `PORTAL_DEMO_EMAIL`；正式环境使用批准的身份邮箱资料，不从浏览器参数或用户名推断。资源工具桥协议和前端无需增加 email 参数。

`DATA_AGENT_ALLOWED_PARENT_APP_IDS` 是新增的嵌套父应用白名单，默认空值禁用第二层；现有 Portal 直接 Data Agent 入口仍可用。父应用须已注册、启用且具备对应资源权限；目标应用/资源权限也须配置。`DATA_AGENT_REFERER` 延续原接口约定，必要时按厂商要求设置。

资源工具无需新增厂商密钥。需要同时交付本次 Portal 后端、Portal 前端/SDK、资源工具前端及其 vendored SDK；这些是配套 feature 改动。原第一层配置见 [portal-jwt.md](portal-jwt.md)。

## 浏览器与运维边界

- 新桥协议为独立的 `portal-data-agent` 1.0，不改变 `portal-embed` JWT 协议。Data Agent 地址只允许 HTTPS、固定 `/admin/chat` 和约定查询参数。
- 首次打开才换票；折叠/切换聊天面板保留已有 iframe；重新加载获取新票据。退出、取消或上下文变更后丢弃晚到响应。
- 票据只在内存和厂商要求的 iframe URL 中出现，不写浏览器 storage、应用日志或独立打开链接。厂商及相关网关的访问日志需避免记录 token 查询参数。
- 厂商 CSP `frame-ancestors` 必须同时允许 Portal、资源工具两级祖先；两边网关也不得通过 CSP/X-Frame-Options 阻断。实际第三方 Cookie、厂商会话及权限范围需要真实环境验收。
- iframe 加载不代表厂商登录或业务权限验证成功，界面仅提示已获取访问凭证。
- 回退第二层可先清空父应用白名单，再回退配套前端版本。帆软旧入口配置保持原样。未调用真实库、SSO 或厂商接口不影响合成环境测试，但不能据此宣称生产联调通过。

## 测试

Java API 测试覆盖父实例/当前会话/权限和换票期间变更；SDK 测试覆盖伪造消息、重复请求、并发上限、取消/超时及异常 URL；资源工具测试覆盖会话前后校验、首次加载/折叠/重试及帆软回归。

浏览器验收使用 `backend/tests/portal_browser_fixture.py` 的隔离 SQLite 合成用户，加 `backend/tests/data_agent_browser_fixture.py` 的本地 HTTPS 厂商替身。替身明确显示 synthetic 标记，token 随机生成且不打印。它证明三层调用及身份映射契约，不证明真实厂商授权。

结果见 [本次验证记录](../docs/portal-data-agent-20261102/validation.md)。
