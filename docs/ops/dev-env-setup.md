# 开发环境安装说明（Windows 11）：Node.js、pnpm、Docker Desktop

> 负责人：运维负责人 · 最后更新：2026-10-04 · 来源任务：T-007，T-011 修订（pnpm 改为 11）
> 读者：总经理（零基础）。照着一步步做，大约 60–90 分钟，中间要**重启电脑 1–2 次**。
> 软件版本以 `docs/decisions/ADR-0003-tech-stack.md`「版本基线」为准，本文只讲「怎么装、怎么验证」。git 已按 `docs/ops/git-setup.md` 装好，本文不再涉及。

---

## 一、先弄懂要装的三样东西（3 分钟）

还是把项目想成**一本书稿**，不过这本书要被「印刷」成能用的软件。

| 软件 | 通俗解释 | 打个比方 |
|---|---|---|
| **Node.js** | 让电脑能运行 JavaScript / TypeScript 程序的「发动机」。我们的服务器、网页构建工具、测试工具全靠它跑。 | 印刷厂的**动力电源**。没它，所有机器都不转。 |
| **pnpm** | 「零件管家」。项目要用到成百上千个别人写好的代码包（零件），pnpm 负责按清单把它们下载、放好、保证每台电脑装的版本一模一样。 | 印刷厂的**仓库管理员**，按采购单进货、编号上架。 |
| **npm** | Node.js 自带的旧版零件管家。我们只用它做一件事：把 pnpm 装上。 | 管理员的**前任**，交接完就退居二线。 |
| **Docker Desktop** | 在你的电脑里开一个个「标准集装箱」，把数据库（PostgreSQL）装在箱子里运行。好处：不弄乱你的电脑，一条命令开、一条命令关，而且和香港服务器上跑的是同一个箱子。 | 厂房里的**标准集装箱**：数据库整箱运来，用完整箱拿走，地板上不留痕迹。 |
| **WSL 2** | Windows 自带的「迷你 Linux」。Docker 的集装箱需要 Linux 才能跑，WSL 2 就是给它提供 Linux 环境的底座。 | 集装箱要放在**专用码头**上，WSL 2 就是码头。 |

术语：
- **命令行 / PowerShell**：一个蓝色（或黑色）窗口，用打字的方式让电脑做事。本文所有「输入命令」都在这里做。
- **验证命令**：装完后输入的一句话，电脑回答一个版本号，就说明装好了。
- **镜像站**：国外网站在国内的「复印件」，内容相同，下载更快。

---

## 二、哪些软件现在**不用装**

| 软件 | 什么时候装 | 说明 |
|---|---|---|
| Android Studio、JDK（Java） | 安卓阶段（L5）开工前 | 体积大（10 GB 以上），到时另写说明 |
| PostgreSQL 数据库（直接装在 Windows 上） | **永远不要装** | 数据库跑在 Docker 集装箱里。如果另装一个，两者会抢同一个「门牌号」（5432 端口）导致冲突 |
| Redis、MySQL、MongoDB | 不需要 | 技术选型里没有它们 |
| Python、Visual Studio 生成工具 | 不需要 | 安装 Node.js 时有一个勾选项会顺带装它们，**不要勾**（见第四节） |
| nvm 等「Node 版本切换器」 | 不需要 | 我们只用一个 Node 版本 |
| Playwright 测试浏览器 | 不用手动装 | 以后由 AI 负责人用一条命令自动下载 |
| VS Code 等代码编辑器 | 可选 | 你不需要写代码。想舒服地看文档可以装，不装不影响开发 |
| GitHub 账号、GitHub CLI | 做自动化测试（D-L0-03）时 | 到时另行通知 |

---

## 三、开工前检查电脑（10 分钟）

### 1. Windows 版本

按 **Win + R**，输入 `winver`，回车。弹出的窗口里看「版本」：

