# 经销商 target 与 Phasing 接入

2026-11-15 用户明确确认：`data.distributor_sellin_resource_history.target_2025`、`target_2026` 单位均为 L；分别为2025全年、2026年1–9月。应用显示 KL，不使用旧 `data.distributor_target` 回退，不按9/12自行折算。

## 读取与公式

- PostgreSQL 可选投影读取四个新字段，原始 target/Phasing 不改写；旧SQLite演示缓存无须加列，也不会自动获得真实目标。
- `contract2025`、`contract2026Ytd` 为兼容现有界面的归一 L 字段；页面名称统一为“经销商 target（KL）”。源值另在 `sourceTarget*`、`sourcePhasing*` 保留供对账。
- Phasing = Actual Vol / 同期 target，API为比率、页面乘100显示百分比。源Phasing保留两位小数，业务展示用未提前舍入的输入重算。
- target为0、负数或缺失时单行Phasing不可用；已知零/负目标保留原值。合计分子、分母只使用同一批正目标记录，不能把零目标记录的销量算进分子。任何目标或销量未知时，范围汇总Phasing保持不可用。
- 管理层、我的投入组合共用经销商明细；Editor、详情抽屉、SD/RSM汇总沿用同一配对助手。
- 真实PG旧提交使用普通经销商编码，而历史表为组织身份键；读时对独立返回副本按Sector＋编码唯一匹配，修复旧方案明细的名称、组织与历史为空。保持原历史快照、金额和权限；已有组织冲突、多候选及ID碰撞不猜测。

## 当前真实源对账

1,489个Sector＋经销商身份无重复；逐行核对API原始目标、归一目标和Phasing。

| 年度 | 正目标/可计算Phasing | 零目标 | NULL目标 | 有目标值的记录 |
|---|---:|---:|---:|---:|
| 2025全年 | 182 | 536 | 771 | 718 |
| 2026年1–9月 | 699 | 16 | 774 | 715 |

源Phasing的182/699条均在两位小数容差内匹配Actual/target。2025的PCMO、CRTO已填目标均为0，所以这些行Phasing继续显示“—”，不能用2026目标替代。

## 批次及配置

`reference.dealerTargetConfirmation` 独立保存单位、各年起止月份、确认时间及源指纹。新批次自动失效；2026还必须匹配有效的Actual期间确认。`historySnapshot.manifest.target` 展示来源、各期覆盖和不可用原因。

新增四列曾使原Actual/费用的9月确认失效。核对原24列整表指纹与此前确认完全相同后，仅重新绑定已有Actual/费用确认（revision7→8），再绑定本次用户明确的target确认（revision8→9）。只写配置及审计；历史源、预算、分配和用户均未写入。源指纹保持 `382d06175f6c5e853b1e00e147467a67`。

确认脚本 `backend/scripts/confirm_dealer_targets.py` 默认dry-run，显式 `--apply` 与期望revision才提交；不能将脚本参数视为业务证据。只读对账脚本 `backend/scripts/verify_dealer_targets_pg.py` 在真实PG逐行复核，并以纯内存测试配置验证L/KL转换及全年目标不得混入9月Phasing；测试配置不写入数据库。

## 实际验证与运行

- 前端67文件405项测试、TypeScript、生产构建和bundle检查通过。
- 最终后端830项pytest通过（含四角色旧身份、selected同步、停用既有名单保存、不可变snapshot、单位/期间/负值回归）；全目录Ruff和Mypy90源文件通过。
- 真实PG只读对账1,489行通过；本地SQLite缓存兼容回归通过。
- main按用户要求使用显式本机PG测试入口 `scripts.pg_local_preview:create_pg_local_preview --factory` 运行于 `http://127.0.0.1:8020/`，直接进入并选择现有启用账号，不需帆软；连接现有安全配置指定的服务器PG。后端现有权限保留，不创建演示账号。8019继续为隔离SQLite演示。
- 浏览器实测管理层2026YTD：经销商12088919（PCMO）target693.75KL、Vol630.2KL、Phasing90.84%，明细与抽屉一致；2025对应target0，Phasing为“—”。3个旧项目共12分配行、8家经销商全部正确匹配历史，未重复跨Sector。
- 截图位于忽略目录 `output/playwright/main-pg-target-drawer.png`，未提交真实业务截图。
- 本次为本机main连接远端PG预览与代码同步，不代表远端应用部署或真实SSO/UAT验收。
