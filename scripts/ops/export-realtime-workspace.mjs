#!/usr/bin/env node
/**
 * 批 V：从旧服务器只读导出「私有 workspace 8d1b5e3b」实时语音账号与它下面的实时复刻音色绑定。
 * 由总负责人在本机执行（需要旧服 SSH 私钥）；脚本本身不含任何凭据。默认只打印将执行的步骤，加 --run 才连接旧服。
 *
 * 三步（都只读旧库；旧服不落任何文件）：
 *   1. discover：列出 8d1b5e3b 开头的旧端点（id / 场景 / 厂商 / 型号 / 启用 / 基址；不读 api_key）。
 *   2. bindings：导出该账号下实时型号的 character_voice_bindings（角色 / 端点 / 型号 / 音色代号 / 状态；音色代号不是凭据）。
 *   3. account：沿用 ADR-20261023 通道，用新服 prepare 产生的接收方公开证书在旧服内存里加密导出账号，本机只拿到密文。
 *
 *   node scripts/ops/export-realtime-workspace.mjs discover --ssh-key <私钥路径> --out-dir <本机空目录> [--run]
 *   node scripts/ops/export-realtime-workspace.mjs bindings --ssh-key <私钥路径> --out-dir <本机空目录> [--run]
 *   node scripts/ops/export-realtime-workspace.mjs account --ssh-key <私钥路径> --out-dir <本机空目录> \
 *     --endpoint-id <discover 得到的完整 ID> --receiver-cert <receiver.crt> --receiver-sha256 <64 位十六进制> [--run]
 *
 * 安全边界：只接受 8d1b5e3b 开头的端点；156 开头的私有 workspace 一律拒绝。输出文件只新建不覆盖；
 * 旧服的 stderr 只保留白名单字段（与 2026-10-24 语音账号导出相同），其余诊断一律抑制，避免误打印秘密。
 */
import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

export const ALLOWED_PREFIX = '8d1b5e3b';
export const FORBIDDEN_PREFIX = '156';
const DEFAULT_HOST = 'ubuntu@152.136.111.51';
const OLD_DB = '/opt/weiban-server/weiban.db';
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
      '--exporter': 'exporter',
    }[arg];
    if (!name || rest[i + 1] === undefined || rest[i + 1].startsWith('--'))
      throw new Error(`无法识别的参数：${arg}`);
    options[name] = rest[++i];
  }
  if (!options.sshKey || !options.outDir) throw new Error('需要 --ssh-key 与 --out-dir');
  if (!/^[A-Za-z0-9_.-]+@[A-Za-z0-9.-]+$/.test(options.host)) throw new Error('--host 格式不对');
  if (step === 'account') {
    const id = String(options.endpointId ?? '').toLowerCase();
    if (!/^[A-Za-z0-9_.:-]{8,128}$/.test(id)) throw new Error('需要 --endpoint-id（完整端点 ID）');
    if (id.startsWith(FORBIDDEN_PREFIX)) throw new Error('156 开头的私有 workspace 不迁移');
    if (!id.startsWith(ALLOWED_PREFIX)) throw new Error(`只迁 ${ALLOWED_PREFIX} 开头的端点`);
    if (!options.receiverCert || !/^[0-9a-f]{64}$/.test(options.receiverSha256 ?? ''))
      throw new Error('需要 --receiver-cert 与 64 位小写十六进制 --receiver-sha256');
  }
  return options;
}

/** 只读查询（经 stdin 交给 sqlite3，不拼进远端 shell 命令）。前缀是常量，不接受外部输入。 */
export function discoverSql() {
  return `SELECT e.id, e.scene, CASE WHEN e.provider_id<>'' THEN p.vendor ELSE e.vendor END AS vendor,
  e.model, e.enabled, e.provider_id,
  CASE WHEN e.provider_id<>'' THEN p.base_url ELSE e.base_url END AS base_url
  FROM ai_endpoints e LEFT JOIN ai_providers p ON p.id = e.provider_id
  WHERE e.id LIKE '${ALLOWED_PREFIX}%' ORDER BY e.scene, e.id;`;
}

export function bindingsSql() {
  return `SELECT character_id, endpoint_id, model, voice_id, status FROM character_voice_bindings
  WHERE endpoint_id LIKE '${ALLOWED_PREFIX}%' AND model LIKE '%realtime%' ORDER BY character_id, model;`;
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
  const rows = JSON.parse(result.stdout.toString('utf8') || '[]').map((row) => ({
    id: row.id,
    scene: row.scene,
    vendor: row.vendor,
    model: row.model,
    enabled: row.enabled,
    providerId: row.provider_id || null,
    baseUrl: safeBaseUrl(row.base_url),
    // 新服 import-legacy-upstreams --prepare 的 scope.json 条目（与导出器的账号来源 ID 规则一致）。
    scopeEntry: {
      sourceId: row.provider_id ? `provider:${row.provider_id}` : `endpoint:${row.id}`,
      vendor: row.vendor,
      baseUrl: safeBaseUrl(row.base_url),
    },
  }));
  const file = newFile(options.outDir, 'realtime-endpoints.json');
  fs.writeFileSync(file, JSON.stringify(rows, null, 2), { flag: 'wx' });
  return { ok: true, endpoints: rows, file };
}

function bindings(options) {
  if (!options.run) return { plan: `ssh ${options.host} '${SQLITE}' <<< "${bindingsSql()}"` };
  const result = ssh(options, SQLITE, bindingsSql());
  if (result.status !== 0) return { ok: false, code: 'BINDINGS_FAILED' };
  const rows = JSON.parse(result.stdout.toString('utf8') || '[]');
  const file = newFile(options.outDir, 'realtime-bindings.json');
  fs.writeFileSync(file, JSON.stringify({ version: 1, bindings: rows }), { flag: 'wx' });
  const byModel = {};
  for (const row of rows)
    byModel[`${row.model}|${row.status}`] = (byModel[`${row.model}|${row.status}`] ?? 0) + 1;
  return { ok: true, rows: rows.length, byModelAndStatus: byModel, file };
}

function account(options) {
  const certificate = fs.readFileSync(options.receiverCert);
  if (certificate.includes(Buffer.from('PRIVATE KEY'))) throw new Error('只能给公开证书');
  const fingerprint = createHash('sha256').update(certificate).digest('hex');
  if (fingerprint !== options.receiverSha256)
    throw new Error('证书指纹与 --receiver-sha256 不一致');
  const exporter =
    options.exporter ??
    path.join(path.dirname(fileURLToPath(import.meta.url)), 'export-legacy-upstreams.mjs');
  const source = fs.readFileSync(exporter);
  const plan = {
    endpointId: options.endpointId,
    recipientSha256: fingerprint,
    exporterSha256: createHash('sha256').update(source).digest('hex'),
    output: path.join(options.outDir, 'realtime-account.cms'),
  };
  if (!options.run) return { plan };
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
    {
      flag: 'wx',
    },
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
