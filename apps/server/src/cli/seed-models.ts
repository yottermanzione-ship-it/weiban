/** 种子导入走管理接口，不跨模块读写数据库；预览不需要账户或真实密钥。 */
import { readFile } from 'node:fs/promises';
import {
  BillingAdminEndpoints,
  ModelAccessAdminEndpoints,
  AdminCatalogEntry,
  AdminPriceVersion,
} from '@weiban/contracts';
import type { z } from 'zod';
import { INITIAL_MODELS, initialPriceItems } from '../modules/model-access/index.js';
const label = 'model-catalog-v0.3';
async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const draft = {
    versionLabel: label,
    note: 'model-catalog v0.3：售价=成本；未核实；DeepSeek先取高峰上界，确认分时后另发新版。',
    items: initialPriceItems(),
  };
  if (!args.includes('--apply')) {
    process.stdout.write(JSON.stringify({ prices: draft, models: INITIAL_MODELS }, null, 2) + '\n');
    return;
  }
  const base = process.env['MODEL_SEED_API_URL'];
  const tokenFile = process.env['MODEL_SEED_ADMIN_TOKEN_FILE'];
  const idsFile = process.env['MODEL_SEED_UPSTREAM_IDS_FILE'];
  if (!base || !tokenFile || !idsFile)
    throw new Error(
      '需要 MODEL_SEED_API_URL、MODEL_SEED_ADMIN_TOKEN_FILE、MODEL_SEED_UPSTREAM_IDS_FILE',
    );
  const target = new URL(base);
  if (
    target.protocol !== 'https:' &&
    !['127.0.0.1', 'localhost', '[::1]'].includes(target.hostname)
  )
    throw new Error('远端管理接口必须使用 HTTPS');
  const token = (await readFile(tokenFile, 'utf8')).trim();
  const ids = JSON.parse(await readFile(idsFile, 'utf8')) as Record<string, string>;
  // 在任何写入前验证全部映射；未评测目录不设默认、不启用。
  const catalog = INITIAL_MODELS.map((m, index) =>
    AdminCatalogEntry.parse({
      modelKey: m.modelKey,
      displayName: m.name,
      vendorName: m.vendor,
      upstreamId: ids[m.provider],
      upstreamModelId: m.upstreamModelId,
      capabilities: [...m.capabilities],
      tags: [],
      leaderboardRank: null,
      sortOrder: index,
      defaultFor: [],
      enabled: false,
    }),
  );
  async function request(method: string, path: string, body?: unknown): Promise<unknown> {
    const res = await fetch(new URL(path, target), {
      method,
      redirect: 'error',
      headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(20000),
    });
    if (!res.ok) throw new Error(`种子导入接口失败：HTTP ${res.status}`);
    return res.json();
  }
  const B = BillingAdminEndpoints;
  const M = ModelAccessAdminEndpoints;
  const versions = B.listPriceVersions.response.parse(
    await request('GET', B.listPriceVersions.path),
  );
  let version: z.infer<typeof AdminPriceVersion> | undefined = versions.items.find(
    (v) => v.versionLabel === label,
  );
  if (!version)
    version = B.createPriceVersion.response.parse(
      await request('POST', B.createPriceVersion.path, draft),
    );
  if (args.includes('--activate') && version.status === 'draft') {
    version = B.activatePriceVersion.response.parse(
      await request(
        'POST',
        B.activatePriceVersion.path.replace(':priceVersionId', version.priceVersionId),
        { effectiveFrom: null },
      ),
    );
  }
  const existing = M.listCatalog.response.parse(await request('GET', M.listCatalog.path));
  for (const entry of catalog) {
    if (existing.items.some((m) => m.modelKey === entry.modelKey)) continue;
    await request(
      'PUT',
      M.upsertCatalogEntry.path.replace(':modelKey', encodeURIComponent(entry.modelKey)),
      entry,
    );
  }
  process.stdout.write(
    `种子导入完成：价目表 ${version.priceVersionId}（${version.status}）；目录保持停用，完成连通与评测后启用。\n`,
  );
}
main().catch(() => {
  process.stderr.write('种子导入失败；请检查参数、管理员会话及接口可用性。未输出认证信息。\n');
  process.exitCode = 1;
});
