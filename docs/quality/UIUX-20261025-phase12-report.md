# 微伴 UI/UX 系统审计报告：第一、二阶段

审计日期：2026-10-25（北京时间）。**只读审计，不是发布验收；未修改业务代码、设计令牌、契约、测试或 CI。**

## 1. 结论与优先级

不建议先做逐页美化。应先处理 **公共弹层的键盘边界、配置读取前可保存、主操作/说明文字对比度**，再收敛共享表格与管理页信息层级。本轮记录 **10 项问题（2 项 P1、8 项 P2）及 2 项范围/环境风险**；问题状态区分运行确认、源码确认与未验证条件，不把静态疑点直接算成视觉缺陷。

- 已归档 **478 幅带记录截图**：路由基准与状态 416、弹层/抽屉 44、专项量测 10、线上公开壳 8。数量不等于业务流程通过数。
- 网页对 114 条 page 样例做桌面/移动采集：224 幅停在目标路径，4 幅发生转向（2 条样例 × 2 视口）；后台 34 个独立页面 × 2 视口均有截图。/reports 复用广场页，清单另记；未把它冒充新的独立页面。
- 清单：网页 124 条、后台 43 条、安卓 99 个逻辑 UI 节点。包含门禁、跳转、参数变体，不可把合计当成独立页面数。安卓没有运行截图。
- 重点共享组件 76 个；补充全图得到 301 个有实际 JSX 使用的导出 UI 符号、1225 条引用。全图扫描337个源文件、2359条导入边；局部未导出组件/动态组件名有分析边界。
- **只读证据：1809 个源/设计/契约/测试文件 SHA256 对比，变化 0 个。** 质量文档不在该指纹范围。

| 优先级 | 问题 | 验证口径 |
|---|---|---|
| P1 · UX-01 | 网页弹层没有形成完整的键盘操作边界 | 运行确认；旁支确认框为源码确认 |
| P1 · UX-02 | 全站配置尚未读到时，保存仍然可用且没有明确加载状态 | 运行确认 + 源码确认；未提交保存请求 |
| P2 · UX-03 | 主操作白字配品牌绿，对比度只有 2.38:1 | 计算样式量测确认 |
| P2 · UX-04 | 后台说明文字过浅且普遍为 12px | 运行与计算样式确认 |
| P2 · UX-05 | 编辑输入框覆盖了全局键盘焦点样式 | 运行量测 + 源码确认 |
| P2 · UX-06 | 旧卡历史静态 Modal 脱离后台主题上下文 | 运行确认 + 源码确认 |
| P2 · UX-07 | 共享表格出现重复刷新与额外空工具带 | 运行确认 + 源码确认 |
| P2 · UX-08 | 模型管理的主要工作区被低频配置卡压到首屏下方 | 截图与结构确认 |
| P2 · UX-09 | 生态决策模型说明在同一页面互相矛盾 | 源码与当前渲染文案确认 |
| P2 · UX-10 | 旧卡版本预览静默截断关键人设内容 | 源码确认；截图只确认预览形态，长文本条件未单独实测 |

## 2. 版本、方法与可信边界

### 2.1 两个版本不能混为一谈

- 当前目标：分支 codex/voice-v02-v06-20261024，HEAD 11255c61381386f8708cdbb6eed0f2a51ee0e256 **加未提交的4.1工作树**。本地预览直接运行当前源码，不使用过期 dist。
- 线上公开样本：提交 d72f9f7b7590af96cf30220417d78f2f02a6df95，契约4.0，部署时间2026-10-24T22:48:21.313569Z（北京时间10月25日06:48）。只拍公开壳，不登录。
- 4.1旧卡编辑/历史恢复、头像按钮、私密固定模型等未发布变化不能拿线上4.0截图判‘本地仍没改’。本轮也没有证明其真实数据库保存/恢复已成功。

### 2.2 截图怎样得到

当前源码预览为127.0.0.1:4173/4174；保留真实 App、Router、组件和业务 CSS，在独立审计入口替换 API 响应并种入虚构账号、角色与12条普通合成聊天。API代理已清空、非本地请求及未模拟写请求被阻断、WebSocket为空实现、Service Worker阻断；没有复制个人浏览器资料、Cookie或读取私人/成人聊天，没有付费调用、发消息、绑定、上传或生产删除。**这是当前组件+合成数据，不是实网功能验收。**