| 看到的版本 | 怎么办 |
|---|---|
| **24H2** 或 **25H2**（或更新） | 很好，继续 |
| **23H2**（内部版本 22631） | 能装 Docker（23H2 是它的最低要求），但这个版本微软已在 2025 年 11 月停止安全更新。**建议先升级**：开始菜单 → 设置 → **Windows 更新** → 检查更新，按提示升级到 24H2 或更新版本（要下载几个 GB、重启一次）。升级不会删你的文件 |
| 22H2 或更早 | 必须先按上面方法升级，否则 Docker 装不上 |

同一窗口也能看到是不是「专业版 / Pro」。家庭版也能用（走 WSL 2），不影响本文步骤。

### 2. 内存和硬盘

- **内存**：按 **Ctrl + Shift + Esc** 打开任务管理器 → 点左侧 **性能** → **内存**，右上角显示总量。**至少 8 GB**，16 GB 更舒服。
- **硬盘**：打开「此电脑」，看 **C 盘**剩余空间，**至少 20 GB**（Node 约 0.1 GB，Docker 和 WSL 约 3–5 GB，以后数据库镜像和项目零件还会再占几个 GB）。

### 3. 虚拟化是否已开启（Docker 必需）

还在任务管理器 → **性能** → 点 **CPU**，看右下方的一行：

- **「虚拟化：已启用」**（英文系统是 `Virtualization: Enabled`）→ 很好，继续。
- **「虚拟化：已禁用」** → 需要进 BIOS 打开，见下方「附：怎么在 BIOS 里开启虚拟化」。**做完再继续第六节**；第四、五节（Node.js、pnpm）不受影响，可以先装。

> **附：怎么在 BIOS 里开启虚拟化**
> BIOS 是电脑开机最早出现的设置界面，不同品牌长得不一样。
> 1. 保存好手头的文件，**重启电脑**，在屏幕刚亮、出现品牌 Logo 时连续按进入键：联想多为 **F2**（或机身侧面的 Novo 小孔），戴尔 **F2**，惠普 **F10**（或先按 Esc），华硕 **F2 / Del**，台式机组装机多为 **Del**。
> 2. 进去后用方向键找一个名字类似下列之一的选项，改为 **Enabled（启用）**：
>    - Intel 电脑：`Intel Virtualization Technology`、`Intel VT-x`、`VT-x`
>    - AMD 电脑：`SVM Mode`、`AMD-V`
>    它常藏在 `Advanced`、`Configuration`、`Security` 或 `CPU Configuration` 菜单里。
> 3. 按 **F10** 保存并退出（会问 Save and Exit，选 Yes），电脑自动重启。
> 4. 回到任务管理器确认变成「已启用」。
> 
> 找不到这个选项时，**不要乱改其他设置**，把电脑品牌和型号（机身底部标签上有）告诉项目总负责人，我们给你查具体位置。

---

## 四、安装 Node.js 24 LTS（15 分钟）

LTS 是「长期支持版」，官方保证修 bug、补安全漏洞好几年，最适合做项目。

### 1. 下载安装包

**推荐：官网下载。**

1. 浏览器打开 <https://nodejs.org/zh-cn/download>
2. 页面上选择：版本选 **v24.x.x（LTS）**，系统选 **Windows**，架构选 **x64**，然后点「Windows 安装程序（.msi）」按钮。
   文件名形如 `node-v24.xx.x-x64.msi`（xx 是小版本号，24 开头的最新版都行），大小约 30 MB。
   - 也可以直接打开 <https://nodejs.org/dist/latest-v24.x/>，点名为 `node-v24.xx.x-x64.msi` 的文件。
3. **如果官网很慢或打不开**，用国内镜像（同一个官方安装包的副本）：
   打开 <https://registry.npmmirror.com/binary.html?path=node/latest-v24.x/>，下载其中 `node-v24.xx.x-x64.msi`。

> 只从上面的地址下载。不要选 v25、v26 这类非 24 开头的版本，也不要用「高速下载器」。

### 2. 安装（每一屏怎么选）

双击 `node-v24.xx.x-x64.msi`。安装向导是英文的，**只有 1 处不要勾**，用 **【注意】** 标出：

