import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  accountPlan,
  BEIJING_ENDPOINT_ID,
  BEIJING_MODEL,
  BEIJING_PROVIDER_PREFIX,
  bindingsSql,
  checkBindingRows,
  classifyEndpoint,
  discoverSql,
  OMNI_MODEL,
  parseArgs,
  PUBLIC_PROVIDER_PREFIX,
  safeBaseUrl,
  scopeEntry,
} from './export-realtime-workspace.mjs';

// 只测参数与查询的安全边界；不连接任何服务器。
const base = ['--ssh-key', 'k', '--out-dir', 'd'];
const PUBLIC_ENDPOINT = '0975357a-1111-2222-3333-444444444444';
const PUBLIC_PROVIDER = `${PUBLIC_PROVIDER_PREFIX}-aaaa-bbbb`;
const BEIJING_PROVIDER = `${BEIJING_PROVIDER_PREFIX}-1111-2222`;
const BEIJING_BASE = 'https://ws-qsp3p9ofolmfyu6g.cn-beijing.maas.aliyuncs.com/api';
const SHA = 'a'.repeat(64);

test('默认只打印计划，--run 才执行', () => {
  assert.equal(parseArgs(['discover', ...base]).run, false);
  assert.equal(parseArgs(['discover', ...base, '--run']).run, true);
});

test('bindings 必须给完整端点 ID；「156语音」（8d1b5e3b / 6b29cca6 / 156）一律拒绝，北京 workspace 放行', () => {
  assert.throws(() => parseArgs(['bindings', ...base]), /endpoint-id/);
  for (const id of ['8d1b5e3b-x-1', '6b29cca6-x-1', '156abcdef-1'])
    assert.throws(() => parseArgs(['bindings', ...base, '--endpoint-id', id]), /156语音/);
  assert.throws(
    () => parseArgs(['bindings', ...base, '--endpoint-id', "0975357a' OR 1=1 --"]),
    /endpoint-id/,
  );
  assert.equal(
    parseArgs(['bindings', ...base, '--endpoint-id', PUBLIC_ENDPOINT]).endpointId,
    PUBLIC_ENDPOINT,
  );
  assert.equal(
    parseArgs(['bindings', ...base, '--endpoint-id', BEIJING_ENDPOINT_ID.toUpperCase()]).endpointId,
    BEIJING_ENDPOINT_ID,
  );
});

test('account 只接受北京 workspace 端点，并要求公开证书与指纹', () => {
  const cert = ['--receiver-cert', 'r.crt', '--receiver-sha256', SHA];
  assert.equal(
    parseArgs(['account', ...base, '--endpoint-id', BEIJING_ENDPOINT_ID, ...cert]).endpointId,
    BEIJING_ENDPOINT_ID,
  );
  for (const id of [PUBLIC_ENDPOINT, 'eb3630dd-0000-0000-0000-000000000000'])
    assert.throws(
      () => parseArgs(['account', ...base, '--endpoint-id', id, ...cert]),
      /只迁北京 workspace/,
    );
  assert.throws(
    () => parseArgs(['account', ...base, '--endpoint-id', '6b29cca6-x-1', ...cert]),
    /156语音/,
  );
  assert.throws(
    () => parseArgs(['account', ...base, '--endpoint-id', BEIJING_ENDPOINT_ID]),
    /receiver-cert/,
  );
  const options = { endpointId: BEIJING_ENDPOINT_ID, outDir: 'd' };
  const pem = Buffer.from('-----BEGIN CERTIFICATE-----\nAAAA\n-----END CERTIFICATE-----\n');
  const fingerprint = createHash('sha256').update(pem).digest('hex');
  assert.equal(
    accountPlan({ ...options, receiverSha256: fingerprint }, pem, Buffer.from('x')).recipientSha256,
    fingerprint,
  );
  assert.throws(
    () => accountPlan({ ...options, receiverSha256: SHA }, pem, Buffer.from('x')),
    /指纹/,
  );
  assert.throws(
    () =>
      accountPlan(
        { ...options, receiverSha256: fingerprint },
        Buffer.from('-----BEGIN PRIVATE KEY-----'),
        Buffer.from('x'),
      ),
    /公开证书/,
  );
});

test('只读查询不读 api_key；bindings 只查指定端点、对应供应商与型号', () => {
  assert.doesNotMatch(discoverSql(), /api_key/);
  assert.match(discoverSql(), /e\.model LIKE '%realtime%'/);
  const sql = bindingsSql(PUBLIC_ENDPOINT);
  assert.doesNotMatch(sql, /api_key/);
  assert.match(sql, new RegExp(`b\\.endpoint_id = '${PUBLIC_ENDPOINT}'`));
  assert.match(sql, new RegExp(`b\\.model = '${OMNI_MODEL}' AND e\\.model = '${OMNI_MODEL}'`));
  assert.match(sql, new RegExp(`e\\.provider_id LIKE '${PUBLIC_PROVIDER_PREFIX}%'`));
  const beijing = bindingsSql(BEIJING_ENDPOINT_ID);
  assert.doesNotMatch(beijing, /api_key/);
  assert.match(
    beijing,
    new RegExp(`b\\.model = '${BEIJING_MODEL}' AND e\\.model = '${BEIJING_MODEL}'`),
  );
  assert.match(beijing, new RegExp(`e\\.provider_id LIKE '${BEIJING_PROVIDER_PREFIX}%'`));
  assert.throws(() => bindingsSql('8d1b5e3b-0000-0000'), /不合法/);
  assert.throws(() => bindingsSql('6b29cca6-0000-0000'), /不合法/);
});

