# Backend 协作规则

先遵循 [根规则](../AGENTS.md) 和 [当前业务需求](../docs/CURRENT_REQUIREMENTS.md)。

## 架构与一致性

- Python 3.11、FastAPI、SQLAlchemy Async、Alembic、PostgreSQL；依赖由 `requirements*.txt` 与 `constraints.txt` 管理。
- 保持 Controller → Service → Repository → DO。DTO 验证输入，Service 负责业务规则与事务，Repository 负责明确查询；使用类型提示与参数化 SQL。
- 修改 API 时同步 DTO、前端调用、接口文档和必要测试；沿用既有响应结构、错误码和修订冲突机制。
- 保存允许不平衡，提交检查预算平衡，部门确认后冻结；部门未齐交不能确认；撤回确认直接解锁本部门全部 Owner，保留原提交；管理员驳回全版本并强制设置未来截止时间。已关闭或截止版本按现有规则拒绝写入。
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
- 2026-11-16用户最新确认：Phasing直接取同业务身份的phasing_2025/phasing_2026源比率，不再重算或被target/Actual期间确认失效屏蔽。零有效，NULL/非有限值保持空；不自动修改既有target/Actual确认。汇总使用同年源target加权源Phasing。
- 指标遵循 [供应商 V2.0 口径映射](../docs/METRIC_DEFINITIONS.md)：Phasing以2026-11-16源值直读规则为准；Yield仅C3与完整历史投资均>0；YoY基期≤0返回无基期；试算负权归0、总权0拒绝。保留PG原值，派生重算与源值核对分开。
- YTD 管理配置为1–12、默认10，配置更新仍检查revision并留审计；Actual/费用真实覆盖月份独立返回，未知仍为null。不能将管理员设置或原型10月写成PG的业务日期。
- 用户已确认当前PG批次Actual/费用均累计到2026年9月。使用绑定全源指纹的historyCoverageConfirmation，数据换批即失效；sourcePeriodMetadataAvailable仍为false，源时间字段后续补。有效月份与configuredYtdCutoffMonth分开，不能自动延用到预计2027年1月的新数据。

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

2026-11-16 最新确认：Owner 部门提交前可反复修改重提；部门提交管理层后锁定。部门只能在版本开放且未截止时提交或撤回；撤回直接解除本部门全部 Owner 锁，保留现有提交，保存修改后须重新提交。管理员仅在全部启用项目已由部门提交后才能关闭；截止只停止业务操作，不等于管理员最终关闭。管理员驳回为全版本一键释放全部部门，必须填写原因和晚于当前时间的新截止时间，原子重开版本并撤销所有部门确认，已有 Owner 提交和历史快照保留，未提交/已修改草稿不能伪造为已提交。取消部门退回 Owner、单项目和单 Owner 退回流程。此次测试后推送，不部署。

2026-11-16空值修复：Target按已确认固定L源target_2025/2026直接读取，页面KL；期间元数据失效不清空数值，0保留、NULL不补。历史期间确认采用history_2026_v1（Sector/编码及2026销量、C3、四费用8列）；无关Target/Phasing变化不使Yield失效，计算输入变化仍失效。旧确认必须凭原历史摘要一致证据显式升级并审计，不能静默续期。Editor指标占比分母与组合页统一按完整名单有效值合计，缺失行自身保持空；完整总额继续标识缺失。详见docs/HISTORY_AVAILABILITY_20261116.md（子目录按根目录解析）。
