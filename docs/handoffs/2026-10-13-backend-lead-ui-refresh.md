# 交接说明：换壳 UI 批次后端配套

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-13 |

依据：`docs/refactor/02-wechat-shell-and-miniprograms.md` 第 5、6、11 节，`02a-navigation-tree.md`，`01-old-weiban-review.md`。按总经理授权本批不写测试、不跑测试，只保证 typecheck / lint / build / `android:generate:check` 通过。契约升到 **3.2**（全部向后兼容）。

## 做了什么

1. **系统自带宠物**（迁移 0084）：预置 3 物种 × 3 外观（小猫：橘猫 / 奶牛猫 / 三花猫；小狗：柴犬 / 小白狗 / 黑白狗；小兔：白兔 / 灰兔 / 奶茶兔），每个外观有幼年 / 少年 / 成年三张图，默认上架，各带 6 个兜底名字。图片是原创简单 SVG 占位：`media.objects` 行的 `storage_key` 以 `builtin/` 开头，内容由 `media/application/builtin-art.ts` 现场画出，不放对象存储；给模型或复制（readBytes / copyObject）时自动转 PNG。后台仍用原有图鉴接口增改、下架、换图（上传正式插画后改外观的 `imageMediaIds`）。领养不再依赖后台上传，`GET /pets/species` 默认就有 3 个物种。
2. **隐藏会话（不显示该聊天）**：**服务器早已支持，本批无需改代码**。`PATCH /conversations/:id/state { hidden: true|false }`；隐藏后 `GET /conversations` 不返回；该会话来新消息时服务器自动把 `hidden` 置回 false（与微信一致）；变化经同步更新 `conversation.state_updated` / `conversation.updated` 推到本人所有设备。
3. **公告与更新说明**（迁移 0086，新接口见下）：旧版做法、问题、新版改进写在 `docs/backend/announcements.md`。要点：公告可发布 / 编辑 / 撤回 / 删除，字段含标题、正文、生效与结束时间、目标平台、是否弹窗、是否置顶；用户端拉未读与已读回执（多端同步）；更新说明按平台 + 版本号逐条维护，「首次打开新版本弹一次」且跳版本不漏；安卓 / 网页都支持「最低可用版本」强制更新。
4. **情景预设改名与排序**（迁移 0085 + ai-runtime `INITIAL_MODES`）：弹层顺序 = 自动、日常聊天、情侣暧昧、树洞分享、傲娇斗嘴、加油打气、私密。`ScenarioMode` 新增 `auto` / `treehole` / `cheer`，在 policy 里登记为可选项（`allowlistFallback = 'daily'`，旧角色卡的管理员允许列表有 daily 就能看到）；AI 未实现前提示词与日常完全相同，listModes 返回 `aiReady: false`。listModes 每项新增可选 `description`、`section`（preset / private）、`recommended`、`aiReady`。

## 新接口清单（给网页 / 安卓 / 管理后台）

用户端：

| 接口 | 说明 |
|---|---|
| `GET /api/v1/announcements?platform=web\|android` | 当前有效公告 `{ items, unreadCount }`；置顶在前。`popup && readAt == null` 的按发布时间从旧到新依次弹窗 |
| `POST /api/v1/announcements/read` `{ announcementIds }` | 已读回执，204，幂等 |
| `GET /api/v1/app/version-check?platform&versionCode`（免登录） | `updateRequired`（不可关闭，去下载 / 刷新）、`updateAvailable`、`latestVersion`、`downloadUrl`、`forceUpdateMessage`、`latestNote` |
| `GET /api/v1/app/release-notes?platform&versionCode` | `items`（更新日志）、`whatsNew`（非空就弹「本版新功能」）、`lastSeenVersionCode` |
| `POST /api/v1/app/release-notes/seen` `{ platform, versionCode }` | 关闭「本版新功能」后调用，204 |
| `GET /characters/:id/scenario-modes`、群聊 `scenario-modes`（已有） | 每项多了可选 `description / section / recommended / aiReady`，顺序即弹层顺序 |
| `PATCH /conversations/:id/state { hidden }`（已有） | 不显示该聊天 / 取消 |

管理后台：

