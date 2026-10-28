#!/usr/bin/env node
/**
 * V3（2026-10-28）：从旧服务器只读导出实时通话的复刻音色绑定，以及「DashScope Beijing Workspace」账号（加密）。
 * 由总负责人在本机执行（需要旧服 SSH 私钥）；脚本本身不含任何凭据。默认只打印将执行的步骤，加 --run 才连接旧服。
 *
 * 背景（10-28 生产实查 + 总经理 10-28 下午拍板）：旧库 402 条实时绑定分属三个账号——
 * - 私有 workspace 供应商 cb9de005「DashScope Beijing Workspace」（端点 eb3630dd-bfbd-49ea-a460-b542a98eb354，
 *   qwen-audio-3.0-realtime-plus，基址 https://ws-qsp3p9ofolmfyu6g.cn-beijing.maas.aliyuncs.com/api，213 条）：**要**，
 *   账号经 ADR-20261023 加密通道迁入，绑定迁进 qwen/qwen-audio-3.0-realtime-plus；
 * - 私有 workspace 供应商 8d1b5e3b「156语音」（端点 6b29cca6…，15 条）：**不要**，一律拒绝；
 * - 公共百炼供应商 8eed4824（端点 0975357a…，qwen3.5-omni-plus-realtime，174 条）：V2 已迁（新站已有同一账号）。
 * 复刻音色只在创建它的账号可用，所以每个端点的绑定只能迁到挂在同一账号上的模型。
 *
 * 三步（都只读旧库；旧服不落任何文件）：
 *   1. discover：列出旧库全部实时端点（端点 ID / 型号 / 启用 / 供应商 ID 与名称 / 基址 / 绑定条数），标出可迁的（allowed），
 *      并把需要迁账号的北京 workspace 写成 scope.json（新服 import-legacy-upstreams --prepare --scope-file 直接用）。
 *   2. bindings：只导出 --endpoint-id 指定的那一个可迁端点下、该端点型号的绑定；查询本身还要求端点属于对应供应商，
 *      拿回的每一行再逐条核对端点、供应商、型号，有一行不对就不写文件。
 *   3. account：只接受北京 workspace 端点；用新服 prepare 产生的接收方公开证书在旧服内存里加密导出账号，本机只拿到密文。
 *
 *   node scripts/ops/export-realtime-workspace.mjs discover --ssh-key <私钥路径> --out-dir <本机空目录> [--run]
 *   node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key <私钥路径> --out-dir <本机空目录> \
 *     --endpoint-id <discover 里 allowed = true 的完整端点 ID> [--run]
 *   node scripts/ops/export-realtime-workspace.mjs account --ssh-key <私钥路径> --out-dir <本机空目录> \
 *     --endpoint-id eb3630dd-bfbd-49ea-a460-b542a98eb354 --receiver-cert <receiver.crt> \
 *     --receiver-sha256 <64 位小写十六进制> [--run]
 *
 * 输出文件只新建不覆盖；音色代号不是凭据。account 步骤旧服的 stderr 只保留白名单字段（与 2026-10-24 语音账号导出相同），
 * 其余诊断一律抑制，避免误打印秘密。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash, X509Certificate } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 公共百炼供应商（与新站上游 2fed2a60 同一账号）。 */
