# Docker Nginx HTTPS 发布操作手册

目标：把 `http://resource.digitalshell.com.cn:18080/` 改为 `https://resource.digitalshell.com.cn/`。
在现有 ECS 上运行两个 Compose 服务：`app` 和 `nginx`；不安装主机 Nginx，不新增负载均衡，不迁移数据库。

```text
浏览器 HTTPS :443 → nginx 容器 :443 → app 容器 :8000
浏览器 HTTP :80  → 301 跳转到 HTTPS
主机 127.0.0.1:18080 → app 容器 :8000（仅本机诊断）
```

## 1. 证书检查结果与待确认条件

2026-10-12 本地检查运维提供的 `digitalshell.com.cn_nginx.zip`：

- SAN 包含 `*.digitalshell.com.cn` 与 `digitalshell.com.cn`，覆盖目标子域名。
- 证书与 ZIP 内私钥的公钥匹配。
- 证书有效期截止 UTC `2026-11-26 23:59:59`，即北京时间 **2026-11-27 07:59:59**；到期前需向运维取得续期证书。此脚本不自动申请证书。
- ZIP 内证书文件为 `digitalshell.com.cn_nginx/digitalshell.com.cn_bundle.pem`，私钥为 `digitalshell.com.cn_nginx/digitalshell.com.cn.key`。

仍需在目标环境确认：域名 A 记录指向 `47.117.67.109`、不存在错误的 AAAA 记录；云安全组放行 TCP 443（HTTPS）和 80（HTTP 跳转）；服务器上 80/443 没有其他服务占用。
没有安全组管理权限时仍需要云账号管理员放行端口。安装 Nginx 无法改变云安全组。

## 2. 本地推送 main

本次允许提交的完整列表（已有文件修改 + 新文件）：

```text
.gitignore
.dockerignore
compose.yaml
README.md
deploy/.env.example
deploy/deploy.sh
deploy/https.sh
deploy/https_config.py
deploy/nginx/default.conf.template
deploy/tests/test_deploy.py
deploy/tests/test_https.py
docs/DOCKER_DEPLOYMENT.md
docs/HTTPS.md
```

之前未跟踪的主机安装脚本 `deploy/install-https.sh`、模板 `deploy/nginx/resource.conf.template` 已删除；旧的 `docs/HTTPS.md` 已重写为本手册。
不要提交 ZIP、证书、私钥、真实 `.env`、`settings.toml`、`deploy/certs/`、`deploy/backups/`。

本地 PowerShell：

```powershell
cd D:\work\Develop\shell-forecast
git status --short
git diff --check
git add .gitignore .dockerignore compose.yaml README.md deploy/.env.example deploy/deploy.sh deploy/https.sh deploy/https_config.py deploy/nginx/default.conf.template deploy/tests/test_deploy.py deploy/tests/test_https.py docs/DOCKER_DEPLOYMENT.md docs/HTTPS.md
git diff --cached --stat
git commit -m "feat(deploy): add Docker Nginx HTTPS entrypoint"
git push origin main
```

执行前确认自己在 `main`，且暂存区没有其他人的改动。以上命令不会自动合并业务变更。

## 3. 上传证书 ZIP（本地 PowerShell）

```powershell
scp -i "C:\Users\Lenovo\Desktop\id_ed25519" "C:\Users\Lenovo\Desktop\digitalshell.com.cn_nginx.zip" ecs-user@47.117.67.109:/home/ecs-user/
```

ZIP 包含私钥，请保留在受控位置。不要上传到仓库、发送聊天明文、放进 Docker 构建上下文。

## 4. 服务器拉取最新 main

在当前 SSH 终端执行：

```bash
cd /opt/shell-forecast
git status --short
```

必须没有输出；有输出时先保留、核对服务器本地改动，不要执行强制重置。
备份当前版本和实际配置（需要 sudo，因为 `.env` 权限为 600）：