| 屏幕标题（英文） | 意思 | 怎么选 |
|---|---|---|
| Welcome to the Node.js Setup Wizard | 欢迎 | 点 **Next** |
| End-User License Agreement | 许可协议 | 勾选 **I accept the terms in the License Agreement**，点 **Next** |
| Destination Folder | 安装位置 | 保持默认 `C:\Program Files\nodejs\`，点 **Next** |
| Custom Setup | 装哪些组件 | **全部保持默认**（Node.js runtime、Corepack manager、npm package manager、Online documentation shortcuts、Add to PATH 都是默认要装的），点 **Next**。其中 **Add to PATH** 决定命令行能不能找到 node，务必保留 |
| Tools for Native Modules | 是否自动安装编译工具 | **【注意】不要勾选** 那个 「Automatically install the necessary tools…」 复选框，直接点 **Next**。勾了会额外下载约 3 GB 的 Python 和 Visual Studio 工具，耗时长、国内网络常失败，我们的项目用不到 |
| Ready to install Node.js | 准备安装 | 点 **Install**。弹出「是否允许此应用对你的设备进行更改」点 **是** |
| Completed the Node.js Setup Wizard | 完成 | 点 **Finish** |

> 万一不小心勾了「Tools for Native Modules」，安装结束后会弹出一个黑色窗口开始下载工具。直接点窗口右上角 × 关掉即可，Node.js 本身已经装好了。

### 3. 验证

1. **关掉所有已经打开的 PowerShell 窗口**，然后按 **Win** 键，输入 `PowerShell`，打开 **Windows PowerShell**。（必须新开，旧窗口不认识刚装的软件。）
2. 输入下面这行，按回车：

   ```
   node -v
   ```

   - 显示 `v24.xx.x` → **成功**。
   - 显示「无法将 node 项识别为 cmdlet、函数……」→ 重启电脑后再试；仍然不行，重新运行安装包，确认 Custom Setup 那一屏的 Add to PATH 没被关掉。

3. 再输入：

   ```
   npm -v
   ```

   - 显示一个版本号（形如 `11.x.x`）→ **成功**，跳到第五节。
   - 显示「**无法加载文件 C:\Program Files\nodejs\npm.ps1，因为在此系统上禁止运行脚本**」→ 这是 Windows 的默认安全设置挡住了，按下面一步放行，然后再输入 `npm -v`。

### 4. （遇到上面的「禁止运行脚本」才需要做）允许运行本机脚本

Windows 默认不允许 PowerShell 运行任何脚本文件，而 npm、pnpm 的启动器正是脚本文件。我们把它改成「本机的脚本可以运行，从网上下载的脚本必须有签名」——这是微软给开发者推荐的设置，**只影响你自己这个 Windows 账户**。

在 PowerShell 里输入，回车：

```
Set-ExecutionPolicy -Scope CurrentUser -ExecutionPolicy RemoteSigned
```

如果问「是否要更改执行策略?」，输入 `Y` 回车。然后检查：

```
Get-ExecutionPolicy -Scope CurrentUser
```

显示 `RemoteSigned` 即完成。这一步也让 AI 负责人以后能在你电脑上正常调用 pnpm。

---

## 五、安装 pnpm（10 分钟）

### 1. （可选）国内网络：把下载源换成国内镜像

pnpm 和项目的零件默认从美国的 npm 官方仓库下载。在国内可能很慢甚至失败。可以把下载源换成国内镜像站 npmmirror。

| | 说明 |
|---|---|
| 好处 | 下载速度快很多，以后每次安装零件都受益 |
| 坏处 | 镜像同步有几分钟到十几分钟延迟，刚发布的新版本偶尔暂时下不到；它由第三方（阿里系的 cnpm 团队）运营，但每个零件都带官方的「指纹」，pnpm 会核对，被篡改的零件装不上 |
| 影响范围 | 只改你这台电脑的个人设置，**不写进项目仓库**，香港服务器和自动化测试不受影响 |

**我们的建议**：先不换，直接做下一步。如果下一步卡住超过 3 分钟、或报 `ETIMEDOUT`、`ECONNRESET`、`network` 之类的错误，再回来执行这一行：

```
npm config set registry https://registry.npmmirror.com
```

检查是否生效（应显示 `https://registry.npmmirror.com/`）：