export const PUBLIC_PROVIDER_PREFIX = '8eed4824';
export const OMNI_MODEL = 'qwen3.5-omni-plus-realtime';
/** V3：北京 workspace（总经理 10-28 拍板要迁）。端点用完整 ID，供应商用前缀。 */
export const BEIJING_PROVIDER_PREFIX = 'cb9de005';
export const BEIJING_ENDPOINT_ID = 'eb3630dd-bfbd-49ea-a460-b542a98eb354';
export const BEIJING_MODEL = 'qwen-audio-3.0-realtime-plus';
export const BEIJING_WORKSPACE_HOST = 'ws-qsp3p9ofolmfyu6g.cn-beijing.maas.aliyuncs.com';
/** 「156语音」私有 workspace 的供应商 / 端点 ID 前缀，以及最早约定不迁的 156 前缀：一律拒绝。 */
export const FORBIDDEN_PREFIXES = ['8d1b5e3b', '6b29cca6', '156'];
/** 可迁的端点：每条都限定供应商与型号，以及新站的目标模型键。 */
export const ALLOWED_SOURCES = [
  {
    name: 'public-omni',
    providerPrefix: PUBLIC_PROVIDER_PREFIX,
    model: OMNI_MODEL,
    targetModelKey: `qwen/${OMNI_MODEL}`,
    account: 'existing',
  },
  {
    name: 'beijing-workspace',
    endpointId: BEIJING_ENDPOINT_ID,
    providerPrefix: BEIJING_PROVIDER_PREFIX,
    model: BEIJING_MODEL,
    targetModelKey: `qwen/${BEIJING_MODEL}`,
    account: 'import',
  },
];
const DEFAULT_HOST = 'ubuntu@152.136.111.51';
const OLD_DB = '/opt/weiban-server/weiban.db';
/** 端点 ID 只允许这些字符（会写进只读 SQL，不能有引号）。 */
const ENDPOINT_ID = /^[A-Za-z0-9_.:-]{8,128}$/;
const RECEIPT_KEYS = [
  'ok',
  'code',
  'dryRun',
  'databaseReadOnly',
  'accounts',
  'endpoints',
  'envCredentials',
  'ciphertextBytes',
  'ciphertextSha256',
];

export function forbidden(id) {
  const value = String(id ?? '')
    .trim()
    .toLowerCase();
  return FORBIDDEN_PREFIXES.some((prefix) => value.startsWith(prefix));
}

/** 北京 workspace 只认完整端点 ID；其余可迁来源（公共 Omni）按供应商前缀 + 型号识别。 */
function sourceFor(row) {
  const id = String(row?.id ?? row?.endpoint_id ?? '')
    .trim()
    .toLowerCase();
  const provider = String(row?.provider_id ?? '')
    .trim()
    .toLowerCase();
  return (
    ALLOWED_SOURCES.find(
      (s) =>
        provider.startsWith(s.providerPrefix) &&
        row?.model === s.model &&
        (s.endpointId === undefined || id === s.endpointId),
    ) ?? null
  );
}

export function parseArgs(argv) {
  const [step, ...rest] = argv;
  if (!['discover', 'bindings', 'account'].includes(step))
    throw new Error('第一个参数必须是 discover / bindings / account');
  const options = { step, run: false, host: DEFAULT_HOST };
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === '--run') {
      options.run = true;
      continue;
    }
    const name = {
      '--ssh-key': 'sshKey',
      '--out-dir': 'outDir',
      '--host': 'host',
      '--endpoint-id': 'endpointId',
      '--receiver-cert': 'receiverCert',
      '--receiver-sha256': 'receiverSha256',
    }[arg];
    if (!name || rest[i + 1] === undefined || rest[i + 1].startsWith('--'))
      throw new Error(`无法识别的参数：${arg}`);
    options[name] = rest[++i];
  }
  if (!options.sshKey || !options.outDir) throw new Error('需要 --ssh-key 与 --out-dir');
  if (!/^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$/.test(options.host)) throw new Error('--host 格式不对');
  if (step === 'bindings' || step === 'account') {
    const id = String(options.endpointId ?? '')
      .trim()
      .toLowerCase();
    if (!ENDPOINT_ID.test(id))
      throw new Error('需要 --endpoint-id（discover 输出里的完整端点 ID）');
    if (forbidden(id))
      throw new Error('「156语音」私有 workspace（8d1b5e3b / 6b29cca6 / 156）不迁移');
    options.endpointId = id;
  }
  if (step === 'account') {
    if (options.endpointId !== BEIJING_ENDPOINT_ID)
      throw new Error(`只迁北京 workspace 账号：--endpoint-id 必须是 ${BEIJING_ENDPOINT_ID}`);
    if (!options.receiverCert || !/^[0-9a-f]{64}$/.test(options.receiverSha256 ?? ''))
      throw new Error('需要 --receiver-cert 与 64 位小写十六进制 --receiver-sha256');
  }
  return options;
}

