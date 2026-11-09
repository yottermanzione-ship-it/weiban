# 增量附件清单、转运与归属演练

结论：**本轮附件工具开发自测通过；正式迁移与独立验收未完成。** 仅在独立副本和每项测试自行创建的合成临时目录工作，未连接线上、未读真实聊天/私有媒体/凭据，未切站、发布或更改生产配置。

| 项 | 内容 |
|---|---|
| 日期 / 执行人 | 2026-11-09 / Codex 媒体子任务 |
| 独立副本 | `C:/wb-dev/wb-migration-rehearsal-1109` |
| 分支 | `codex/migration-rehearsal-20261109` |
| 读取基线完整 SHA | `cc10580419eeb1306b361b799688af85ec52530d` |
| 本文对应改动 | 当前分支未提交工作树中的 `scripts/ops/legacy-delta-media.mjs` 与同名测试；最终集成 SHA 由主会话登记 |
| 关联 | [正式迁移方案](../handoffs/2026-11-09-migration-cutover-plan.md) P04/P05；[11-08 元数据预检](2026-11-08-legacy-delta-preflight.md)；既有 Q-063 |

## 实现与生产代码依据

- 原始媒体对象沿用 [旧内容导入器](../../scripts/ops/import-legacy-content.mjs) 的对象结构，ID 为 `legacyId('media', ownerUserId, purpose, asset.path)`；用户表情 ID 为 `legacyId('user-sticker', ownerUserId, mediaId)`。同源文件可只转运一份，但不同用户/用途仍有不同媒体对象，不共享私有访问身份。
- [新增离线模块](../../scripts/ops/legacy-delta-media.mjs) 不加载应用配置、不创建数据库连接、不读取密钥文件、不下载网络地址、不自动写报告。源和暂存目录须为调用者独占、无并发写入的本地目录。源目录只读，二者不能相同或互为父子目录。
- `buildLegacyDeltaMediaPlan` 生成整体 SHA-256 与逐块 SHA-256、用户/用途关联、源字节数、去重后暂存字节数、单文件最大源缓冲区，以及未解码扩展前的加密对象容量估算。**估算不含图片解码/重编码增减、缩略图、数据库、文件系统及备份，不可据此单独放行真实磁盘容量。**
- `transferLegacyDeltaMedia` 在每次执行时验证源、已完成目标和部分目标。部分块被修改会重传；完成文件被修改默认返回 `staged_corrupt`。显式 `repairCorruptStaging: true` 仅在固定源再次校验通过后重建自身暂存目录下的生成文件，不删除源文件。发布采用不会覆盖已有目标的 hard-link/unlink，并可恢复在两步之间中止的精确双链接对。
- 路径检查覆盖绝对/上级/反斜杠/盘符与 ADS/保留设备名、目录 junction/符号链接、普通文件 hard link，以及根目录祖先链。根目录缺失或不安全只返回固定分类，不把路径带入异常正文。尚未声明抵抗拥有该临时目录写权限的对抗性并发修改；正式运行须保障目录独占。
- `createLegacyDeltaMediaPort` 接入现有 [MediaService](../../apps/server/src/modules/media/application/media.ts) 的 `importLegacyObject`、`inspectLibraryImage`、`canUse`、`readBytes`。图片预期摘要来自同一实际重编码流程；现有对象亦重新比较用户、用途、状态、预期内容摘要，并按归属解密读取、比对最终字节数/MIME/摘要。已有 `ready` 行或 checkpoint 标记均不足以放行。
- 密文仍由实际 [EnvelopeCrypto](../../apps/server/src/platform/crypto/envelope.ts) 产生，保持每用户 DEK、随机 nonce、`media:{id}` AAD。工具不另造加密格式。读取、归属、解密或表情绑定失败的对象不会进入供消息导入器使用的 `ready` Map。
- 缺源文件、无引用、外部来源、源变化、损坏暂存文件、归属冲突、未就绪对象、解密失败等固定分类分别记录。未解决项使 `summary.ok=false`，即使其余对象已经完成。未填假附件，未把旧观察的 3,228 文件/约 832 MB、33 缺失或无引用当成实时统计。

## 主导入器接入约定

```javascript
const plan = await buildLegacyDeltaMediaPlan({
  objects: existingMediaPlan.objects,
  sourceRoot,
  unresolvedReferences: [
    // 由当前受保护源清单填入实际分类/数量，不使用历史观察值。
    // { classification: 'missing' | 'no_reference' | 'unsupported_external', count: 1 }
  ],
});
const transfer = await transferLegacyDeltaMedia({
  plan, sourceRoot, stagingRoot, checkpoint, onCheckpoint,
});
const mediaPort = createLegacyDeltaMediaPort({
  media, adminId, lookupObject, bindSticker,
});
const imported = await importLegacyDeltaMedia({
  plan, stagingRoot, mediaPort, normalize, checkpoint, onCheckpoint,
});
```