```
npm config get registry
```

以后想换回官方源：`npm config delete registry`。这个设置 npm 和 pnpm 共用，设一次就行。

### 2. 安装 pnpm

在 PowerShell 里输入，回车：

```
npm install -g pnpm@11
```

- `-g` 表示「装在全局」，即整台电脑都能用；`@11` 表示装第 11 代（与 ADR-0003 版本基线一致；T-009 从 10 改为 11）。
- 以前装过 pnpm 10 的，直接执行这一行就会升级到 11，不用先卸载。
- 等它跑完，最后出现 `added 1 package` 之类的字样就行。中间出现黄色 `npm warn` 字样不用管。
- **不需要**用「管理员身份」打开 PowerShell。

> 为什么不用 Node.js 自带的 Corepack 来装 pnpm？Corepack 在 Windows 上启用要管理员权限，而且 Node.js 25 以后已经不再自带它；我们以后升级 Node 时还得换方法。用 npm 装一次最简单、最稳。仓库骨架（T-011）已在根目录 `package.json` 的 `devEngines.packageManager` 锁定了 pnpm 的具体版本（11.x 中的一个），电脑上的 pnpm 版本不一致时，pnpm 会自动下载并改用项目要求的版本，你不用操心。

### 3. 验证

**关掉 PowerShell 重新打开**，输入：

```
pnpm -v
```

- 显示 `11.xx.x` → **成功**。
- 显示「无法将 pnpm 项识别为……」→ 重启电脑再试；仍不行，见文末「常见问题」。
- 显示「无法加载文件 …\pnpm.ps1，因为在此系统上禁止运行脚本」→ 回到第四节第 4 步。

---

## 六、安装 WSL 2（10 分钟，需重启）

Docker 需要它。**要先确认第三节的「虚拟化：已启用」**。

### 1. 先看看是不是已经装了

普通 PowerShell 里输入：

```
wsl --version
```

- 显示好几行，第一行形如 `WSL 版本: 2.x.x.x`（英文 `WSL version: 2.x.x.x`），且大于等于 2.1.5 → **已装好**，直接跳到第七节。
- 显示 1.x、或者小于 2.1.5 → 执行第 3 步「更新」。
- 显示一大段使用帮助、或者「找不到」「未安装」之类 → 执行第 2 步「安装」。

### 2. 安装

1. 按 **Win** 键，输入 `PowerShell`，**右键** Windows PowerShell → **以管理员身份运行**，弹窗点 **是**。（窗口标题会带「管理员」字样。）
2. 输入，回车：

   ```
   wsl --install --no-distribution
   ```

   `--no-distribution` 表示只装 WSL 本身，不额外装 Ubuntu 系统。Docker 用不到 Ubuntu，这样还省得设置一套 Linux 用户名和密码。
3. 看到「操作成功完成」或提示需要重启 → **重启电脑**。
4. 重启后打开普通 PowerShell，再执行一次 `wsl --version`，确认第一行是 2.x。

### 3. 更新（已装但版本旧时）

管理员 PowerShell 里输入：

```
wsl --update
```

完成后执行 `wsl --shutdown`，再 `wsl --version` 检查。

---

## 七、安装 Docker Desktop（20 分钟）

### 0. 许可说明（不用花钱）

Docker Desktop 对**个人使用**、以及员工少于 250 人且年收入低于 1000 万美元的小企业**免费**。微伴是个人学习项目，属于免费范围。

### 1. 下载

1. 浏览器打开 Docker 官方安装页：<https://docs.docker.com/desktop/setup/install/windows-install/>
2. 点页面上方的 **Docker Desktop for Windows - x86_64** 按钮。文件名 `Docker Desktop Installer.exe`，大小约 500–600 MB。
   - 如果你的电脑是 ARM 处理器（极少见，如部分 Surface Pro X、骁龙笔记本），选 Arm 版本；不确定就选 x86_64。