```bash
PREVIOUS_RELEASE=$(git rev-parse HEAD)
sudo mkdir -p deploy/backups
sudo chmod 700 deploy/backups
sudo cp -pn deploy/.env deploy/backups/pre-https.env
sudo cp -pn deploy/settings.toml deploy/backups/pre-https.settings.toml
printf '%s\n' "$PREVIOUS_RELEASE"

git fetch --prune origin
git log --oneline HEAD..origin/main
git diff --name-only HEAD..origin/main -- backend/migrations
git checkout --detach origin/main
git rev-parse --short=12 HEAD
```

本次部署文件变更没有数据库迁移。若期间 main 另有业务变更并出现迁移文件，应先核对迁移。
`deploy/.env` 和 `deploy/settings.toml` 为忽略文件，拉代码不会覆盖实际数据库、AI、Databricks 设置。

## 5. 发布应用代码

```bash
sudo bash deploy/deploy.sh --port 18080
```

首次启用前尚未设置 HTTPS profile，此命令沿用原 HTTP 发布方式。
如果刚刚发布过同一业务版本且仅切换 HTTPS，这一步可以省略：后面的 HTTPS 脚本会继续使用 `.env` 的当前 IMAGE_TAG，不重新构建应用。
不要执行 `docker compose down`，无需提前停止应用。

## 6. 一键启用 Docker HTTPS

```bash
sudo chmod 600 /home/ecs-user/digitalshell.com.cn_nginx.zip

sudo bash deploy/https.sh --cert-zip /home/ecs-user/digitalshell.com.cn_nginx.zip
```

无需手动解压，也无需手工编写 Nginx 配置。脚本只读取 ZIP 内唯一的 `*_bundle.pem` 和 `*.key`，校验后安装为：

```text
deploy/certs/fullchain.pem
deploy/certs/private.key
```

脚本会完成八个带时间戳的阶段：检查工具/Compose → 验证导入证书 → 检查入口端口 → 准备 Nginx 镜像 → 临时容器 nginx -t → 保存 HTTPS 配置 → 更新并等待两个容器健康 → 校验本机 HTTPS 证书链、健康接口、首页。
完整日志在 `logs/deploy/https-时间戳-PID.log`，任何阶段出错会停止并提示行号。

Nginx 使用官方固定版本镜像 `nginx:1.30.5-alpine`，首次须下载；已有该镜像时不重复拉取。
若镜像仓库网络错误，可稍后重试同一命令；不要更换为不明来源镜像或清空 Docker 数据。

脚本自动更新服务器 `deploy/.env`：

```dotenv
COMPOSE_PROFILES=https
APP_BIND_ADDRESS=127.0.0.1
```

保留原 `APP_PORT=18080`、`IMAGE_TAG`、业务环境、UID/GID及所有现有配置。
下面的值不在旧 `.env` 中也有 Compose 默认值，无需手动添加：

```dotenv
HTTPS_DOMAIN=resource.digitalshell.com.cn
HTTP_PORT=80
HTTPS_PORT=443
HTTPS_BIND_ADDRESS=0.0.0.0
NGINX_IMAGE=nginx:1.30.5-alpine
```

Nginx 模板已经写好，直接只读挂载进容器；实际证书目录也只读挂载，不会烘焙进镜像。挂载配置包含 SELinux 的共享标签，仅标记这两个项目路径，允许临时校验容器与正式 Nginx 容器读取，不关闭 SELinux。
切换会重新创建 app 的端口映射，短暂中断；之后公网原来的 `:18080` 将不可用，本机诊断仍可用。
如 shell 里设置过 APP_BIND_ADDRESS、COMPOSE_PROFILES 或 IMAGE_TAG，会覆盖 dotenv 值，请取消后重试。

## 7. 公网访问验证与防火墙

在本地 PowerShell：

```powershell
Resolve-DnsName resource.digitalshell.com.cn
Test-NetConnection resource.digitalshell.com.cn -Port 443
curl.exe --fail https://resource.digitalshell.com.cn/health
```

浏览器访问 `https://resource.digitalshell.com.cn/`，确认没有证书警告，并测试登录、页面、API 和文件上传。
只有 HTTP 健康或本机 HTTPS 成功，并不能证明云安全组、公网 DNS、防火墙正确。