- `lookupObject(id)` 只返回媒体元数据，使用应用行的 `id/ownerId/purpose/state/contentHash/sizeBytes/mimeType` 驼峰字段；`media` 是调用者已受控装配的真实 MediaService。模块不自行连接数据库。
- `normalize(object, bytes)` 返回 `{ bytes, mimeType, durationMs?, legacyVideo? }`，调用者必须复用已核准的旧文件规范化规则。现有 WAV 修复/转码、SVG 处理及旧 MP4 poster 提取不是本模块新写的另一套算法。本轮对合成有效 WAV/PNG 使用真实媒体服务解码及储存；未声称覆盖所有历史文件格式或已实际播放。
- `bindSticker(object)` 必须幂等并验证目标表情绑定归属；表情对象没有此端口或绑定失败时不会进入 `ready`。头像等业务引用仍由其所属业务事务写入，模块不覆盖已有头像。
- 导入返回 `ready: Map<mediaId, { id, ownerUserId, purpose, stickerId, sourceSha256, contentHash }>`。消息导入必须核对引用对象及预期所有者/用途，不能只测试 Map 中有同名 ID。
- `plan`、`checkpoint`、`outcomes` 和 `ready` 含受保护的源标识/路径/关联/摘要，不应写普通日志。需要持久化时由主流程采用权限受限的受保护存储；回调持久化失败立即停止，后续重跑重新核验真实对象。公开报告只使用固定分类与数字组成的 `summary`。模块没有自动输出原始异常信息。
- 主流程应保留已确认的缺失/冲突处置单；不能仅以部分对象成功或用户自行改写 `plan.summary.ok` 绕过完整性门禁。

## 自测证据

测试使用 Node v24.21.0、已安装项目依赖。运行真实 `MediaService` 的导入、图片重编码、音频检查、pending→ready、异常清理、访问检查与读取，以及真实信封加密。仅数据库持久层、对象存储、账号状态/审计以进程内合成端口代替；不启动 Nest/队列，不连接 PostgreSQL，不创建/清理共享 `weiban_test`。随机测试 KEK/DEK 仅存在内存，未输出、未保存密钥文件；测试结束清零并清理自己创建的临时目录。

```powershell
$env:TSX_TSCONFIG_PATH = 'apps/server/tsconfig.json'
node --import ./apps/server/node_modules/tsx/dist/loader.mjs --test scripts/ops/legacy-delta-media.test.mjs scripts/ops/legacy-content-rules.test.mjs
pnpm exec eslint scripts/ops/legacy-delta-media.mjs scripts/ops/legacy-delta-media.test.mjs
pnpm exec prettier --check scripts/ops/legacy-delta-media.mjs scripts/ops/legacy-delta-media.test.mjs
```

合成附件测试 **17/17** 与既有标识/规则测试 **6/6** 通过，无跳过；测试命令退出 0。代表性覆盖如下：

| 场景 | 结果与证据边界 |
|---|---|
| 同源、同字节重复源与跨用户 | 仅去重转运；媒体 ID、owner、密文独立，另一用户 `canUse` 为 false，改 owner 或媒体 AAD 无法解密 |
| 清单缺项 | 缺文件/空文件/大小变化/无引用/外部来源分开计数，保持未完成；不下载外部链接 |
| 路径越界 | 穿越、绝对路径、盘符/ADS、设备名、junction、hard link、源/暂存嵌套均拒绝；测试全部执行，没有因 Windows 跳过 |
| 断点与完整性 | 块回执失败后中止，已存部分块损坏可修复；伪造完成列表仍重读；完成文件损坏默认阻断，显式重传恢复 |
| 源后续变化 | 即使已有暂存完成文件也拒绝；源未通过再次校验时不删除损坏暂存证据 |
| 发布中途停止 | 精确 `.bin`/`.partial` 双链接对可恢复；不放行其他 hard link |
| 旧对象复用 | owner、用途、pending 状态、预期解码摘要、字节数任何不符均阻断，保留原数据、不覆写 |
| 真实图片与表情 | PNG 实际重编码为 WebP，校验解码后摘要；绑定失败后重跑复用媒体并完成绑定，不产生重复对象 |
| 存储失败及 checkpoint 失败 | 实际媒体 store 清理 pending/对象；后续可重跑；媒体已提交但回执失败后重新解密校验再复用 |
| 密文篡改/账号删除 | 密文认证失败不产生 ready 引用；删除账号不能经导入重建数据密钥 |
| 敏感数据与内存 | 汇总不含合成用户 ID、源路径、文件名或内容哈希；正常/失败路径清零源及规范化明文缓冲区；未持久化随机密钥 |

首轮 ESLint 检出路径拒绝正则中控制字符写法，已改为逐字符数值判断，保留原限制；不绕过 lint 规则。最终 ESLint、Prettier 检查退出 0；三个新增文件分别执行 `git diff --no-index --check -- NUL <file>`，均无空白诊断（退出 1 表示新增文件差异，不代表空白检查失败）。

## 未完成与正式放行限制

1. 本轮是开发者自测，不能作为独立验收签字。数据库内存端口不能证明真实 PostgreSQL 约束、并发锁、磁盘故障和对象存储的生产行为。
2. 未读取或搬运任何真实私有媒体；真实缺文件/无引用数量、最终清单和恢复处置仍需正式授权后在受保护环境重新核实。
3. 未跑约 832 MB 的重型媒体规模计时。代表规模、实际存储吞吐与维护窗口估算由主会话统一执行；本报告不根据小测试时长推断真实迁移耗时。
4. 尚需接入最终受保护媒体计划/回执持久化、实际规范化端口、账号/消息导入事务和真实存储，并验证真实必要附件解密/可展示/可播放与权限。相关路径不会因本轮工具测试通过自动对线上开放。
