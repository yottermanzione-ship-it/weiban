'use strict';
// Exact source edit only; never replaces the old checkout or any unrelated dirty file.
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const hash = (text) => crypto.createHash('sha256').update(text).digest('hex');

function patchSource(original) {
  let source = original.replace(/\r\n/g, '\n');
  if (source.includes('LEGACY_CHANNEL_RELAY_ENABLED'))
    throw new Error('RELAY_PATCH_ALREADY_PRESENT');
  const replace = (before, after) => {
    if (source.split(before).length !== 2) throw new Error('RELAY_PATCH_CONTEXT_MISMATCH');
    source = source.replace(before, after);
  };
  replace(
    'migrateDatabaseSecrets(startupDatabase);',
    `migrateDatabaseSecrets(startupDatabase);
const legacyRelay = process.env.LEGACY_CHANNEL_RELAY_ENABLED === "1"
  ? require("./lib/legacy_channel_relay.cjs").createLegacyRelay({ database: startupDatabase })
  : null;`,
  );
  replace(
    'const app = express();',
    `const app = express();
app.use(require("./lib/legacy_channel_relay.cjs").createMaintenanceMiddleware());`,
  );
  replace(
    'function leasedTimer(jobKey, leaseMs, task) {',
    'function leasedTimer(jobKey, leaseMs, task) {\n  if (process.env.LEGACY_BACKGROUND_DISABLED === "1") return () => {};',
  );
  replace(
    'require("./lib/voice/qwen_realtime_gateway").attachRealtimeGateway(httpServer);',
    'if (process.env.LEGACY_GENERATION_DISABLED !== "1") require("./lib/voice/qwen_realtime_gateway").attachRealtimeGateway(httpServer);',
  );
  replace(
    '  const bindingStore = createBindingStore(db);',
    '  let bindingStore = createBindingStore(db);\n  if (legacyRelay) bindingStore = legacyRelay.mappedWechatStore(bindingStore);',
  );
  replace(
    '  const ilinkClient = createIlinkClient({});',
    '  let ilinkClient = createIlinkClient({});\n  if (legacyRelay) ilinkClient = legacyRelay.mappedWechatClient(ilinkClient);',
  );
  replace('  const poller = createWechatPoller({', '  let poller = createWechatPoller({');
  replace(
    '    inboundService: createInboundService({',
    '    inboundService: legacyRelay ? legacyRelay.wechatInbound() : createInboundService({',
  );
  replace(
    '  const channelRunner = createWechatChannelRunner({',
    '  if (legacyRelay) poller = legacyRelay.wrapWechatPoller(poller);\n  const channelRunner = createWechatChannelRunner({',
  );
  replace(
    '  const inboundService = createWeiboInboundService({',
    '  const inboundService = legacyRelay ? legacyRelay.weiboInbound() : createWeiboInboundService({',
  );
  replace(
    '  const weiboRunner = createWeiboChannelRunner({',
    '  const weiboRunner = legacyRelay ? legacyRelay.weiboRunner(weiboPool) : createWeiboChannelRunner({',
  );
  replace(
    '  const inboundService = createQqInboundService({',
    '  const inboundService = legacyRelay ? legacyRelay.qqInbound() : createQqInboundService({',
  );
  replace(
    '  const qqRunner = createQqChannelRunner({',
    '  const qqRunner = legacyRelay ? legacyRelay.qqRunner(clientRef) : createQqChannelRunner({',
  );
  return source;
}

function patchFunctions(original, names) {
  let source = original.replace(/\r\n/g, '\n');
  if (source.includes('LEGACY_GENERATION_DISABLED'))
    throw new Error('GENERATION_PATCH_ALREADY_PRESENT');
  for (const [declaration, action] of names) {
    if (source.split(declaration).length !== 2)
      throw new Error('GENERATION_PATCH_CONTEXT_MISMATCH');
    source = source.replace(
      declaration,
      `${declaration}\n  if (process.env.LEGACY_GENERATION_DISABLED === "1") ${action}`,
    );
  }
  return source;
}