DNS 异常时可以绕过解析，验证真实公网入口（仍校验证书）：

```powershell
curl.exe --fail --noproxy "*" --resolve resource.digitalshell.com.cn:443:47.117.67.109 https://resource.digitalshell.com.cn/health
```

若服务器 firewalld 正在运行，按当前服务器的网络策略放行：

```bash
sudo firewall-cmd --state
sudo firewall-cmd --permanent --add-service=https
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

没有该服务时无需额外安装；Docker 端口映射的实际访问也取决于 Docker 自身防火墙规则。
公网安全组再移除不需要的 18080 规则。脚本不自动修改防火墙或安全组。

## 8. 日志、后续更新与重启

```bash
sudo docker compose --env-file deploy/.env ps
sudo docker compose --env-file deploy/.env logs --tail=100 -f nginx app
sudo bash deploy/https.sh --verify
```

Nginx 访问日志和错误日志输出到容器日志。Ctrl+C 仅结束日志跟踪。

后续更新：

```bash
cd /opt/shell-forecast
git status --short
git fetch --prune origin
git log --oneline HEAD..origin/main
git diff --name-only HEAD..origin/main -- backend/migrations
git checkout --detach origin/main
sudo bash deploy/deploy.sh --port 18080
```

启用后的部署脚本自动检查证书、Nginx 配置，更新 app/nginx，并在最后校验 HTTPS。
无需再手工安装 Nginx或重做证书。Nginx 通过 Docker DNS 动态解析 app，app 容器更新后无需修改 upstream IP。

仅重启：

```bash
sudo docker compose --env-file deploy/.env restart app nginx
sudo bash deploy/https.sh --verify
```

配置或端口映射变更需要 `up -d` 重新创建，单纯 restart 不会应用新的 Compose 配置。

## 9. 回滚、证书续期及应用限制

第一次切换失败，需要恢复原公开 HTTP 时：

```bash
sudo docker compose --env-file deploy/.env --profile https stop nginx
sudo cp -p deploy/backups/pre-https.env deploy/.env
sudo docker compose --env-file deploy/.env up -d --no-build --force-recreate app
curl --fail http://127.0.0.1:18080/health
```

该 `.env` 保存了切换前的镜像标签，所以回滚可直接使用旧镜像，无需访问镜像仓库或构建。请暂时保留旧镜像，不要 prune。
若要回滚业务代码，另行检出此前记录的提交；Docker 端口/镜像回滚不需要清空数据库。

每次启用/续期会在 `deploy/backups/https-时间戳-PID/` 保存旧 `.env` 和已有 certs。恢复旧证书时，需复制这个备份下的 `certs` 文件回当前 `deploy/certs` 并重启 nginx；不得在生产随意回滚到过期证书。

续期：从运维取得新的同格式 ZIP，再执行 `https.sh --cert-zip 新ZIP路径`。
脚本检查有效期、域名、证书与私钥匹配；不会在日志中输出私钥。不要覆盖共享证书的其他服务。

**Data Agent iframe**：当前默认 `http://dataaitest.digitalshell.com.cn:3052/`，HTTPS 主站会拦截 HTTP iframe。需要该服务实际提供 HTTPS，再把服务器 `.env` 的 `VITE_YIWEN_IFRAME_URL` 改成验证过的 HTTPS 地址，重新运行 deploy.sh 构建前端。不要仅替换协议文字，也不要开启浏览器不安全内容绕过。

若门户/SSO 使用绝对回调地址，应将它们更新为 HTTPS 并登记到身份平台；现有相对 API 地址无需改动。
Nginx 终止 TLS，后端仍走 Docker 内部 HTTP；HTTPS 本身不改变当前 UAT 的认证方式。

## 10. 验证边界

本地可验证证书包、Compose 配置解析、Bash 语法、脚本控制流程和配置更新。
目标 ECS 的镜像拉取、容器 Nginx 配置检查、信任链、公网域名/安全组和浏览器验收，以服务器执行结果为准。
