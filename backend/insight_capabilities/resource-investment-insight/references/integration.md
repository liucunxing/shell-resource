# 独立测试与工程接入

当前目录是 `shell-resource/backend/insight_capabilities/resource-investment-insight/` 的工程副本，已由实际前后端接入；工程外原型与独立源包不随这里的修改更新。命令行能力包只读显式环境变量；工程 Service 从宿主配置读取模型连接。

## 先做本地离线检查

要求Python 3.10或以上。唯一运行依赖为jsonschema；安装时可使用团队已有虚拟环境或在本包内新建环境，避免改同事工程的依赖锁文件。

```powershell
python -m pip install -r requirements.txt
python scripts/insight_pack.py check --evidence examples/baseline.evidence.json --result examples/baseline.comprehensive.json
python -m unittest discover -s tests -v
python scripts/build_preview.py
python scripts/insight_pack.py request --preset comprehensive --evidence examples/baseline.evidence.json --output out/request.json
```

打开 `preview.html` 可离线查看四个合成场景、三个分析方案、430px侧栏及展开视图。验收控制与业务界面分开；它不是三个状态Sheet，不是在线模型调用界面。`request` 输出包含 `metadata` 与可发送的 `request` 对象，后者才是模型API请求体。

`scripts/create_examples.py` 仅用于维护时重建合成样例，会覆盖 examples 下的同名样例；初次使用、验证已有结果或测试提示词时不需要运行它。

## 再做显式模型测试

仅在授权测试环境向模型发送已经完成权限过滤的数据。通过环境变量注入 `INSIGHT_BASE_URL`、`INSIGHT_API_KEY`，可选 `INSIGHT_MODEL`。本包不附真实值、不自动读取其他应用配置。

```powershell
python scripts/insight_pack.py call --preset comprehensive --evidence examples/baseline.evidence.json --output out/qwen-comprehensive.json
python scripts/insight_pack.py call --preset comprehensive --thinking --evidence examples/baseline.evidence.json --output out/qwen-thinking.json
```

默认模型为 `qwen3.8-flash`、关闭思考、使用JSON Schema。官方文档列出该模型对结构化输出与思考模式的支持；具体区域、网关和SDK行为仍需在实际端点验证。若端点不接受Schema，可显式加 `--response-format object`，继续执行相同本地校验；脚本不会静默降级。

