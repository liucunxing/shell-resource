---
name: resource-investment-insight
description: "为资源投资工作台生成有证据依据的 Insight，或接入、调整和验证其综合体检、历史 Yield 与计划投入四象限、分配结构分析能力。使用授权事实与预计算图表数据，保留六维检查摘要；不修改预算、不执行审批、不从全库自行扩大数据范围。"
---

# 资源投资 Insight

把授权范围内的资源安排解释成用户能快速阅读和复核的分析。检查六个维度，但不固定写六段；根据证据决定重点、篇幅、组合方式和合适的图表。正常、需关注和依据不足是同一页里的状态，不是三个结果页面。

## 使用入口

- **生成或改写分析**：读取 `prompts/common.md`、`manifest.json` 中选定方案的提示词，以及本次证据。仅加载需要的方案，不拼接所有方案。用户未选时采用 `comprehensive`。直接以 Skill 执行时，提示词中的 `task.allowed_visuals` 取自 manifest 所选方案的 `allowed_visuals`；通过 API 调用时由编译器组装该 task 对象。
- **编写提示词**：先读 [提示词编写约定](references/prompt-authoring.md)。提示词文件是唯一的文案规则来源，每次调用重新读取；不把报告段落、标题或句数写死在程序里。
- **接入工程或运行测试**：读 [接入与验证](references/integration.md)。通过 `scripts/insight_pack.py` 组装普通 Qwen 请求，不依赖本机已安装的其他 Codex skill。
- **选择或实现图表**：读 [可视化规范](references/visualization.md)，再参考 `preview.html` 的离线输出测试壳。它展示的是人工编写的合成样例，不能作为模型效果实测。
- **调整方法和口径**：读 [分析方法](references/analysis-methods.md) 及 [证据契约](references/evidence-contract.md)。先更改和验证系统提供的证据，不能用提示词替代计算或权限规则。

## 核心边界

1. 使用宿主后端已完成权限过滤的证据。历史整体 Yield 可以是授权的只读汇总，不由此推导或展示未授权跨部门资源明细。能力包不负责登录鉴权，也不能把调用者自报的 scope 当作授权证明。
2. 金额、占比、坐标、分界线、群体、年份、分母和数据版本由系统提供。模型选择已提供的事实与图表，不生成或执行代码、SQL、任意 HTML、图表配置，也不更改预算。
3. 保留 `low_yield / high_yield / concentration / overlap / trend / completeness` 六维检查结果，分别使用可核对事实、需关注、依据不足或符合已给定规则的状态。无依据不能写“正常”。
4. 事实、解释和复核建议相互区分。相对排名、四象限位置和多项叠加不自动成为异常，更不能直接推导应当增投、减投或因果关系。
5. 2025 全年历史与 2027 计划的比较标注跨年参考；2026 累计不是全年，也不自动年化。未提供未来经营目标时，不编造未来 Yield。
6. `check_constraints.required_focus` 指定的事项必须显式展开；其他内容按信息价值组织，允许没有重点卡片。六维摘要始终可见。

## 提示词与结构的关系

提示词负责“如何分析、怎么表达”。JSON 结构只约定渲染器需要的字段和合法组件，不固定报告标题、观点数量、维度顺序之外的叙述方式或每点句数。`blocks` 可以为空，可以把多个维度合并为一个发现；选择图表需要确有对应数据。

更改提示词无需修改 Python 或前端组件。调整字段、增加图表种类或改变指标口径时，才需要同步版本化的契约与组件。`prompt_sha256` 自动追踪实际提示词内容；对客户发布时仍应更新方案版本。

## 本地验证

在包目录执行：

```powershell
python -m pip install -r requirements.txt
python scripts/insight_pack.py check --evidence examples/baseline.evidence.json --result examples/baseline.comprehensive.json
python scripts/insight_pack.py request --preset quadrant --evidence examples/baseline.evidence.json --output out/quadrant.request.json
python -m unittest discover -s tests -v
python scripts/build_preview.py
```

`request` 只生成请求文件，不联网。只有显式执行 `call` 命令才会请求模型；连接信息由环境变量提供，不放进能力包。真实 Qwen 的结论质量、延迟与当前端点兼容性须另做实测。

实际完成的离线、独立使用和浏览器验证见 [交付验证记录](references/verification.md)。自己的结果可通过 `build_preview.py --evidence 本次证据.json --result 本次结果.json --output out/model-preview.html` 渲染查看。

## 交付范围

这是可复制到工程中试验的独立分析能力包，不会自动替换现有六段返回协议，也没有安装到全局 Codex skill 路径。接入时由同事选择性增加适配器与渲染组件，沿用现有 Controller → Service → Repository 分层和权限查询。
