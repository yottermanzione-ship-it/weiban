# git 安装与首次配置（Windows 11）

> 负责人：运维负责人 · 最后更新：2026-10-04 · 来源任务：T-001
> 读者：总经理（零基础）。照着一步步做，大约 15 分钟。
> 分支、提交、合并的日常流程见 `docs/ops/git-workflow.md`，本文只讲「装好、配好」。

---

## 一、先弄懂四个词（2 分钟）

把整个项目文件夹想成一本**不断修改的书稿**。

| 词 | 通俗解释 | 打个比方 |
|---|---|---|
| **git** | 一个「版本管理」软件。它会记住项目里每个文件的每一次修改，随时能看到谁在什么时候改了什么，也能退回到任何一个旧版本。 | 给书稿装了一个**无限次的撤销键 + 修改日记**。 |
| **提交（commit）** | 把「当前这一批修改」拍一张快照存进历史，并写一句话说明改了什么。 | 在修改日记里写一条：「10 月 4 日，第三章加了一段对话」，同时把那一刻的书稿复印一份存档。 |
| **分支（branch）** | 从主线复制出一条独立的「平行版本」，在上面随便改，不影响主线。 | 把书稿复印一份去**草稿本**上改，改砸了扔掉就行，正式稿不受影响。 |
| **合并（merge）** | 把分支上验收通过的修改并回主线。 | 编辑审过草稿本、确认没问题，再把改动**誊抄回正式稿**。 |

我们项目的主线叫 `main`，它永远是「验收通过、可以用」的版本。每个任务都在自己的分支上做，质量负责人验收通过后才合并回 `main`。

---

## 二、下载安装包

**推荐方式：官网下载。**

1. 用浏览器打开 git 官网下载页：<https://git-scm.com/download/win>
2. 页面会自动开始下载，或点击 **「Click here to download」**。要的是 **64-bit Git for Windows Setup**，文件名类似 `Git-2.xx.x-64-bit.exe`（xx 是版本号，任何最新版都行），大小约 60–70 MB。
3. **如果官网下载很慢或打不开**（国内网络常见），换用国内镜像：
   打开 <https://registry.npmmirror.com/binary.html?path=git-for-windows/>，点进版本号最大的那个文件夹（例如 `v2.xx.x.windows.1/`），下载其中名为 `Git-2.xx.x-64-bit.exe` 的文件。这是同一个官方安装包的镜像副本。

> 只从上面两个地址下载。不要用搜索引擎里的「高速下载」「下载器」链接，那些常捆绑垃圾软件。

---

## 三、安装（每一屏怎么选）

双击下载好的 `Git-2.xx.x-64-bit.exe`。如果弹出「是否允许此应用对你的设备进行更改」，点 **是**。

安装向导是英文的，共十几屏。**绝大多数保持默认、直接点 Next**，只有 3 处需要改，下表用 **【要改】** 标出。不同版本的屏幕顺序可能略有差异，按标题对照即可。

| 屏幕标题（英文） | 意思 | 怎么选 |
|---|---|---|
| Information | 许可协议 | 点 **Next** |
| Select Destination Location | 安装到哪里 | 保持默认 `C:\Program Files\Git`，点 **Next** |
| Select Components | 安装哪些组件 | 保持默认勾选，点 **Next** |
| Select Start Menu Folder | 开始菜单文件夹 | 保持默认，点 **Next** |
| Choosing the default editor used by Git | git 需要你写较长文字时用哪个编辑器 | **【要改】** 下拉框选 **Use Notepad as Git's default editor**（用记事本）。默认的 Vim 对新手很难用，进去了都不知道怎么退出。点 **Next** |
| Adjusting the name of the initial branch in new repositories | 新项目的主线叫什么名字 | **【要改】** 选第二项 **Override the default branch name for new repositories**，下方输入框填 `main`（多数情况已经默认填好）。点 **Next** |
| Adjusting your PATH environment | 能否在命令行里直接用 git | 保持默认 **Git from the command line and also from 3rd-party software**（标着 Recommended），点 **Next**。这一项决定 AI 负责人能不能调用 git，务必是这一项 |
| Choosing the SSH executable | 远程连接工具 | 保持默认 **Use bundled OpenSSH**，点 **Next** |
| Choosing HTTPS transport backend | 联网加密方式 | **【要改】** 选 **Use the native Windows Secure Channel library**（用 Windows 自带的证书）。这样公司/家庭网络里的证书问题更少。点 **Next** |
| Configuring the line ending conversions | 换行符怎么处理 | 保持默认 **Checkout Windows-style, commit Unix-style line endings**，点 **Next** |
| Configuring the terminal emulator to use with Git Bash | Git 自带命令窗口的样式 | 保持默认 **Use MinTTY**，点 **Next** |
| Choose the default behavior of `git pull` | 拉取远程更新的方式 | 保持默认 **Fast-forward or merge**，点 **Next** |
| Choose a credential helper | 记住远程仓库密码的工具 | 保持默认 **Git Credential Manager**，点 **Next** |
| Configuring extra options | 额外选项 | 保持默认（勾选 Enable file system caching），点 **Next** |
| Configuring experimental options | 实验功能 | **都不勾**，点 **Install** |
| Completing the Git Setup Wizard | 安装完成 | 取消勾选 「View Release Notes」，点 **Finish** |

