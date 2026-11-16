# 有效数据 Phasing 与旧退回状态清理

用户要求清理旧部门退回遗留，并允许加权 Phasing 只取完整有效数据。

## 计算变化

多经销商按同年源 target>0 且源 Phasing 为有限数的记录计算 sum(target×Phasing)/sum(target)。缺失记录与非正权重跳过，零 Phasing 保留；无有效记录显示“—”。单家明细依旧直接显示源 Phasing。各处说明标明结果仅代表有效数据范围，历史总额等完整性规则不变。

## 数据清理

全库筛查 requires_resubmission 或 return_reason 非空的状态，共5条。逐条确认最近操作为 DEPARTMENT_RETURN、原因匹配、当前 revision 等于最后提交 revision，且无部门确认。事务内锁定版本和目标行，清空旧退回原因及强制重提标记，将这些未修改方案恢复为已有提交；部门仍未确认。未修改预算、分配、源指标、历史快照或旧审计。

清理前状态备份在忽略目录 output/legacy-return-cleanup-before.json，另写5条 LEGACY_RETURN_CLEANUP 审计，明确操作者为 codex:user-request，不冒用用户邮箱。相关版本 revision 增加以使旧编辑状态失效。提交后再次查询，全库遗留标记0条。清理只作用于已连接业务PG，不覆盖本地合成演示库。

## 验证

- 前端79个测试文件、448项测试通过，覆盖混合有效/缺失数据、全无效、零Phasing、非有限输入与详情汇总。
- npm run build、npm run check:bundle、git diff --check通过。
- 业务PG清理已提交；前端新算法尚未部署服务器，未声称线上页面已使用新算法。
