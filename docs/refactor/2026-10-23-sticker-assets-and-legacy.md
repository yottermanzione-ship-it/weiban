# 表情素材与旧版筛选核查（2026-10-23）

## 结论与范围

1. 旧版的星形“共享”库是**当前会话角色名对应的公开上传表情**，不是通用明星合集；当前旧代码聊天面板本身没有名为“明星专属”的独立 tab。新界面可按当前角色专属设计，但不能宣称旧版已有同名 tab，更不能把私人上传自动公开。
2. ChineseBQB 确实是旧版来源：本地有 12 系列 × 12 条 = 144 条 manifest，144 个文件均存在；其中 6 对字节完全重复，实际 138 个不同文件。**发现下载来源不等于获得图片授权**，本次可确认适合直接新增上架的 ChineseBQB 图片为 0 张。
3. 通用 emoji 推荐发送 Unicode 文本、由系统原生绘制；如需跨端统一图形，可从 Twemoji 或 Noto Emoji 中先选下述明确的 24 个码位，履行各自许可后导入。不复制微信、苹果或其他闭源平台的 emoji 图片。

任务依据：[任务卡](../tasks/2026-10-23-stickers-voice-ecology.md)。本次仅新增本报告；无业务/契约改动、无 SSH、无迁库、无部署、无付费调用、未执行旧版导入脚本或外部仓库脚本、未安装依赖，未复制任何用户聊天/头像/截图。

核查工作树为 `codex/stickers-voice-20261023`，HEAD `d4ea97ee4393803b22e94ca6a0458e5270b2a23e`；旧版参考树 HEAD `2c5632e2ed66f5144d8f7bbad805a4f9d913a0d5`。未核服务器实时记录，下面的“实际数量”仅指本地参考树，不推断生产数据库数量。

## 一、旧版目录与数据路径

### 1.1 内置素材实存盘点

