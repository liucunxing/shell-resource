# 临时帆软 Portal 邮箱免登

示例入口格式：`https://resource.digitalshell.com.cn/?user_email=example.user02%40example.invalid`

示例邮箱仅用于说明参数格式，不是可用于线上登录的账号。实际用户须由管理员在对应环境的权限表中配置，并按职责授予角色和数据范围。

前端在首次加载工作台之前接收 `user_email`，去除首尾空格并转小写，建立当前标签页身份，然后清除地址栏中的该参数。有效邮箱会自动请求后端校验权限，有权限直接进入工作台；校验失败显示登录框和错误，邮箱仍为灰色只读，可点击“进入工作台”重试。无 `user_email`、空值、格式错误和重复参数都会清除旧身份，邮箱保持为空且登录按钮不可点击。Demo 模式不受影响。

继续使用现有 `X-User-Email` API 链路，由后端查询 PG `data.user_permissions`，仅允许启用且角色有效的用户进入。邮箱不在前端绑定角色；本文不声明示例邮箱已在任何环境中获得权限。

部署沿用现有内部 UAT 的 `APP_ENV=development`，无需新增配置或表结构迁移。如果部署指向其他 PG，需在该库配置实际用户所需的权限。发布后用已授权的实际测试账号替换示例邮箱，验证其权限对应的页面、刷新行为及未配置邮箱被拒绝。

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

本版已移除旧右侧 Data Agent 嵌入模块；本文保留的邮箱登录和 Portal 认证不受影响。
