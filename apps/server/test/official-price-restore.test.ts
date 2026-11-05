import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { resetTestDatabase, withClient } from './support/db-admin.js';
import { describeDb } from './support/db.js';

const script = readFileSync(
  new URL(
    '../../../docs/quality/reproductions/2026-11-05-official-pricing/restore-price-table.sql',
    import.meta.url,
  ),
  'utf8',
);
describeDb('官方售价恢复操作：真实迁移结构、预览、发布和拒绝过期快照', () => {
  beforeAll(resetTestDatabase, 120_000);
  it('恢复普通售价、私密使用 Astra 售价且保留自身成本，重复执行不再发布', async () => {
    await withClient(async (db) => {
      const oldId = randomUUID(),
        badId = randomUUID();
      await db.query(
        `INSERT INTO model_access.model_catalog(model_key,display_name,vendor_name,upstream_id,upstream_model_id,capabilities,tags,sort_order,default_for,enabled,created_at,updated_at,scenarios)
        VALUES('restore/astra','Astra','test',$1,'gpt-6-astra','{}','{}',0,'{}',true,now(),now(),'{chat}'),
        ('restore/private','Private','test',$1,'private-test','{}','{}',1,'{}',true,now(),now(),'{private}')`,
        [randomUUID()],
      );
      await db.query(
        `INSERT INTO model_access.settings(key,value,updated_at) VALUES('model_uses','{"fixed":{"private":"restore/private"}}',now()),('models_dev_settings','{"usdCnyRate":7.2}',now()) ON CONFLICT(key) DO UPDATE SET value=excluded.value`,
      );
      await db.query(
        `INSERT INTO billing.price_versions(id,version_label,status,created_at) VALUES($1,'official-original','retired',now()),($2,'cost-plus-test','active',now())`,
        [oldId, badId],
      );
      const units = [
        'input_tokens_per_million',
        'cached_input_tokens_per_million',
        'output_tokens_per_million',
      ];
      const official = [72_000_000, 7_200_000, 360_000_000];
      for (let i = 0; i < 3; i++)
        for (const model of ['restore/astra', 'restore/private']) {
          const cost = model === 'restore/astra' ? 1000 * (i + 1) : 2000 * (i + 1);
          await db.query(
            `INSERT INTO billing.price_items(id,price_version_id,model_key,unit,price_micros,cost_micros,sort_order) VALUES($1,$2,$3,$4,$5,$6,$7),($8,$9,$3,$4,$10,$6,$7)`,
            [
              randomUUID(),
              oldId,
              model,
              units[i],
              model === 'restore/astra' ? official[i] : 9000,
              cost,
              i,
              randomUUID(),
              badId,
              Math.ceil(cost * 1.3),
            ],
          );
        }
      await db.query(
        `INSERT INTO platform.audit_log(id,occurred_at,module,action,actor_type,target_type,target_id,details) VALUES($1,now(),'billing','price_version.cost_plus_published','system','price_version',$2,$3)`,
        [randomUUID(), badId, JSON.stringify({ replaced: oldId, changedItems: 6 })],
      );
      const snapshot = async () =>
        (await db.query('SELECT * FROM billing.price_items ORDER BY id')).rows;
      // Astra 支持缓存写入但私密供应商不提供该计价项；不虚构私密成本或新增其计价项。
      await db.query(
        `INSERT INTO billing.price_items(id,price_version_id,model_key,unit,price_micros,cost_micros,sort_order) VALUES($1,$2,'restore/astra','cache_write_5m_tokens_per_million',90000000,2000000,4),($3,$4,'restore/astra','cache_write_5m_tokens_per_million',2600000,2000000,4)`,
        [randomUUID(), oldId, randomUUID(), badId],
      );
      await db.query(
        `UPDATE platform.audit_log SET details=jsonb_set(details,'{changedItems}','7') WHERE target_id=$1`,
        [badId],
      );
      const original = await snapshot();
      const run = async (apply: boolean) => {
        try {
          const results = await db.query(script.replace(":'apply'", apply ? "'true'" : "'false'"));
          return (Array.isArray(results) ? results : [results])
            .flatMap((r) => r.rows)
            .find((r) => r.result)?.result;
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      };
      expect(await run(false)).toMatchObject({
        applied: false,
        items: 7,
        changedItems: 7,
        privateChangedItems: 3,
      });
      expect(await snapshot()).toEqual(original);
      // 有人已更改成本时拒绝恢复，不能覆盖期间的新配置；失败必须整笔回滚。
      await db.query(
        'UPDATE billing.price_items SET cost_micros=cost_micros+1 WHERE price_version_id=$1',
        [badId],
      );
      await expect(run(true)).rejects.toThrow('CURRENT_PRICE_NO_LONGER_MATCHES_INCIDENT');
      expect(
        (await db.query('SELECT count(*)::int AS n FROM billing.price_versions')).rows[0].n,
      ).toBe(2);
      await db.query(
        'UPDATE billing.price_items SET cost_micros=cost_micros-1 WHERE price_version_id=$1',
        [badId],
      );
      expect(await run(true)).toMatchObject({
        applied: true,
        items: 7,
        costsPreserved: true,
        historicalLedgerUnchanged: true,
      });
      const active = (
        await db.query(
          `SELECT p.model_key,p.unit,p.price_micros,p.cost_micros FROM billing.price_items p JOIN billing.price_versions v ON v.id=p.price_version_id WHERE v.status='active'`,
        )
      ).rows;
      for (let i = 0; i < 3; i++) {
        expect(
          active.find((r) => r.model_key === 'restore/private' && r.unit === units[i]),
        ).toMatchObject({ price_micros: String(official[i]), cost_micros: String(2000 * (i + 1)) });
      }
      expect((await snapshot()).filter((r) => [oldId, badId].includes(r.price_version_id))).toEqual(
        original,
      );
      expect(await run(true)).toMatchObject({
        applied: false,
        alreadyApplied: true,
        changedItems: 0,
      });
      expect(
        (await db.query('SELECT count(*)::int AS n FROM billing.price_versions')).rows[0].n,
      ).toBe(3);
    });
  });
});
