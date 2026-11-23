# 部署后跑一轮业务验收

在仓库根目录打开 Codex，说“用 business-journey-uat 对这次部署跑全员业务验收，提交号是……”。[业务旅程、案例和人员名单](../../uat-inputs/resource-studio/README.md) 单独存放，业务负责人可在这里确认每个角色的动作和预期。团队共用的 [Skill](../../.agents/skills/business-journey-uat/SKILL.md) 指导 AI 执行、看截图、写体验观察。

## 首次准备

使用仓库 `.nvmrc` 中的 Node 版本，以及安装了 `backend/requirements-dev.txt` 的 Python。团队已有前后端开发环境时，只需安装验收工具的依赖。以下命令从仓库根目录运行。

```powershell
npm ci --prefix tools/business-uat
```

新检出还需要应用自身的前端依赖和 Python 环境。

```powershell
npm ci --prefix frontend
py -3.11 -m venv backend/.venv
backend/.venv/Scripts/python.exe -m pip install -r backend/requirements-dev.txt
```

默认依次尝试工具包对应的 Chromium、本机 Chrome、Edge。需要安装 Chromium 时运行 `node tools/business-uat/node_modules/playwright/cli.js install chromium`。非 Windows 环境可用 `python3.11 -m venv backend/.venv` 和 `backend/.venv/bin/python`。

## 日常使用

在测试前可执行 `node tools/business-uat/inputs.cjs`，打开打印出的网页，逐条确认用户旅程和预期结果。页面直接从独立输入目录生成。

```powershell
node tools/business-uat/cli.cjs
node tools/business-uat/cli.cjs --revision <部署提交SHA> --seed 1
node tools/business-uat/cli.cjs --revision <部署提交SHA> --deployment-url https://<部署站点>
```

第一行验当前检出，后两行用于部署后验收。将尖括号参数替换为部署记录里的提交号和实际站点根地址。一次只需运行其中一行。工具核对前后端源码与指定部署提交是否一致，在临时目录重建前端，从当前源码启动应用。没有提供站点时，报告的部署依据是输入的提交号。提供站点时，还会用匿名 GET 核对健康端点、首页引用和入口脚本内容。登录、服务器数据库及完整镜像仍需各自的验收证据。

可选参数包括：

| 参数 | 用途 |
| --- | --- |
| `--roster 文件.json` | 替换默认 10 人，使用已脱敏的完整名单和项目归属。输入格式见同目录示例和[名单说明](../../uat-inputs/resource-studio/README.md)。 |
| `--fixture 文件.json` | 使用自备完整合成业务快照，默认采用其中的人员。可以再用 `--roster` 覆盖其名单。 |
| `--inputs 目录` | 使用另一版资源工具的案例输入。默认读取目录中的 `cases.json` 和 `roster.json`。 |
| `--seed 正整数` | 选择折返和调整项目。同一输入和种子可复测。希望换一组项目时换种子。 |
| `--python 解释器路径`、`--channel chrome` 或 `msedge` | 复用已有的开发虚拟环境或指定已安装浏览器。 |

各测试身份在独立浏览器会话中共享当轮临时业务库。写操作只落在随机端口的本机实例。前端用新构建，后端装载合成业务快照，进程退出后清理临时数据库。验收过程只持久保存报告和证据；产品代码、配置、账号授权以及共享数据均为只读。每次运行都从同一起点开始，旧报告可继续查看。

## 如何看结果

打开命令最后一行的 `outputs/business-uat/<本轮编号>/index.html`。首页给出结论、业务影响、覆盖人数与未测场景。展开旅程可查看每位用户、每个适用项目的预期和现场，`results.json` 保留结构化明细。前后两轮输入、业务快照、人员和抽样参数一致时，首页比较同条检查的结果。每轮报告独立保存于 Git 忽略目录。退出码 0 表示隔离业务旅程通过，1 表示发现与业务预期不符的结果，2 表示执行或覆盖证据不足。

AI 按 Skill 查看本轮实际截图，把观察保存在同一输出目录的 `ux-review.json`。每条已核实的观察引用本轮图片。对照格式示例如下，复核人员使用实际现场替换示例内容。

```json
{
  "runId": "本轮目录名",
  "observations": [{
    "role": "部门负责人",
    "task": "确认尚未齐交的部门",
    "status": "待核实",
    "observed": "本轮缺少可辨认待交项目的截图",
    "impact": "仍需核对负责人能否找到待跟进的项目"
  }]
}
```

`status` 可填“可完成”“影响使用”“待核实”。已核实的条目另填 `evidence`，值为本轮目录内截图的相对路径。执行 `node tools/business-uat/ux-review.cjs <本轮输出目录>` 后可在首页打开体验复核。业务侧的最终验收决定应一并考虑自动结果、体验观察和待补证项目。
