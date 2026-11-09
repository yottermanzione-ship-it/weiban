# 旧绑定渠道中继候选：2026-11-09

此目录是本轮独立候选，不表示已部署或已真实收发。源码、映射准备和验证由根统一收口；不要另起发布框架或逐文件重启。

**21:56 最新范围覆盖此前候选：微博全部不迁移，用户自行在新版绑定；旧微博传输关闭，不影响新版原生微博。微信只迁正式 cutover 时最终 `identity.memberships.pro_plus_until > cutoverAt` 的有效 PRO+ 用户，按会员转换后的最终值判定，不覆盖新站更长期限；过期跳过。QQ维持原1条计划。固定保护账号仍全部排除。**

## 运行边界

- 合格微信与原 QQ 的凭据和连接留旧主机；微博不导出敏感绑定包，只输出 excludedWeibo 数量。这里只处理普通文字。新版使用同 UUID 的有效账号、已经存在的预设角色/有效联系人/私聊，调用原 `ChatUserPort.sendMessage`，计费及回复只有新版一条路径。
- 旧绑定 ID、generation、原真实 peer 的 SHA256、原角色名 SHA256 固定；不覆盖原生 `channels.bindings`。旧包即使带微博，plan也排除，apply/enable与新版legacy入口都硬拒绝。
- 新增 `0164_legacy_channel_relay`。映射导入默认关闭；每绑定认证密钥从旧进程既有 JWT_SECRET 独立派生，新版按该用户 DEK 密封存储。跨机包为 RSA-OAEP + AES-GCM；接收私钥也由现有平台 DEK 密封，无新增明文秘密文件。
- 入站原 inbox/游标事务提交后再转发。外部消息 ID 转成稳定 UUID；超时重试不更换键，绝不扣旧 quota、创建旧 pending reply job 或降级调用旧模型。平台未提供时间时沿旧协议以接收时间记账，有旧原始 inbox receipt 的消息仍拒绝重放。
- 出站只取对应新角色的 normal 文字，排除撤回、健康和草稿标签，先持久化旧 `done` 合成 job + delivery，再确认新游标。旧 HTTP 发送器使用本地固定绑定的真实对端；每次实际发出前向新版 `status` 校验。微博/QQ 外发阶段中断或结果不明留 `ambiguous`，不盲重发。微信复用原 claim/lease/分段 client ID 及 ambiguous 语义。
- 本人解绑禁用本渠道全部 legacy 映射，并记 `user_disabled`，运维重新执行 enable 不能悄悄恢复。列表显示“沿用原有连接”，重复扫码/填凭据/换角色被拒绝；不新增多槽编辑界面。

## 一次运行配置

`runtime.env.patch.json` 是所有旧运行变量的唯一覆盖源。`patch-old-env.cjs` 只改这些非秘密键，保留原 `.env` 其他内容，核对原 SHA、留备份，**不重启**。`.env` 不能覆盖 PM2 已存在的同名环境，因此根在最终唯一一次恢复 patched `weiban-server` 时，须同时把这份 JSON 中的值注入实际 PM2 环境并 `--update-env`，再用布尔/存在性回读确认，不能打印 PM2 全部环境。

总闸包括 `LEGACY_WRITES_PAUSED`、`LEGACY_GENERATION_DISABLED`、`LEGACY_BACKGROUND_DISABLED`；同时明确关闭 heartbeat、group scenes、moments、moments publish。旧微信/QQ ENABLED=1，WEIBO_CHANNEL_ENABLED=0；adapter会拒绝微博未关闭的配置。

维护中间件在 Express 路由前：GET/HEAD `/app`、`/app/*` 跳到 `https://app.weiban.online/`，不携带旧查询参数；`/api/app/config`、`/api/download-config` 的 GET/HEAD 放行，公开下载静态资源与 `/health*` 不拦。其余旧 `/api/` 请求返回 503 + 升级提示；旧支付回调也返回 503 保留重试，**绝不恢复旧认单/履约**。渠道入站为 WSS/长轮询，不经过这些 HTTP 写路由。

`apply-old-patch.cjs` 仅精确修改四个源码文件：`server.js`、`routes/chat.js`、`lib/group/group_service.js`、`lib/model/model_router.js`。逐文件确认原 SHA、备份；任何上下文不同直接失败。保留 dirty server.js 其余改动。总闸禁止 reply recovery / 未答 sweeper / scheduled trigger / 群回合恢复 / 模型路由；不挂接旧实时语音 WebSocket；普通 leasedTimer 背景任务停止，渠道 startLeadership 保留。

## 根执行顺序

