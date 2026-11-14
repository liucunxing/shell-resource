# shadcn 统一组件验收

> 视觉验收状态（2026-11-14）：用户已明确否定此前工程与最新 V19 原型的视觉一致性，指出布局、配色、顺序及图表均有差异。本文保留的是当时功能、构建和浏览器操作证据，不能解释为 V19 视觉保真通过。修复与同屏对照验收尚待完成；当前结果不应按“V19 已验收”交付。

日期：2026-11-14。分支：`feat/v19-prototype-20261114`。本轮效果待用户确认，尚未推送或部署。

## 实施范围

- 共享组件位于 `frontend/src/components/ui/`，采用 shadcn 官方 New York / Radix 源码，Tailwind v4、Shell 红色与中性色主题。生成配置见 `frontend/components.json`。
- 按钮、输入框、选择框、Checkbox、Label、Table、Card、Badge、Alert、Dialog、Tabs、Accordion、Progress 和 Sonner 提示统一使用共享组件；已移除 Fluent 依赖和 Provider。
- 保留现有业务布局、图表与 TanStack 数据计算；历史归档原型不修改。表格保留单一外层滚动容器，弹窗保留焦点约束、Escape 和返回触发控件。
- 修正旧 CSS 与组件样式冲突造成的导航选中态、移动按钮显隐、遮罩高度、卡片留白和表单排列问题。
- 根目录、前后端 AGENTS.md/README.md 及 CURRENT_REQUIREMENTS.md 已与 V19 工作流、费用权限和 Databricks SP/schema 边界对齐。

## 本轮验证

| 检查 | 结果 |
|---|---|
| `npm test` | 51 文件、289 测试通过 |
| `npm run build` | TypeScript 检查和 Vite 生产构建通过 |
| `npm run check:bundle` | 通过；最大 UI chunk 436,980 B，低于 500 KB；ExcelJS 保持单份 Worker 按需加载 |
| `git diff --check` | 通过 |
| 原生控件扫描 | 应用 JSX/TSX 的基础表单、表格、弹窗、折叠控件仅在共享 UI 内使用原生标签 |
| 浏览器 | Edge，桌面 1440×960、手机 390×844；测试页面无 JavaScript 异常 |

浏览器验证覆盖 Owner 三步编辑、Checkbox、筛选/选择、长表格横向滚动、试算弹窗取消/Escape/焦点恢复、管理员创建版本与用户表单取消、Checkbox 标签点击、保存草稿的 Sonner 反馈和手机导航。桌面/手机文档宽度均等于视口宽度，长表在自己的容器内滚动。

证据目录（工作区外层）：`outputs/shadcn-standardization-20261114/`，含 browser-results.json 和桌面、手机、试算弹窗、用户权限界面截图。

## 验证边界

浏览器使用本地合成 SQLite 验收数据，保存仅影响本地测试草稿。本轮未改后端业务代码或远端数据库，未重跑远端 PG 验收、真实 SSO 或业务 UAT。历史 V19 后端 696 项测试不能作为本轮新增测试宣称。应用 Databricks SP 的认证问题仍按 CURRENT_REQUIREMENTS.md 记录，未使用个人凭据接入应用。

用户可确认主题、组件密度与交互效果后再进入下一次推送/发布。

组件来源：[shadcn Vite 接入](https://ui.shadcn.com/docs/installation/vite)、[Native Select](https://ui.shadcn.com/docs/components/radix/native-select)。

## 本地免登录验收入口补充

按用户要求，本地合成数据 fixture 现支持直接打开 `http://127.0.0.1:8019/`，无需邮箱参数、登录或帆软跳转。默认 Owner A，顶部 shadcn 下拉框可切换七个合成账号，刷新保留当前浏览器会话角色；普通应用和 Portal 入口保持原有身份校验。

已验证全新浏览器会话直达、切换管理员、刷新保持角色、390px 手机布局无横向溢出、无页面 JavaScript 异常。后端入口与已有身份相关测试合计 18 项通过，新增 helper 的 Ruff/Mypy 通过。证据为同目录 `direct-preview-results.json`、`direct-preview-desktop.png`、`direct-preview-mobile.png`。
