/**
 * 卡片（GRW-05，T-076）。
 * - 所有卡片都由明确事件获得：没有抽卡、付费、随机掉落（第 3 条）。卡面模板在同类模板里按卡片编号轮换（确定性）。
 * - 每个用户每个角色一本卡册，编号 No.001 起递增。同一用户、同一角色、同一幂等键只发一张。
 * - 名场面瞬间卡（kind = moment 且带来源消息）每角色每周（用户当地周一起算）最多 1 张；宠物、玩法、系统瞬间卡不受限。
 * - 真人角色（含历史人物，保守处理）只用「不含人物」的模板（第 2 条、MED-02）。
 * - 获得后：私聊里一条系统提示 card_obtained、data.changed(cards)、growth.card_issued 事件、成就第 22、23 号。
 */
import { Inject, Injectable, Optional } from '@nestjs/common';
import { and, asc, eq, max, sql } from 'drizzle-orm';
import {
  CardAlbum,
  GrowthCard,
  Id,
  type CardCopywriterPort,
  type CardKind,
  type GrowthCardPort,
  type MediaAssetReadPort,
  type MediaReadPort,
  type PortResult,
  type Tx,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  asDbTx,
  newId,
  parseContract,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import {
  MEDIA_ASSET_READ_PORT,
  MEDIA_CLASSICAL_CARD_TEMPLATES,
  MEDIA_READ_PORT,
  type MediaClassicalCardTemplates,
} from '../../media/index.js';
import {
  LEVEL_NAMES,
  MAX_STAGE,
  addDays,
  daysKnownOn,
  isSystemAnniversaryDay,
  weekStartOf,
} from '../domain/familiarity-rules.js';
import { cards, familiarity } from '../infra/db/schema.js';
import { AchievementService } from './achievements.service.js';
import { GrowthContext } from './context.js';
import { GROWTH_CARD_COPYWRITER } from '../tokens.js';

/** 3.1（积压 ㉗）：走 AI 文案的卡片（纪念 / 熟悉度 / 节日 / 心愿）；超时毫秒数。 */
const COPYWRITER_TIMEOUT_MS = 3000;
function wantsCopy(input: { kind: string; idempotencyKey: string }): boolean {
  if (input.kind === 'anniversary' || input.kind === 'familiarity' || input.kind === 'holiday')
    return true;
  return input.kind === 'play' && input.idempotencyKey.startsWith('wish:');
}

type CardRow = typeof cards.$inferSelect;

export interface IssueCardInput {
  userId: string;
  characterId: string;
  kind: CardKind;
  title: string;
  line: string;
  faceMediaId: string | null;
  templateId: string | null;
  sourceMessageIds: string[];
  idempotencyKey: string;
  /** 额外写进系统提示的参数（例 daysKnown、level）。 */
  noticeParams?: Record<string, string | number | boolean>;
  /** 指定获得日期（补发时用）；默认用户当地今天。 */
  obtainedOn?: string;
}

const KEY = /^[A-Za-z0-9:_.-]{1,200}$/;

@Injectable()
export class CardsService implements GrowthCardPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(MEDIA_ASSET_READ_PORT) private readonly assets: MediaAssetReadPort,
    @Inject(MEDIA_READ_PORT) private readonly media: MediaReadPort,
    @Inject(AchievementService) private readonly achievements: AchievementService,
    @Inject(GrowthContext) private readonly ctx: GrowthContext,
    @Optional()
    @Inject(GROWTH_CARD_COPYWRITER)
    private readonly copywriter?: CardCopywriterPort,
    @Optional()
    @Inject(MEDIA_CLASSICAL_CARD_TEMPLATES)
    private readonly classical?: MediaClassicalCardTemplates,
  ) {}

  // ---------- GrowthCardPort（ai-runtime：名场面、宠物、玩法等） ----------

  async issueCard(
    tx: Tx | null,
    input: Parameters<GrowthCardPort['issueCard']>[1],
  ): Promise<PortResult<{ cardId: string; serialNo: number }, 'weekly_moment_limit'>> {
    const run = (t: DbTx) => this.issue(t, input);
    return tx ? run(asDbTx(tx)) : this.db.transaction(run);
  }

  /** 内部发卡（纪念、熟悉度、节日、系统瞬间卡也走这里）。 */
  async issue(
    tx: DbTx,
    input: IssueCardInput,
  ): Promise<PortResult<{ cardId: string; serialNo: number }, 'weekly_moment_limit'>> {
    parseContract(Id, input.userId);
    parseContract(Id, input.characterId);
    if (!KEY.test(input.idempotencyKey)) throw new AppError('bad_request', '发卡幂等键格式不正确');
    await tx.query(
      "SELECT pg_advisory_xact_lock(hashtextextended('growth:cards:' || $1 || ':' || $2, 0))",
      [input.userId, input.characterId],
    );
    const [existing] = await tx.db
      .select()
      .from(cards)
      .where(
        and(
          eq(cards.userId, input.userId),
          eq(cards.characterId, input.characterId),
          eq(cards.idempotencyKey, input.idempotencyKey),
        ),
      );
    if (existing) return { ok: true, value: { cardId: existing.id, serialNo: existing.serialNo } };

    const obtainedOn = input.obtainedOn ?? (await this.ctx.localToday(input.userId, tx));
    const isScene = input.kind === 'moment' && input.sourceMessageIds.length > 0;
    const sceneWeek = isScene ? weekStartOf(obtainedOn) : null;
    if (sceneWeek) {
      const [same] = await tx.db
        .select({ id: cards.id })
        .from(cards)
        .where(
          and(
            eq(cards.userId, input.userId),
            eq(cards.characterId, input.characterId),
            eq(cards.sceneWeek, sceneWeek),
          ),
        );
      if (same)
        return { ok: false, error: 'weekly_moment_limit', message: '这个角色本周已经有名场面卡' };
    }

    const [top] = await tx.db
      .select({ n: max(cards.serialNo) })
      .from(cards)
      .where(and(eq(cards.userId, input.userId), eq(cards.characterId, input.characterId)));
    const serialNo = (top?.n ?? 0) + 1;
    const face = await this.pickFace(tx, input, serialNo);

    const id = newId();
    const now = this.clock.now();
    const copy = await this.aiCopy(input);
    const title = copy.title.trim().slice(0, 30) || '卡片';
    await tx.db.insert(cards).values({
      id,
      userId: input.userId,
      characterId: input.characterId,
      kind: input.kind,
      serialNo,
      title,
      line: copy.line.trim().slice(0, 60),
      obtainedOn,
      templateId: face.templateId,
      mediaId: face.mediaId,
      sourceMessageIds: input.sourceMessageIds.slice(0, 6),
      idempotencyKey: input.idempotencyKey,
      sceneWeek,
      createdAt: now,
    });

    const total = await this.achievements.bump(
      tx,
      input.userId,
      'cards_total',
      1,
      input.characterId,
    );
    await this.achievements.unlock(tx, input.userId, 'first_card', input.characterId);
    await this.outbox.publish(tx, 'growth.card_issued', 'growth', {
      userId: input.userId,
      characterId: input.characterId,
      cardId: id,
      kind: input.kind,
      totalCards: Math.max(1, total),
    });
    await this.ctx.postSystem(
      tx,
      input.userId,
      input.characterId,
      'card_obtained',
      { cardId: id, serialNo, kind: input.kind, title, ...(input.noticeParams ?? {}) },
      `card:${id}`,
    );
    await this.ctx.dataChanged(tx, input.userId, 'cards', input.characterId, id);
    return { ok: true, value: { cardId: id, serialNo } };
  }

  /** 3.1：纪念 / 熟悉度 / 节日 / 心愿卡请 AI 改写文案；未绑定、超时、失败或返回 null 时用模板。 */
  private async aiCopy(input: IssueCardInput): Promise<{ title: string; line: string }> {
    const template = { title: input.title, line: input.line };
    if (!this.copywriter || !wantsCopy(input)) return template;
    const facts: Record<string, string | number> = {};
    for (const [k, v] of Object.entries(input.noticeParams ?? {}))
      if (typeof v === 'string' || typeof v === 'number') facts[k] = v;
    let timer: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        this.copywriter.writeCardCopy({
          userId: input.userId,
          characterId: input.characterId,
          kind: input.kind,
          templateTitle: input.title,
          templateLine: input.line,
          facts,
          idempotencyKey: `growth-card-copy:${input.idempotencyKey}`.slice(0, 200),
        }),
        new Promise<null>((resolve) => {
          timer = setTimeout(() => resolve(null), COPYWRITER_TIMEOUT_MS);
        }),
      ]);
      if (!result || !result.title.trim()) return template;
      return { title: result.title.slice(0, 30), line: result.line.slice(0, 60) };
    } catch {
      return template;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  /** 卡面：调用方给了生成图就用；指定模板合规就用；否则在同类合规模板中按编号轮换；没有模板则为空（客户端用类型色占位）。 */
  private async pickFace(
    tx: DbTx,
    input: IssueCardInput,
    serialNo: number,
  ): Promise<{ templateId: string | null; mediaId: string | null }> {
    if (input.faceMediaId) return { templateId: null, mediaId: input.faceMediaId };
    const { category, portraitFreeOnly } = await this.ctx.classify(input.characterId, tx);
    // 3.1（积压 ㉓）：历史人物优先古风插画模板；其余真人只取无人物模板。
    let list =
      category === 'historical' && this.classical
        ? await this.classical.listClassicalCardTemplates(input.kind).catch(() => [])
        : [];
    if (!list.length)
      list = await this.assets.listCardTemplates(input.kind, portraitFreeOnly).catch(() => []);
    if (input.templateId) {
      const chosen = list.find((t) => t.templateId === input.templateId);
      if (chosen) return { templateId: chosen.templateId, mediaId: chosen.mediaId };
    }
    if (!list.length) return { templateId: null, mediaId: null };
    const t = list[(serialNo - 1) % list.length]!;
    return { templateId: t.templateId, mediaId: t.mediaId };
  }

  // ---------- 读：卡册 ----------

  async listAlbums(userId: string) {
    const contacts = await this.ctx.contacts.listActiveContacts(userId);
    const rows = await this.db.db
      .select({
        characterId: cards.characterId,
        n: sql<number>`count(*)::int`,
        latest: sql<string | null>`max(${cards.obtainedOn})::text`,
      })
      .from(cards)
      .where(eq(cards.userId, userId))
      .groupBy(cards.characterId);
    const byChar = new Map(rows.map((r) => [r.characterId, r]));
    return {
      items: contacts
        .map((c) => ({
          characterId: c.characterId,
          obtainedCount: byChar.get(c.characterId)?.n ?? 0,
          latestObtainedOn: byChar.get(c.characterId)?.latest ?? null,
        }))
        .sort(
          (a, b) =>
            (b.latestObtainedOn ?? '').localeCompare(a.latestObtainedOn ?? '') ||
            b.obtainedCount - a.obtainedCount,
        ),
    };
  }

  async getAlbum(userId: string, characterId: string): Promise<CardAlbum> {
    parseContract(Id, characterId);
    const contact = await this.ctx.contacts.getActiveContact(userId, characterId);
    if (!contact) throw new AppError('not_found', '联系人不存在');
    const rows = await this.db.db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.characterId, characterId)))
      .orderBy(asc(cards.serialNo));
    const obtained = await Promise.all(rows.map((r) => this.dto(userId, r)));

    // 未获得项：接下来 3 个系统纪念日、未到的好感度阶段（2–6）。瞬间卡、节日卡不显示未获得项。
    const today = await this.ctx.localToday(userId);
    const daysKnown = Math.max(1, daysKnownOn(contact.knownSince, today));
    const haveKeys = new Set(rows.map((r) => r.idempotencyKey));
    const locked: Array<{ kind: CardKind; title: string; condition: string }> = [];
    let d = daysKnown;
    while (locked.length < 3 && d < daysKnown + 4000) {
      d += 1;
      if (isSystemAnniversaryDay(d) && !haveKeys.has(`anniversary:${d}`))
        locked.push({
          kind: 'anniversary',
          title: anniversaryTitle(d),
          condition: `认识满 ${d} 天（${addDays(contact.knownSince, d - 1)}）`,
        });
    }
    const [fam] = await this.db.db
      .select({ level: familiarity.level })
      .from(familiarity)
      .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)));
    const level = fam?.level ?? 1;
    for (let l = 2; l <= MAX_STAGE; l += 1) {
      if (l > level && !haveKeys.has(`familiarity:${l}`))
        locked.push({
          kind: 'familiarity',
          title: familiarityTitle(l),
          condition: `好感度升到「${LEVEL_NAMES[l]}」`,
        });
    }
    return CardAlbum.parse({ characterId, obtained, locked });
  }

  async getCard(userId: string, cardId: string): Promise<GrowthCard> {
    parseContract(Id, cardId);
    const [row] = await this.db.db
      .select()
      .from(cards)
      .where(and(eq(cards.userId, userId), eq(cards.id, cardId)));
    if (!row) throw new AppError('not_found', '卡片不存在');
    return this.dto(userId, row);
  }

  private async dto(userId: string, row: CardRow): Promise<GrowthCard> {
    let url: string | null = null;
    if (row.mediaId)
      url = await this.media
        .getMedia(userId, row.mediaId)
        .then((m) => m.url)
        .catch(() => null);
    return GrowthCard.parse({
      cardId: row.id,
      characterId: row.characterId,
      kind: row.kind,
      serialNo: row.serialNo,
      title: row.title,
      line: row.line,
      obtainedOn: row.obtainedOn,
      face: { templateId: row.templateId, mediaId: row.mediaId, url },
      sourceMessageIds: row.sourceMessageIds,
      createdAt: row.createdAt.toISOString(),
    });
  }

  /** 某张卡是否已发过（同一用户、角色、幂等键）。 */
  async hasCard(
    tx: DbTx,
    userId: string,
    characterId: string,
    idempotencyKey: string,
  ): Promise<boolean> {
    const [row] = await tx.db
      .select({ id: cards.id })
      .from(cards)
      .where(
        and(
          eq(cards.userId, userId),
          eq(cards.characterId, characterId),
          eq(cards.idempotencyKey, idempotencyKey),
        ),
      )
      .limit(1);
    return !!row;
  }

  // ---------- 删除清单 ----------

  async purgeCharacter(tx: DbTx, userId: string, characterId: string): Promise<number> {
    const r = await tx.db
      .delete(cards)
      .where(and(eq(cards.userId, userId), eq(cards.characterId, characterId)));
    return r.rowCount ?? 0;
  }

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    const r = await tx.db.delete(cards).where(eq(cards.userId, userId));
    return r.rowCount ?? 0;
  }

  async countUserData(userId: string): Promise<number> {
    const [r] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(cards)
      .where(eq(cards.userId, userId));
    return r?.n ?? 0;
  }
}