test('discover：公共 Omni 与北京 workspace 端点可迁，156语音与北京的其他端点不迁', () => {
  const omni = classifyEndpoint({
    id: PUBLIC_ENDPOINT,
    provider_id: PUBLIC_PROVIDER,
    model: OMNI_MODEL,
  });
  assert.deepEqual(omni, {
    allowed: true,
    reason: null,
    targetModelKey: `qwen/${OMNI_MODEL}`,
    account: 'existing',
  });
  assert.deepEqual(
    classifyEndpoint({
      id: BEIJING_ENDPOINT_ID,
      provider_id: BEIJING_PROVIDER,
      model: BEIJING_MODEL,
    }),
    {
      allowed: true,
      reason: null,
      targetModelKey: 'qwen/qwen-audio-3.0-realtime-plus',
      account: 'import',
    },
  );
  for (const row of [
    { id: '6b29cca6-1', provider_id: '8d1b5e3b-1', model: BEIJING_MODEL },
    { id: 'eb3630dd-0000', provider_id: BEIJING_PROVIDER, model: BEIJING_MODEL },
    { id: BEIJING_ENDPOINT_ID, provider_id: BEIJING_PROVIDER, model: OMNI_MODEL },
    { id: BEIJING_ENDPOINT_ID, provider_id: PUBLIC_PROVIDER, model: BEIJING_MODEL },
    { id: PUBLIC_ENDPOINT, provider_id: PUBLIC_PROVIDER, model: 'other' },
  ])
    assert.equal(classifyEndpoint(row).allowed, false, JSON.stringify(row));
});

test('discover 的 scopeEntry 可直接填 scope.json（来源 ID 规则与导出器一致，基址去掉账号与查询串）', () => {
  assert.deepEqual(
    scopeEntry({
      id: BEIJING_ENDPOINT_ID,
      provider_id: BEIJING_PROVIDER,
      vendor: 'dashscope',
      base_url: BEIJING_BASE,
    }),
    { sourceId: `provider:${BEIJING_PROVIDER}`, vendor: 'dashscope', baseUrl: BEIJING_BASE },
  );
  assert.equal(
    scopeEntry({ id: 'e1', provider_id: '', vendor: 'dashscope', base_url: BEIJING_BASE }).sourceId,
    'endpoint:e1',
  );
});

test('拿回的绑定逐行核对，有一行越界就整体拒绝', () => {
  const good = {
    character_id: 'c',
    endpoint_id: PUBLIC_ENDPOINT,
    provider_id: PUBLIC_PROVIDER,
    model: OMNI_MODEL,
    voice_id: 'v',
    status: 'ready',
  };
  assert.equal(checkBindingRows([good], PUBLIC_ENDPOINT).ok, true);
  for (const bad of [
    { ...good, endpoint_id: 'other-endpoint' },
    { ...good, provider_id: '8d1b5e3b-1' },
    { ...good, provider_id: BEIJING_PROVIDER },
    { ...good, model: BEIJING_MODEL },
  ])
    assert.deepEqual(checkBindingRows([good, bad], PUBLIC_ENDPOINT), {
      ok: false,
      code: 'BINDINGS_SCOPE_VIOLATION',
    });
  const beijing = {
    ...good,
    endpoint_id: BEIJING_ENDPOINT_ID,
    provider_id: BEIJING_PROVIDER,
    model: BEIJING_MODEL,
  };
  assert.equal(checkBindingRows([beijing], BEIJING_ENDPOINT_ID).ok, true);
  for (const bad of [
    { ...beijing, provider_id: PUBLIC_PROVIDER },
    { ...beijing, provider_id: '8d1b5e3b-1' },
    { ...beijing, model: OMNI_MODEL },
    { ...beijing, endpoint_id: '6b29cca6-1' },
  ])
    assert.deepEqual(checkBindingRows([beijing, bad], BEIJING_ENDPOINT_ID), {
      ok: false,
      code: 'BINDINGS_SCOPE_VIOLATION',
    });
});

test('基址去掉账号与查询串', () => {
  assert.equal(
    safeBaseUrl('https://u:p@dashscope.aliyuncs.com/api/v1?k=1'),
    'https://dashscope.aliyuncs.com/api/v1',
  );
  assert.equal(safeBaseUrl(BEIJING_BASE), BEIJING_BASE);
  assert.equal(safeBaseUrl('not a url'), null);
});
