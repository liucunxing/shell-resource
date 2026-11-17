# 管理员配置补齐与验收（2026-11-15）

## 交付行为

- 用户与权限页提供用户Excel模板下载/上传；项目配置页提供当前规划版本Initiative归属模板下载/上传。解析在现有Worker执行，ExcelJS不进入UI包。
- 上传先进行本地逐行校验和服务端事务预览，确认后整批提交。取消无写入，任一行失败整批回滚。文件类型/大小、公式、重复键、必填字段、整数元预算、人员权限和版本并发均校验。Initiative模板绑定目标版本，含空ID新增行的旧版本模板也不能跨版使用。
- 用户导入按邮箱新增/更新，既有项目负责人的身份字段沿已有规则限制；未列出的用户不删除。负责人覆盖只拒绝本次新增或恶化的缺口，不让无关历史缺口拦截管理层用户新增。至少保留一个启用管理员，模拟视角拒绝写入。
- 项目清单移除末尾重复编辑列；保留顶部统一编辑。变化原因继续必填，错误展示项目名及缺失字段并自动定位；预算空值不转换为0。2026-11-17修订：保存配置使相应项目须重新提交，并撤销相关部门确认；版本保持原发布/开放状态，无需重新发布。原分配与历史提交快照保留。
- 组织与枚举页可配置Initiative、资源大类、部门图例色，六位HEX校验，清空恢复默认。Initiative使用稳定编号跨版本共享；设置随工作区Context传递至卡片、标签、图表与抽屉，不通过模块可变全局串色。
- 用户负责的Initiative每行两个组件，名称不在组件内部换行，可打开详情，色彩取管理员配置。

## 接口

- `POST /api/v1/workbench/admin/users/import`：expected_revision为用户配置指纹，items为用户配置数组，preview默认为true；用户列表返回revision。
- `POST /api/v1/workbench/planning-versions/{version_id}/initiatives/import`：expected_revision为规划版本revision，items为项目数组，preview默认为true。
- `AdminConfigDTO.legendColors`写入`workspace_config.reference.displaySettings.legendColors`，`state.legendColors`对各角色返回；保存沿用config revision和审计，无新增数据库表。

## 验证

- 前端67文件/400项测试通过，TypeScript及生产构建通过，bundle检查通过，ExcelJS仍只有一个Worker依赖副本。
- 后端全量pytest通过；最终历史缺口兼容修正另跑15项针对测试通过；全目录Ruff、Mypy通过。
- 浏览器使用8021独立本地SQLite合成环境：两种模板实际下载，错误用户文件阻止确认；合法用户/Initiative实际预览和提交，刷新后保留；Initiative取消不写入，错版本模板拒绝。
- 项目原因为空时提示项目名且焦点移至原因，补齐后保存成功；三类色彩保存刷新后保留，Owner卡片颜色与部门色点实际更新；用户标签两列、不换行且下钻成功，390px窄屏无页面横向溢出。
- 截图：`output/playwright/admin-users-import-tags.png`、`output/playwright/admin-legend-colors.png`。文件样例位于`output/admin-import/`，均为example.test合成账号，未进入Git。

仅本地合成数据交互和自动化验证，不代表远端部署、真实SSO或业务UAT。真实PG未被导入测试写入。原target来源核查与待确认单位/期间不属于本次改动。
