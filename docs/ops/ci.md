# 自动检查流水线（CI）与 main 保护规则

> 负责人：运维负责人 · 最后更新：2026-10-05 · 来源任务：T-015（D-L0-03）
> 读者：总经理（零基础）、项目总负责人。
> 流水线配置文件：`.github/workflows/ci.yml`。检查命令本身的说明见 `docs/ops/local-dev.md` 第四节，这里不重复。

---

## 一句话

**每次把代码推送到 GitHub，GitHub 会自动在云端电脑上跑一遍 `pnpm check` 的全部检查，结果是绿勾（通过）或红叉（失败）。设置好 main 保护规则后，红叉的代码就合并不进 `main`。**

---

## 一、名词解释

| 名词 | 意思 |
|---|---|
| CI（持续集成） | 代码一推送，就自动跑检查。相当于一个永不疲倦的质检员。 |
| GitHub Actions | GitHub 自带的 CI 服务。我们的检查就跑在它上面。 |
| 工作流（workflow） | 一份「检查清单」配置文件，放在 `.github/workflows/`。我们只有一份：`ci.yml`。 |
| 运行（run） | 工作流被触发一次，就是一次运行。每次运行有自己的网页，能看到每一步的输出。 |
| PR（合并请求，Pull Request） | 在 GitHub 网页上「申请把某条分支合并进 main」。CI 会对它跑检查，通过后点按钮合并。 |
| 保护规则（ruleset） | 给 `main` 加的锁：例如「必须通过 CI 才能合并」「不能强行覆盖历史」。 |

---

## 二、CI 做了什么

触发时机：

- 推送到**任何分支**（例如负责人推送 `T-015-ci-and-lint-hardening`）；
- 向 `main` 发起 PR；
- 在网页上手动点「Run workflow」。

每次运行依次执行（任何一步失败，后面的步骤不再执行，整次运行显示红叉）：

| 步骤 | 命令 | 检查什么 |
|---|---|---|
| 1 | `pnpm install --frozen-lockfile` | 依赖能装上，且锁文件 `pnpm-lock.yaml` 与 `package.json` 一致 |
| 2 | `pnpm format:check` | 代码排版 |
| 3 | `pnpm lint` | 代码规则：模块边界 R1～R9、服务器禁止路径别名、服务器模块之间禁止循环依赖 |
| 4 | `pnpm typecheck` | 类型检查 |
| 5 | `pnpm test` | 自动测试 |
| 6 | `pnpm tokens --check` | `docs/design/tokens.css` 与 `tokens.json` 重新生成的结果一致 |

- Node 版本读 `.nvmrc`（24），pnpm 版本读 `package.json` 的 `devEngines`（11.28.4），和本机完全一样。
- 依赖会被缓存，第二次起运行更快（通常 1～2 分钟）。
- 安卓的 Gradle 构建已在 `ci.yml` 末尾留好位置，等 Android 负责人建好安卓工程（D-L0-18）后接入。
- 费用：私有仓库每月有 2000 分钟免费额度，我们一次运行约 1～2 分钟，正常使用远用不完。

---

## 三、怎么看 CI 结果

### 方法 A：网页（任何人都能用，推荐总经理用这个）

1. 浏览器打开 `https://github.com/yottermanzione-ship-it/weiban/actions`（需要先登录 GitHub）。
2. 列表里每一行是一次运行。左边**绿色对勾 = 通过**，**红色叉 = 失败**，黄色圆点 = 正在跑。
3. 想看某条分支：点列表上方的「Branch」下拉框，选分支名（例如 `T-015-ci-and-lint-hardening`）。
4. 点开一次运行 → 点左边的 `check` → 能看到每一步的输出。失败的步骤是红色的，展开就是报错内容，可以截图发给项目总负责人。

### 方法 B：命令行（给项目总负责人用，需要总经理先做一次第五节的 gh 登录）

```
gh run list --branch T-015-ci-and-lint-hardening --limit 5
gh run view <运行编号> --log-failed
```

第一列 `completed` + 第二列 `success` 就是通过。

---

## 四、main 保护规则：一步一步设置

> **先看前提**：我们的仓库是**私有**仓库。GitHub 免费账号的私有仓库**不能真正启用**保护规则
> （页面上能填，但会提示需要升级，规则不生效）。要启用，二选一：
>
> - 把账号升级到 **GitHub Pro**（约 4 美元 / 月，`https://github.com/settings/billing` → Upgrade）；
> - 或把仓库改成公开（**不推荐**：仓库里有 AI 提示词、测试样本等内容）。
>
> 这件事需要总经理决定，见本节末尾「不升级时怎么办」。以下步骤在满足前提后操作。

全程在网页上点，约 5 分钟。**只有仓库主人（总经理的 GitHub 账号）能做。**

