#!/usr/bin/env node
/**
 * V2（2026-10-28）：从旧服务器只读导出「公共百炼账号」下 Omni 3.5 Plus 实时端点的复刻音色绑定。
 * 由总负责人在本机执行（需要旧服 SSH 私钥）；脚本本身不含任何凭据。默认只打印将执行的步骤，加 --run 才连接旧服。
 *
 * 背景（10-28 生产实查）：旧库 402 条实时绑定分属三个账号——私有 workspace 供应商 cb9de005（端点 eb3630dd…，213 条）、
 * 私有 workspace 供应商 8d1b5e3b「156语音」（端点 6b29cca6…，15 条）、公共百炼供应商 8eed4824（端点 0975357a…，
 * qwen3.5-omni-plus-realtime，174 条）。复刻音色只在创建它的账号可用，新站公共百炼上游就是 8eed4824 这个账号，
 * 所以只迁后者；两个私有 workspace 一律拒绝。批 V 里「8d1b5e3b 是端点前缀」的前提是错的（它是供应商 ID），已删除。
 * 也不再导出任何账号：新站已有同一个公共百炼账号，旧版私有 workspace 不迁。
 *
 * 两步（都只读旧库、不读 api_key；旧服不落任何文件）：
 *   1. discover：列出旧库全部实时端点（端点 ID / 型号 / 启用 / 供应商 ID 与名称 / 基址 / 绑定条数），标出可迁的那条（allowed）。
 *   2. bindings：只导出 --endpoint-id 指定的那一个端点下的 Omni 3.5 Plus 绑定；查询本身还要求端点属于公共供应商，
 *      拿回的每一行再逐条核对端点、供应商、型号，有一行不对就不写文件。
 *
 *   node scripts/ops/export-realtime-workspace.mjs discover --ssh-key <私钥路径> --out-dir <本机空目录> [--run]
 *   node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key <私钥路径> --out-dir <本机空目录> \
 *     --endpoint-id <discover 里 allowed = true 的完整端点 ID> [--run]
 *
 * 输出文件只新建不覆盖；音色代号不是凭据。
 */
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

/** 公共百炼供应商（与新站上游 2fed2a60 同一账号）。 */
export const PUBLIC_PROVIDER_PREFIX = '8eed4824';
export const OMNI_MODEL = 'qwen3.5-omni-plus-realtime';
/** 私有 workspace 的供应商 / 端点 ID 前缀，以及最早约定不迁的 156 前缀。 */
export const FORBIDDEN_PREFIXES = ['cb9de005', '8d1b5e3b', 'eb3630dd', '6b29cca6', '156'];
const DEFAULT_HOST = 'ubuntu@152.136.111.51';
const OLD_DB = '/opt/weiban-server/weiban.db';
/** 端点 ID 只允许这些字符（会写进只读 SQL，不能有引号）。 */
const ENDPOINT_ID = /^[A-Za-z0-9_.:-]{8,128}$/;

export function forbidden(id) {
  const value = String(id ?? '')
    .trim()
    .toLowerCase();
  return FORBIDDEN_PREFIXES.some((prefix) => value.startsWith(prefix));
}