3. **如果官网下载太慢**：打开 Windows 自带的 **Microsoft Store**，搜索 `Docker Desktop`，确认发布者是 **Docker Inc**，点「获取 / 安装」。这也是官方渠道。

> 不要从网盘、论坛、「破解版 / 汉化版」下载 Docker。

### 2. 安装（每一屏怎么选）

双击 `Docker Desktop Installer.exe`。屏幕顺序可能因版本略有差异，按内容对照即可：

| 屏幕内容（英文） | 意思 | 怎么选 |
|---|---|---|
| 选择安装方式：**Per-user**（只给当前用户装）/ **All users**（给所有用户装） | 装给谁 | 保持默认 **Per-user**（官方推荐，不需要管理员权限，以后自动更新也不用管理员）。点 **Next** / **OK** |
| **Configuration** 配置页 | 选项 | **【必须勾】** `Use WSL 2 instead of Hyper-V (recommended)`。`Add shortcut to desktop`（加桌面快捷方式）勾不勾随意，建议勾。如果页面上还有别的复选框，保持默认。点 **OK** |
| Unpacking files / Installing | 安装中 | 等几分钟，不要关窗口 |
| **Installation succeeded** | 安装成功 | 点 **Close**。如果按钮是 **Close and restart** 或 **Close and log out**，说明需要重启或注销，先保存好手头的文件再点 |

> 如果中途弹出「是否允许此应用对你的设备进行更改」，点 **是**。
> 如果提示 WSL 需要安装或更新，回到第六节做完再重新运行安装包。

### 3. 首次启动（要注意的几屏）

从桌面快捷方式或开始菜单打开 **Docker Desktop**。第一次启动要 1–3 分钟。

| 你会看到 | 怎么做 |
|---|---|
| **Docker Subscription Service Agreement**（服务协议） | 点 **Accept**。不接受 Docker 就无法运行 |
| 要你登录 / 注册 Docker 账号（Sign in / Sign up） | **不需要登录**。点 **Skip**（跳过）或 **Continue without signing in**。不登录完全够用；以后如果拉镜像遇到「次数超限」，再注册一个免费账号即可 |
| 问卷（你的职业、用途等） | 点 **Skip** |
| 提示 WSL 需要更新（`WSL needs updating` 之类） | 按提示点更新，或在管理员 PowerShell 执行 `wsl --update`，然后重开 Docker Desktop |
| 窗口左下角显示绿色的 **Engine running** | **启动成功** |

屏幕右下角的任务栏托盘里会出现一个**小鲸鱼图标**。鲸鱼静止 = 正在运行；鲸鱼图标上有动画 = 正在启动。

### 4. 推荐设置（2 分钟）

点 Docker Desktop 右上角的**齿轮图标**（Settings）→ **General**：

| 选项 | 建议 |
|---|---|
| `Start Docker Desktop when you sign in to your computer`（开机自动启动） | 内存 **16 GB 及以上**：可以勾选，省得每次手动开。内存 **8 GB**：建议**不勾**，开发前手动打开 Docker Desktop |
| `Send usage statistics`（发送使用统计） | 建议**不勾**，减少数据外发 |
| 其他选项 | 保持默认 |

改完点右下角 **Apply & restart**（或 **Apply**）。

### 5. 验证

打开**新的** PowerShell（普通的就行），依次输入：

```
docker --version
```

显示形如 `Docker version 2x.x.x, build xxxxxxx` → 成功。

```
docker compose version
```

显示形如 `Docker Compose version v2.xx.x` → 成功。（我们用它一条命令启动数据库。）

最后做一次真正的「开箱测试」：

```
docker run --rm hello-world
```

这条命令会从网上下载一个只有几 KB 的测试集装箱并运行它。

