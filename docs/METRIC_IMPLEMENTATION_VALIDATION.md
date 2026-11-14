# 已确定指标口径的工程修复验证

日期：2026-11-15。基线为main的df1bbf5。原型及供应商说明不修改；远端业务数据不改写。

## 修改与理由

- 集中度Top表、累计曲线共用有历史名单、百元排序及非负分析产出，避免同一页面曲线与表格结果不同；分母为0不画假曲线。
- SD/RSM的Vol/C3占比与偏离判断统一使用逐家截零产出。原始Actual、C3及历史投资合计保留有符号数。
- Editor合同列、合同占比、排序及Phasing不再硬编码空值；使用已有history合同字段，标明全年签署量。真实PG没有该字段，仍显示未提供；没有用演示数据补真实合同。
- PPP API规则改为“已定义目标Vol/C3，缺目标数据”，保留待配置列，删除未定义提示。Phasing元数据标明full_year_signed。
- 汇总Yield检查期间与完整原始金额后先合计再相除，不因单行Yield无效阻断有效的净合计；合计C3/投资不大于0或月份未知仍不计算。
- 历史费用构成有负数、缺失或总额不大于0时保留金额明细，提示暂不显示构成占比，不把负费用画成正向结构，也不推断冲销含义。

## 已执行

- 前端59个测试文件、345项通过；npm run build、npm run check:bundle通过。新增负值、缺失、零分母、净额Yield、曲线/表格一致性及费用构成保护测试。
- 后端全量739项通过；Ruff全范围通过；Mypy 90个源文件通过。补充PPP/合同元数据与负原值、净费用、NULL保留断言。
- 主工程新构建在127.0.0.1:8025、独立SQLite原型fixture进行Edge/Playwright核对：免登录进入、Owner拆分/组合切换，合同缺失保持空值，PPP由C3切换Vol目标，数据口径展开及Tab焦点操作；390px和1440px页面宽度均未溢出；健康检查两幅SVG无NaN属性，控制台无错误。截图保留于工作区忽略输出output/playwright/metrics-health-desktop.png。
- PG 01:21只读检查1,489行、Sector＋编码重复0、2026费用全空；源指纹不变。完整PG测试入口通过：31/31流程检查、16/16全量真实接入检查；两次QA schema事务回滚后确认不存在，business_writes=false，前后源表指纹一致。报告：outputs/branch-tests/pg-real-20261115-012743-548/。

## 保留边界

- 合同读取/计算支持已落实，但PG源及现有模型未提供合同列；本地原型导出合同也尚未进入seed/API。真实源确定后仍需模型映射接入，不把函数测试当实际合同数据验收。
- PPP目标、2026费用和真实覆盖月份仍未提供；业务选择见[PENDING_DATA_DECISIONS.md](PENDING_DATA_DECISIONS.md)。
- 本轮是计算与数据边界修复，不宣称全部V19视觉或真实业务UAT已通过；没有部署远端应用服务器。

## 分支同步

实现提交 `fcf9d5c` 已同步main与test/v19-pg-real；test/v19-local-demo以合并提交 `b509b32` 纳入。两个测试分支跟踪内容仅test-profile.json不同（真实PG / 本地原型）。两个worktree分别build和bundle检查通过，本地默认入口9项SQLite原型测试通过，报告位于该worktree的outputs/branch-tests/local-prototype-20261115-013055-553/。后续仅文档记录提交不改变受测业务代码。