- [阿里云：结构化输出](https://help.aliyun.com/zh/model-studio/qwen-structured-output)
- [阿里云：深度思考](https://help.aliyun.com/zh/model-studio/deep-thinking)

以上文档于2026-10-09核对；文档能力支持不代表已实测本工程端点。

不用人为压小 `max_tokens` 控制文案长短，以免截断JSON；简洁要求放在提示词。超时默认120秒，`call_qwen()`参数可由宿主调整。失败时不覆盖原结果、不打印服务端响应正文或凭据；本包没有自动重试、切模型或后台调用。

## 查看这一次模型结果的实际排版

使用同一次调用的证据和结果文件，生成独立 HTML。先通过本地结构与引用校验，再写入文件；不会再次请求模型。

```powershell
python scripts/build_preview.py --evidence examples/baseline.evidence.json --result out/qwen-comprehensive.json --output out/model-preview.html
```

支持原始结果 JSON 和 `call` 保存的 `{metadata, usage, result}` 文件。默认从结果读取方案，可加 `--preset comprehensive` 检查是否与预期一致。只展示该文件实际包含的方案；导入预览标明本地文件来源，metadata 中的模型名称只是调用记录，不自动成为模型真实性或效果证明。不要用另一批 evidence 配对旧结果。

修改提示词后，依次重新 `request/call`、校验、构建这一份结果预览即可。`preview.html` 中的内置演示不会随提示词改变。

## 最小工程接线

1. **Service准备证据**：复用现有查询的身份和范围过滤，生成完整可比队列、指标、图表数据、六维判断边界。当前接口只挑最高/最低Yield与首个趋势对象的证据需要补充，无法凭提示词获得未传入的对象。

   现有管理员维护的业务规则、目标和说明，应作为带来源与版本的事实继续传入，不应在适配时丢失。它们属于待解释的业务资料，不是可覆盖系统边界的指令。若工程接口与此前实现已不同，以当前接口实际传入的证据为准。
2. **选择已发布方案**：客户端只传方案ID；后端白名单查manifest。普通用户不编辑提示词。现有管理层只读与生成权限继续由宿主控制。
3. **组装请求**：调用 `InsightPack(pack_path).compile(evidence, preset_id)`，把返回payload交给现有httpx模型客户端；不必使用本包的urllib命令行客户端。
4. **校验并保存**：规范化后依次调用 `resolve_fact_tokens()`、`bind_named_facts()`、`validate_consistency()`，通过后保存 result、证据、绑定审计与 metadata。`validate_result()` 只做结构/引用校验，用于兼容旧样例，不能替代生成链路一致性校验。生成期间再次检查数据/权限/方案版本是否变化，沿用原有stale和并发逻辑。
5. **前端映射**：复用现有React样式与图形基础，将有限图种映射到组件。预览只是输出组件与布局参考，不要求复制整个HTML或增加新框架。始终保留六维紧凑摘要，不能继续按固定数组下标写死六个正文标题。

```python
pack = InsightPack(pack_path)
payload, metadata = pack.compile(evidence, preset_id="quadrant")
# model_json = await existing_model_client(payload)
# model_json, bindings = pack.resolve_fact_tokens(model_json, evidence)
# model_json, citations = pack.bind_named_facts(model_json, evidence)
# pack.validate_consistency(model_json, evidence, "quadrant")
# save(record={"metadata": metadata, "result": model_json})
```

上述省略部分由现有工程负责；本包没有替换Controller、数据库表、权限过滤、同步快照、预算写入或错误处理页面。旧版 `items[{key,review}]` 与本包结构不同，需要明确的适配分支，不能直接替换字段后期待旧前端兼容。

## 与正式Agent Skill的关系

根目录的 `SKILL.md` 供Codex或支持Skill的执行器按需读取。业务Qwen普通API由后端显式加载提示词；不会因为文件名是SKILL.md而自动发现技能。本包自身不依赖Codex宿主API。

未来需要挂载百炼Agent Skills时，可复用方法与材料并验证其执行器读取/脚本运行能力；不要把“可打包上传”误当作当前业务API已完成集成。

## 此次用到的Codex技能

- `skill-creator`：可发现入口、按方案分层读取、提示词与资源分离、行为验证。
- `data-analytics:visualize-data`：按分析问题选图、诚实坐标/分母/时期、缺失与零分离、图表可读性。
- `data-analytics:validate-data`：独立复算关键数字、检查结论依据和实际渲染。这里只实施本包范围内的标准验证。

技能用于编写和评审本包，相关原则已落入本地文件；部署时不需要安装这些Codex插件。现有Shell配色和交互边界沿用会话中已确认的设计，不引入营销页式的大标题或新UI框架。


## 工程适配版 0.1.1-engineering

工程副本的 Qwen 请求 Schema 去除端点不支持的 uniqueItems（本地继续完整校验），并按本次事实、方案图种与六维状态建立 enum / anyOf 约束。公共与四象限提示词明确复用上游分组和中位数口径。本目录适配不会修改工程外的独立源包；真实效果测试由宿主记录。


宿主服务调用 `normalize_result(candidate)` 后再严格校验，返回 `(result, normalizations)`。仅稳定去重 blocks.dimension_ids、blocks.fact_ids、checks.fact_ids 的重复字符串，记录路径与去除数量。六维对象、状态、数字、文本及 blocks 均不增删或改写；非法引用仍失败。它是集合字段归一化，不修复模型分析结论。


## 工程适配版 0.1.2-engineering

已有历史 Yield/计划金额、完整可比经营年度对按 observed 进行事实分析，缺未来目标不阻塞已有分析。limited 中文为“待补充信息”，只用于实际缺失的关键历史或不可比数据，具体写清字段、影响与补充动作。图文引用至少共享一个事实，且提示词要求主题/对象一致，无合适图表时不配图。


## 工程适配版 0.1.4-engineering：一致性与耗时

- 事实与图表行采用无损列式传输，共享 note/period/source 按 fact_annotations 合并；所有行、null、0、单位、scope 和年份保留。请求 Schema 用 $defs 去重，未放松本地契约。可用 expand_evidence() 还原检查。
- 模型可用 `{{fact_id}}` 引用真实值；服务端仅替换显式占位符。对明确命名的对象和指标补全授权事实引用，逐项写入 fact_bindings / citation_bindings，不改写结论，再运行数字、对象、分组、状态和图表主题检查。
- visual.title 固定为对应 dataset.title，visual.body 为空；图表口径由数据集直接呈现。AI 的额外解释使用独立 finding 并绑定具体事实，避免金额图附带 Yield/趋势判断。报告主标题与文字发现仍由模型组织。
- 规则覆盖已知反例，不等于任意自然语言的形式化证明；未支持的复杂比较和隐含因果仍须人工抽检。
- 工程内部消费 Qwen SSE，完整接收且校验后才保存/展示；不向用户流出未校验片段。记录首 token、模型调用、准备、保存前耗时、usage 和每次校验诊断。
- 后端 insight_timeout_seconds 默认且最高 60 秒，覆盖准备、首次调用、最多一次修复、复验与保存；前端 65 秒兜底并显示等待秒数。失败保留原记录，无自动无限重试。独立 urllib CLI 的 socket timeout 仍为 120 秒，不能作为工程 SLA。
- `scripts/evaluate_insight_engineering.py --live` 使用实际 Service 与隔离合成 SQLite，`scripts/verify_insight_integration.py --live` 验证真实 HTTP 保存读回及权限。真实业务数据规模与 PostgreSQL 延迟需在目标环境另验，合成通过不代表生产验收。

## 工程适配版 0.3.0：必填正文、展示与模型传输

- `required_focus_dimensions` 对应的 `required_findings` 在供应商结构化输出中设为必填；宿主解包为公共 blocks 后仍执行完整事实校验。不要只在 summary 或 checks 提及复核而缺少独立正文。
- 金额展示使用万元，Yield 保留一位小数；原始证据和计算精度保留。金额标量占位符没有单位后缀时自动带万元，已有显式元后缀继续兼容，再统一展示转换。不可把整个 investment JSON 作为正文占位符。
- 每次模型响应记录结束原因、接收字节/帧数、首 token 时间、耗时、请求 ID 和失败阶段；生产日志不记录输入、响应正文或密钥。`length`、`content_filter`、提前 EOF、坏 SSE 与 JSON 解析失败分开诊断，不能把所有 ValueError 都认定为截断。
- 提前 EOF、坏 SSE、JSON 解析失败、网络中断等瞬时错误在总截止时间内最多重试一次，并改用普通 JSON 传输；完整 schema、权限和事实校验不变。输出上限与内容过滤不重复发送相同请求，失败不保存候选。429/502/503/504 也只允许一次有截止时间的重试。
- `evaluate_insight_investment.py --live --json-only` 验证真实 JSON 传输；`--probe-output-limit` 使用同一批合成输入和刻意缩小的 max_tokens=8 验证真实 length 诊断，不写 Insight 记录。此实验不能证明历史某次失败也是输出上限。