1. 浏览器登录 GitHub，打开 `https://github.com/yottermanzione-ship-it/weiban`。
2. 点仓库页面顶部右侧的 **Settings**（齿轮图标）。看不到 Settings 说明登录的不是仓库主人账号。
3. 左侧菜单找到 **Code and automation** 一组，点 **Rules** → **Rulesets**。
4. 点右上角绿色按钮 **New ruleset** → 选 **New branch ruleset**。
5. 填写：
   - **Ruleset Name**：`main 保护`
   - **Enforcement status**：选 **Active**（生效）。
   - **Bypass list**：**保持为空**，不要添加任何人（否则添加的人可以绕过规则，包括你自己）。
6. **Target branches** 一栏：点 **Add target** → 选 **Include default branch**（默认分支就是 `main`）。
7. **Rules** 一栏，按下表勾选（没提到的保持默认、不勾）：

   | 规则 | 勾不勾 | 作用 |
   |---|---|---|
   | Restrict deletions | 勾（默认已勾） | 不能删除 `main` |
   | Block force pushes | 勾（默认已勾） | 不能强行覆盖 `main` 的历史 |
   | Require a pull request before merging | 勾 | 改动必须通过 PR 合并，不能直接推到 `main` |
   | └ Required approvals | 填 `0` | 个人项目没有第二个审批人；验收由质量负责人报告把关 |
   | └ Allowed merge methods | 只留 **Merge** | 保留「每个任务一个合并记录」，与 `git merge --no-ff` 效果相同 |
   | Require status checks to pass | 勾 | CI 不通过就不能合并 |
   | └ 点 **Add checks**，搜索 `check`，选来源为 **GitHub Actions** 的那一项 | 必做 | 指定「必须通过」的是哪个检查。搜不到时，说明这个仓库还没跑过一次 CI，先等 T-015 分支的运行出现 |
   | └ Require branches to be up to date before merging | 不勾 | 勾了以后每次 main 有新提交，其他分支都要先更新才能合并，个人项目没必要 |

8. 拉到最下面点 **Create**。列表里出现 `main 保护`、状态 Active 即完成。
9. 截图发给项目总负责人确认。

### 设置之后，合并流程怎么变

`docs/ops/git-workflow.md` 第四节第 6 步的「本机 `git merge` 后推送 main」会被拒绝（这正是规则在起作用）。改为：

1. 负责人推送任务分支（现在已经这样做）。
2. 在 GitHub 网页上为该分支开 PR（或项目总负责人用 `gh pr create --base main --head <分支名>`）。
3. 等 PR 页面显示 `check` 绿勾，点 **Merge pull request**，合并说明照旧写验收报告路径。
4. 本机 `git switch main` → `git pull`，与 GitHub 同步。

`git-workflow.md` 的正式修订等总经理决定启用后再做，避免文档先于事实。

### 不升级时怎么办（当前状态）

规则无法强制时，靠「合并前核对」兜底：项目总负责人在本机合并前，除 `git-workflow.md` 第 6 步原有的三项核对外，**再确认该分支最后一次 CI 运行是绿勾**（第三节方法 A 或 B）。红叉不合并。

---

## 五、给项目总负责人装 gh 命令行（可选，推荐，总经理操作一次）

装好后项目总负责人可以在命令行查看 CI 结果、开 PR，不用每次请总经理看网页。

1. 打开 PowerShell，执行：`winget install --id GitHub.cli -e`，等出现「已成功安装」。
2. **关掉 PowerShell 再重新打开**，执行 `gh --version`，显示版本号即成功。
3. 执行 `gh auth login`，按提示依次选：`GitHub.com` → `HTTPS` → `Login with a web browser`。
4. 屏幕上会显示一个 8 位验证码，按回车会打开浏览器，把验证码填进去，点 **Authorize**。
5. 回到 PowerShell 看到 `Logged in as …` 即完成。

登录凭据由 gh 保存在 Windows 凭据管理器里，不会写进项目文件夹。

---

## 六、常见问题

**Q：推送后 Actions 页面里没有新的运行？**
等 1 分钟刷新。仍没有：Settings → Actions → General，确认 **Actions permissions** 不是「Disable actions」。

**Q：CI 红叉，但本机 `pnpm check` 是好的？**
最常见的原因是本机有没提交的文件。执行 `git status` 看一下；把截图和 Actions 页面的报错一起发给项目总负责人，转运维负责人。

**Q：`pnpm install --frozen-lockfile` 这一步失败？**
说明有人改了 `package.json` 的依赖但没有提交更新后的 `pnpm-lock.yaml`。本机执行 `pnpm install` 后把 `pnpm-lock.yaml` 一起提交。

**Q：`pnpm tokens --check` 失败？**
有人改了 `docs/design/tokens.json` 但没重新生成 CSS，或手改了 `tokens.css`。执行 `pnpm tokens`，把 `docs/design/tokens.css` 一起提交。
