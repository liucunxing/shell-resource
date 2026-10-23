# 服务器共享 HTTPS 网关

本 ECS 的公网入口由一个独立 Docker Compose 项目统一管理：

```text
Internet
  └─ 80/443  →  /opt/digitalshell-gateway (Nginx, host network)
                 ├─ resource.digitalshell.com.cn → 127.0.0.1:18080 (shell-forecast)
                 └─ oneportal.digitalshell.com.cn → 127.0.0.1:18081 (future OnePortal)
```

应用项目不得再监听公网 `80/443`，也不得各自启动 Nginx。这样增加新平台时只需分配一个本机端口和一个 `server_name` 路由，不会抢占入口端口。

## 首次迁移到共享网关

以下命令在 ECS 中以 `ecs-user` 执行。先确认当前代码已包含 `gateway/` 目录，且 `resource` 应用已按新的 Compose 配置监听 `127.0.0.1:18080`。

```bash
cd /opt/shell-forecast
git fetch --prune origin
git checkout --detach origin/main
sudo bash deploy/deploy.sh --port 18080
curl --noproxy '*' --fail http://127.0.0.1:18080/health
```

安装网关程序文件；此命令不会覆盖已有 `.env` 或证书：

```bash
cd /opt/shell-forecast
sudo bash gateway/install.sh /opt/digitalshell-gateway
sudo chown -R ecs-user:ecs-user /opt/digitalshell-gateway
```

复制当前证书到网关目录。不要把证书、私钥、`gateway/.env` 提交到 Git：

```bash
sudo install -m 0644 -o ecs-user -g ecs-user deploy/certs/fullchain.pem /opt/digitalshell-gateway/certs/fullchain.pem
sudo install -m 0600 -o ecs-user -g ecs-user deploy/certs/private.key /opt/digitalshell-gateway/certs/private.key
```

检查证书确实覆盖两个域名。若任一命令失败，请先向证书提供方申请包含两个名称或 `*.digitalshell.com.cn` 的证书，**不要切换网关**：

```bash
sudo openssl x509 -in /opt/digitalshell-gateway/certs/fullchain.pem -noout -checkhost resource.digitalshell.com.cn
sudo openssl x509 -in /opt/digitalshell-gateway/certs/fullchain.pem -noout -checkhost oneportal.digitalshell.com.cn
cd /opt/digitalshell-gateway
sudo bash deploy.sh --check
```

旧项目私有 Nginx 仍占用 80/443，必须先仅停止它。以下命令按 Compose 标签精确定位，不会停止 `app`：

```bash
LEGACY_NGINX=$(sudo docker ps -q \
  --filter label=com.docker.compose.project=shell-forecast \
  --filter label=com.docker.compose.service=nginx)
printf '旧 Nginx 容器 ID：%s\n' "$LEGACY_NGINX"
test -n "$LEGACY_NGINX" && sudo docker stop "$LEGACY_NGINX"
```

启动网关。脚本会检查端口、上游只为 `127.0.0.1`、证书域名、Nginx 配置、两个域名的网关健康接口，以及 resource 应用健康接口：

```bash
cd /opt/digitalshell-gateway
sudo bash deploy.sh
```

最后从服务器与外部浏览器验证：

```bash
curl --noproxy '*' --fail --resolve resource.digitalshell.com.cn:443:127.0.0.1 https://resource.digitalshell.com.cn/health
curl --noproxy '*' --fail --resolve oneportal.digitalshell.com.cn:443:127.0.0.1 https://oneportal.digitalshell.com.cn/nginx-health
sudo docker compose --env-file .env ps
sudo docker compose --env-file .env logs --tail=100 nginx
```

`oneportal` 尚未部署前，其根路径返回 502 是预期行为；`/nginx-health` 返回 200 说明域名路由和 TLS 已就绪。

## 网关日常维护

网关部署目录独立于应用仓库；更改仓库内的 `gateway/` 后，需显式同步才会生效：

```bash
cd /opt/shell-forecast
sudo bash gateway/install.sh /opt/digitalshell-gateway
cd /opt/digitalshell-gateway
sudo bash deploy.sh --check
sudo bash deploy.sh
```

`--check` 使用隔离网络的临时容器验证模板、证书及私钥，不占用 80/443。正式部署仅在预检成功后更新网关。保留原入口的 20MB 上传限制和 300 秒请求超时。现有镜像可用时直接复用；镜像版本升级时先修改 `.env` 中的 `GATEWAY_NGINX_IMAGE`。

当前安全镜像为 `digitalshell-gateway:1.30.6-brotli1.2.1`。它由本目录的 `Dockerfile` 从固定 digest 的官方 Nginx 1.30.6 构建，并补充 Brotli 1.2.1（官方基础镜像仍含 1.2.0）。目标镜像不存在时，`deploy.sh` 在预检前自动构建。首次从旧网关升级时，`install.sh` 保留已有 `.env`，因此必须显式更新其中的 `GATEWAY_NGINX_IMAGE`。后续修改 Dockerfile 应使用新镜像标签；回滚时把该变量恢复为保留的旧镜像，再执行 `deploy.sh`。

旧项目 Nginx 在迁移后保持停止状态，可设为 `sudo docker update --restart=no shell-forecast-nginx-1` 避免误启动；需要回滚时仍可手动启动。

## 之后发布 resource 项目

网关不需要重启。仅更新应用：

```bash
cd /opt/shell-forecast
git fetch --prune origin
git checkout --detach origin/main
sudo bash deploy/deploy.sh --port 18080
curl --noproxy '*' --fail http://127.0.0.1:18080/health
curl --noproxy '*' --fail https://resource.digitalshell.com.cn/health
```

## 接入未来 OnePortal

OnePortal 的 Compose 必须只发布 `127.0.0.1:18081:<container-port>`。部署并确认 `curl http://127.0.0.1:18081/health` 后，网关已经预留 `oneportal.digitalshell.com.cn → 127.0.0.1:18081`，只需验证：

```bash
curl --noproxy '*' --fail https://oneportal.digitalshell.com.cn/health
```

若将来需要第三个应用，新增一个未占用的本机端口和一个 Nginx `server_name` 块，随后在 `/opt/digitalshell-gateway` 同步 `gateway/` 的程序文件并执行 `sudo bash deploy.sh`。不要给应用自身分配 80 或 443。

## 故障恢复边界

`gateway/deploy.sh` 从不停止其他项目。若新网关没有启动成功，旧私有 Nginx 容器仍在，只是已停止；确认问题后可使用上面输出并记录的旧容器 ID 恢复旧入口。恢复前先停止共享网关：

```bash
cd /opt/digitalshell-gateway
sudo docker compose --env-file .env down
sudo docker start <旧_Nginx_容器_ID>
```

不要在恢复过程中执行 `docker system prune`、删除数据库卷或修改应用的 `deploy/settings.toml`。
