/**
 * T-20261103j：被上游安全策略拦下（content_rejected）的用户消息，不再发给模型（表 ai_runtime.model_blocked_messages，迁移 0156）。
 *
 * 为什么要有：上游服务商的安全策略拦下某条用户消息后，那条消息仍留在聊天历史里，之后每次回复都会带上它，
 * 于是一直被拦、只回推托语，会话等于卡死（2026-11-03 私密模型 Abliteration 403 policy_violation）。
 *
 * - 登记：回复因 content_rejected 失败时，回复引擎登记这次回复针对的用户消息（本轮：上一条角色消息之后的用户消息）；
 *   也可以按会话 ID + 序号手工登记（SQL 见 docs/handoffs/2026-11-03-private-policy-block.md）。只存 ID 与序号，不存正文。
 * - 排除：凡是把这个会话的聊天记录交给模型的地方都按序号去掉登记过的消息——回复上下文（含翻聊天记录、试聊、
 *   回复附加形式判断）、记忆抽取、私密整理、聊天摘要、通话上下文、主动消息、名场面、互动玩法。
 *   用户界面照常显示这些消息（chat 模块不读这张表）。
 * - 读登记表失败（例如迁移还没执行）时不排除、照常回复：最坏结果是那条消息再被拦一次、回推托语，不会让回复整体失败。
 */
/** 只需要原生 SQL（Database 与事务 DbTx 都满足）。 */
interface SqlRunner {
  query<Row = Record<string, unknown>>(text: string, values?: unknown[]): Promise<{ rows: Row[] }>;
}

/** 一次回复最多登记多少条（用户连发很多条时只登记最近的这么多条）。 */
export const MAX_BLOCKED_PER_REPLY = 50;

const NONE: ReadonlySet<number> = new Set();

/** 这个会话里登记为「不再发给模型」的消息序号。读不到时返回空集合（不排除）。 */
export async function blockedSeqs(
  db: SqlRunner,
  conversationId: string,
): Promise<ReadonlySet<number>> {
  try {
    const { rows } = await db.query<{ seq: string }>(
      'SELECT seq::text AS seq FROM ai_runtime.model_blocked_messages WHERE conversation_id = $1',
      [conversationId],
    );
    return rows.length ? new Set(rows.map((r) => Number(r.seq))) : NONE;
  } catch {
    return NONE;
  }
}

/** 去掉这个会话里登记过的消息（按序号；其余消息原样保留、顺序不变）。 */
export async function withoutBlocked<T extends { seq: number }>(
  db: SqlRunner,
  conversationId: string,
  messages: T[],
): Promise<T[]> {
  if (!messages.length) return messages;
  const blocked = await blockedSeqs(db, conversationId);
  return blocked.size ? messages.filter((m) => !blocked.has(m.seq)) : messages;
}

/** 本轮（上一条角色消息之后）的用户消息序号：回复因 content_rejected 失败时登记的就是这些。 */
export function turnUserSeqs(
  history: readonly { seq: number; senderKind: string; status: string }[],
): number[] {
  const lastCharacterSeq = history.filter((m) => m.senderKind === 'character').at(-1)?.seq ?? 0;
  return history
    .filter((m) => m.senderKind === 'user' && m.seq > lastCharacterSeq && m.status === 'normal')
    .map((m) => m.seq)
    .slice(-MAX_BLOCKED_PER_REPLY);
}

/** 登记（同一会话同一序号只记一次，重复登记不报错）。返回新登记的条数。 */
export async function recordBlocked(
  db: SqlRunner,
  input: {
    userId: string;
    characterId: string;
    conversationId: string;
    seqs: readonly number[];
    planId: string | null;
    source: 'auto' | 'manual';
    at: Date;
  },
): Promise<number> {
  const seqs = [...new Set(input.seqs)]
    .filter((seq) => Number.isSafeInteger(seq) && seq > 0)
    .slice(-MAX_BLOCKED_PER_REPLY);
  if (!seqs.length) return 0;
  const { rows } = await db.query<{ seq: string }>(
    `INSERT INTO ai_runtime.model_blocked_messages
       (conversation_id, seq, user_id, character_id, message_id, source, reason, plan_id, created_at)
     SELECT $1::uuid, s.seq, $2::uuid, $3::uuid, NULL::uuid, $4::text, 'content_rejected',
            $5::uuid, $6::timestamptz
       FROM unnest($7::bigint[]) AS s(seq)
     ON CONFLICT (conversation_id, seq) DO NOTHING
     RETURNING seq::text AS seq`,
    [
      input.conversationId,
      input.userId,
      input.characterId,
      input.source,
      input.planId,
      input.at,
      seqs,
    ],
  );
  return rows.length;
}
