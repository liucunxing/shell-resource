# 全局切换组件调整 · 2026-11-15

按用户本次要求，参考 [shadcn/ui Radix Tabs](https://ui.shadcn.com/docs/components/radix/tabs)，保留项目已有 Radix 交互与业务状态，统一共享样式。

- 浅灰轨道 `#f1f3f5`、白色选中项、深灰文字，细边框与轻阴影；不再使用黄色选中或红色底线。按钮约26px高，轨道约34px高。
- 移除组合页、工作台、历史参考、详情抽屉的重复颜色/尺寸覆盖；保留组合Tab冻结和窄屏横向滚动。
- 历史期间使用共享 `HistoryPeriodTabs`，标签仅为“2026 YTD”；截止月、未知截止月和累计口径在相邻 ! 悬停/聚焦时显示。图标与期间按钮成组，窄屏不分离。管理员月份配置预览保留详细月份。
- 原始数据类别改用 Tabs 的 `onValueChange`，方向键选择与点击一致地更新类别并重置筛选/分页。

## 实际验证

- `npm test`：64个测试文件、380项通过。期间相关测试验证9月/未知截止月进入说明内容，按钮不带括号，不回退为10月。
- `npm run build`：通过；`npm run check:bundle`：通过。
- 本地 SQLite 合成场景 `http://127.0.0.1:8019/`，1440×1000：Owner组合健康检查、2025/YTD及方向键切换、SD/RSM切换、Initiative详情抽屉、YTD说明悬浮、抽屉关闭、工作台第三步。
- 管理层集中度、叠加到经销商、经销商明细、版本变化Tab切换通过。
- 390×844：组合Tab可横向滚动，SD/RSM与历史期间可切换，文档宽度未溢出；期间与说明图标保持在一起。
- 修复默认Tabs隐藏底线伪元素导致的多余纵向滚动条；桌面Tablist检查无纵向溢出。

## 本地截图

相同Owner角色和1440×1000视口的健康检查调整前后：

- [调整前](../output/playwright/tabs-before.png)
- [调整后](../output/playwright/tabs-after-health.png)
- [抽屉与YTD口径](../output/playwright/tabs-after-drawer.png)
- [工作台](../output/playwright/tabs-after-editor.png)
- [窄屏](../output/playwright/tabs-after-mobile.png)

截图在本地输出目录（不进入Git）；本轮按用户新要求调整切换外观，原型原黄色切换不再是该控件的验收目标。未验证真实PG业务UAT或远端服务器部署；原始数据旧入口的方向键修正未单独做浏览器验收。代码与本地检查不代表用户视觉验收。
