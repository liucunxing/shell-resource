# Resource Studio V20 交接

2026-11-15，用户确认V20并授权同步工程、测试后推送。此前V17分支交接内容已被当前需求替代，旧内容保留在Git历史，不作为现在的未完成功能清单。

- 当前主线main，PG测试分支test/v19-pg-real、本地演示分支test/v19-local-demo；分支名为兼容名称，当前功能版本为V20。两个测试分支保留各自test-profile，数据和凭据不混用。
- 需求、批准原型SHA、组织四组表、V17明细表头、完整下钻及预留核对门禁见[V20同步说明](V20_IMPLEMENTATION.md)。
- 所有应用组件使用shadcn，后端执行部门费用上限；可见完整总额与受限细项分开序列化。API失败不回退演示数据。
- 实时业务数据读PG，Databricks保持应用SP边界。当前PG已无同Sector重复，2025/2026 Actual与四费无NULL；缺项和例子见[当前还缺什么](PENDING_DATA_DECISIONS.md)。
- 账号归属须管理员按真实组织配置；不能用本地合成角色代替真实人员，也不把合成数据导入远端。

## 启动与验证

本地演示使用tests.v20_prototype_fixture和独立.cache/v20-prototype，保留V19旧缓存。构建frontend后可在backend启动：

```powershell
.\.venv\Scripts\python.exe -m uvicorn tests.v20_prototype_fixture:app --app-dir src --host 127.0.0.1 --port 8021
```

直接访问http://127.0.0.1:8021，无需登录或帆软跳转。按分支启动脚本启动本地演示仍使用8019；详见[测试分支](TEST_BRANCHES.md)。正式应用入口保留原认证。

本次工程测试、真实PG隔离回归与浏览器证据统一记录在[V20同步说明](V20_IMPLEMENTATION.md)。服务器部署未包含在这次代码推送授权中，运维步骤见[服务器手册](SERVER_OPERATIONS.md)。
