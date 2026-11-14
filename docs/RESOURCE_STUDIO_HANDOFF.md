# Resource Studio V17 分支交接

分支：`feature_11_11_cx`。不合并 main。

## 已落实的客户决定

- 页面以客户 V17 HTML 为准，导航移除 Insight/Data Agent/Raw/About；保持邮箱登录。
- 历史与经销商目录只读 PostgreSQL `data.distributor_sellin_resource_history`，不再依赖 Databricks。
- 源状态 `1=active`、`0=closed`；只允许新选 active，后端同样校验。旧 closed 分配不自动删除。
- 历史逐条展示，同编码按 SD/RSM 独立选择和保存。记录身份包含业务线、编码、SD、RSM，原始编码不被内部标识覆盖。
- 2026 是 YTD。Yield 直接读取导入值；源 YOY 为比率，接口转百分比数值；L/$ 页面转 KL/K$。
- 不新增历史合同量字段；Phasing 缺少依据时显示 —。

## 接手启动

1. 按现有 requirements/constraints 安装后端依赖；项目依赖包括 PyJWT，但本次未更换邮箱认证流程。
2. 复制 example 配置为本地配置，填写开发数据库；不得提交配置凭据。
3. 对已有数据库检查 Alembic 当前版本，按项目迁移流程应用 `20261112_01` 和 `20261114_01`。前者为历史字段兼容性补齐，后者新增分配表 `history_key/sd/rsm` 三个可空列。禁止重跑空库建表脚本覆盖业务库。本机开发库已经单独执行这三个 ADD COLUMN；未擅自修改 Alembic 版本戳。
4. 后端：在 backend 运行 `..\.venv\Scripts\python.exe -m uvicorn app.main:app --app-dir src --host 127.0.0.1 --port 8000`。
5. 前端：`npm.cmd --prefix frontend run dev`，端口 5175。默认 API 模式，演示数据需要显式 VITE_DATA_MODE=demo。本机忽略文件 `.env.development.local` 已设为 api，不随 Git 交接。

## 验证与边界

前后端单元测试包含同编码不同 RSM 的独立保存/发布、Excel 往返、closed 新增拦截及既有分配保留。真实开发库只读接口与页面已联调；不把测试中的 SQLite 事务验证等同于生产验证。测试不向真实数据库写入预算或分配。

## 尚未完成的 V17 功能（不得误认为完整验收）

- 规划版本创建、复制、发布、关闭提交与版本隔离尚未接入真实持久化；页面版本标签/比较区域仍有静态内容。
- 新 AdminStudio 的用户编辑、组织枚举、健康阈值尚未完成后端绑定；部分按钮仅前端状态或提示，不能作为操作成功依据。已有后台 users/config API 可复用。
- 第三步并排试算的完整指标预览、撤销操作、版本对比明细需要继续按客户 HTML 对齐。
- 旧分配只含经销商编码，若对应多条组织记录，本次保留旧记录，不自动指定 SD/RSM；可由 Owner 重新选择明确记录。
- 原附件二在当前桌面路径已不可读取；接手需获取客户完整开发说明，对未完成项逐项核对。客户原型桌面路径不能作为团队共享依赖。

本分支是可继续开发的交接分支，不是已完成客户全部需求的验收版本。
