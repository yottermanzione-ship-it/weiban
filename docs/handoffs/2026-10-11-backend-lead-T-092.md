# 交接说明：T-092 L7 玩法二：心愿清单（后端）

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead |
| 日期 | 2026-10-11 |
| 分支 / 提交 | `T-092-play-wishlist`，`cfee98c`，已快进合并进 `local/trunk`（`C:\wb-dev\wb-int`） |
| 迁移 | `0066_play_wishlist`（含 .down.sql，不删 play schema；已登记 journal） |
| 自检 | server `tsc`、根目录 `pnpm lint`（含 dependency-cruiser）通过；按约定未写、未跑测试，未在数据库执行迁移 |

## 做了什么

实现说明见 `docs/backend/play.md` 第 3 节。

1. **清单项增删改**：
   - 每个角色最多 50 项，满了返回 422 `limit_reached`。
   - 重复提交只算一次（以 `clientRequestId` 判断）。
   - 心愿文字加密保存。
   - 两个入口读写同一张表，改动后都会通知客户端刷新（`data.changed(wishlist)`）。
2. **约定**：
   - 新建、改文字或日期、删除时都发 `play.wishlist_item_changed`，删除时日期为 null。
   - ai-runtime 据此写入或取消「我们的约定」。
3. **打勾**：
   - 第一次完成时发瞬间卡（kind `play`，同一项只发一次），并发 `play.wishlist_item_completed{firstCompletion}`。
   - growth 自动记首次互动 +5 和第 31 号成就。
   - 取消完成不收回卡，再次完成也不再发卡。
4. **发卡怎么接**：
   - play 不能 import growth，所以新增了 play 自己的令牌 `PLAY_CARD_ISSUER`，由 `app.module.ts` 的 `PlayCompositionModule` 绑定到 `GROWTH_CARD_PORT`。
   - T-093 的「第一次收到回信」瞬间卡也走这个令牌。
5. **角色提议**：
   - 实现了 `PlayAgentPort.createWishlistProposal`：每个角色每周（用户当地时间周一起算）最多 1 次，清单满时返回 `list_full`，重复调用返回原提议 ID。
   - 订阅 `chat.message_action_chosen`：用户点「加进去」时建项并标「TA 提议」；点「先不了」、清单已满或角色已删除时记为拒绝。
6. **跟进标记**：`PLAY_WISHLIST_FOLLOW_UP.markWishlistFollowedUp`，保证「我们那件事做了吗」每项最多问一次。
7. **删除角色**：
   - 30 天回收期内清单保留，但无法访问。
   - 恢复后原样回来。
   - 彻底删除时一并删除；注销时也会删除。

## 改了哪些文件

- `apps/server/src/modules/play/`：`application/wishlist.service.ts`（新）、`http/wishlist.controller.ts`（新）；改 `infra/db/schema.ts`、`tokens.ts`、`index.ts`、`play.module.ts`、`application/{context,play-ports,play-lifecycle,daily-question.service}.ts`
- `apps/server/src/app.module.ts`（`PlayCompositionModule`）
- `apps/server/drizzle/0066_play_wishlist.sql` / `.down.sql`、`meta/_journal.json`
- `docs/backend/play.md`

契约未改，所以 Android 生成物不需要重新生成。

## 遗留问题

- 按约定没写测试，没在数据库上实际跑过。
- 提议在角色已删除时，契约只有 `weekly_limit` / `list_full` 两个错误码，所以只能返回 `weekly_limit`，并在说明文字里写「角色不在通讯录中」。
- 用户点了「加进去」但清单已满时，不会建项也没有提示，卡片上只显示已选的按钮。如果要提示「清单满了」，需要 T-096 或设计补一条文案。
- 删除角色时清单保留，但客户端返回的是「角色不在通讯录」。没有单独的「暂停」字段，契约里也没有。

## 需要总经理决定的事

无

## 给其他负责人的交接

- 给 AI（T-096）：
  - 发提议：先调用 `PLAY_AGENT_PORT.createWishlistProposal`，拿到 `proposalId` 后发 `action_card`（cardKind `wishlist_proposal`，`ref = {kind: WISHLIST_PROPOSAL_REF_KIND, id: proposalId}`，按钮用 `WISHLIST_PROPOSAL_ACTIONS.add` / `.skip`）。提议要计入 P-03 / P-04，理由用「互动玩法」。
  - 约定：订阅 `play.wishlist_item_changed`，写入或取消约定。
  - 跟进：问之前先调用 `PLAY_WISHLIST_FOLLOW_UP.markWishlistFollowedUp(itemId)`，返回 true 才问。
  - 以上都从 `../../play/index.js` 注入。
- 给 Web / 安卓：接口按 `WishlistEndpoints`；收到 `data.changed(section=wishlist)` 后重新拉清单。
- 给 growth：不需要改。
- 给总负责人：已合并进 `local/trunk`（`cfee98c`）。