- 输出里有一行 **`Hello from Docker!`** → **全部成功**。
- 等了很久后报 `timeout`、`TLS handshake timeout`、`context deadline exceeded`、`connection refused` 之类 → 是国内访问 Docker 官方镜像仓库的网络问题，见下一步。
- 报 `error during connect` 或 `The system cannot find the file specified` → Docker Desktop 没在运行，打开它、等左下角出现 Engine running 再试。

### 6. （上一步网络报错才做）配置 Docker 镜像加速

Docker 的「集装箱仓库」Docker Hub 在国内经常连不上。可以让 Docker 先从国内镜像站取。

1. Docker Desktop → 齿轮图标 **Settings** → 左侧 **Docker Engine**。
2. 右侧是一段大括号包起来的文字（叫 JSON 配置）。在**第一个 `{` 的下一行**插入下面这一行（注意末尾有英文逗号）：

   ```
   "registry-mirrors": ["https://docker.m.daocloud.io"],
   ```

   插入后的样子大致如下（其余原有内容不动）：

   ```
   {
     "registry-mirrors": ["https://docker.m.daocloud.io"],
     "builder": {
       ...原来的内容...
     },
     ...
   }
   ```

3. 点右下角 **Apply & restart**。如果提示格式错误，多半是逗号、引号用成了中文符号，或者逗号漏了，检查后再点。
4. 等 Engine running 后，重新执行 `docker run --rm hello-world`。

说明：
- 这是第三方（DaoCloud）提供的免费加速服务，国内的这类服务时有关停。**仍然失败时不要自己换来换去**，把报错原文发给项目总负责人，由运维负责人给出当时可用的方案。
- 只影响你的开发电脑；香港生产服务器直连官方仓库，不用镜像站。

---

## 八、资源占用提醒（必读）

Docker Desktop 运行时会在后台开一台「迷你 Linux 虚拟机」，即使你没在开发也会占资源：