/** 只读：全部实时端点及其供应商（不读 api_key）。经 stdin 交给 sqlite3，不拼进远端 shell 命令。 */
export function discoverSql() {
  return `SELECT e.id, e.scene, e.model, e.enabled, e.provider_id,
  CASE WHEN e.provider_id<>'' THEN p.name ELSE '' END AS provider_name,
  CASE WHEN e.provider_id<>'' THEN p.vendor ELSE e.vendor END AS vendor,
  CASE WHEN e.provider_id<>'' THEN p.base_url ELSE e.base_url END AS base_url,
  (SELECT count(*) FROM character_voice_bindings b WHERE b.endpoint_id = e.id) AS bindings
  FROM ai_endpoints e LEFT JOIN ai_providers p ON p.id = e.provider_id
  WHERE e.model LIKE '%realtime%' ORDER BY e.model, e.id;`;
}

/**
 * 只读：指定端点下、该端点型号的绑定。型号与供应商前缀来自 --endpoint-id 对应的可迁来源（常量），查询本身要求
 * 端点型号相同且属于该供应商。北京 workspace 只认完整端点 ID；其余端点 ID 默认按公共 Omni 查。
 */
export function bindingsSql(endpointId) {
  if (!ENDPOINT_ID.test(endpointId) || forbidden(endpointId)) throw new Error('端点 ID 不合法');
  const source =
    endpointId === BEIJING_ENDPOINT_ID
      ? ALLOWED_SOURCES.find((s) => s.name === 'beijing-workspace')
      : ALLOWED_SOURCES.find((s) => s.name === 'public-omni');
  return `SELECT b.character_id, b.endpoint_id, e.provider_id, b.model, b.voice_id, b.status
  FROM character_voice_bindings b JOIN ai_endpoints e ON e.id = b.endpoint_id
  WHERE b.endpoint_id = '${endpointId}' AND b.model = '${source.model}' AND e.model = '${source.model}'
  AND e.provider_id LIKE '${source.providerPrefix}%' ORDER BY b.character_id;`;
}

/** discover 的每个端点能不能迁：公共供应商下的 Omni 3.5 Plus，或北京 workspace 的那一个端点。 */
export function classifyEndpoint(row) {
  const provider = String(row.provider_id ?? '').toLowerCase();
  if (forbidden(row.id) || forbidden(provider))
    return { allowed: false, reason: '「156语音」私有 workspace，不迁' };
  const source = sourceFor(row);
  if (!source) {
    if (provider.startsWith(BEIJING_PROVIDER_PREFIX))
      return {
        allowed: false,
        reason: `北京 workspace 只迁端点 ${BEIJING_ENDPOINT_ID}（型号 ${BEIJING_MODEL}）`,
      };
    if (!provider.startsWith(PUBLIC_PROVIDER_PREFIX))
      return { allowed: false, reason: '不是可迁的供应商' };
    return { allowed: false, reason: `型号不是 ${OMNI_MODEL}` };
  }
  return {
    allowed: true,
    reason: null,
    targetModelKey: source.targetModelKey,
    // import = 账号要经加密通道迁入（scope.json 已写好）；existing = 新站已有同一账号
    account: source.account,
  };
}

/** 新服 import-legacy-upstreams --prepare 的 scope.json 条目（与导出器的账号来源 ID 规则一致）。 */
export function scopeEntry(row) {
  return {
    sourceId: row.provider_id ? `provider:${row.provider_id}` : `endpoint:${row.id}`,
    vendor: row.vendor,
    baseUrl: safeBaseUrl(row.base_url),
  };
}

/** 逐行核对 bindings 查询结果；有一行不属于指定端点 / 对应供应商 / 端点型号就整体拒绝。 */
export function checkBindingRows(rows, endpointId) {
  if (!Array.isArray(rows)) return { ok: false, code: 'BINDINGS_INVALID' };
  for (const row of rows) {
    const provider = String(row?.provider_id ?? '').toLowerCase();
    const source = sourceFor(row);
    if (
      row?.endpoint_id !== endpointId ||
      forbidden(row?.endpoint_id) ||
      forbidden(provider) ||
      !source ||
      // 公共 Omni 来源不认北京 workspace 的端点（反之由 sourceFor 的完整端点 ID 保证）
      (source.endpointId === undefined && endpointId === BEIJING_ENDPOINT_ID)
    )
      return { ok: false, code: 'BINDINGS_SCOPE_VIOLATION' };
  }
  return { ok: true, rows };
}

