# 第二层 Data Agent 验证记录 · 2026-11-02

实现范围：资源工具的 Portal 入口 → 父 Portal 消息桥 → 既有 Data Agent 换票 API → 厂商 iframe。帆软旧入口保留。未合并 main、未部署、未调用真实数据库/SSO/厂商服务。

## 分支与代码

- 资源工具：第二层在 `feature/portal-data-agent-bridge` 开发，基于第一层 `1a3bca0`；按用户要求统一交付到 `feature/portal-jwt-resource-entry`，包含两层接入。
- Portal：独立工作区 `shell-oneportal-resource-bridge`，分支 `feature/resource-data-agent-bridge`，基于 `8d2e1b8`，带入原目录已完成的第一层源码前置改动。原 Portal 目录 33 个复制文件的 SHA256 校验未变。
- Portal SDK 与资源工具 vendored SDK 的 9 个源文件逐字节一致。资源工具独立提交到上述交付分支；Portal 新增改动仍保留在本地，尚未提交/推送。

## 自动化结果

| 范围 | 实际命令（相应模块目录） | 结果 |
|---|---|---|
| Portal Java 与依赖模块 | `mvn -B -o -f pom.xml -pl apps/portal/backend -am verify` | Portal 111 通过、1 跳过；directory 12 通过、2 跳过；跳过真实厂商/Redis 集成 |
| SDK | `npm ci`、`npm run typecheck`、`npm test`、`npm run build`、`npm pack --dry-run` | 49/49；含原 JWT 协议回归 |
| 契约 | 契约资产生成一致性检查与 `validate_assets.py` | 10 schemas / 98 shape cases / 42 vectors |
| Portal 前端 | `npm run typecheck`、`npm test`、`npm run build` | 18/18；构建通过 |
| 资源工具前端 | `npm test`、`npm run build` | 39 文件、199/199；默认与显式本地 loopback 测试构建均通过，最终已恢复默认构建 |
| 资源工具后端 | 在 `backend` 目录运行 `.venv/Scripts/python.exe -m pytest` | 467/467；3 个现有依赖弃用提示 |
| 本地 HTTPS 测试替身 | ruff / compileall | 通过 |

后端覆盖：直接入口、合法父实例、跨 session/过期/被删除/非根实例、父应用白名单和父/目标权限、停用/映射变化、换票中退出或重新登录、上游非200/异常身份/超长响应/完整请求超时。厂商响应正文也受20秒期限约束。

SDK/前端覆盖：精确 origin/source/request/instance、重复 ID、并发上限、取消/超时/导航/销毁、迟到回包、非法 HTTPS 地址及参数、安全错误码跨 bundle、本地资源会话前后检查、45秒整体加载期限。

**额外测试限制：** 曾误在仓库根目录运行 pytest，未使用 `backend/pyproject.toml` 的 testpaths，额外收集到其他目录，结果 512 通过、15 失败：12 项部署脚本的隔离测试因本机缺少 WSL `/bin/bash` 失败；1 项 ping 环境断言受错误收集顺序影响，在正确 backend 命令中已通过；2 项未修改的 Insight projection 断言不一致，未纳入本次修复。没有执行部署。这一结果不作为全仓测试通过；本次认证链路与配置的后端测试集通过。

## Chromium 三层浏览器验收

真实本地 Java Portal + Vite Portal 页面 + Python 资源工具接收端 + HTTPS 厂商替身。测试账户仅 `alice@example.invalid` / `bob@example.invalid`，资源数据来自隔离 SQLite；厂商 API key、票据和 TLS 证书均为本次随机生成的合成数据。

| 场景 | 结果 |
|---|---|
| 刚登录 Alice，直接进入 Data Agent 并传问题 | 替身显示 synthetic-alice 和原问题 |
| Portal → 资源 → Agent 三层嵌入 | Alice/Bob 分别显示对应身份；Agent frame 的 parent 是资源 workbench |
| 第二层请求数据 | 只有 parentInstanceId、question，无邮箱或用户名 |
| 资源页折叠后恢复 | 同一 iframe 保留，无新增换票请求 |
| 伪造实例 ID / 消息增加 email | 不触发 Portal API |
| 模拟503 → 重试 | 失败清除 iframe，安全错误可重试，再次正常进入 |
| 换票响应延迟，用户退出后才释放 | 不恢复 iframe，页面只剩 Portal 登录视图 |
| Bob 登录后复用 Alice 旧父实例 | 409 CONTEXT_INVALID |
| 同浏览器并存旧帆软入口 | 旧入口仍使用 Alice，业务读取200；不被 Portal Bob 覆盖 |
| Portal 资源页 storage | localStorage / sessionStorage 均无新增项，无票据独立打开链接 |

本地截图（均有 synthetic 标记）：`output/playwright/portal-data-agent-alice.png`、`portal-data-agent-bob.png`、`portal-data-agent-retry.png`、`portal-data-agent-logout.png`。输出目录已忽略，不提交运行时证书、票据或日志。

## 交付边界

本次证明本地接口契约、身份隔离和浏览器流程；尚未证明真实 Data Agent 的 Cookie、双层 frame-ancestors 或业务数据权限。上线前仍需两个不同权限账号完成厂商 UAT。现有 ExcelJS 大分包警告未在本次优化。

本次测试浏览器及4组本地服务已关闭，测试端口已释放。配置见 [接入说明](../../deploy/portal-data-agent.md)。独立 QA 与最终复核结论记录于 [交付过程记录](state/agent_run_log.md)。
