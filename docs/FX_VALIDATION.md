# 汇率与负费用变更验证（2026-11-15）

## 范围

历史投资按管理员参数除算为USD、默认1；C3不重复转换，规划金额仍为人民币。负费用正常参与净额；跨Sector独立身份保持。同步管理员界面、API/manifest、历史展示与导出、Insight事实/格式及项目规则。新旧Insight货币标签按事实元数据区分；USD历史与CNY计划不计算差额/倍数。

## 已执行

- 后端全量pytest通过；新增默认/7.2转换、负费用净额、源值不变、NULL/权限、revision冲突、管理员鉴权、配置审计与参考导入保留、跨币种比较保护等用例。后续Insight文案/兼容调整又通过相关pytest。
- Ruff通过（src/tests/scripts/migrations）；Mypy检查90个源文件通过。
- 前端347项测试通过；TypeScript/Vite构建及bundle检查通过，ExcelJS仍仅在Worker使用。
- 真实PG只读事务核对1489行：当前汇率1，API有符号历史投资总和等于源表四费用净额。未写远端源或真实配置。
- 真实Edge浏览器本地SQLite验证：管理员“组织与枚举”页初始汇率1；输入0禁用保存；保存7.2返回200、刷新保持7.2；随后通过同一页面恢复1。1440宽和390窄屏检查，无页面横向溢出。
- 本地截图保存在忽略目录output/playwright/history-exchange-rate.png及history-exchange-rate-mobile.png。这是本地交互检查，不宣称客户视觉验收或正式部署完成。
- 应用Databricks OAuth仍返回401 invalid_client。按用户追加授权，用现有个人登录跨catalog只读查到5个汇率对象并核对结构、重复、无效值、月份与方向；见[DATABRICKS_FX_DISCOVERY.md](DATABRICKS_FX_DISCOVERY.md)。未替换应用认证或自动接入。

## 限制

统一手动汇率作用于全部历史年份。未来按月取率需要费用业务月份、源币种及选率规则；当前PG缺月份，不能据最新率重算全年。2026费用、合同、PPP等原有源数据缺口仍保留。UI的预算万元、勾选保持滚动和无底色双点图为此前已推送修改，本轮继续保留。
