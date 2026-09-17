# GitHub 建仓、绑定与分支协作流程

本文适用于当前 `shell-forecast` 项目。项目已经在本地执行过 `git init -b main`，因此不要再次初始化。

## 1. 在 GitHub 创建空仓库

1. 登录 GitHub，点击右上角 `+` → `New repository`。
2. Repository name 建议填写 `shell-forecast`。
3. 根据团队要求选择 Private 或 Public。
4. **不要勾选** Add a README、Add .gitignore、Choose a license。本地已经存在这些内容，远端保持空仓库可以避免首次推送发生历史冲突。
5. 点击 Create repository，复制 HTTPS 地址：

```text
https://github.com/<OWNER>/shell-forecast.git
```

## 2. 首次本地提交

在项目根目录执行：

```powershell
cd D:\work\Develop\shell-forecast
git status
git add .
git status
git diff --cached --stat
git commit -m "chore: initialize FastAPI backend skeleton"
```

`git add .` 会包含 `backend/`、`frontend/`、`docs/` 和根目录项目文件。提交前必须通过 `git status` 和 `git diff --cached --stat` 确认文件范围。

如果误暂存某个文件，可以在提交前撤销暂存，不会删除本地文件：

```powershell
git restore --staged <file-path>
```

## 3. 绑定 GitHub 远程仓库并首次推送

把 `<OWNER>` 替换为 GitHub 用户名或组织名：

```powershell
git remote add origin https://github.com/<OWNER>/shell-forecast.git
git remote -v
git push -u origin main
```

第一次推送时，Git Credential Manager 通常会打开浏览器要求登录并授权。GitHub 不接受账号密码进行 Git HTTPS 推送；使用浏览器授权、Git Credential Manager 或 Personal Access Token。

以后 `main` 已经跟踪 `origin/main`，可直接执行：

```powershell
git pull --ff-only
git push
```

如果 `origin` 地址填错：

```powershell
git remote set-url origin https://github.com/<OWNER>/shell-forecast.git
git remote -v
```

## 4. 创建个人开发分支

首次 `main` 推送成功后，从最新 `main` 创建功能分支：

```powershell
git switch main
git pull --ff-only origin main
git switch -c feature/your-name/backend-foundation
git push -u origin feature/your-name/backend-foundation
```

推荐分支命名：

- `feature/<功能>`：新功能；
- `fix/<问题>`：缺陷修复；
- `chore/<事项>`：依赖、配置和工程维护；
- `docs/<事项>`：文档修改。

多人协作时，也可以加开发者标识，例如 `feature/your-name/backend-foundation`。

## 5. 日常开发提交

```powershell
git status
git add <明确的文件或目录>
git diff --cached
git commit -m "feat: add allocation API"
git push
```

优先暂存明确路径；确认修改范围后再提交。不要提交 `.env`、密钥、`.venv`、缓存、日志或本地数据库。

## 6. 同步 main 的最新代码

共享分支已经推送后，使用 merge 不需要改写远端历史：

```powershell
git switch feature/your-name/backend-foundation
git fetch origin
git merge origin/main
git push
```

如果发生冲突，手动解决后执行：

```powershell
git add <resolved-files>
git commit
git push
```

不要使用 `git reset --hard` 或普通 `git push --force` 处理冲突。

## 7. 创建 Pull Request

1. 在 GitHub 打开仓库。
2. 选择 `feature/your-name/backend-foundation` 分支。
3. 点击 Compare & pull request。
4. Base 选择 `main`（如果团队以后建立 `develop`，则按团队规则选择）。
5. 填写修改内容、验证结果和注意事项，提交 Pull Request。
6. Review 通过后合并，不直接在本地向受保护的 `main` 强推。

建议仓库管理员为 `main` 开启保护规则：要求 Pull Request、禁止 force push，并按团队要求配置审批和检查。

## 8. PR 合并后的本地清理

```powershell
git switch main
git pull --ff-only origin main
git branch -d feature/your-name/backend-foundation
```

确认远端分支不再需要后，可以在 GitHub PR 页面删除，或者执行：

```powershell
git push origin --delete feature/your-name/backend-foundation
```

删除远端分支前，应确认 PR 已经合并且没有其他人继续使用该分支。

## 9. 常用检查命令

```powershell
git status --short --branch
git branch -vv
git remote -v
git log --oneline --decorate --graph --all -20
git diff
git diff --cached
```