1. 冻结与备份依根总流程：真实目标为 root PM2 `weiban-server`，以及独立 `weiban-voice-agent.service`、`weiban-voice-bridge.service`。不要停止整个 PM2 daemon；独立语音两服务切换后保持停用。导出冻结证明用真实进程/有效写入开关，不用不存在的 unit。
2. 旧普通业务写及生成关闭；维护期停止真实进程后取最终数据。最终聚合检查旧 reply pending/running 和群 pending/running 为 0；`awaiting_asr`、`scheduled` 保留冻结，不执行/删除。新 app 按根流程停止、备份、先补原 schema 数据/财务。
3. 0162 数据/补偿完成后，新 app 仍停止；使用已审查新镜像单独 migrate 0163/0164。迁移前 B0 独立固定，正式 release 的额外备份也保留。此时不启动新 app，不另起发布框架。
4. 准备接收与映射：将 `prepare-new.mjs` 打包单文件放入同一维护容器，复用新服务数据库/KEK配置。正式优先采用下述同一父进程持有 `privatePem`、plan/apply 分别经 stdin 传入的方式；不写私钥文件、不放环境变量、不输出。公开 PEM 和加密源包可传文件。原 `recipient` 文件模式仅作 tmpfs 备用，代码要求接收目录所在文件系统为 Linux tmpfs；其中 `.private.sealed` 是加密临时文件，**不是纯进程内存**，禁止复制到系统盘/资料目录。旧 exporter 如需实际 PM2 环境覆盖，在旧进程还运行时传当次核对的 `--runtime-pid`，不输出环境。
5. `plan` 使用加密源包，按旧 characters_v2 ID → 新 legacy_card.id 精确匹配；同 UUID active 用户、published 角色、active 联系人和现有 normal direct 会话必须都存在。无匹配、归属不符、原生渠道冲突、未确认 peer 都列为排除计数；不新建角色/好友/会话。`--cutover-at` 使用实际停止旧写入的 UTC 时间。计划不得引用还会变化的聊天尾序号；应在最后一次数据补齐后产生。
6. plan 排除全部微博和同一固定 policy 保护账号，并查询转换完成后的最终会员筛选微信；apply与enable再次查询会员、拒绝微博，保护 owner在任何写入前硬拒绝。`--allow-exclusions yes` 只允许 `preserved_existing_account`、`native_binding_conflict`、`manager_skip_weibo`、`membership_expired`，其余原因一律拒绝整体跳过。原生冲突保留新版原生。导入只插入；map不含认证密钥。enable拒绝用户已断开的映射。
7. 旧进程仍停止时，`freeze-old-queues.cjs` 先只读取得队列摘要 SHA。验证备份后 apply：保留所有行，旧 pending/retry/claimed/sending 记 `skipped/legacy_cutover_frozen`，原完整值在验证备份；既存 ambiguous 完全不动；`lrout-*` 新中继行不碰。脚本拒绝仍有旧 pending/running 生成任务。
8. 维护期完成映射 apply/enable、旧四源码精确补丁、旧队列冻结和一份运行配置覆盖之后，最后运行正常 `release.sh` 统一启动新 app/Caddy；随后仅恢复 patched `weiban-server`。release 依旧/新 journal 判定 has_migration=1，不误自动回退旧 schema。若需先上线旧维护提示而映射未就绪，relay=0 时旧三渠道也必须暂时为 0，避免生成旧待办。
9. `probe-mappings.cjs` 逐映射签名请求新版 `status`，只输出总数/HTTP 状态计数，0 消息/0 模型调用；核实全部计划映射授权就绪。再按根总体方案开放新版。签名 status 不是平台实际收发验收，真实外部消息仍需另行观察。

## 工具入口

```text
# 本地构建运维工具，不在生产安装 tsx
node deploy/legacy-channel-relay/build-preparation.mjs <绝对路径/prepare-relay.bundle.mjs>

# 正式 plan/apply 的 stdin 仅承载私钥 PEM，由下方同一个父进程分别传入
node prepare-relay.bundle.mjs plan --private-key-stdin yes --encrypted-source <cipher.json> --plan <plan.json> --cutover-at <UTC-ISO>
node prepare-relay.bundle.mjs apply --private-key-stdin yes --encrypted-source <cipher.json> --plan <plan.json> --plan-sha256 <已核对SHA> --old-map-output <map.json>
node prepare-relay.bundle.mjs enable --plan <plan.json> --plan-sha256 <同一SHA>
node prepare-relay.bundle.mjs disable --plan <plan.json> --plan-sha256 <同一SHA>

# 旧机；默认路径只读 dry-run，apply 只在根维护时执行
node export-old.cjs --root /opt/weiban-server --recipient-public-key <public.pem> --recipient-sha256 <DER-SHA> --output <cipher.json>
node apply-old-patch.cjs /opt/weiban-server
node apply-old-patch.cjs /opt/weiban-server --apply --source-manifest <四文件原SHA对象.json>
node patch-old-env.cjs /opt/weiban-server/.env
node patch-old-env.cjs /opt/weiban-server/.env --apply --expect-sha256 <原环境文件SHA>
node freeze-old-queues.cjs /opt/weiban-server
node freeze-old-queues.cjs /opt/weiban-server --apply --expect-queue-sha256 <摘要SHA> --backup-attestation <备份确认.json>
node probe-mappings.cjs --root /opt/weiban-server --map <map.json> --origin https://app.weiban.online
```

