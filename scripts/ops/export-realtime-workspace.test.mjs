import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  bindingsSql,
  checkBindingRows,
  classifyEndpoint,
  discoverSql,
  OMNI_MODEL,
  parseArgs,
  PUBLIC_PROVIDER_PREFIX,
  safeBaseUrl,
} from './export-realtime-workspace.mjs';

// 只测参数与查询的安全边界；不连接任何服务器。
const base = ['--ssh-key', 'k', '--out-dir', 'd'];
const PUBLIC_ENDPOINT = '0975357a-1111-2222-3333-444444444444';
const PUBLIC_PROVIDER = `${PUBLIC_PROVIDER_PREFIX}-aaaa-bbbb`;

test('默认只打印计划，--run 才执行', () => {
  assert.equal(parseArgs(['discover', ...base]).run, false);
  assert.equal(parseArgs(['discover', ...base, '--run']).run, true);
});

test('不再导出账号；bindings 必须给完整端点 ID，拒绝两个私有 workspace 与 156', () => {
  assert.throws(() => parseArgs(['account', ...base]), /不再导出账号/);
  assert.throws(() => parseArgs(['bindings', ...base]), /endpoint-id/);
  for (const id of ['cb9de005-x-1', '8d1b5e3b-x-1', 'eb3630dd-x-1', '6b29cca6-x-1', '156abcdef-1'])
    assert.throws(() => parseArgs(['bindings', ...base, '--endpoint-id', id]), /私有 workspace/);
  assert.throws(
    () => parseArgs(['bindings', ...base, '--endpoint-id', "0975357a' OR 1=1 --"]),
    /endpoint-id/,
  );
  assert.equal(
    parseArgs(['bindings', ...base, '--endpoint-id', PUBLIC_ENDPOINT]).endpointId,
    PUBLIC_ENDPOINT,
  );
});

test('只读查询不读 api_key；bindings 只查指定端点、公共供应商、Omni 3.5 Plus', () => {
  assert.doesNotMatch(discoverSql(), /api_key/);
  assert.match(discoverSql(), /e\.model LIKE '%realtime%'/);
  const sql = bindingsSql(PUBLIC_ENDPOINT);
  assert.doesNotMatch(sql, /api_key/);
  assert.doesNotMatch(sql, /8d1b5e3b/);
  assert.match(sql, new RegExp(`b\\.endpoint_id = '${PUBLIC_ENDPOINT}'`));
  assert.match(sql, new RegExp(`b\\.model = '${OMNI_MODEL}' AND e\\.model = '${OMNI_MODEL}'`));
  assert.match(sql, new RegExp(`e\\.provider_id LIKE '${PUBLIC_PROVIDER_PREFIX}%'`));
  assert.throws(() => bindingsSql('8d1b5e3b-0000-0000'), /不合法/);
});

test('discover 只把公共供应商下的 Omni 3.5 Plus 端点标为可迁', () => {
  assert.equal(
    classifyEndpoint({ id: PUBLIC_ENDPOINT, provider_id: PUBLIC_PROVIDER, model: OMNI_MODEL })
      .allowed,
    true,
  );
  assert.equal(
    classifyEndpoint({
      id: '6b29cca6-1',
      provider_id: '8d1b5e3b-1',
      model: 'qwen-audio-3.0-realtime-plus',
    }).allowed,
    false,
  );
  assert.equal(
    classifyEndpoint({ id: 'eb3630dd-1', provider_id: 'cb9de005-1', model: OMNI_MODEL }).allowed,
    false,
  );
  assert.equal(
    classifyEndpoint({ id: PUBLIC_ENDPOINT, provider_id: PUBLIC_PROVIDER, model: 'other' }).allowed,
    false,
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
    { ...good, provider_id: 'cb9de005-1' },
    { ...good, model: 'qwen-audio-3.0-realtime-plus' },
  ])
    assert.deepEqual(checkBindingRows([good, bad], PUBLIC_ENDPOINT), {
      ok: false,
      code: 'BINDINGS_SCOPE_VIOLATION',
    });
});

test('基址去掉账号与查询串', () => {
  assert.equal(
    safeBaseUrl('https://u:p@dashscope.aliyuncs.com/api/v1?k=1'),
    'https://dashscope.aliyuncs.com/api/v1',
  );
  assert.equal(safeBaseUrl('not a url'), null);
});
