import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { beforeAll, expect, it } from 'vitest';
import { resetTestDatabase, withClient } from './support/db-admin.js';
import { describeDb } from './support/db.js';

const script = readFileSync(
  new URL(
    '../../../docs/quality/reproductions/2026-11-07-update-usage/realtime-official-prices.sql',
    import.meta.url,
  ),
  'utf8',
);
describeDb('实时通话官方价发布：版本化、成本保留与幂等', () => {
  beforeAll(resetTestDatabase, 120_000);
  it('预览不修改；只修正指定17项；重复发布和过期配置均不误改', async () => {
    await withClient(async (db) => {
      const upstream = randomUUID(),
        price = randomUUID();
      await db.query(
        // eslint-disable-next-line weiban/exclusive-sdk -- 只写本机隔离库的地域匹配夹具，不发送任何供应商请求。
        `INSERT INTO model_access.upstreams(id,name,kind,base_url,secret_ciphertext,display_prefix,display_suffix,status,status_changed_at,created_at,updated_at)
        VALUES($1,'synthetic','dashscope','https://dashscope.aliyuncs.com/api/v1','\\x00','','','active',now(),now(),now())`,
        [upstream],
      );
      await db.query(
        `INSERT INTO billing.price_versions(id,version_label,status,created_at) VALUES($1,'synthetic-before','active',now())`,
        [price],
      );
      const models: Array<[string, number[]]> = [
        ['qwen3.8-omni-flash-realtime', [1.5, 1.5, 4.5, 6, 12, 0.01]],
        ['qwen3.5-omni-plus-realtime', [10, 10, 60, 80, 300, 0.01]],
        ['qwen-audio-3.1-realtime-plus', [5, 5, 40, 40, 150]],
      ];
      const units = [
        'input_tokens_per_million',
        'cached_input_tokens_per_million',
        'output_tokens_per_million',
        'audio_input_tokens_per_million',
        'audio_output_tokens_per_million',
        'voice_clone',
      ];
      for (const [model, rates] of models) {
        await db.query(
          `INSERT INTO model_access.model_catalog(model_key,display_name,vendor_name,upstream_id,upstream_model_id,capabilities,tags,sort_order,default_for,enabled,created_at,updated_at)
          VALUES($1,$1,'synthetic',$2,$1,'{}','{}',0,'{}',true,now(),now())`,
          [model, upstream],
        );
        for (const [i, rate] of rates.entries())
          await db.query(
            `INSERT INTO billing.price_items(id,price_version_id,model_key,unit,price_micros,cost_micros,sort_order) VALUES($1,$2,$3,$4,$5,123,0)`,
            [randomUUID(), price, model, units[i], Math.round(rate * 1_300_000)],
          );
      }
      await db.query(
        `INSERT INTO billing.price_items(id,price_version_id,model_key,unit,price_micros,cost_micros,sort_order) VALUES($1,$2,'unrelated','input_tokens_per_million',999,321,0)`,
        [randomUUID(), price],
      );
      const run = async (apply: boolean) => {
        try {
          const r = await db.query(script.replace(":'apply'", apply ? "'true'" : "'false'"));
          return (Array.isArray(r) ? r : [r]).flatMap((x) => x.rows).find((x) => x.result)?.result;
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      };
      expect(await run(false)).toMatchObject({ applied: false, changedItems: 17, items: 18 });
      expect((await db.query('SELECT count(*)::int n FROM billing.price_versions')).rows[0].n).toBe(
        1,
      );
      await db.query(
        "UPDATE billing.price_items SET price_micros=1 WHERE model_key='qwen3.8-omni-flash-realtime' AND unit='voice_clone'",
      );
      await expect(run(true)).rejects.toThrow('REALTIME_PRICES_CHANGED_REVIEW_REQUIRED');
      await db.query(
        "UPDATE billing.price_items SET price_micros=13000 WHERE model_key='qwen3.8-omni-flash-realtime' AND unit='voice_clone'",
      );
      expect(await run(true)).toMatchObject({ applied: true, changedItems: 17, items: 18 });
      expect(await run(true)).toMatchObject({ applied: false, changedItems: 0 });
      const active = (
        await db.query(
          `SELECT p.* FROM billing.price_items p JOIN billing.price_versions v ON v.id=p.price_version_id WHERE v.status='active'`,
        )
      ).rows;
      expect(
        active
          .filter((x) => x.model_key !== 'unrelated')
          .every((x) => Number(x.cost_micros) === 123),
      ).toBe(true);
      expect(active.find((x) => x.model_key === 'unrelated')).toMatchObject({
        price_micros: '999',
        cost_micros: '321',
      });
      expect((await db.query('SELECT count(*)::int n FROM billing.ledger_entries')).rows[0].n).toBe(
        0,
      );
    });
  });
  it('英文更名先预览、旧值变化拒绝、只改名称和更新时间、重复执行不改动', async () => {
    const rename = readFileSync(
      new URL(
        '../../../docs/quality/reproductions/2026-11-07-update-usage/english-model-names.sql',
        import.meta.url,
      ),
      'utf8',
    );
    const values = rename.match(/INSERT INTO english_names VALUES\s*([\s\S]*?);/)![1]!;
    await withClient(async (db) => {
      const upstream = (await db.query('SELECT id FROM model_access.upstreams LIMIT 1')).rows[0].id;
      await db.query(
        `WITH n(key,old_name,old_vendor,new_name,new_vendor) AS (VALUES ${values})
        INSERT INTO model_access.model_catalog(model_key,display_name,vendor_name,upstream_id,upstream_model_id,capabilities,tags,sort_order,default_for,enabled,created_at,updated_at)
        SELECT key,old_name,old_vendor,$1,key,'{}','{}',0,'{}',false,now(),now() FROM n`,
        [upstream],
      );
      const preserved = async () =>
        (
          await db.query(
            "SELECT jsonb_agg(to_jsonb(m)-'display_name'-'vendor_name'-'updated_at' ORDER BY model_key) value FROM model_access.model_catalog m",
          )
        ).rows[0].value;
      const before = await preserved();
      const run = async (apply: boolean) => {
        try {
          const r = await db.query(rename.replace(":'apply'", apply ? "'true'" : "'false'"));
          return (Array.isArray(r) ? r : [r]).flatMap((x) => x.rows).find((x) => x.result)?.result;
        } catch (error) {
          await db.query('ROLLBACK');
          throw error;
        }
      };
      expect(await run(false)).toMatchObject({ applied: false, changedItems: 10 });
      await db.query(
        "UPDATE model_access.model_catalog SET display_name='Manual Change' WHERE model_key='deepseek/deepseek-search'",
      );
      await expect(run(true)).rejects.toThrow('MODEL_NAMES_CHANGED_REVIEW_REQUIRED');
      await db.query(
        "UPDATE model_access.model_catalog SET display_name='联网搜索' WHERE model_key='deepseek/deepseek-search'",
      );
      expect(await run(true)).toMatchObject({ applied: true, changedItems: 10 });
      expect(await run(true)).toMatchObject({ applied: false, changedItems: 0 });
      expect(await preserved()).toEqual(before);
      expect(
        (
          await db.query(
            "SELECT count(*)::int n FROM model_access.model_catalog WHERE display_name ~ '[一-鿿]' OR vendor_name ~ '[一-鿿]' ",
          )
        ).rows[0].n,
      ).toBe(0);
    });
  });
});
