import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  ALLOWED_PREFIX,
  bindingsSql,
  discoverSql,
  parseArgs,
  safeBaseUrl,
} from './export-realtime-workspace.mjs';

// 只测参数与查询的安全边界；不连接任何服务器。
const base = ['--ssh-key', 'k', '--out-dir', 'd'];
const cert = ['--receiver-cert', 'c.crt', '--receiver-sha256', 'a'.repeat(64)];

test('默认只打印计划，--run 才执行', () => {
  assert.equal(parseArgs(['discover', ...base]).run, false);
  assert.equal(parseArgs(['discover', ...base, '--run']).run, true);
});

test('账号导出只接受 8d1b5e3b 开头的端点，拒绝 156 workspace', () => {
  assert.throws(() => parseArgs(['account', ...base, '--endpoint-id', '156abcdef-1', ...cert]), /156/);
  assert.throws(() => parseArgs(['account', ...base, '--endpoint-id', 'aaaaaaaa-1', ...cert]), /8d1b5e3b/);
  assert.equal(
    parseArgs(['account', ...base, '--endpoint-id', `${ALLOWED_PREFIX}-0000`, ...cert]).endpointId,
    `${ALLOWED_PREFIX}-0000`,
  );
  assert.throws(() => parseArgs(['account', ...base, '--endpoint-id', `${ALLOWED_PREFIX}-0`]), /receiver/);
});

test('只读查询不读 api_key，只查 8d1b5e3b 的实时绑定', () => {
  assert.doesNotMatch(discoverSql(), /api_key/);
  assert.match(discoverSql(), /LIKE '8d1b5e3b%'/);
  assert.match(bindingsSql(), /endpoint_id LIKE '8d1b5e3b%' AND model LIKE '%realtime%'/);
});

test('基址去掉账号与查询串', () => {
  assert.equal(safeBaseUrl('https://u:p@dashscope.aliyuncs.com/api/v1?k=1'), 'https://dashscope.aliyuncs.com/api/v1');
  assert.equal(safeBaseUrl('not a url'), null);
});
