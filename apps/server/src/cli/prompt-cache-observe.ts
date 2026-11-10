/** Bounded read-only diagnostic. Emits fixed categories/counts, never prompt text or IDs. */
import { createHmac, randomBytes } from 'node:crypto';
import assert from 'node:assert/strict';
import { setTimeout as sleep } from 'node:timers/promises';
import { Client } from 'pg';
import { EnvelopeCrypto } from '../platform/crypto/envelope.js';
import { loadKekRing } from '../platform/crypto/kek-ring.js';
import { loadConfig } from '../platform/config/config.js';
import type { Database } from '../platform/db/database.js';
import { SystemClock } from '../platform/clock/clock.js';

type Message = { role: string; content: string; images?: unknown[] };
type Snapshot = {
  messages: Message[];
  scope: string;
  scenarioMode: string;
  personaVersion: number;
  memoryRevision: number;
  habits?: string[];
};
const markers = [
  ['platform', '\n\n【你正在使用的微伴】\n'],
  ['persona', '\n\n【你是谁】\n'],
  ['speech', '\n\n【说话方式】\n'],
  ['examples', '\n\n【说话示例】\n'],
  ['knowledge', '\n\n【公开资料】\n'],
  ['relationship', '\n\n【关系与设置】\n'],
  ['care', '\n\n【需要关怀或岔开话题时】\n'],
  ['scenario', '\n\n【当前情景补充】\n'],
  ['author_supplement', '\n\n【角色作者的写作要求】\n'],
  ['self_reports', '\n\n你曾经的自述（'],
  ['memory', '\n\n【记忆】\n'],
  ['episodes', '\n\n【最近一起经历的】\n'],
] as const;
const secret = randomBytes(32);
const hash = (value: string) => createHmac('sha256', secret).update(value).digest('hex');
function fingerprint(value: Snapshot) {
  const head = value.messages[0]?.role === 'system' ? value.messages[0].content : '';
  const offsets = [
    { category: 'intro', index: 0 },
    ...markers.flatMap(([category, text]) => {
      const index = head.indexOf(text);
      return index >= 0 ? [{ category, index }] : [];
    }),
  ].sort((a, b) => a.index - b.index);
  return {
    sections: offsets.map((entry, i) => ({
      category: entry.category,
      hash: hash(head.slice(entry.index, offsets[i + 1]?.index)),
    })),
    messages: value.messages.map((m) => ({
      role: m.role,
      hash: hash(JSON.stringify(m)),
      media: !!m.images?.length,
    })),
    lastUser: value.messages.findLastIndex((m) => m.role === 'user'),
    scope: value.scope,
    mode: value.scenarioMode,
    persona: value.personaVersion,
    memory: value.memoryRevision,
    habits: hash(JSON.stringify(value.habits ?? [])),
  };
}
type Fingerprint = ReturnType<typeof fingerprint>;
function compare(before: Fingerprint, after: Fingerprint): string {
  if (before.scope !== after.scope || before.mode !== after.mode) return 'scope_or_mode_changed';
  if (before.persona !== after.persona) return 'persona_version_changed';
  if (before.messages[0]?.hash !== after.messages[0]?.hash) {
    for (let i = 0; i < Math.max(before.sections.length, after.sections.length); i++) {
      const a = before.sections[i],
        b = after.sections[i];
      if (a?.category !== b?.category || a?.hash !== b?.hash)
        return `head_${b?.category ?? a?.category ?? 'intro'}`;
    }
    return 'head_structure';
  }
  for (let i = 1; i < Math.min(before.messages.length, after.messages.length); i++) {
    if (before.messages[i]!.hash !== after.messages[i]!.hash) {
      if (i >= before.lastUser) return 'new_turn_or_dynamic_tail';
      if (before.messages[i]!.role === 'system' || after.messages[i]!.role === 'system')
        return 'history_depth_note_moved';
      if (before.messages.slice(i + 1).some((m) => m.hash === after.messages[i]!.hash))
        return 'history_window_advanced';
      if (before.habits !== after.habits) return 'history_habit_filter_changed';
      if (before.messages[i]!.media || after.messages[i]!.media) return 'history_media_changed';
      return 'history_text_changed';
    }
  }
  return 'append_only_or_identical';
}
function selfTest() {
  const base: Snapshot = {
    scope: 'normal',
    scenarioMode: 'daily',
    personaVersion: 1,
    memoryRevision: 1,
    messages: [
      {
        role: 'system',
        content:
          '固定\n\n【你是谁】\n虚构角色\n\n【记忆】\n虚构记忆\n\n【最近一起经历的】\n虚构经历',
      },
      { role: 'user', content: '旧问题' },
      { role: 'assistant', content: '旧回答' },
      { role: 'user', content: '新问题' },
      { role: 'system', content: '动态时间1' },
    ],
  };
  const a = fingerprint(base);
  const change = (from: string, to: string) =>
    fingerprint({
      ...base,
      messages: base.messages.map((m) => ({ ...m, content: m.content.replace(from, to) })),
    });
  assert.equal(compare(a, change('虚构记忆', '新虚构记忆')), 'head_memory');
  assert.equal(compare(a, change('虚构经历', '新虚构经历')), 'head_episodes');
  assert.equal(compare(a, change('旧回答', '改写旧回答')), 'history_text_changed');
  assert.equal(compare(a, change('动态时间1', '动态时间2')), 'new_turn_or_dynamic_tail');
  assert.equal(
    compare(a, fingerprint({ ...base, scenarioMode: 'treehole' })),
    'scope_or_mode_changed',
  );
  assert.equal(compare(a, fingerprint(base)), 'append_only_or_identical');
  assert(!JSON.stringify(a).includes('虚构'));
  assert.equal(summaryFormat({ ok: true, value: { truncated: true } }), 'truncated');
  assert.equal(summaryFormat({ ok: true, value: { text: 'not json' } }), 'invalid_json');
  assert.equal(
    summaryFormat({
      ok: true,
      value: {
        text: JSON.stringify({
          items: [
            { text: '甲'.repeat(700), sourceIds: ['fake-a'] },
            { text: '乙'.repeat(700), sourceIds: ['fake-b'] },
          ],
        }),
      },
    }),
    'summary_too_long',
  );
  console.log(
    JSON.stringify({ syntheticChecksPassed: 10, databaseAccess: false, promptOutput: false }),
  );
}
async function observe() {
  if (process.env.WB_CACHE_OBSERVATION_APPROVED !== '1') throw new Error('approval_required');
  const config = loadConfig();
  const client = new Client({
    connectionString: config.database.url,
    application_name: 'cache-prefix-readonly-observer',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  await client.query("SET default_transaction_read_only=on; SET statement_timeout='3s'");
  const ring = loadKekRing(config);
  const clock = new SystemClock();
  const crypto = new EnvelopeCrypto(
    // open() only uses query(); the connection itself rejects every database write.
    {
      query: (sql: string, values?: unknown[]) => client.query(sql, values),
    } as unknown as Database,
    clock,
    ring,
  );
  const seen = new Set<string>();
  const previous = new Map<string, { value: Fingerprint; seq: number; at: number }>();
  const counts: Record<string, number> = {};
  let samples = 0,
    pairs = 0,
    errors = 0,
    reportedSamples = 0;
  const until = Math.min(
    clock.nowMs() + 15 * 60_000,
    Number(process.env.WB_CACHE_OBSERVE_UNTIL_MS) || Infinity,
  );
  const started = new Date(clock.nowMs() - 60_000).toISOString();
  try {
    while (clock.nowMs() < until && samples < 100) {
      const rows = (
        await client.query<{
          id: string;
          user_id: string;
          conversation_id: string;
          trigger_seq: string;
          created_at: Date;
          input_ciphertext: Buffer;
        }>(
          "SELECT id,user_id,conversation_id,trigger_seq,created_at,input_ciphertext FROM ai_runtime.reply_plans WHERE status IN ('generating','waiting','sending') AND due_at >= $1 AND input_ciphertext IS NOT NULL ORDER BY due_at DESC LIMIT 30",
          [started],
        )
      ).rows;
      for (const row of rows.reverse()) {
        if (seen.has(row.id)) continue;
        seen.add(row.id);
        let bytes: Buffer | undefined;
        try {
          bytes = await crypto.open(row.user_id, `ai:plan:${row.id}:input`, row.input_ciphertext);
          const snapshot = JSON.parse(bytes.toString('utf8')) as Snapshot;
          const value = fingerprint(snapshot);
          const previousValue = previous.get(row.conversation_id);
          const seq = Number(row.trigger_seq),
            at = row.created_at.getTime();
          if (previousValue && seq > previousValue.seq && at - previousValue.at <= 5 * 60_000) {
            const category = compare(previousValue.value, value);
            counts[category] = (counts[category] ?? 0) + 1;
            pairs++;
          }
          if (!previousValue || seq > previousValue.seq)
            previous.set(row.conversation_id, { value, seq, at });
          samples++;
        } catch {
          errors++;
        } finally {
          bytes?.fill(0);
        }
      }
      if (samples >= reportedSamples + 10) {
        reportedSamples = samples;
        console.log(JSON.stringify({ samples, pairs, errors, firstChanges: counts }));
      }
      await sleep(2000);
    }
    console.log(
      JSON.stringify({
        finished: true,
        samples,
        pairs,
        errors,
        firstChanges: counts,
        plaintextSaved: false,
        databaseReadOnly: true,
      }),
    );
  } finally {
    for (const key of ring?.keys.values() ?? []) key.fill(0);
    secret.fill(0);
    previous.clear();
    await client.end();
  }
}
function summaryFormat(result: unknown): string {
  const value = result as { ok?: boolean; value?: { truncated?: boolean; text?: string } };
  if (!value.ok || !value.value) return 'no_successful_result';
  if (value.value.truncated) return 'truncated';
  let raw: unknown;
  try {
    raw = JSON.parse(value.value.text ?? '');
  } catch {
    const fenced = /^\s*```(?:json)?\s*\n([\s\S]*?)\n```\s*$/i.exec(value.value.text ?? '');
    if (fenced) {
      try {
        JSON.parse(fenced[1]!);
        return 'json_fence_only';
      } catch {
        /* fixed category below */
      }
    }
    return 'invalid_json';
  }
  // Frozen diagnostic mirror of the pre-fix 20be39be SummaryAnswer, not production validation.
  const items = raw && typeof raw === 'object' ? (raw as { items?: unknown }).items : undefined;
  if (Array.isArray(raw)) return 'root_array';
  if (!Array.isArray(items)) return 'missing_items_array';
  if (items.length > 24) return 'too_many_items';
  for (const item of items as {
    text?: unknown;
    sourceIds?: unknown;
    source_ids?: unknown;
    sources?: unknown;
  }[]) {
    if (!item || typeof item.text !== 'string' || !item.text.trim()) return 'missing_text';
    if (item.text.trim().length > 1200) return 'item_text_over_limit';
    if (!Array.isArray(item.sourceIds))
      return Array.isArray(item.source_ids)
        ? 'snake_case_sources'
        : Array.isArray(item.sources)
          ? 'sources_alias'
          : 'missing_source_ids';
    if (!item.sourceIds.length) return 'empty_source_ids';
    if (item.sourceIds.length > 100) return 'too_many_source_ids';
    if (item.sourceIds.some((id) => typeof id !== 'string')) return 'nonstring_source_id';
  }
  if (
    !Array.isArray(items) ||
    items.length > 24 ||
    items.some(
      (item: { text?: unknown; sourceIds?: unknown }) =>
        !item ||
        typeof item.text !== 'string' ||
        !item.text.trim() ||
        item.text.trim().length > 1200 ||
        !Array.isArray(item.sourceIds) ||
        item.sourceIds.length < 1 ||
        item.sourceIds.length > 100 ||
        item.sourceIds.some((id) => typeof id !== 'string'),
    )
  )
    return 'invalid_schema';
  if ((items as { text: string }[]).reduce((n, item) => n + item.text.trim().length, 0) > 1200)
    return 'summary_too_long';
  if (!items.length) return 'empty';
  return 'format_valid_sources_not_checked';
}
async function inspectSummaries() {
  if (process.env.WB_SUMMARY_FORMAT_APPROVED !== '1') throw new Error('approval_required');
  const config = loadConfig();
  const client = new Client({
    connectionString: config.database.url,
    application_name: 'cache-summary-format-readonly',
    connectionTimeoutMillis: 5000,
  });
  await client.connect();
  await client.query("SET default_transaction_read_only=on; SET statement_timeout='5s'");
  const ring = loadKekRing(config);
  const crypto = new EnvelopeCrypto(
    {
      query: (sql: string, values?: unknown[]) => client.query(sql, values),
    } as unknown as Database,
    new SystemClock(),
    ring,
  );
  const categories: Record<string, number> = {};
  const structure: { items: number; textChars: number; boundedJsonWrapper: boolean }[] = [];
  try {
    const rows = (
      await client.query<{ id: string | null; user_id: string | null; ciphertext: Buffer | null }>(`
      SELECT g.id,g.user_id,g.ciphertext FROM ai_runtime.chat_summary_states s
      JOIN ai_runtime.memory_states m ON m.id=s.parent_id
      JOIN LATERAL (SELECT id,status FROM model_access.usage_records u WHERE u.conversation_id=m.conversation_id AND u.prompt_template_version='chat-summary-v2' AND u.scenario_mode='normal' AND u.created_at<=s.updated_at+interval '1 minute' ORDER BY u.created_at DESC LIMIT 1) u ON true
      LEFT JOIN LATERAL (SELECT id,user_id,ciphertext FROM model_access.generation_results g WHERE g.usage_record_id=u.id AND g.phase='complete' ORDER BY g.created_at DESC LIMIT 1) g ON true
      WHERE s.scope='normal' AND s.target_seq>s.covered_seq AND u.status='succeeded' AND s.updated_at <= '2026-11-10T12:55:35.715Z' ORDER BY s.updated_at DESC LIMIT 7
    `)
    ).rows;
    for (const row of rows) {
      let category = 'result_unavailable',
        bytes: Buffer | undefined;
      try {
        if (row.id && row.user_id && row.ciphertext) {
          bytes = await crypto.open(row.user_id, `generation:${row.id}`, row.ciphertext);
          const result = JSON.parse(bytes.toString('utf8')) as { value?: { text?: string } };
          category = summaryFormat(result);
          const text = result.value?.text ?? '';
          let raw: { items?: unknown } | null = null,
            boundedJsonWrapper = false;
          try {
            raw = JSON.parse(text) as { items?: unknown };
          } catch {
            const first = text.indexOf('{'),
              last = text.lastIndexOf('}');
            if (first >= 0 && last > first)
              try {
                raw = JSON.parse(text.slice(first, last + 1)) as { items?: unknown };
                boundedJsonWrapper = true;
              } catch {
                /* no text leaves this process */
              }
          }
          const items = Array.isArray(raw?.items) ? raw.items : [];
          structure.push({
            items: items.length,
            textChars: items.reduce(
              (n: number, x: { text?: unknown }) =>
                n + (typeof x?.text === 'string' ? x.text.trim().length : 0),
              0,
            ),
            boundedJsonWrapper,
          });
        }
      } catch {
        category = 'unreadable';
      } finally {
        bytes?.fill(0);
      }
      categories[category] = (categories[category] ?? 0) + 1;
    }
    console.log(
      JSON.stringify({
        checked: rows.length,
        categories,
        structure,
        plaintextSaved: false,
        databaseReadOnly: true,
      }),
    );
  } finally {
    for (const key of ring?.keys.values() ?? []) key.fill(0);
    await client.end();
  }
}
if (process.argv.includes('--observe')) {
  observe().catch(() => {
    console.error('CACHE_OBSERVATION_STOPPED');
    process.exitCode = 1;
  });
} else if (process.argv.includes('--summary-format')) {
  inspectSummaries().catch(() => {
    console.error('SUMMARY_FORMAT_CHECK_STOPPED');
    process.exitCode = 1;
  });
} else selfTest();
