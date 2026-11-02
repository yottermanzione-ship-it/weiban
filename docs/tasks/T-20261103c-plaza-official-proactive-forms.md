# T-20261103c 广场微伴角色详情「不存在」修复、主动消息接回语音/表情等形式

| 项 | 内容 |
|---|---|
| 负责人 | backend-lead（第 1 项）+ ai-lead（第 2 项），一人顺序完成 |
| 分支 | `fix/plaza-official-proactive-forms-20261103`（worktree `C:\wb-dev\wb-t1103c`） |
| 状态 | 待派发 |
| 来源 | 11-02 交接遗留「广场详情不存在」；T-20261103b（PR #44）交接遗留「主动消息只剩文字」 |

## 1. 广场「微伴角色」详情页全部显示「角色不存在或已下架」

- **现象**：广场「微伴角色」页签的列表能显示，点进任意一个角色都提示「角色不存在或已下架」，点赞和评论也会失败。
- **根因（已查实）**：
  - 列表 `listOfficialIds` 取的是所有 `kind='preset' AND status='published'` 的角色。
  - 详情、点赞、评论走 `PlazaOfficialService.assertListed`，进而调用 `plaza-port.ts` 的 `getOfficialProfile`，它又调用 `characters.presetForCopy`。
  - `presetForCopy` 是给「复制成自定义角色」用的，碰到旧卡角色（`legacy_card` 不为空）直接返回 null。
  - 2026-11-03 生产实查：已上架的官方角色 677 个，全部是旧卡，所以详情页全坏。
- **要求**：
  1. `getOfficialProfile` 不再借用 `presetForCopy`。它的判定口径要和列表完全一致：preset、已发布、存在即可，新卡和旧卡都支持。「复制」的口径不变，旧卡照样不能复制。
  2. 旧卡的公开人设摘要从 `LegacyCharacterCard`（`packages/contracts/src/legacy-character-card.ts`）里取，规则如下，只摘公开的几项并截断，和新卡同等克制：
     - `summary`：取 profile.intro，截 300 字；
     - `personality`：取 soulPersonality，截 300 字；
     - `speechStyle`：取 speakingStyle，没有就取 styleChatStyle，截 200 字；
     - `catchphrases`：旧卡没有对应字段就给空数组。
     - 不返回世界书、示例对话、避免词、开场白等内容。
  3. 网页 `role-plaza.tsx` 的 `OfficialRolePage`：现在任何错误都显示「角色不存在或已下架」。改成只有 `not_found` 才这样显示，网络错误或其他错误显示通用的加载失败，并提供重试。
  4. 测试：服务端补单测，覆盖旧卡角色能取到详情、点赞成功、未发布或非 preset 返回 not_found。网页有现成用例就顺带更新。
- 不涉及契约字段变化，不升版本。

## 2. 生态「主动消息」接回语音、表情包、图片等形式

- **背景**：#44 把语音、图片、表情包、拍一拍从生态候选动作里删掉了（v3：这些是基础层）。删掉以后，主动消息走 `proactive.sendEcology` 只能发文字。v3 的意思是：聊天里这些形式默认都有，按场景自己斟酌，不定固定概率；用户说过不要哪种就不发哪种（`suppressedForms`）。
- **要求**：主动消息发送时复用聊天回复里已有的形式判断（`reply-engine.ts` / `media-ai.ts` 里的 `planExtras` 等路径），由同一套逻辑决定这条主动消息用文字、语音还是带表情包或图片。不新造概率规则。
  - 表情包选图走 #38 的完整标签选图，回填已于 11-03 写入 1619 条。
  - 用户说过不要的形式不发；私密模式下不发语音，沿用现有限制。
  - 计费、计数（「3 次无回复」、早安晚安单独计数）都不能被改坏。
- **测试**：单测覆盖三点：形式判断确实被调用、`suppressedForms` 生效、私密模式不发语音。
- **先看 #44**：本任务开工时 #44 可能还没合入 main。先 `git fetch origin`；#44 已合入就直接合并 origin/main；还没合入就先合并 `origin/feat/ecology-v3-switches-20261103`（用 merge，不 rebase），等它合入后再合并一次 origin/main。

## 规矩

- 分支 → PR（base main）→ CI。不推 main、不合并、不部署、不碰服务器。做到一半就及时推远端分支。
- 本机只跑一次相关检查（类型检查、改动文件 lint/prettier、相关单测），其余交给 CI。
- 不读用户私聊原文。
- 交接写 `docs/handoffs/2026-11-03-plaza-official-proactive-forms.md`，内容包括做了什么、改了哪些文件、自测结果、遗留问题。