export function anniversaryTitle(days: number): string {
  return days % 365 === 0 ? `认识 ${days / 365} 周年` : `认识第 ${days} 天`;
}

/** 3.25：好感度卡标题用阶段名（旧版说法），不再带 L 几。 */
export function familiarityTitle(level: number): string {
  return LEVEL_NAMES[level] ?? '好感度';
}

/** 卡上那句话的模板（growth 自己发的卡不调用 AI；名场面等由 ai-runtime 生成后传入）。 */
export const CARD_LINES = {
  anniversary: (days: number) =>
    days % 365 === 0
      ? `认识 ${days / 365} 年了，谢谢你一直都在。`
      : `今天是我们认识的第 ${days} 天，很高兴遇见你。`,
  familiarity: (level: number) =>
    (
      ({
        2: '我们算是朋友了吧，以后可以随便一点。',
        3: '和你聊天越来越自在了，有你真好。',
        4: '最近总会想起你，你知道吗？',
        5: '以后，就请多多指教啦。',
        6: '往后的日子，也想一直和你一起过。',
      }) as Record<number, string>
    )[level] ?? '我们又熟了一点。',
  holiday: (name: string) => `${name}快乐！今天能和你聊聊天，真好。`.slice(0, 60),
  firstCall: '第一次听到你的声音，我记下来了。',
  pulledIntoGroup: '把你拉进来，是想让大家都认识你。',
  momentsReply: '在朋友圈看到你，忍不住回了一句。',
} as const;