| 资源 | 占用情况 | 建议 |
|---|---|---|
| 内存 | WSL 2 默认最多可用到电脑内存的一半，常见实际占用 1–3 GB | 不开发时：右键托盘小鲸鱼 → **Quit Docker Desktop** 退出，内存就还回来了 |
| 硬盘 | 镜像和数据库数据会慢慢变大，存在 `C:\Users\你的用户名\AppData\Local\Docker\` 下 | 一般几个 GB，不用管。C 盘紧张时告诉项目总负责人，我们给出清理命令 |
| CPU / 电池 | 空闲时很低；笔记本不插电时会更耗电一些 | 同上，不用时退出 |

**（可选）给 WSL 设内存上限**，适合 8 GB / 16 GB 内存、开着 Docker 觉得卡的电脑：

1. PowerShell 里输入（会打开记事本，问「是否创建新文件」点 **是**）：

   ```
   notepad "$env:USERPROFILE\.wslconfig"
   ```

2. 在记事本里粘贴下面两行，保存并关闭：

   ```
   [wsl2]
   memory=4GB
   ```

   8 GB 内存的电脑可以写 `memory=3GB`。我们开发用的数据库 1 GB 就够。
3. PowerShell 里执行 `wsl --shutdown`，再重新打开 Docker Desktop，设置生效。

---

## 九、常见问题

**Q：输入命令后显示「无法将 xxx 项识别为 cmdlet、函数、脚本文件或可运行程序的名称」？**
新装的软件，旧的 PowerShell 窗口不认识。**关掉所有 PowerShell 重新打开**；仍不行就**重启电脑**。还不行，说明安装时 PATH 那一项没选对，重新运行对应安装包。

**Q：`pnpm -v` 一直找不到，但 `npm -v` 正常？**
执行 `npm config get prefix`，会显示一个文件夹（通常是 `C:\Users\你的用户名\AppData\Roaming\npm`）。把这个结果和报错一起发给项目总负责人。

**Q：`npm install -g pnpm@11` 报 `EPERM`、`operation not permitted`？**
通常是杀毒软件或另一个窗口占用了文件。关掉其他 PowerShell 窗口，等一分钟再执行一次。仍失败把报错发给总负责人。**不要**为了绕过它去用管理员身份反复尝试。

**Q：WSL 安装卡在 0% 不动？**
按 **Ctrl + C** 取消，在管理员 PowerShell 执行 `wsl --update --web-download`（改从微软网站直接下载），完成后重启电脑。

**Q：执行 wsl 命令或启动 Docker 时提示「请启用虚拟机平台 Windows 功能并确保在 BIOS 中启用虚拟化」或 `Virtualization support not detected`？**
回到第三节第 3 步，确认任务管理器里「虚拟化：已启用」。已启用仍报错，在管理员 PowerShell 执行 `wsl --install --no-distribution`，重启电脑。

**Q：Docker Desktop 一直显示「Docker Desktop is starting…」超过 5 分钟？**
右键托盘小鲸鱼 → Quit Docker Desktop；在 PowerShell 执行 `wsl --shutdown`；再打开 Docker Desktop。仍不行就重启电脑。还不行，在 Docker Desktop 右上角点小虫子图标（Troubleshoot），截图发给总负责人。

**Q：wsl --version 输出的字中间有很多空格，或者是乱码？**
这是 wsl 程序在 Windows PowerShell 里的老毛病，不影响使用，照样复制给我们就行。

**Q：Docker 提示更新（Update available）要不要点？**
可以点，Docker 的更新一般是安全的。更新期间正在运行的数据库会暂停，更新完自动恢复。正在开发重要内容时可以晚点再更新。

**Q：项目文件夹放在哪里？**
保持在现在的位置即可。**不要**把项目放进 OneDrive、百度网盘等「自动同步文件夹」，项目里的零件文件夹（node_modules）有几万个小文件，同步会让电脑卡死、还可能弄坏文件。

---

## 十、装完自查清单

全部装好后，打开一个**新的** PowerShell，**把下面整段一次复制、右键粘贴、回车**：

```
"--- Windows ---"; (Get-ItemProperty 'HKLM:\SOFTWARE\Microsoft\Windows NT\CurrentVersion').DisplayVersion
"--- node ---"; node -v
"--- npm ---"; npm -v
"--- npm registry ---"; npm config get registry
"--- pnpm ---"; pnpm -v
"--- ExecutionPolicy ---"; Get-ExecutionPolicy -Scope CurrentUser
"--- wsl ---"; wsl --version
"--- docker ---"; docker --version
"--- compose ---"; docker compose version
"--- hello-world ---"; docker run --rm hello-world
```

然后**选中窗口里的全部输出、复制，发给项目总负责人**就算完成。（PowerShell 里用鼠标拖选文字，按回车或右键即可复制。）

对照表（你也可以自己先看一眼）：

| 检查项 | 合格的样子 | 对应章节 |
|---|---|---|
| Windows | `24H2`、`25H2` 或更新（`23H2` 能用但建议升级） | 第三节 |
| node | `v24.` 开头 | 第四节 |
| npm | 一个版本号，如 `11.x.x` | 第四节 |
| npm registry | `https://registry.npmjs.org/`（官方）或 `https://registry.npmmirror.com/`（国内镜像），两者都合格 | 第五节第 1 步 |
| pnpm | `11.` 开头 | 第五节 |
| ExecutionPolicy | `RemoteSigned`（如果是 `Undefined` 但 npm、pnpm 都能显示版本号，也合格） | 第四节第 4 步 |
| wsl | 第一行 `WSL 版本: 2.x.x.x`（不低于 2.1.5） | 第六节 |
| docker | `Docker version 2x.x.x` | 第七节 |
| compose | `Docker Compose version v2.x.x` 或更新（2026 年新版 Docker Desktop 显示 `v5.x.x`，也合格） | 第七节 |
| hello-world | 出现 `Hello from Docker!` | 第七节第 5 步 |

全部合格后，就可以开始 D-L0-01（仓库骨架）了，这一步由运维负责人在你的电脑上完成，**不需要你动手**。仓库骨架和本机数据库（D-L0-01、D-L0-02）已在 T-011 完成，怎么起停数据库、怎么跑检查见 `docs/ops/local-dev.md`。
