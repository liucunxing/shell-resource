# @oneportal/embed-browser-sdk

Portal embed protocol `1.0` 的浏览器公共包。包含 Portal 使用的 `host` 入口和下游页面使用的 `child` 入口，无运行时 npm 依赖。两个入口构建为独立 ES module，可由应用自己的静态资源服务器提供。

```powershell
npm.cmd ci
npm.cmd run typecheck
npm.cmd test
npm.cmd run build
npm.cmd pack --dry-run
```

`npm test` 使用 Node test runner 与 jsdom 验证 DOM、来源关联、并发和清理；它不能替代真实浏览器的 Cookie/CSP/iframe 验收。跨三个本地应用的浏览器验收使用仓库 `examples/embed-host/` 与 `examples/receiver-spring-boot/`。构建产物在忽略的 `dist/`，包的 `prepack` 会自动重建。包尚未发布至 npm registry。

## Portal host

```typescript
import { createEmbedHost } from '@oneportal/embed-browser-sdk/host';

const host = createEmbedHost();
const instance = host.embedApp({
  appId: 'small-app', resourceId: 'home',
  container: document.querySelector<HTMLElement>('#application')!,
});
instance.on('error', error => showError(error.code));
instance.on('sessionExpired', () => showSignInRequired());
await instance.ready; // Only a validated EMBED_READY resolves this promise.
// On tab close:
instance.destroy();
// On Portal account switch or container unmount:
host.destroy();
```

默认从同源 `GET /api/auth/csrf` 读取 `{headerName,token}`，然后以当前 Cookie、CSRF 请求头调用 `POST /api/embed/launch`。可通过 `csrf(signal?)` 接入其他 CSRF 获取机制，返回头名称必须为 `X-...`。可配置 `launchEndpoint`、`destroyEndpoint`，但它们始终限定 Portal 同源；不允许把用户会话请求发向下游域名。

`embedApp` 同步返回实例。实例有 `requestId`、签发后可用的 `instanceId`、`state`、`ready` Promise、`on(event,listener)`（返回取消监听函数）和 `destroy()`。状态为 `CREATED → LAUNCHING → POSTING → WAITING_READY → READY`，失败进入 `ERROR`，销毁进入 `DESTROYED`。错误只提供受控错误码和安全描述，不转发下游原始报错文本。

默认 launch 超时 10 秒，就绪超时 15 秒；可通过 `launchTimeoutMs`、`readyTimeoutMs` 配置为 1–300000ms。凭证通过短暂存在的隐藏表单 POST 到独立命名 iframe；表单提交后立即清理，不进入 URL、日志、localStorage。`iframe.load` 不代表认证成功。

`destroy()` 会中断请求、移除 iframe/临时表单、清理定时器与监听器、拒绝尚未完成的 ready Promise，并尽力调用带 CSRF 的 `DELETE /api/embed/instances/{id}`。网络退出时无法保证 DELETE 到达，服务端仍须有 TTL。销毁不是下游会话注销。

## Receiver child

只能在本应用服务器已确认会话后，使用 `GET /embed/context/{instanceId}` 返回的可信上下文初始化：

```typescript
import { createEmbedChild } from '@oneportal/embed-browser-sdk/child';

const response = await fetch(`/embed/context/${instanceId}`, {
  credentials: 'same-origin', cache: 'no-store',
});
if (!response.ok) throw new Error('Local session is not established');
const child = createEmbedChild(await response.json());
child.notifyReady();

// Only a direct Portal child can request the second iframe level.
const agent = child.embedApp({
  appId: 'data-agent', resourceId: 'home',
  container: document.querySelector<HTMLElement>('#agent')!,
});
await agent.ready;
```

`notifyError(code)` 发送受控错误；`notifySessionExpired()` 发送可选失效事件；两者均不携带内部 Token。`child.destroy()` 清理本地监听器和子 iframe。协议 V1 没有子页面独立删除服务端上下文的消息：嵌套上下文由顶层父实例删除整棵树或服务端 TTL 回收；浏览器关闭子 iframe不会立即撤销已签发凭证或下游会话。

两层嵌套中，host 根据已登记窗口还原父实例，向 Portal 后端请求目标应用的新凭证。child 只接受正确父窗口、来源、实例、申请 ID 的 `EMBED_GRANT`。第三层嵌套请求不会转发。相同嵌套申请 ID 不会重复签发。

## 安全与运行边界

### 可选 Data Agent 产品换票桥接

此能力使用独立 `portal-data-agent/1.0` 消息，不能用通用 `embedApp({appId:'data-agent'})`
代替产品 API Key 换用户 token。Portal 配置 `createEmbedHost({dataAgentLaunch})`，回调签名为
`({parentInstanceId, question}, signal) => Promise<{iframeUrl,targetOrigin}>`；应用通过回调调用
同源、带 CSRF 和已认证会话的后端换票接口。没有回调时拒绝请求。

资源页在已验证 context 创建 child 后调用 `await child.launchDataAgent(question, signal)`，
返回值只用于产品 iframe；不得写入浏览器存储、日志、链接或分析事件。SDK 不会代替产品
验收，也不会将 iframe load 宣称为个人账号登录成功。退出/换账号时清理该 iframe 并销毁 child/host。

每根实例最多 8 个并发请求、256 个历史请求 ID；默认等待 30 秒。取消、退出、会话过期或
页面导航会中止待处理请求，晚到结果不会交给新页面。问题最多 2000 个 UTF-16 单元。
目标只允许 HTTPS、固定 `/admin/chat` 和 `token`/`space`/可选 `ask` 参数；泛用 JWT URL
仍禁止查询串。详细边界及 schema 见 [`DATA-AGENT-BRIDGE.md`](../../contracts/embed/DATA-AGENT-BRIDGE.md)。

- 所有来源比较均为精确 origin；消息同时校验协议版本、结构、窗口 source、实例及 requestId。错误消息中的内部细节不显示、不记录。
- 所有 wire UUID 必须为标准连字符格式的小写十六进制；非规范大写值直接拒绝，不自动转换。
- 默认 HTTPS；本地技术验证可显式设置 `allowLoopbackHttp: true`，只接受 `localhost`、`127.0.0.1`、`[::1]` 的 HTTP。生产不得启用此选项。
- iframe 使用 `allow-forms allow-scripts allow-same-origin allow-downloads` sandbox；需要弹窗、顶层导航等能力的系统应单独评估适配，不默认放开。
- 当前每个 host 最多 32 个活动根实例，每个 child 最多 8 个活动子实例。每个根实例最多 8 个并发嵌套签发、生命周期内 256 个唯一嵌套申请；超出返回 `RATE_LIMITED`，可以销毁后重新打开根实例。
- 不自动重试登录、续签、自动恢复或跨系统退出。Portal 切换账号必须先销毁旧 host，避免旧 iframe 留在页面上。
- SDK 不验证 JWT 签名、不提供资源授权、不保证第三方 Cookie 可用。接收方的签名、Origin、会话和每个业务请求的授权验证不可省略。

机器可读契约位于仓库 `contracts/embed/`；本包只包含浏览器代码，接收方 Java 包单独位于 `packages/embed-receiver-java/`。