证据：[目录定义](<C:/wb-ref/old-weiban/server/lib/chat/sticker_catalog.js#L53-L155>)、[ChineseBQB manifest](<C:/wb-ref/old-weiban/server/lib/chat/chinesebqb_manifest.json>)；实存目录为 [builtin](<C:/wb-ref/old-weiban/server/public/stickers/builtin/>)。只计算名称、长度、SHA-256，不展示或复制图片。

| 来源 | 条数 | 展示/用途 | 权利状态 |
|---|---:|---|---|
| 代码生成 SVG | 16 | panel 默认页；有开心、难过、手势等语义 | 代码内直接画几何脸，非 Unicode 标准 emoji 全集；仍需项目方确认来源，不冒称已做原创权属审查 |
| Operit 固定清单 | 53 | 9 种情绪，加入内置检索/模型可用目录 | 只是来源标识，未核上游每图许可，不随代码开源许可推定图片可搬 |
| ChineseBQB | 144 | 12 系列，可整套 pin；manifest 每套 12 | 第三方合集，逐图授权未确认 |
| 合计 | 213 | 内置目录，不含用户私人上传 | 不是 213 张全新可发布素材 |

实存 213 文件合计 30,245,986 字节；扩展名为 SVG 16、JPG 61、GIF 115、PNG 8、WebP 13。ChineseBQB 子集合 26,605,888 字节，格式 GIF 108 / JPG 30 / PNG 6；不存在 manifest 缺图。最大内置文件 6,680,115 字节：低于本次研究下载单件 10MB 限制，但已高于旧上传路由 5MiB 限制，不能把旧文件直接当新上传接口的通过样例。

SHA-256 完全重复共 7 对（全部内置去重后 206 个不同字节文件）：

- ChineseBQB：cat 1/4；happy_duck 1/2；panda 1/3；smirk_boy 1/2；tiger 1/3；wang_egg 1/2。
- Operit：happy 4 与 miss_you 1。

这是字节去重，不是视觉相似性去重。不同系列可以保留多个分类引用，但底层 blob 应共享；不得仅因为同图删掉历史消息引用。

### 1.2 面板、系列、单表情的真实筛选

证据：[store:53–218](<C:/wb-ref/old-weiban/server/lib/chat/sticker_store.js#L53-L218>)、[routes:34–67](<C:/wb-ref/old-weiban/server/routes/stickers.js#L34-L67>)。

- `panel(userId, personaName)`：默认 16 SVG → 收藏页 → 用户已 pin 的 ChineseBQB 系列。收藏页合并当前 `user_id + persona_name` 的 `slot=favorite` 与历史 `slot=exclusive`。**不是全账户跨角色收藏**。
- 系列 pin 存于 `user_sticker_pack_pins`，按 `user_id` 管理，排序为 `sort_order, created_at`，因此已添加系列可随该用户跨会话显示；与单图按会话角色隔离不同。
- `library()`：先星形“共享”页，再全部有素材的 ChineseBQB 系列；“共享”页不等于所有用户全部图片。
- `listPublicExclusive(personaName)` 的 SQL 精确为 `persona_name=? AND source='upload' AND is_public=1`，**不限定上传用户**，因此同名角色可看其他用户主动勾选公开的上传。
- 上传实际写入 `slot='favorite'`，`is_public` 由用户显式输入决定；老名字 `Exclusive` 不表示当前数据都是 private 或存在独立 exclusive tab。
- 前端保留识别 `shared/exclusive/exclusive_public` 的兼容分支，并显示“添加的单个表情”，不是存在三种已生成 tab 的证据。见 [面板组件](<C:/wb-ref/old-weiban/src/lib/widgets/sticker_panel.dart#L161-L170>)。
- 上传确认文案直接写“共享到该角色的表情库”“不勾则只有你自己能用”。见 [上传 UI](<C:/wb-ref/old-weiban/src/lib/pages/chat_page/send_ops.dart#L660-L669>)。

### 1.3 “明星专属”该如何解释

**按旧查询意图：当前角色专属共享，而不是通用明星图库。**但旧实现只用自由文本 `persona_name`，没有证明角色是真明星的身份校验，也没有稳定角色 ID 或别名映射：同名冲突、改名、空名均不能靠文案解决。旧路由空名返回 400，不能省略参数请求来代表全局列表。

额外风险：[resolve(public:ID)](<C:/wb-ref/old-weiban/server/lib/chat/sticker_store.js#L273-L293>) 仅查 `id + is_public + source=upload`，没有再次校验当前 `persona_name`，所以“库列表按角色过滤”不等于“所有直接 ID 路径都按角色过滤”。不要复用这个遗漏来构建全明星 tab；新实现应列表/详情/收藏/发送统一按角色与公开状态验证，角色隔离变更交主代理处理，本报告不改契约。

旧数据库中具体多少用户上传、多少角色、多少公开记录：**未读取私人数据库，未知**。不能从 builtin 213 推算这部分，更不默认迁移。

## 二、ChineseBQB 官方来源、规模与权利

### 2.1 能确认和不能确认的事项

官方来源为 [zhaoolee/ChineseBQB](https://github.com/zhaoolee/ChineseBQB)。作者资料索引将其与 v2fy 联系起来；本地旧导入脚本也直接引用该仓库，见 [脚本说明](<C:/wb-ref/old-weiban/server/scripts/import_chinesebqb_curated.js#L4-L28>)。

本次访问情况：任务已知 v2fy.com 被 DNS 安全策略拦截；另外独立 `web_fetch` 访问官方 github.com、raw.githubusercontent.com、api.github.com 也均返回“resolves to a non-public IP address”。**未换 IP、代理、镜像或下载工具绕过**。只使用公开搜索索引核实能见内容；不把搜索摘要当作完整审计或某个提交快照。

- 官方仓库搜索索引可见 README 宣称“共收录 5871 张表情包”，并接受向 `000Contribution_贡献🇨🇳` 投稿。该数是**README 声明量，不是本轮递归树实测、去重数或授权数**。
- 索引可见实际根目录如 `001Funny_滑稽大佬😏BQB`；旧版下载目标是同名 `.zip`。故组织单位是按题材/角色分包的目录与压缩包，不是纯 emoji 字体，也不是每套按情绪自动生成。
- [官方 package.json 索引](https://github.com/zhaoolee/ChineseBQB/blob/master/package.json) 可见 `"license": "ISC"`。**这只是软件包元数据，不能保证根目录每张真人照、影视帧、漫画、网友投稿均获 ISC 授权**。
- 本次未取得完整 README 许可段、独立 LICENSE、逐图作者授权清单及当前 commit/tree：这些均标为未确认。不能声称“无许可证”，也不能声称“所有图片 ISC / 公共领域 / 免费商用”。即便存在聚合仓库许可，发布人也不能转授自己未拥有的第三方肖像/作品权利。
- 全库精确目录数、各目录当前完整数量、总字节、ZIP 内路径安全、真实 MIME 分布：未实测。本地 144 张不能代表全库 5871 张的格式或权利。

本轮公开素材下载为 **0 字节**，没有建立全库 clone，也未下载样本；因此未触及 50MB 总量 / 单件 10MB 的授权上限。未执行官方脚本或旧导入脚本。

### 2.2 已存在的具体包候选（只适合作为清权候选）

以下每行“12”均是**旧版实际选入数量**，不是官方该包全量；每行可新增上架确认量均为 **0**。URL 为官方根目录下对应包；仓库当前目录是否变动待官方原文可访问时复核。

| 旧版 slug / 标题 | 包目录 / URL | 已选量 | 主要限制 |
|---|---|---:|---|
| funny / 滑稽 | [001Funny](<https://github.com/zhaoolee/ChineseBQB/tree/master/001Funny_滑稽大佬😏BQB>) | 12 | 含二次创作可能性，逐图来源未明 |
| cute_girl / 可爱女孩 | [002CuteGirl](<https://github.com/zhaoolee/ChineseBQB/tree/master/002CuteGirl_可爱的女孩纸👧BQB>) | 12 | 真人肖像/摄影或插画权利均待核 |
| smirk_boy / 假笑男孩 | [004SmirkBoy](<https://github.com/zhaoolee/ChineseBQB/tree/master/004SmirkBoy_假笑男孩👦BQB>) | 12 | 真人及未成年人肖像风险，不直接发布 |
| parrot / 鹦鹉 | [012Parrot](<https://github.com/zhaoolee/ChineseBQB/tree/master/012Parrot_鹦鹉🐦BQB>) | 12 | 不因是动物就自动无版权 |
| tiger / 胖虎 | [007Tiger](<https://github.com/zhaoolee/ChineseBQB/tree/master/007Tiger_胖虎🐯BQB>) | 12 | 角色/漫画 IP 风险 |
| happy_duck / 开心鸭 | [008HappyDuck](<https://github.com/zhaoolee/ChineseBQB/tree/master/008HappyDuck_开心鸭🐥BQB>) | 12 | 角色形象及原画权利待核 |
| cat / 猫咪 | [010Cat](<https://github.com/zhaoolee/ChineseBQB/tree/master/010Cat_是喵星人啦🐱BQB>) | 12 | 摄影/配字二创来源待核 |
| dog / 狗狗 | [011Dog](<https://github.com/zhaoolee/ChineseBQB/tree/master/011Dog_狗🐶BQB>) | 12 | 同上 |
| panda / 金馆长 | [015Golden_Curator_Panda](<https://github.com/zhaoolee/ChineseBQB/tree/master/015Golden_Curator_Panda金馆长熊猫🐼BQB>) | 12 | 真人脸/影视素材拼贴风险 |
| wang_egg / 汪蛋 | [018WangEgg](<https://github.com/zhaoolee/ChineseBQB/tree/master/018WangEgg_汪蛋🥚BQB>) | 12 | 原角色授权待核 |
| chicken / 小幺鸡 | [026Chicken](<https://github.com/zhaoolee/ChineseBQB/tree/master/026Chicken_小幺鸡🐔BQB>) | 12 | 原角色授权待核 |
| penguin / 企鹅 | [031Penguin](<https://github.com/zhaoolee/ChineseBQB/tree/master/031Penguin_沙雕企鹅🐧BQB>) | 12 | 原画/二创授权待核 |

旧脚本是每包文件路径排序后取前 12 张，仅认可扩展名 PNG/JPG/JPEG/GIF/WebP，然后复制重命名。**它没有逐图许可、SHA 去重、内容审核、魔数/像素/帧上限或解压路径校验**，且下载整 ZIP 可能超过本轮限额，不建议照搬。见 [旧脚本:83–137](<C:/wb-ref/old-weiban/server/scripts/import_chinesebqb_curated.js#L83-L137>)。

## 三、可安全扩充的通用 emoji 候选

### 3.1 Unicode 文本与图片字形不是同一权利

`U+1F600` 及其字符序列用于表达“grinning face”；将该字符作为消息文本，不等于复制微信画出的笑脸图片。Unicode 数据表、说明文本本身仍有相应数据/文档许可；整份导入时需保留 Unicode 许可。设备字体画出的具体图形、字体文件、截图则有其各自权利，不能因为码位公开就抽取系统字体或微信图片再分发。

系统原生渲染最省分发成本：只发送文本，不上传供应商字形；代价是不同 Android/iOS/Windows 样式不一、新码位可能缺字，ZWJ/变体/肤色必须按完整 grapheme（用户眼中的一个字符）处理。原生渲染不代表获得该系统字体文件或位图的再分发许可。

### 3.2 首批可落地选择：24 个普通码位

建议同一份文本清单：

`1F600 1F603 1F604 1F601 1F606 1F605 1F602 1F642 1F609 1F60A 1F60D 1F618 1F914 1F610 1F644 1F62D 1F622 1F620 1F631 1F634 1F44D 1F44E 1F44F 1F64F`

这是明确可盘点的 **24 个基础字符 / 单套 24 个图形目标**，不是声称覆盖全部 Unicode 或某项目当前全库。先避开国旗、复杂 ZWJ、新版本缺字及明星图像，不涉及私人素材。

| 方案/包候选 | 首批数量与资源 URL | 许可与发布前条件 | 建议 |
|---|---|---|---|
| 系统原生 emoji 文本包 | 24 个字符、0 图片；[Unicode emoji charts](https://www.unicode.org/emoji/charts/) | 不打包闭源字体、不截图拆图；若复制官方分类/数据，保留相应 Unicode 许可 | **优先**；需客户端验证换行/无障碍及跨端显示 |
| Twemoji 子集 | 24 SVG 或同码位 PNG；[官方仓库](https://github.com/jdecked/twemoji)，[SVG目录](https://github.com/jdecked/twemoji/tree/main/assets/svg)，例 [1f600.svg](https://github.com/jdecked/twemoji/blob/main/assets/svg/1f600.svg) | 官方索引明确：代码 MIT，图形 **CC BY 4.0**；注明 Twemoji/作者、来源与许可链接、修改说明，保留归属；商标/人格权不因 CC 自动获得 | 要统一图片风格时推荐；固定 commit 并逐件验证存在，不用 `latest` 上生产 |
| Noto Emoji 子集 | 同 24 个目标；[官方仓库](https://github.com/googlefonts/noto-emoji)，[README](https://github.com/googlefonts/noto-emoji/blob/main/README.md?plain=1) | 索引说明字体 **SIL OFL 1.1**，工具及**大多数**图片 Apache 2.0；不能简化成“全库 Apache”。选定文件需核子目录/例外，保留版权/许可/NOTICE；修改字体遵守保留字体名等 OFL 条款 | 原生缺字备用或统一包的替代，不把字体许可套到所有 PNG/SVG |
| OpenMoji 子集（备选） | 同 24 个目标；[官方项目](https://openmoji.org/)，例 [1F919 官方页](https://openmoji.org/library/emoji-1F919/) | 官方页标 **CC BY-SA 4.0**，须署名；修改后的图形按相同许可提供，不等于整个业务代码被强制同许可。须单独核全包元数据/文件 | 若能承担图形改编同许可义务，可作候选；不优先混入专有贴纸 |

以上图形包为**明确许可框架下的候选**，本轮因无法取回官方完整文件而没有标记“发布权利审查完成”或“已下载24/24”。开源图形许可也不保证第三方品牌/旗帜/人物权利，故仅选普通面部与手势，不引入商标附加图形。

来源依据：[Twemoji 官方说明](https://github.com/jdecked/twemoji) 的搜索索引明确区分 MIT/CC BY 4.0；[Noto README](https://github.com/googlefonts/noto-emoji/blob/main/README.md?plain=1) 明确区分字体 OFL/大多数图像 Apache；[OpenMoji 官方图形页](https://openmoji.org/library/emoji-1F919/) 标注 CC BY-SA 4.0。完整许可原文与锁定版本仍是实际入库前的必需材料。

## 四、导入与媒体安全方案（建议，不是本轮实现）

1. **先清权后入公开库**：为每个资产记录 `upstream repo + commit + path + URL + author + license/exception + proof URL + reviewed_at + visibility`。缺逐图权利证据的 ChineseBQB 一律 `quarantine/not_publishable`，不能因过去已用过自动放行。私人上传默认私有，公开勾选只代表用户意图，不替代用户具备授权的校验和侵权下架流程。
2. **下载预算与网络边界**：只从允许的官方公开地址取得锁定版本元数据/少量样本，研究目录限定 `C:/wb-dev/logs/stickers-20261023/`，累计 ≤50MB、单件 ≤10MB，流式计数并中断超限；预估长度只作参考，不能只信 Content-Length；拦截内网/环回/云元数据地址、限制重定向并逐跳校验，不绕过 DNS 安全拦截。禁止下载全库 ZIP，禁止执行远程脚本或安装仓库依赖。
3. **安全解码**：扩展名、MIME、魔数三方核对，真实解码；只允许必要格式。静图建议 PNG/WebP，动画另走审核管道。建议起点为单图≤5MiB、边长≤2048、总像素≤4MP；动画≤100帧、累计解码像素≤100MP、时长≤15秒，并加 CPU/内存/超时限制，数值需客户端实测后固化。旧素材超过新门槛应隔离或审核后转码，不静默放开限制。
4. **压缩包/SVG**：若后续获准单包取样，预先限制条目数、展开总量/比率；拒绝绝对路径、`..`、符号链接，禁止脚本与可执行文件。外部 SVG 必须移除 script、事件、外链、foreignObject、嵌入字体及危险 URI，优先离线安全栅格化后发布，不直接信任上传 SVG。
5. **两层去重**：原始 SHA-256 唯一 blob；转码后规范化像素哈希及 pHash/动画抽样辅助近似去重，人工确认。保留各系列索引/署名/原 URL，不把“视觉相似”当同一授权来源；同一字节的不同来源保留来源证据。
6. **内容/隐私复核**：逐图核真人、未成年人、影视漫画 IP、个人信息、水印、色情/仇恨/诈骗与恶意二维码；不把旧聊天或自拍当素材。删除 EXIF/GPS 等非必要元数据；对剥离水印/改图要有权利依据，不能为规避署名而处理。
7. **可撤回发布**：先产干跑清单（新增/重复/超限/未授权/拒绝原因），只允许 reviewed 状态进入发布清单；独立存储前缀、内容哈希对象名、正确 Content-Type、`nosniff`、不允许执行、保留缩略图与原图关联。公共缓存只用于已授权公开素材，私有上传走鉴权而不是公共 CDN；撤回同时停展示/下载并处理缓存，不破坏历史引用审计。
8. **验证与回退**：包版本及 license manifest 一起发布；为缺图/恶意 SVG/解压炸弹/跨角色 public ID/撤回后收藏引用设测试。备份、幂等、批量审批/审计由主代理依现有契约处理，本报告不新增接口、不执行迁移。

## 五、检查记录与交接

- 已执行一次只读本地统计：manifest 按 slug/格式分组、实存缺图检查、文件长度与 SHA-256 分组；最初 PowerShell 按系统默认编码解析中文 JSON 失败，明确指定 UTF-8 后统计成功，这是读取编码问题，不是素材 JSON 被改坏。
- 已检查创建目标不存在后新增本报告。未跑业务测试：无业务代码变更，不能据研究结果登记独立质量验收或上线通过。
- 待主代理落实：将“明星专属”定义为当前稳定角色标识下的获准公开表情；不要迁移旧 public-ID 角色漏校验；选择先上24字符原生emoji，图片风格统一则先核Twemoji固定版本归属；ChineseBQB继续清权，未清权不扩充上架。
- 尚未确认：官方完整许可原文与逐图权利、当前全库精确目录/字节/去重规模、生产用户表情数量与迁移授权；均不能写成已完成。网络阻碍是官方域名工具安全拦截，不以镜像或代理绕过。