> 只有 3 处要改：编辑器选记事本、主线名填 `main`、HTTPS 选 Windows Secure Channel。万一选错了也没关系，重新运行安装包会让你再选一遍，不会丢东西。

---

## 四、验证装好了

1. 按键盘 **Win 键**，输入 `PowerShell`，点击打开 **Windows PowerShell**（蓝色窗口）。
   - 如果 PowerShell 在安装 git 之前就开着，**先关掉再重新打开**，否则它找不到新装的 git。
2. 在窗口里输入下面这行，按回车：

   ```
   git --version
   ```

3. 看结果：
   - 显示类似 `git version 2.xx.x.windows.1` → **装好了**，继续第五步。
   - 显示「无法将 git 项识别为 cmdlet、函数……」→ 没装好。先**重启电脑**再试一次；仍然不行，重新运行安装包，特别注意 PATH 那一屏选的是 Recommended 那项。

---

## 五、首次配置（只需做一次）

git 每次记录修改时会写上「是谁改的」，所以要先告诉它你的名字和邮箱。还是在 PowerShell 里，**一行一行**复制、粘贴、回车（粘贴可以在窗口里点鼠标右键）。

### 1. 名字和邮箱（必做）

把引号里的内容换成你自己的：

```
git config --global user.name "你的名字或昵称"
git config --global user.email "你的邮箱"
```

- 名字用中文、英文、昵称都可以，只是用来显示。
- **邮箱提醒**：如果以后要把代码放到 GitHub 等网站（见 `git-workflow.md` 第七节），这个邮箱会出现在提交记录里。介意的话，等注册 GitHub 后可以改成它提供的隐私邮箱（形如 `数字+用户名@users.noreply.github.com`），重新执行上面第二行即可。

### 2. 推荐设置（建议都做，避免中文乱码等小问题）

```
git config --global init.defaultBranch main
git config --global core.quotepath false
git config --global i18n.commitEncoding utf-8
git config --global i18n.logOutputEncoding utf-8
git config --global core.autocrlf true
```

每行的作用：

| 设置 | 作用 |
|---|---|
| `init.defaultBranch main` | 主线统一叫 `main`（安装时已选，这里再保险一次） |
| `core.quotepath false` | 中文文件名正常显示，而不是一串 `\346\226\207` 这样的乱码 |
| `i18n.commitEncoding` / `i18n.logOutputEncoding` | 中文提交说明按 UTF-8 存储和显示 |
| `core.autocrlf true` | Windows 和 Linux 服务器之间换行符自动转换（与安装时的默认选项一致） |

### 3. 检查配置

```
git config --global --list
```

能看到 `user.name=…`、`user.email=…` 以及上面几项，就全部完成了。

---

## 六、做完之后

告诉项目总负责人「git 装好了」。接下来由运维负责人在项目文件夹里建立 git 仓库（`git init`）并做第一次提交，**这一步不需要你动手**。

---

## 常见问题

**Q：PowerShell 里看提交记录（git log）时中文变成 `<E4><B8><AD>` 这样的乱码？**
在 PowerShell 执行下面这行，然后关掉 PowerShell 重新打开：

```
[Environment]::SetEnvironmentVariable("LESSCHARSET", "utf-8", "User")
```

它的作用是告诉 git 显示长内容时用的翻页工具按 UTF-8 显示中文，只影响你自己这个 Windows 账户。

**Q：git log 显示到一半停住了，底下有个冒号 `:`，怎么退出？**
按键盘 **q** 键。

**Q：不小心进入了一个看不懂的全屏编辑界面？**
如果是记事本，写好内容后保存并关闭记事本即可。如果是黑底界面（Vim，说明编辑器没选成记事本），依次按 **Esc**，输入 `:q!`，回车即可退出；然后执行 `git config --global core.editor notepad` 改成记事本。

**Q：以后要升级 git 吗？**
不用经常升级。需要时在 PowerShell 执行 `git update-git-for-windows`，或者重新下载最新安装包覆盖安装。
