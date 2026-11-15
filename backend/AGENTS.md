# Backend 协作规则

先遵循 [根规则](../AGENTS.md) 和 [当前业务需求](../docs/CURRENT_REQUIREMENTS.md)。

## 架构与一致性

- Python 3.11、FastAPI、SQLAlchemy Async、Alembic、PostgreSQL；依赖由 `requirements*.txt` 与 `constraints.txt` 管理。
- 保持 Controller → Service → Repository → DO。DTO 验证输入，Service 负责业务规则与事务，Repository 负责明确查询；使用类型提示与参数化 SQL。
- 修改 API 时同步 DTO、前端调用、接口文档和必要测试；沿用既有响应结构、错误码和修订冲突机制。
- 保存允许不平衡，提交检查预算平衡并冻结；部门未齐交不能确认；撤回确认不解冻 Owner；带原因的定向退回才允许重新编辑。已关闭或截止版本按现有规则拒绝写入。
- 新版本继承最后提交快照，不继承未提交工作稿；保留版本隔离、来源快照和旧组织归属，歧义映射必须拒绝而非猜测。

## 身份与权限

- 生产环境拒绝开发 `X-User-Email` 身份；Portal JWT / Cookie / CSRF 使用独立依赖与路由，不能以旧邮箱入口替代。
- 每次请求根据真实身份检查启用用户、角色、业务范围和当前版本；模拟用户只读。前端隐藏不构成权限控制。
- 所属Sector/Department独立于可操作业务范围。费用明细限于本人所属部门：MKT→MRD/SP&A，ICE→ICE Rebate/SP&A，Capex→Capex；部门、用户配置依次取交集收窄，admin/management不跨部门扩权。无有效归属时不提供明细，完整总额/Yield/占比仍公开。
- 公共历史总额与受限费用分开序列化；不能把受限细项放进客户端数据、错误或日志中。

## 数据源边界

- 当前 V19 经销商与历史读取 PG `data.distributor_sellin_resource_history`；保留的 Databricks Repository/config 不等于已被运行链路调用。旧参考导入不等于更新此历史宽表。
- Databricks 访问只能使用应用 Service Principal，且仅限该身份被分配并授权的 schema，当前配置为 `prod.resource_planning`。个人登录可查询其他表不构成应用授权。
- 认证失败明确返回不可用，不使用个人 token/CLI 登录回退，不自行授权，不把查询改到 `raw`、`base`、`report`、开发 schema 等扩大范围。
- 需新增源数据时由数据负责人提供 schema 内的授权视图/同步表，核对应用身份、列、业务粒度、刷新频率、年月、单位和币种，再集成与对账。
- 不猜造未知截止月、经销商target、汇率或组织归属；缺失与真实零区分。PPP为旧实现误加项，取消API规则和缺项声明。Sellin按季度更新，Actual/费用/target的业务覆盖仍须由源同批提供。
- Phasing分母按用户最新确认是同期间经销商target：9月YTD对应1–9月target；不自动取全年合同，也不使用销售SD/RSM目标。未提供或期间不明时保持不可用；演示全年合同不能冒充YTD真实目标。
- 指标遵循 [供应商 V2.0 口径映射](../docs/METRIC_DEFINITIONS.md)：Phasing 在合同>0时为Vol/合同；Yield仅C3与完整历史投资均>0；YoY基期≤0返回无基期；试算负权归0、总权0拒绝。保留PG原值，派生重算与源值核对分开。
- YTD 管理配置为1–12、默认10，配置更新仍检查revision并留审计；Actual/费用真实覆盖月份独立返回，未知仍为null。不能将管理员设置或原型10月写成PG的业务日期。

## 数据库与配置

- schema 变更必须有 Alembic 迁移；先核对实际 revision 与现存数据，保留原值和审计。不得把空库建表脚本用于覆盖已有库。
- 远端迁移先演练，明确数据库目标，控制锁等待并核对前后业务值；测试采用隔离 schema / 事务回滚，不能用真实业务数据演示流程。
- 密钥只从忽略配置或安全环境读取；不打印连接密码、Client Secret、token、Cookie 或业务绑定值。环境与 warehouse、schema 配置不要硬编码到业务服务。

## 验证

在 `backend` 运行 `python -m pytest -q`、`python -m ruff check src tests scripts migrations`、`python -m mypy src`；视改动范围选择相关测试，完整交付遵循项目要求。

SQLite 只能证明本地逻辑；PG ARRAY、迁移及事务需要实际 PostgreSQL 证据。`tests.v19_browser_fixture` 为隔离合成数据，不访问开发 PG/AI 凭据，不能证明真实身份、部署或 UAT。真实连接检查与迁移命令见 README 和 `docs/V19_VALIDATION.md`，准确区分只读检查、回滚演练和提交升级。

## 本地验收入口

用户于 2026-11-15 明确：原型演示数据仅导入本地 SQLite，远端 PG 保留真实业务数据，两者不得混用。本地直接访问，无需登录或帆软跳转。`tests.v20_prototype_fixture` 将V19合成业务快照按V20部门权限适配后导入独立 `.cache/v20-prototype`，旧V19缓存保留；旧 `tests.v19_browser_fixture` 的简化合成数据留在 `.cache/v19-final`，不能覆盖。仅 loopback fixture 注入 `example.test` 合成身份和角色切换；普通 API/Portal 入口继续原有校验。原型的模拟月份、合同或指标不能用于填补远端源缺失。

用户最新确认：history manifest及Insight事实明确C3为USD、历史投资归一为USD、规划投资为CNY。Yield单位USD/USD、历史费用先除以配置汇率，不称multiple；原数值公式及正值有效性保留。跨Sector编码是不同业务身份，不跨Sector合并。不得重写源金额或补造汇率。

2026-11-15用户授权：明确的只读探源任务可使用现有个人登录跨catalog/schema查表；这与应用接入分开。不得因此更换应用认证、扩大运行时权限或写源库。