桌面1440×1000、窄屏390×844；另测钱包349宽、网页深色和1.35字号。只是浏览器视口，不是安卓真机、软键盘或手势认证。空/加载/错误各选10个网页和10个后台页面，每页两视口，共120幅；不是全部页面的全部状态。弹层为22个采集场景×两视口共44幅，不代表清单内全部弹层已测。

采样期间发现合成分页游标总非空会让经期读取循环不结束，已修审计夹具为有限页并从检查点续拍，**不把夹具问题算成产品性能缺陷**；早期非空余额提醒生成了Toast并发图，最终主要弹层证据使用无该提醒的clean版。部分并行任务未正常返回，保留静态产物后由主协调补齐采集和报告；未把失败任务视为审计通过。

## 3. 问题详情

### UX-01 · P1 · 网页弹层没有形成完整的键盘操作边界

**验证：** 运行确认；旁支确认框为源码确认

**现象：** 打开提示音等底部弹层后焦点仍留在背景；按两次 Tab 可落到背景的‘经期日记相关’链接。Sheet/Dialog 未标 aria-modal，也没有焦点限制和关闭后的焦点恢复。Sheet 已支持 Esc，不能把它误报为完全不支持键盘关闭。

**影响：** 使用键盘或读屏时，视觉上被遮罩的页面仍可进入；所有使用公共 Sheet/Dialog 的弹层均有同类实现风险，不能把静态调用数当作全部已复现。