| 接口 | 说明 |
|---|---|
| `GET/POST /api/v1/admin/announcements`，`PATCH/DELETE /admin/announcements/:id`，`POST /admin/announcements/:id/publish`、`/withdraw` | 公告管理；PATCH 可带 `resetReads: true` 让所有人重新看到 |
| `GET/POST /api/v1/admin/release-notes`，`PATCH/DELETE /admin/release-notes/:id` | 更新说明 |
| `GET /api/v1/admin/app-version-policies`，`PUT /admin/app-version-policies/:platform` | 版本策略（最新版本、下载地址、最低可用版本号） |
| `/admin/pet-species`（已有） | 现在会列出 3 个内置物种，可改名、下架、换图 |

## 改了哪些文件

- 契约：`packages/contracts/src/http/announcements.ts`（新）、`http/companion.ts`、`http/ai-runtime-extras.ts`、`ports/policy.ts`、`index.ts`、`version.ts`（3.2）、`README.md`（变更记录）
- 迁移：`apps/server/drizzle/0084_builtin_pet_species(.down).sql`、`0085_scenario_presets(.down).sql`、`0086_announcements_release_notes(.down).sql`、`meta/_journal.json`
- 服务器：`modules/media/application/builtin-art.ts`（新）、`media.ts`；`modules/identity/application/announcements.ts`（新）、`http/announcements.controller.ts`（新）、`identity.module.ts`、`infra/db/schema.ts`、`application/deletion.ts`；`modules/policy/application/policy.ts`；`modules/ai-runtime/domain/persona.ts`、`application/settings.ts`、`group-chat.ts`、`reply-context.ts`
- 安卓生成物：`apps/android/core/contracts-generated/**`
- 文档：`docs/backend/announcements.md`（新）、本文件

## 遗留问题

- 本批没有测试（按授权），交 Codex 整体验收时重点看：内置素材下载 / 转 PNG、markSeen 只前进、公告生效期筛选、新预设在旧角色卡上的可见性。
- 用户端预设名单仍以代码 `INITIAL_MODES` 为准，`characters.scenario_modes` 表（后台情景模式管理）只同步了名字和顺序，两处并存是旧技术债，未合并。
- 「自动」作为新账号默认预设暂未启用（AI 未实现），默认仍是日常聊天。
- 公告发布不做实时广播，客户端在打开 / 回到前台时拉取。
- 网页目前没有版本构建号，`version-check` / `release-notes` 需要网页在构建时注入一个递增整数。

## 需要总经理决定的事

无。（「成人」显示名改为「私密」、新预设规则按设计稿先做了，需产品在 MODE-01 中确认，见下。）

## 给其他负责人的交接

- 给 Web：
  - 不显示该聊天直接用 `PATCH state { hidden: true }`；注意现有 `chat.tsx` / `groups.tsx` 把「群聊 hidden」当成「已退群」处理，用户手动隐藏群聊后会打不开，需改为按自己是否仍在成员列表判断。
  - 宠物领养页可去掉「暂时没有可以领养的小家伙」的死路分支（保留加载失败重试）。内置插画是 SVG，用 `<img>` 显示即可。
  - 情景预设弹层直接按 listModes 返回顺序渲染；`section = private` 放底部「私密」栏；`recommended` 显示推荐角标；`aiReady = false` 可正常显示和切换。
  - 公告 / 本版新功能 / 强制刷新：启动和回到前台时调用上表接口，网页构建号需在构建时注入。
- 给 Android：同上；`version-check` 用 `BuildConfig.VERSION_CODE`，`updateRequired` 时弹不可关闭的下载弹窗；契约生成物已重生成（3.2）。
- 给 AI 负责人：`auto` / `treehole` / `cheer` 已在契约、policy、`INITIAL_MODES` 登记，`persona.ts` 的 `MODES` 里三者暂为日常文案；下一张卡实现策略和提示词后把对应项 `aiReady` 改为 true。「自动」只能在日常 / 树洞 / 打气 / 傲娇之间选（设计 5.3）。
- 给产品：确认 MODE-01 改名（日常聊天 / 情侣暧昧 / 傲娇斗嘴 / 私密）与三个新预设规则；树洞内容是否不外传。
- 给管理后台：可新增公告、更新说明、版本策略三页，接口见上表。