function patchChatSource(source) {
  let result = patchFunctions(source, [
    [
      'async function generateReply(name, message, context) {',
      'throw new Error("LEGACY_GENERATION_DISABLED");',
    ],
    ['function scheduleReplyJob(id) {', 'return;'],
    ['async function runReplyJob(id, overrides = {}) {', 'return;'],
    ['function recoverReplyWork() {', 'return;'],
  ]);
  const trigger = 'scheduledReplyTrigger.start(1000);';
  if (result.split(trigger).length !== 2) throw new Error('GENERATION_PATCH_CONTEXT_MISMATCH');
  result = result.replace(
    trigger,
    'if (process.env.LEGACY_GENERATION_DISABLED !== "1") scheduledReplyTrigger.start(1000);',
  );
  return result;
}

function patchGroupSource(source) {
  return patchFunctions(source, [
    ['  function scheduleTurnJob(jobId) {', 'return;'],
    ['  function recoverTurnJobs() {', 'return;'],
    ['  function expireAbandonedTurns() {', 'return 0;'],
  ]);
}

function patchModelSource(source) {
  return patchFunctions(source, [
    [
      'async function withSceneBestOfN(scene, fn, options = {}) {',
      'throw new Error("LEGACY_GENERATION_DISABLED");',
    ],
    [
      'async function withSceneFailover(scene, fn, options = {}) {',
      'throw new Error("LEGACY_GENERATION_DISABLED");',
    ],
  ]);
}

function main(args) {
  const root = path.resolve(args[0] || '/opt/weiban-server');
  const candidates = [
    ['server.js', patchSource],
    ['routes/chat.js', patchChatSource],
    ['lib/group/group_service.js', patchGroupSource],
    ['lib/model/model_router.js', patchModelSource],
  ].map(([relative, patch]) => {
    const target = path.join(root, relative),
      original = fs.readFileSync(target);
    return { relative, target, original, patched: patch(original.toString('utf8')) };
  });
  const apply = args.includes('--apply');
  if (apply) {
    const manifestPath = args[args.indexOf('--source-manifest') + 1];
    if (!args.includes('--source-manifest')) throw new Error('RELAY_SOURCE_MANIFEST_REQUIRED');
    const expected = JSON.parse(fs.readFileSync(manifestPath, 'utf8'));
    for (const row of candidates)
      if (expected[row.relative] !== hash(row.original))
        throw new Error('RELAY_SOURCE_HASH_MISMATCH');
    for (const row of candidates)
      fs.writeFileSync(
        `${row.target}.before-legacy-relay-${hash(row.original).slice(0, 16)}`,
        row.original,
        { flag: 'wx', mode: 0o600 },
      );
    const adapterTarget = path.join(root, 'lib/legacy_channel_relay.cjs');
    fs.copyFileSync(
      path.join(__dirname, 'legacy_channel_relay.cjs'),
      adapterTarget,
      fs.constants.COPYFILE_EXCL,
    );
    for (const row of candidates) {
      const temp = `${row.target}.relay-new`;
      fs.writeFileSync(temp, row.patched, { flag: 'wx', mode: fs.statSync(row.target).mode });
      if (hash(fs.readFileSync(row.target)) !== hash(row.original))
        throw new Error('RELAY_SOURCE_CHANGED_DURING_PATCH');
      fs.renameSync(temp, row.target);
    }
  }
  return {
    applied: apply,
    files: candidates.map((row) => ({
      path: row.relative,
      sourceSha256: hash(row.original),
      candidateSha256: hash(row.patched),
    })),
  };
}

module.exports = { patchSource, patchChatSource, patchGroupSource, patchModelSource, main };
if (require.main === module) {
  try {
    process.stdout.write(JSON.stringify(main(process.argv.slice(2))) + '\n');
  } catch {
    process.stderr.write('LEGACY_RELAY_PATCH_FAILED\n');
    process.exitCode = 1;
  }
}