export function parseArgs(argv) {
  const [step, ...rest] = argv;
  if (step === 'account')
    throw new Error(
      'V2 起不再导出账号：实时通话全部走新站已有的公共百炼账号，旧版私有 workspace 不迁',
    );
  if (!['discover', 'bindings'].includes(step))
    throw new Error('第一个参数必须是 discover / bindings');
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
    }[arg];
    if (!name || rest[i + 1] === undefined || rest[i + 1].startsWith('--'))
      throw new Error(`无法识别的参数：${arg}`);
    options[name] = rest[++i];
  }
  if (!options.sshKey || !options.outDir) throw new Error('需要 --ssh-key 与 --out-dir');
  if (!/^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$/.test(options.host)) throw new Error('--host 格式不对');
  if (step === 'bindings') {
    const id = String(options.endpointId ?? '').trim();
    if (!ENDPOINT_ID.test(id))
      throw new Error('需要 --endpoint-id（discover 输出里的完整端点 ID）');
    if (forbidden(id)) throw new Error('私有 workspace（cb9de005 / 8d1b5e3b / 156）的端点不迁移');
    options.endpointId = id;
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

/** 只读：指定端点的 Omni 3.5 Plus 绑定，查询本身要求端点型号相同且属于公共供应商。 */
export function bindingsSql(endpointId) {
  if (!ENDPOINT_ID.test(endpointId) || forbidden(endpointId)) throw new Error('端点 ID 不合法');
  return `SELECT b.character_id, b.endpoint_id, e.provider_id, b.model, b.voice_id, b.status
  FROM character_voice_bindings b JOIN ai_endpoints e ON e.id = b.endpoint_id
  WHERE b.endpoint_id = '${endpointId}' AND b.model = '${OMNI_MODEL}' AND e.model = '${OMNI_MODEL}'
  AND e.provider_id LIKE '${PUBLIC_PROVIDER_PREFIX}%' ORDER BY b.character_id;`;
}

/** discover 的每个端点能不能迁：只有公共供应商下的 Omni 3.5 Plus 实时端点可以。 */
export function classifyEndpoint(row) {
  const provider = String(row.provider_id ?? '').toLowerCase();
  if (forbidden(row.id) || forbidden(provider))
    return { allowed: false, reason: '私有 workspace，不迁' };
  if (!provider.startsWith(PUBLIC_PROVIDER_PREFIX))
    return { allowed: false, reason: '不是公共百炼供应商' };
  if (row.model !== OMNI_MODEL) return { allowed: false, reason: `型号不是 ${OMNI_MODEL}` };
  return { allowed: true, reason: null };
}

/** 逐行核对 bindings 查询结果；有一行不属于指定端点 / 公共供应商 / Omni 3.5 Plus 就整体拒绝。 */
export function checkBindingRows(rows, endpointId) {
  if (!Array.isArray(rows)) return { ok: false, code: 'BINDINGS_INVALID' };
  for (const row of rows) {
    const provider = String(row?.provider_id ?? '').toLowerCase();
    if (
      row?.endpoint_id !== endpointId ||
      row?.model !== OMNI_MODEL ||
      forbidden(row?.endpoint_id) ||
      forbidden(provider) ||
      !provider.startsWith(PUBLIC_PROVIDER_PREFIX)
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

function ssh(options, remoteCommand, input) {
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
      stdio: ['pipe', 'pipe', 'pipe'],
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
  const rows = JSON.parse(result.stdout.toString('utf8') || '[]').map((row) => ({
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
  }));
  const file = newFile(options.outDir, 'realtime-endpoints.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), { flag: 'wx' });
  return { ok: true, endpoints: rows, file };
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
  const file = newFile(options.outDir, 'realtime-bindings.json');
  fs.writeFileSync(
    file,
    JSON.stringify({
      version: 2,
      endpointId: options.endpointId,
      providerPrefix: PUBLIC_PROVIDER_PREFIX,
      model: OMNI_MODEL,
      bindings: checked.rows,
    }),
    { flag: 'wx' },
  );
  const byStatus = {};
  for (const row of checked.rows) byStatus[row.status] = (byStatus[row.status] ?? 0) + 1;
  return { ok: true, rows: checked.rows.length, byStatus, file };
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const options = parseArgs(process.argv.slice(2));
    const output = options.step === 'discover' ? discover(options) : bindings(options);
    console.log(JSON.stringify({ step: options.step, dryRun: !options.run, ...output }, null, 2));
    if (output.ok === false) process.exitCode = 1;
  } catch (error) {
    console.error(
      JSON.stringify({ ok: false, message: error instanceof Error ? error.message : 'unknown' }),
    );
    process.exitCode = 1;
  }
}
