# 临时帆软 Portal 邮箱免登

入口：`http://resource.digitalshell.com.cn:18080/?user_email=lukx1%40digitalchina.com`

前端在首次加载工作台之前接收 `user_email`，去除首尾空格并转小写，覆盖当前标签页保存的邮箱，然后清除地址栏中的该参数。刷新继续使用当前标签页身份。空值、格式错误和重复参数会清除旧身份，避免进入上一个用户的账号。无参数访问保留原登录流程，Demo 模式不受影响。

继续使用现有 `X-User-Email` API 链路，由后端查询 PG `data.user_permissions`，仅允许启用且角色有效的用户进入。邮箱不在前端绑定角色。`lukx1@digitalchina.com` 在当前配置的 PG 中配置为 `admin`，原测试管理员保留。

部署沿用现有内部 UAT 的 `APP_ENV=development`，无需新增配置或表结构迁移。如果部署指向其他 PG，需在该库单独配置此邮箱的管理员权限。发布后用以上链接验证直接进入管理员页面，并验证刷新及未配置邮箱被拒绝。

这是用户指定的临时邮箱传递方案，URL 邮箱可被修改，无法证明访问者已通过帆软认证。仅适用于当前受控内部测试入口；不等同于可信 SSO。现有 `production` 环境仍拒绝此类邮箱身份，后续正式接入需替换为可验证的认证凭据。

## Data Agent iframe

“小One问数Agent”入口嵌入 `https://dataaitest.digitalshell.com.cn/`。前端使用后端返回的当前用户 `identity.email`，自动生成 `?user_email=lukx1%40digitalchina.com`；iframe 与“独立打开”使用同一个地址。不会透传角色、Token 或业务数据。

首次打开才加载 iframe，切换参考/Insight 或收起后保留页面；切换用户重新建立 iframe，重新加载按钮只刷新该 iframe。

Docker/Compose 构建默认接入上述地址，`VITE_YIWEN_IFRAME_URL` 可覆盖；已有部署配置若仍是空值，Compose 使用该默认值。地址在构建时注入，发布需重新构建前端镜像。本机开发可复制 `frontend/.env.example` 为 `.env.local`。远程地址必须使用 HTTPS，仅 localhost、127.0.0.1 和 [::1] 放行 HTTP 调试。

2026-10-12 本地验证：前端 92 项测试、9 项部署脚本测试及构建通过；真实浏览器确认邮箱 URL、首次打开加载、Tab/收起保留、重新加载及切换账号。远端入口返回 HTTP 200，未返回 X-Frame-Options / CSP 限制；Data Agent 加载较慢，独立打开携带邮箱后最终跳转至 `/signin?redirect=/admin` 并要求用户名和密码。因此本应用的邮箱透传已完成，但 Data Agent 对端免登尚未打通，需对端接收 `user_email` 并配置对应账号映射。iframe 的 load 事件不代表认证成功。