**共享根因/代码：** [shell-kit.tsx:452–523](<C:/wb-dev/wb-client-logs/apps/web/src/features/shell-kit.tsx#L452-L523>)；[toast.tsx:56–95](<C:/wb-dev/wb-client-logs/apps/web/src/features/toast.tsx#L56-L95>)；[relations.tsx:293–310](<C:/wb-dev/wb-client-logs/apps/web/src/features/relations.tsx#L293-L310>)；[period.tsx:616–625](<C:/wb-dev/wb-client-logs/apps/web/src/features/period.tsx#L616-L625>)

**静态范围：** Sheet：31 处 JSX 调用行 / 41 条潜在路由；Dialog：46 处 JSX 调用行 / 73 条潜在路由；ActionSheet：8 处 JSX 调用行 / 15 条潜在路由。

**证据：** interactions-clean.json 的 before.activeElement.insideDialog=false；提示音 afterTab.insideDialog=false；ariaModal=null。关系删除/经期放弃修改还直接使用 .panel 充当 dialog，条件截图未覆盖。

[sound-choice-desktop.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/web/interactions-clean/sound-choice-desktop.png>)；[logout-confirm-mobile.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/web/interactions-clean/logout-confirm-mobile.png>)

**建议优先级：** 优先统一公共弹层的焦点进入、循环、背景不可交互、语义标记和焦点恢复规则，再迁移零散确认块；不要逐页添加临时事件监听。

**后续验收条件：** 键盘只能在弹层内循环；取消后回到触发按钮；读屏能识别模态及标题；核对嵌套弹层和危险确认策略。

### UX-02 · P1 · 全站配置尚未读到时，保存仍然可用且没有明确加载状态

**验证：** 运行确认 + 源码确认；未提交保存请求

**现象：** 系统设置的限流与线路健康卡在接口一直等待或读取失败时，输入框呈空值、‘不限’占位，右上保存仍为可点击绿色按钮。相邻好感度卡和生态设置已禁用保存，处理方式不一致。

**影响：** 管理员容易把‘尚未读到’误解成‘当前为空/不限’。必填校验能阻止完全空表单，但填写必填项后仍有把未读到的可选限流值按 null 提交的风险；没有实测或声称已经覆盖生产配置。

**共享根因/代码：** [settings.tsx:42–105](<C:/wb-dev/wb-client-logs/apps/admin/src/features/settings.tsx#L42-L105>)

**静态范围：** SectionCard：67 处 JSX 调用行 / 19 条潜在路由。

**证据：** 独立 loading 探针记录第一个保存 disabled=false；源码按钮只绑定 saving，没有绑定 remote.loading / remote.data / remote.error。

[admin-036-desktop-loading.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-036-desktop-loading.png>)；[admin-036-desktop-error.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-036-desktop-error.png>)；[admin-settings-loading-controls.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/probes/admin-settings-loading-controls.png>)

**建议优先级：** 将数据就绪、加载、读取失败、脏值和提交中作为统一表单状态；读取成功前禁止提交，并显示加载或重试入口。先修限流卡，再检查其它配置卡的同类模式。

**后续验收条件：** 慢响应/读取失败时不能提交空默认值；数据就绪后才允许修改；错误提示说明是读取失败而非用户填错。

### UX-03 · P2 · 主操作白字配品牌绿，对比度只有 2.38:1

**验证：** 计算样式量测确认

**现象：** 网页充值按钮与后台保存按钮均是白色小字配 #07C160。实测对比度 2.38:1，低于普通文字常用的 4.5:1 参考线；网页切深色后该按钮组合也未变化。

**影响：** 影响网页主操作和后台 Ant 主按钮，弱视、强光下辨认成本较高。品牌绿本身不是错误，问题是把同一个装饰品牌色直接作为小字承载底色。

**共享根因/代码：** [tokens.css:158–166](<C:/wb-dev/wb-client-logs/docs/design/tokens.css#L158-L166>)；[old-ui.css:196–208](<C:/wb-dev/wb-client-logs/apps/web/src/app/old-ui.css#L196-L208>)；[theme.ts:4–20](<C:/wb-dev/wb-client-logs/apps/admin/src/app/theme.ts#L4-L20>)

**证据：** visual-probes.json 中充值 16px/600、后台保存 13px/500，前景 rgb(255,255,255)，背景 rgb(7,193,96)，contrast=2.38。非完整 WCAG 认证。

[web-wallet-narrow.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/probes/web-wallet-narrow.png>)；[web-wallet-dark.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/probes/web-wallet-dark.png>)；[admin-model-light.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/probes/admin-model-light.png>)

**建议优先级：** 区分品牌展示色与功能性按钮/文字色，先修语义颜色来源，不逐页随意改绿；保持网页和后台合理的框架差异。

**后续验收条件：** 按真实前景/背景及字号复测主操作正常、悬停、按下、禁用状态；不把禁用态纳入普通文字对比要求。

### UX-04 · P2 · 后台说明文字过浅且普遍为 12px

**验证：** 运行与计算样式确认

**现象：** 页面说明、卡片副说明、字段帮助大量采用 #8A9099 / 12px。白卡上实测 3.22:1，#F4F5F7 页面底上 2.95:1；这些说明包含计费、限流、模型使用规则等重要内容，不只是装饰。

**影响：** 共享 Page / SectionCard / FieldHelp 的页面都受此样式影响。注意本次网页通用页说明量测为 4.58:1，并未证实网页所有次要文字都过浅。

**共享根因/代码：** [styles.css:186–225](<C:/wb-dev/wb-client-logs/apps/admin/src/app/styles.css#L186-L225>)；[page.tsx:6–74](<C:/wb-dev/wb-client-logs/apps/admin/src/ui/page.tsx#L6-L74>)

**静态范围：** Page：34 处 JSX 调用行 / 29 条潜在路由；SectionCard：67 处 JSX 调用行 / 19 条潜在路由。

**证据：** 后台模型页 page-head p=2.95，section-card-desc=3.22；字号均 12px。完整直接调用和样式命中在引用附件中。

[admin-model-light.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/probes/admin-model-light.png>)；[legacy-character-desktop.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/interactions-clean/legacy-character-desktop.png>)

**建议优先级：** 将重要规则提升到可读的次级正文，而非全部塞进低对比小字；统一后台说明文字的语义层级与颜色。

**后续验收条件：** 计费、安全、不可逆操作等说明在真实底色上清楚可读；正文、帮助、装饰三类明确区分。

### UX-05 · P2 · 编辑输入框覆盖了全局键盘焦点样式

**验证：** 运行量测 + 源码确认

**现象：** 昵称输入框已处于 :focus-visible，但 outline 为 none、border 为 0、box-shadow 为 none；只能靠文本光标识别焦点。多行编辑样式也显式取消 outline。

**影响：** 影响复用 edit-input-row / edit-textarea / form-page-field 等编辑样式的页面；其它位置可能有单独补偿，不能仅凭 outline:none 就把所有命中都判定为失败。

**共享根因/代码：** [styles.css:40–46](<C:/wb-dev/wb-client-logs/apps/web/src/app/styles.css#L40-L46>)；[edit-pages.css:98–155](<C:/wb-dev/wb-client-logs/apps/web/src/app/edit-pages.css#L98-L155>)；[edit-pages.css:335–342](<C:/wb-dev/wb-client-logs/apps/web/src/app/edit-pages.css#L335-L342>)

**静态范围：** SearchField：9 处 JSX 调用行 / 23 条潜在路由。

**证据：** nickname-focus 探针 focusVisible=true，outline=none，border=0px none，boxShadow=none。SearchField 属相邻需核查模式，不代表本轮已经逐个确认它的所有引用失败。

[web-nickname-focus.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/probes/web-nickname-focus.png>)

**建议优先级：** 在共享编辑控件恢复一种明确且不破坏微信式轻量外观的键盘焦点指示；不要在每个表单重复补样式。

**后续验收条件：** Tab、Shift+Tab 进入输入框时能看出焦点位置；鼠标、键盘及清空按钮切换可辨认。

### UX-06 · P2 · 旧卡历史静态 Modal 脱离后台主题上下文

**验证：** 运行确认 + 源码确认

**现象：** 后台抽屉和保存按钮是品牌绿，但旧卡历史的恢复确认按钮变成 Ant 默认蓝。查看快照和恢复分别调用静态 Modal.info / Modal.confirm，而统一危险确认使用 App 上下文中的 modal。

**影响：** 本次静态扫描只找到这两处静态 Modal 调用，不能扩大称为所有后台弹窗都变蓝。

**共享根因/代码：** [legacy-card-editor.tsx:370–431](<C:/wb-dev/wb-client-logs/apps/admin/src/components/legacy-card-editor.tsx#L370-L431>)；[page.tsx:142–166](<C:/wb-dev/wb-client-logs/apps/admin/src/ui/page.tsx#L142-L166>)；[main.tsx:16–27](<C:/wb-dev/wb-client-logs/apps/admin/src/main.tsx#L16-L27>)

**静态范围：** LegacyCharacterEditor：1 处 JSX 调用行 / 0 条潜在路由。

**证据：** 同屏保存绿、确认恢复蓝；Modal.info:378、Modal.confirm:406 两个直接调用。未点击确认恢复。

[legacy-restore-confirm-desktop.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/interactions-clean/legacy-restore-confirm-desktop.png>)；[legacy-history-desktop.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/interactions-clean/legacy-history-desktop.png>)

**建议优先级：** 复用带当前 ConfigProvider/App 上下文的弹窗入口，统一主题、语言与层级；不要只给这个确认按钮单独写绿色覆盖。

**后续验收条件：** 快照与恢复确认跟随后台主题和语言；取消/关闭的焦点仍可恢复到原抽屉。

### UX-07 · P2 · 共享表格出现重复刷新与额外空工具带

**验证：** 运行确认 + 源码确认

**现象：** 角色库、用户列表等页面头部已有刷新，DataTable 的 FilterBar 又渲染刷新；ProTable 保留密度/列设置的独立工具条，即使左侧没有标题/操作，也占据一整条空白带。

**影响：** DataTable 有 41 处直接 JSX 调用、静态映射到 25 条后台路由；是否双刷新仍取决于各页 Page.extra，不能把 25 页全部说成已逐页复现。

**共享根因/代码：** [table.tsx:10–30](<C:/wb-dev/wb-client-logs/apps/admin/src/ui/table.tsx#L10-L30>)；[table.tsx:93–117](<C:/wb-dev/wb-client-logs/apps/admin/src/ui/table.tsx#L93-L117>)；[characters.tsx:448–475](<C:/wb-dev/wb-client-logs/apps/admin/src/features/characters.tsx#L448-L475>)

**静态范围：** DataTable：41 处 JSX 调用行 / 25 条潜在路由；FilterBar：1 处 JSX 调用行 / 0 条潜在路由；Page：34 处 JSX 调用行 / 29 条潜在路由。

**证据：** 角色库顶部刷新 + 筛选条刷新同时可见；表头上方另有仅右侧密度/设置图标的空带。

[admin-003-desktop-normal.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-003-desktop-normal.png>)；[admin-005-desktop-normal.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-005-desktop-normal.png>)

**建议优先级：** 先确定统一列表模板的一套操作所有权：页级主操作、筛选与刷新、表格显示设置各放一处，按需合并工具条。

**后续验收条件：** 代表列表不重复同义刷新；无工具内容不保留无意义空带；批量选择与列设置仍可发现。

### UX-08 · P2 · 模型管理的主要工作区被低频配置卡压到首屏下方

**验证：** 截图与结构确认

**现象：** 榜单来源和推荐/平台内部模型两块配置被放在概览、上游账号、模型、调用记录标签之前。1440×1000 下标签约到首屏底部才出现，管理员要进入高频工作区先经过大量低频说明和配置。

**影响：** 主要影响 /model 及其四个参数 Tab，不应把它误归因于所有 SectionCard 都有问题。

**共享根因/代码：** [model-management.tsx:59–105](<C:/wb-dev/wb-client-logs/apps/admin/src/features/model-management.tsx#L59-L105>)

**静态范围：** SectionCard：67 处 JSX 调用行 / 19 条潜在路由。

**证据：** 页面结构先 model-page-head 两卡，再 page-tabs；截图首屏下方才出现四个工作区标签。

[admin-011-desktop-normal.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-011-desktop-normal.png>)

**建议优先级：** 优先明确模型管理的高频主任务与低频平台配置关系，把后者折叠或移入合适设置区域；本轮不绘制新布局。

**后续验收条件：** 进入各工作区无需每次滚过同一大段低频配置；深链 Tab 与返回位置一致。

### UX-09 · P2 · 生态决策模型说明在同一页面互相矛盾

**验证：** 源码与当前渲染文案确认

**现象：** 上方说明 Gate 只回答是/否，不写正文、签名或碎碎念；最大输出 token 的帮助仍写‘一次决策含动作说明和碎碎念，300～600 足够’。

**影响：** 影响生态参数设置的理解与预算配置；这是旧文案残留，不代表本轮验证了实际模型执行或费用。

**共享根因/代码：** [ecology.tsx:159–160](<C:/wb-dev/wb-client-logs/apps/admin/src/features/ecology.tsx#L159-L160>)；[ecology.tsx:223–225](<C:/wb-dev/wb-client-logs/apps/admin/src/features/ecology.tsx#L223-L225>)

**证据：** 两处原文同时存在；下方帮助可能需在页面继续滚动，完整渲染文字见该页捕获记录。

[admin-030-desktop-normal.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-030-desktop-normal.png>)

**建议优先级：** 按已实施的 Gate/正文职责划分统一帮助文案，去掉与执行行为不符的旧提示。

**后续验收条件：** 模型职责、输出预算和费用提示同义一致，不让管理员按正文生成理解 Gate。

### UX-10 · P2 · 旧卡版本预览静默截断关键人设内容

**验证：** 源码确认；截图只确认预览形态，长文本条件未单独实测

**现象：** ‘查看内容’弹窗只显示核心人设前 300 字、说话风格前 200 字，世界书和示例只显示条数；没有展开全文或截断提示。用户可能误把截断片段当作全部版本内容。

**影响：** 影响管理员判断是否恢复旧角色卡，尤其是长人设、世界书或示例变化；不涉及本轮对真实人设数据的读取。

**共享根因/代码：** [legacy-card-editor.tsx:370–394](<C:/wb-dev/wb-client-logs/apps/admin/src/components/legacy-card-editor.tsx#L370-L394>)

**静态范围：** LegacyCharacterEditor：1 处 JSX 调用行 / 0 条潜在路由。

**证据：** corePersona.slice(0,300)、speakingStyle.slice(0,200)；lorebook/examples 仅 length。合成样例较短，未把截图说成已验证万字截断。

[legacy-history-desktop.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/interactions-clean/legacy-history-desktop.png>)

**建议优先级：** 明确标为摘要并允许只读查看完整字段，恢复前能核对关键内容差异；不在本轮实现版本比较工具。

**后续验收条件：** 长字段不会无提示消失；用户能确认被恢复的是哪一版及完整关键内容。

## 4. 产品边界与待确认风险（不与已确认问题混算）

### R-01 · 后台当前开发预览存在部分英文占位/分页

**状态：** 可见现象确认；生产构建未验证，不直接认定线上回归

新角色日期框出现 Select date，表格分页出现 20 / page；主入口已经传 zhCN，需要核对组件库/依赖实例/开发预览上下文，不建议逐页硬写中文。

代码：[main.tsx:16](<C:/wb-dev/wb-client-logs/apps/admin/src/main.tsx#L16>)；[table.tsx:118](<C:/wb-dev/wb-client-logs/apps/admin/src/ui/table.tsx#L118>)

[new-character-desktop.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/interactions-clean/new-character-desktop.png>)；[admin-003-desktop-normal.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-003-desktop-normal.png>)

### R-02 · 后台移动支持、最小宽度与深色模式的产品边界需要文档对齐

**状态：** 范围/文档风险，不作为手机适配 P1 缺陷

设计文档明确后台仅电脑浏览器、最小1200px并称跟随系统深浅；实现是 body 最小1280px且 OS 深色下仍为浅色。窄屏裁切已见，但不要求本轮把整个后台改成手机版；应确认是否维持桌面限定，并让不支持的访问有明确说明。

代码：[admin.md:10–15](<C:/wb-dev/wb-client-logs/docs/design/pages/admin.md#L10-L15>)；[styles.css:10–14](<C:/wb-dev/wb-client-logs/apps/admin/src/app/styles.css#L10-L14>)；[theme.ts:11–31](<C:/wb-dev/wb-client-logs/apps/admin/src/app/theme.ts#L11-L31>)

[admin-003-mobile-normal.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/admin/screenshots/admin-003-mobile-normal.png>)；[admin-model-os-dark.png](<C:/wb-dev/logs/uiux-audit-20261025-2049/probes/admin-model-os-dark.png>)

## 5. 不应被误判的问题与保留方向

- 网页的居中移动画布与后台桌面表格是合理跨端差异，不能因为桌面留白多就一律拉满屏。390宽样本未发现文档级横向溢出，349宽钱包也没有；这不是对所有宽度或每个局部控件的无条件保证。
- 1.35字号在昵称输入/标题与通用说明上实际生效（17→22.95px、13→17.55px）；不能据66处固定px声明断言‘字体设置完全无效’，未测到的通话/媒体等固定字号列风险。
- Sheet 的 shell-sheet 已将padding和gap重置为0；桌面面板实测x=400、宽640居中。静态工具最初推断的‘所有底弹层双重内边距/位置错乱’不成立，不列为缺陷。
- 多处 .switch-row、.panel、.toast 和不同圆角/断点说明CSS有迁移与维护风险，不等于每一处都难看；不同用途可能合理。
- 当前头像选择按钮已居中放大、旧卡能显示旧字段编辑器与恢复确认。这里只确认UI形态，不冒充真实保存、恢复、媒体服务或迁移完成。

## 6. 覆盖缺口：没有测就不写通过

| 区域 | 实际状态 / 为什么 |
|---|---|
| 安卓99个逻辑节点 | 全部静态；无AVD/系统镜像/已连接设备，也无基线APK；未构建安装，不以移动网页代替原生截图。系统权限、FCM、来电、软键盘/返回手势均未测。 |
| 通话页 /calls/:callId | 合成会话转回聊天，未得到活动通话目标页；音视频权限、真实收发与硬件未测。 |
| 宠物入口 /pets/with/:characterId | 转向具体宠物详情，按入口跳转记录，不冒充该路径停留内容；活跃/删除等全部业务分支未遍历。 |
| 首次模型引导与其它权限/只读态 | 部分页面显示首配引导、未配置、只读或占位；截图记录这些真实状态，不等于已有正常数据时全部子区域已验证。 |
| 后台情景模式 | 原生fetch的 /api/v1/admin/scenario-modes 被封网，只有错误/空壳证据，正常列表未覆盖。 |
| 年度回顾、系统自动弹层等 | 静态记录；未强造生产触发，也未给用户新增手动入口。 |
| 全部弹层、Tab、筛选/搜索结果与错误组合 | 仅44幅交互场景与代表状态；静态清单中的其它触发条件仍需后续专项。 |
| 登录注册、找回/校验/提交 | 线上只读欢迎/登录壳，/register URL仍呈欢迎页，不把它计成注册表单覆盖；没有提交真实表单。 |
| 当前4.1与生产4.0差异 | 生产登录后页面未做真实账号回归；不声称本报告证明线上全部行为。 |
| 长列表、滚动、长内容与真实设备 | 基准以视口图为主，部分已有长图是补充；不是全长内容逐字审查，也不是性能/视觉回归CI。 |

完整覆盖矩阵：[route-coverage.csv](<C:/wb-dev/logs/uiux-audit-20261025-2049/route-coverage.csv>)；截图台账：[screenshot-manifest.csv](<C:/wb-dev/logs/uiux-audit-20261025-2049/screenshot-manifest.csv>)。其中captured表示取得画面，不代表页面功能或视觉已经通过。

## 7. 修复建议顺序与交接

1. **第一批：UX-01、UX-02。** 先阻止弹层的背景键盘交互，以及未读到配置时提交；公共机制修一次，不逐页打补丁。
2. **第二批：UX-03～UX-07。** 处理功能色/说明层级、编辑焦点、带上下文的Modal和统一列表工具条。网页/后台可保留各自框架，通过语义约定保持一致。
3. **第三批：UX-08～UX-10。** 模型管理主任务排序、旧文案、版本预览信息完整性。
4. **先确认边界：R-01/R-02。** 生产构建核对局部英文、后台支持范围和深色文档，避免先做错误方向的手机版后台或逐页硬编码。

本次到此只交审计结论与建议。**不执行第三阶段设计方向、不改令牌/组件、不接视觉回归CI、不提交推送或发布。** 后续修复需另获授权；发布验收、数据库迁移/旧卡恢复、真人限制及Weibo真实性均不在本次UI审计结论之内。

## 8. 可复核附件

- [route-coverage.json](<C:/wb-dev/logs/uiux-audit-20261025-2049/route-coverage.json>)：三端路由、组件、权限、状态和截图矩阵；原始清单保留在inventory。
- [screenshot-manifest.json](<C:/wb-dev/logs/uiux-audit-20261025-2049/screenshot-manifest.json>)：每幅图片的路径、视口、状态、来源与捕获结果。
- [shared-component-references.csv](<C:/wb-dev/logs/uiux-audit-20261025-2049/shared-component-references.csv>)：76个重点组件的全部已提取直接JSX引用；[issue-component-references.csv](<C:/wb-dev/logs/uiux-audit-20261025-2049/issue-component-references.csv>) 按问题汇总。
- [exported-ui-component-references.csv](<C:/wb-dev/logs/uiux-audit-20261025-2049/exported-ui-component-references.csv>)：301个有JSX使用的导出UI符号引用；[exported-ui-components.json](<C:/wb-dev/logs/uiux-audit-20261025-2049/exported-ui-components.json>) 带定义位置。
- [style-and-pattern-references.csv](<C:/wb-dev/logs/uiux-audit-20261025-2049/style-and-pattern-references.csv>)：相关语义颜色、弹层、焦点、静态Modal和表格模式的全部静态命中。它是字符串/源码命中，不是运行时影响页数。
- [shared-components.json](<C:/wb-dev/logs/uiux-audit-20261025-2049/static/shared-components.json>)：重点组件潜在路由与样式关联；[shared-refs.raw.json](<C:/wb-dev/logs/uiux-audit-20261025-2049/static/shared-refs.raw.json>) 是337文件/2359导入边的原始图。潜在路由不是截图确认数，也不保证所有分支渲染。
- [source-integrity.json](<C:/wb-dev/logs/uiux-audit-20261025-2049/source-integrity.json>)：1809文件只读对比；原始工作树状态前后另存，当前业务脏改动早于本审计。

分析边界：直接引用按源码JSX调用行计数，别名/通配和动态拼接可能需要人工补充；潜在路由是静态传播，不代表运行时一定受影响。所有已确认问题均给出共享根因或单页结构位置，未拿原始静态候选数量充当最终缺陷数量。
