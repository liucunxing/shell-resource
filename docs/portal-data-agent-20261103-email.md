# 资源工具内部 Data Agent 邮箱免登验证

2026-11-03，配套 Portal 后端切换为 email 交换。资源工具继续使用现有第二层消息桥，不发送身份参数，也不保存厂商 API key。此 feature 需要配套更新 Portal `main` 后端（`fc07d18`）。

## 实际验证

以用户指定的 `lukxa@digitalchina.com` 登录 Portal，本机 JWT 接收端和临时 SQLite 资源夹具接受该邮箱，打开工作台并点击“问数”。

- Portal 收到的浏览器请求仅含 `parentInstanceId`、`question`，未传 email/username。
- Portal 后端以认证用户可信 `profile.email` 调用真实 Data Agent，校验返回 `user.email` 一致，返回 HTTP 200。
- 资源工具内嵌真实 `https://dataai.digitalshell.com.cn/admin/chat` 页面，显示 Nora / DataAgent 辅助决策平台，无需再次登录。
- 前端 39 个测试文件、199 项测试通过；TypeScript/Vite 构建通过。

截图位于忽略的 `output/playwright/resource-email-20261103-loaded.png`，不含 URL Token。凭据和会话不进入 Git。

## 配置变化与边界

移除 Portal 的 `DATA_AGENT_IDENTITY_MAP_JSON`；本地单用户模式显式配置 `PORTAL_DEMO_EMAIL`。资源工具现有桥代码已兼容，无需增加邮箱请求字段。父应用白名单和双方权限继续检查。

资源工作台预算和权限来自隔离 SQLite 测试夹具，仅测试邮箱按本次授权设置；真实 Data Agent 换票及页面加载已验证。未修改真实资源权限或业务数据，未发送业务问题、未验收数据问答准确性、未部署生产环境。帆软旧入口不在本次真实 email 联调范围。