/** 基址只保留协议、主机与路径（去掉账号、查询串），防止误打印嵌在 URL 里的东西。 */
export function safeBaseUrl(value) {
  try {
    const url = new URL(String(value));
    return `${url.protocol}//${url.host}${url.pathname}`;
  } catch {
    return null;
  }
}

function ssh(options, remoteCommand, input, stdout = 'pipe') {
  return spawnSync(
    'ssh',
    [
      '-o',
      'BatchMode=yes',
      '-o',
      'StrictHostKeyChecking=yes',
      '-o',
      'ConnectTimeout=15',
      '-i',
      options.sshKey,
      options.host,
      remoteCommand,
    ],
    {
      input,
      stdio: ['pipe', stdout, 'pipe'],
      timeout: 120_000,
      maxBuffer: 32 * 1024 * 1024,
      windowsHide: true,
    },
  );
}

function newFile(dir, name) {
  if (!fs.statSync(dir, { throwIfNoEntry: false })?.isDirectory())
    throw new Error('--out-dir 不存在');
  return path.join(dir, name);
}

const SQLITE = `sudo -n sqlite3 -readonly -json ${OLD_DB}`;

function discover(options) {
  if (!options.run) return { plan: `ssh ${options.host} '${SQLITE}' <<< "${discoverSql()}"` };
  const result = ssh(options, SQLITE, discoverSql());
  if (result.status !== 0) return { ok: false, code: 'DISCOVER_FAILED' };
  const raw = JSON.parse(result.stdout.toString('utf8') || '[]');
  const rows = raw.map((row) => ({
    id: row.id,
    scene: row.scene,
    model: row.model,
    enabled: row.enabled,
    providerId: row.provider_id || null,
    providerName: row.provider_name || null,
    vendor: row.vendor,
    baseUrl: safeBaseUrl(row.base_url),
    bindings: row.bindings,
    ...classifyEndpoint(row),
    scopeEntry: scopeEntry(row),
  }));
  const file = newFile(options.outDir, 'realtime-endpoints.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), { flag: 'wx' });
  // 只有要迁账号的（北京 workspace）进 scope.json；同一供应商只写一次。
  const scope = [];
  for (const row of rows)
    if (
      row.allowed &&
      row.account === 'import' &&
      !scope.some((s) => s.sourceId === row.scopeEntry.sourceId)
    )
      scope.push(row.scopeEntry);
  const scopeFile = scope.length ? newFile(options.outDir, 'scope.json') : null;
  if (scopeFile) fs.writeFileSync(scopeFile, JSON.stringify(scope, null, 2), { flag: 'wx' });
  return { ok: true, endpoints: rows, file, scopeFile, scope };
}

function bindings(options) {
  const sql = bindingsSql(options.endpointId);
  if (!options.run) return { plan: `ssh ${options.host} '${SQLITE}' <<< "${sql}"` };
  const result = ssh(options, SQLITE, sql);
  if (result.status !== 0) return { ok: false, code: 'BINDINGS_FAILED' };
  const checked = checkBindingRows(
    JSON.parse(result.stdout.toString('utf8') || '[]'),
    options.endpointId,
  );
  if (!checked.ok) return checked;
  const source = sourceFor(checked.rows[0] ?? {});
  const file = newFile(options.outDir, 'realtime-bindings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 3,
      endpointId: options.endpointId,
      providerPrefix: source?.providerPrefix ?? null,
      model: source?.model ?? null,
      targetModelKey: source?.targetModelKey ?? null,
      bindings: checked.rows,
    }),
    { flag: 'wx' },
  );
  const byStatus = {};
  for (const row of checked.rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return {
    ok: true,
    rows: checked.rows.length,
    byStatus,
    targetModelKey: source?.targetModelKey ?? null,
    file,
  };
}