备份确认 JSON 为 `oldProcessStopped: true` 和已验证的 `verifiedBackupSha256`，是根的操作事实声明，不能把“文件存在”当备份验证。以上工具均不主动重启服务、不改 DNS/下载文件、不调用模型。

## 私钥只留父进程内存的最小编排

在 Windows Node 24 的同一进程执行。参数依次为现有维护容器名、切换 UTC、旧机已放好的本目录工具路径；新 bundle 已放 `/app/fast-cutover/prepare-relay.bundle.mjs`，维护容器已有 `/run/relay` 临时目录和新服务 DB/KEK 配置。脚本仅创建公开 PEM、加密源包和计划/map；不会创建 private.sealed，不启停服务。apply 自身严格限制可排除原因。所有 SSH 输出都先捕获，不打印原始私钥或源包。

```js
import { execFileSync } from 'node:child_process';
import { generateKeyPairSync, createHash, randomUUID } from 'node:crypto';
const [container, cutoverAt, oldTools] = process.argv.slice(2);
if (!container || !cutoverAt || !oldTools) throw new Error('ARGUMENTS_REQUIRED');
const q = (s) => "'" + String(s).replaceAll("'", "'\\''") + "'";
const ssh = (old, command, input) =>
  execFileSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-i',
      old ? 'C:/Users/lomjy3/.ssh/weiban_old.pem' : 'C:/Users/lomjy3/.ssh/weiban_deploy',
      old ? 'ubuntu@152.136.111.51' : 'root@103.231.58.124',
      command,
    ],
    { input, windowsHide: true, stdio: ['pipe', 'pipe', 'pipe'] },
  );
const docker = (args, input) =>
  ssh(false, ['docker', 'exec', '-i', container, ...args].map(q).join(' '), input);
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 3072 });
const privatePem = Buffer.from(privateKey.export({ type: 'pkcs8', format: 'pem' }));
const publicPem = publicKey.export({ type: 'spki', format: 'pem' });
const fingerprint = createHash('sha256')
  .update(publicKey.export({ type: 'spki', format: 'der' }))
  .digest('hex');
const id = randomUUID(),
  oldPrefix = '/tmp/weiban-relay-' + id,
  dir = '/run/relay/' + id;
const tool = '/app/fast-cutover/prepare-relay.bundle.mjs';
try {
  ssh(true, 'umask 077\ncat > ' + q(oldPrefix + '.public.pem'), publicPem);
  ssh(
    true,
    [
      'sudo',
      '-n',
      'node',
      oldTools + '/export-old.cjs',
      '--root',
      '/opt/weiban-server',
      '--recipient-public-key',
      oldPrefix + '.public.pem',
      '--recipient-sha256',
      fingerprint,
      '--output',
      oldPrefix + '.cipher.json',
    ]
      .map(q)
      .join(' '),
  );
  const cipher = ssh(true, ['sudo', '-n', 'cat', oldPrefix + '.cipher.json'].map(q).join(' '));
  docker(['mkdir', '-p', dir]);
  docker(['sh', '-c', 'umask 077\ncat > ' + q(dir + '/cipher.json')], cipher);
  const common = [
    '--private-key-stdin',
    'yes',
    '--encrypted-source',
    dir + '/cipher.json',
    '--plan',
    dir + '/plan.json',
  ];
  const plan = JSON.parse(
    docker(['node', tool, 'plan', ...common, '--cutover-at', cutoverAt], privatePem).toString(),
  );
  const applied = JSON.parse(
    docker(
      [
        'node',
        tool,
        'apply',
        ...common,
        '--plan-sha256',
        plan.planSha256,
        '--old-map-output',
        dir + '/map.json',
        '--allow-exclusions',
        'yes',
      ],
      privatePem,
    ).toString(),
  );
  // 仅汇报摘要；随后根用这里的 dir/planSha256 完成 enable、复制 map 及已有正式执行步骤。
  console.log(JSON.stringify({ dir, plan, applied }));
} finally {
  privatePem.fill(0);
}
```

## 一次集中验证（候选作者尚未执行）

```text
pnpm exec vitest run apps/server/src/modules/channels/legacy-relay.test.ts apps/server/src/modules/channels/legacy-binding-management.test.ts
node --test deploy/legacy-channel-relay/legacy-relay.test.mjs
pnpm --filter @weiban/server typecheck
```

另跑本批 scoped ESLint、格式检查和根要求的迁移检查；生产前对最终四个旧源 SHA 做 dry-run 并复核差异。新协议测试使用假端口；旧 adapter 测试使用 node:sqlite 内存库、假 HTTP/平台发送器和假秘密，验证幂等、队列、代际/peer、维护模式、冻结和生成闸门。不能据此声称真实微信/微博/QQ已经收发通过。

回退先禁用新 legacy 映射并停旧 relay，再按根备份恢复对应源文件/运行配置。不要重新启动旧生成、恢复旧支付或重发 ambiguous 队列来掩盖中继失败。旧服务仍负责渠道传输，因此在桥接替代方案完成前不能关机；新旧传输不得同时接管同一绑定。
