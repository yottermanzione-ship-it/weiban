# 第 3 项反馈：每次进入聊天都多一条「已切换到 日常聊天」

## 同一根因的第二个症状（2026-10-25 追加）

用户打开「情景预设」弹层，里面是空的。该弹层由 `CompanionEndpoints.listModes` 驱动（[scenario.tsx](<C:/wb-dev/wb-client-logs/apps/web/src/features/scenario.tsx>) 第 86 行），后端正是同一个 `settings.listModes()` → `policy.listAllowedScenarioModes()` 过滤，旧卡空白名单把候选模式全部滤掉，所以返回空列表。群聊的 `GroupCompanionEndpoints.listModes` 走同一套策略，同样受影响。

不需要单独修：第 3 项的修复（空白名单 = 不限制）同时恢复该弹层；发布后需实际打开弹层确认能列出自动/日常/树洞/打气/傲娇（私密项仍按资格返回）。

## 现象

- 用户截图：和张桂源的私聊里，同一句系统提示「已切换到 日常聊天」在「凌晨 2:12」连着出现多行，2:56 又来一条。
- 用户描述：每次点进聊天都会弹一次。

## 已查到的真实原因（代码 + 线上数据双重证据）

1. 旧角色卡没有新卡的 `modes.adminAllowlist`，`roleAdminAllowlist()` 对旧卡返回空数组（[character-view.ts](<C:/wb-dev/wb-client-logs/apps/server/src/modules/ai-runtime/application/character-view.ts>) 第 121 行）。
2. 但策略层把「空数组」当成「白名单里什么都没有」：`!input.adminAllowlist || includes(...)`，空数组是 truthy，于是 [policy.ts](<C:/wb-dev/wb-client-logs/apps/server/src/modules/policy/application/policy.ts>) 第 72–80 行对每个旧卡角色都返回空的可选模式列表。
3. 于是 [settings.ts](<C:/wb-dev/wb-client-logs/apps/server/src/modules/ai-runtime/application/settings.ts>) 第 147 行认为当前模式「不可用」，每次都把场景改回日常、写一条系统提示；幂等键用的是上一次 `updatedAt` 的毫秒值（第 180 行），每次写入都会变，所以永远去重不了。
4. 线上佐证：该账号 6 条 `companion_settings` 里有 5 条在同一晚被改成 `daily`，时间点与该会话 6 条系统消息一一对应（18:12–18:57 UTC，即北京时间 2:12–2:57），恰好是用户点进聊天的时间。

影响面不止这个角色：677 张旧卡都没有 `adminAllowlist`，所有旧卡角色都会命中，且设置里的情景模式列表会是空的。

## 修复要求

- 空白名单 = 不限制，而不是「一个都不允许」；旧卡按代码注释的原意当作没有该字段。
- 已经是日常时不要把「回落成日常」再写一次设置、更不要再发系统提示；非旧卡的合法回落仍要保留一次提示（例如成人模型不可用）。
- 幂等键不要用会随写入变化的毫秒时间戳；同一原因的重复回落只能有一条提示。
- 不改变真实的安全策略：儿童、真实人物、私密模式等限制照旧，不能为了让提示消失而放宽限制。

## 执行与边界

- 交给后端/策略子代理，模型 `deepseek-account` / `deepseek-flash`。
- 不改旧站、不改数据库数据、不部署、不提交；只改代码与对应单测。
- 已产生的重复提示是否清理，单独作为一次性数据清理决定，不与代码修复混在一起。
- 检查：只跑一次与改动直接相关的单测。