/** 加密导出的计划（不连旧服）：核对公开证书与指纹、导出器指纹。 */
export function accountPlan(options, certificate, source) {
  if (certificate.includes(Buffer.from('PRIVATE KEY'))) throw new Error('只能给公开证书');
  // 与新服 receiver.json 和旧服导出器一致：指纹取证书 DER 的 sha256，不是 PEM 文本。
  let der;
  try {
    der = new X509Certificate(certificate).raw;
  } catch {
    throw new Error('证书无法解析');
  }
  const fingerprint = createHash('sha256').update(der).digest('hex');
  if (fingerprint !== options.receiverSha256)
    throw new Error('证书指纹与 --receiver-sha256 不一致');
  return {
    endpointId: options.endpointId,
    recipientSha256: fingerprint,
    exporterSha256: createHash('sha256').update(source).digest('hex'),
    output: path.join(options.outDir, 'realtime-account.cms'),
  };
}

function account(options) {
  const certificate = fs.readFileSync(options.receiverCert);
  const exporter =
    options.exporter ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-legacy-upstreams.mjs');
  const source = fs.readFileSync(exporter);
  const plan = accountPlan(options, certificate, source);
  if (!options.run) return { plan };
  const fingerprint = plan.recipientSha256;
  // 与 2026-10-24 语音账号导出相同：证书放进旧服内存文件（memfd），导出器经 stdin 运行，旧服不落文件。
  const python = `import os,base64,subprocess,sys
fd=os.memfd_create('weiban-public-recipient',0)
try:
 os.write(fd,base64.b64decode('${certificate.toString('base64')}'))
 cert='/proc/'+str(os.getpid())+'/fd/'+str(fd)
 args=['node','--input-type=module','-','--db','${OLD_DB}','--sqlite-module','/opt/weiban-server/node_modules/better-sqlite3','--endpoint-ids','${options.endpointId}','--legacy-env-file','/opt/weiban-server/.env','--recipient-cert',cert,'--recipient-sha256','${fingerprint}','--output','-']
 r=subprocess.run(args,input=base64.b64decode('${source.toString('base64')}'),stdout=sys.stdout.buffer,stderr=sys.stderr.buffer,pass_fds=(fd,),cwd='/opt/weiban-server',check=False)
 sys.exit(r.returncode)
finally:
 os.close(fd)
`;
  const packet = newFile(options.outDir, 'realtime-account.cms');
  const fd = fs.openSync(packet, 'wx');
  let result;
  try {
    result = ssh(options, "sudo -n sh -c 'ulimit -c 0; exec python3 -'", python, fd);
  } finally {
    fs.closeSync(fd);
  }
  const diagnostics = [];
  for (const line of (result.stderr?.toString('utf8') ?? '').split(/\r?\n/).filter(Boolean)) {
    try {
      const value = JSON.parse(line);
      if (Object.keys(value).some((key) => !RECEIPT_KEYS.includes(key))) throw new Error();
      diagnostics.push(value);
    } catch {
      diagnostics.push({ ok: false, code: 'EXPORT_DIAGNOSTIC_SUPPRESSED' });
    }
  }
  const bytes = fs.readFileSync(packet);
  const receipt = {
    ok: result.status === 0,
    exitCode: result.status,
    endpointId: options.endpointId,
    encryptedPacketBytes: bytes.length,
    ciphertextSha256: createHash('sha256').update(bytes).digest('hex'),
    recipientSha256: fingerprint,
    privateKeyDownloaded: false,
    plaintextExported: false,
    oldServerFilesWritten: false,
    result: diagnostics,
  };
  fs.writeFileSync(
    newFile(options.outDir, 'export-receipt.json'),
    JSON.stringify(receipt, null, 2),
    { flag: 'wx' },
  );
  return receipt;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const output =
      options.step === 'discover'
        ? discover(options)
        : options.step === 'bindings'
          ? bindings(options)
          : account(options);
    console.log(JSON.stringify({ step: options.step, dryRun: !options.run, ...output }, null, 2));
    if (output.ok === false) process.exitCode = 1;
  } catch (error) {
    console.error(
      JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'unknown' }),
    );
    process.exitCode = 1;
  }
}
