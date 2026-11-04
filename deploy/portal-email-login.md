# 临时帆软 Portal 邮箱免登

入口：`https://resource.digitalshell.com.cn/?user_email=lukx1%40digitalchina.com`

前端在首次加载工作台之前接收 `user_email`，去除首尾空格并转小写，建立当前标签页身份，然后清除地址栏中的该参数。有效邮箱会自动请求后端校验权限，有权限直接进入工作台；校验失败显示登录框和错误，邮箱仍为灰色只读，可点击“进入工作台”重试。无 `user_email`、空值、格式错误和重复参数都会清除旧身份，邮箱保持为空且登录按钮不可点击。Demo 模式不受影响。

继续使用现有 `X-User-Email` API 链路，由后端查询 PG `data.user_permissions`，仅允许启用且角色有效的用户进入。邮箱不在前端绑定角色。`lukx1@digitalchina.com` 在当前配置的 PG 中配置为 `admin`，原测试管理员保留。

部署沿用现有内部 UAT 的 `APP_ENV=development`，无需新增配置或表结构迁移。如果部署指向其他 PG，需在该库单独配置此邮箱的管理员权限。发布后用以上链接验证直接进入管理员页面，并验证刷新及未配置邮箱被拒绝。

这是用户指定的临时邮箱传递方案。手工输入可通过下述开关控制；无论是否开启，URL 参数和 `X-User-Email` 请求头均无法证明访问者已通过帆软认证。仅适用于当前受控内部测试入口；不等同于可信 SSO。现有 `production` 环境仍拒绝此类邮箱身份，后续正式接入需替换为可验证的认证凭据。

## 测试邮箱输入开关

服务器修改 `/opt/shell-forecast/deploy/.env` 中的一个配置：

```dotenv
# true：允许编辑邮箱、直接输入邮箱登录；false：灰色只读，仅接收 Portal 邮箱。
VITE_LOGIN_EMAIL_EDITABLE=true
```

未配置时默认 `false`。该值经 Compose/Dockerfile 在前端构建时注入，因此修改后需要重新构建发布，单纯 restart 不会生效：

```bash
cd /opt/shell-forecast
sudo bash deploy/deploy.sh --port 18080
```

本机开发使用 `frontend/.env.local` 中的同名配置并重启 Vite。两种模式均保留 Portal 带入邮箱后自动校验并进入工作台的行为；手工输入仅在提交时建立该标签页身份，后端继续检查用户权限。测试完成后把配置改回 `false` 并重新部署。

## 帆软工作台内打开 Data Agent（隔离 UAT）

首次点击“问数”时，浏览器向资源工具同源接口 `POST /api/v1/workbench/data-agent/launch` 发送空请求体，沿用工作台身份。资源工具后端检查当前邮箱的工作台权限和问数测试名单，向配置的 Data Agent 服务提交 `POST /api/yiaskAuth:issueUserToken`，请求体为 `{"email":"当前工作台邮箱"}`。厂商返回的用户邮箱与当前用户一致时，工作台才加载带票据的 `/admin/chat`。折叠再打开保留 iframe，点击“重新加载”会重新换票。

在资源工具服务器私有的 `deploy/settings.toml` 当前 UAT 配置段中设置下列字段。厂商须在同一测试环境为每个测试邮箱开通独立账号。API 密钥只存放在后端。

```toml
data_agent_base_url = "https://agent.example.invalid"
data_agent_api_token = "<资源工具专用的厂商 UAT API 密钥>"
data_agent_ingress_key = "<与受控入口共享的独立随机密钥，至少 32 字节 ASCII>"
data_agent_space = "default"
data_agent_uat_emails = ["tester@example.invalid"]
```

将样例域名替换为密钥所属的厂商 HTTPS origin。名单默认为空。前端和后端须随此分支一起更新。原有 `VITE_YIWEN_IFRAME_URL` 仅影响演示模式。Portal JWT 入口的配置见[独立说明](portal-data-agent.md)。

**入口身份。** 帆软旧入口使用的 `X-User-Email` 可由浏览器改写。访问名单只控制哪些测试账号能参与。换票接口另需受控入口核实当前登录人，并在代理这一个 POST 时覆盖两个请求头。将 `X-Resource-Verified-Email` 设为入口从认证会话中查到的邮箱，将 `X-Resource-Ingress-Key` 设为与资源工具后端共享的独立随机密钥。入口应清除客户端提供的同名头。复制浏览器传来的邮箱或仅检查 Referer 无法验证身份。两个密钥均应通过服务端密钥渠道提供，禁止进入前端或访问日志。

缺少可信入口配置时接口保持关闭。现有公共网关模板只做转发，部署到该入口前还需接好已认证用户到邮箱的绑定。在隔离 UAT 可由受控测试代理针对已认证的专用测试用户注入这两个头。`production` 继续拒绝旧邮箱工作台身份。
