import { Inject, Injectable } from '@nestjs/common';
import { and, eq, sql } from 'drizzle-orm';
import {
  FamiliarityInfo,
  AddFamiliarityPointsRequest,
  AddFamiliarityPointsResponse,
  DaysKnownInfo,
  Anniversary,
  AddAnniversaryRequest,
  Id,
  type ContactsReadPort,
} from '@weiban/contracts';
import {
  AppError,
  CLOCK,
  DATABASE,
  P25_FAMILIARITY,
  newId,
  parseContract,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { CONTACTS_READ_PORT } from '../../contacts/index.js';
import { familiarity, familiarityEvents, anniversaries } from '../infra/db/schema.js';
import {
  levelFromPoints,
  pointsInLevel,
  pointsToNextLevel,
  SYSTEM_ANNIVERSARY_DAYS,
  systemAnniversaryLabel,
  computeNextOccurrence,
  daysKnownFromDate,
} from '../domain/familiarity-rules.js';

const MAX_CUSTOM_ANNIVERSARIES = 10;

@Injectable()
export class GrowthService {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(CONTACTS_READ_PORT) private readonly contacts: ContactsReadPort,
  ) {}

  private async requireActiveContact(userId: string, characterId: string) {
    const contact = await this.contacts.getActiveContact(userId, characterId);
    if (!contact) throw new AppError('not_found', '联系人不存在或尚未激活');
    return contact;
  }

  private familiarityDto(row: typeof familiarity.$inferSelect): FamiliarityInfo {
    return FamiliarityInfo.parse({
      characterId: row.characterId,
      level: row.level,
      pointsInLevel: pointsInLevel(row.totalPoints, row.level),
      pointsToNextLevel: pointsToNextLevel(row.level),
      totalPoints: row.totalPoints,
      updatedAt: row.updatedAt.toISOString(),
    });
  }

  async getFamiliarity(userId: string, characterId: string): Promise<FamiliarityInfo> {
    parseContract(Id, characterId);
    await this.requireActiveContact(userId, characterId);
    const now = this.clock.now();
    const [row] = await this.db.db
      .select()
      .from(familiarity)
      .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)));
    if (row) return this.familiarityDto(row);
    // No row yet — lazily return a zero state without inserting.
    return FamiliarityInfo.parse({
      characterId,
      level: 1,
      pointsInLevel: 0,
      pointsToNextLevel: pointsToNextLevel(1),
      totalPoints: 0,
      updatedAt: now.toISOString(),
    });
  }

  async addPoints(
    userId: string,
    characterId: string,
    input: unknown,
  ): Promise<AddFamiliarityPointsResponse> {
    parseContract(Id, characterId);
    const body = parseContract(AddFamiliarityPointsRequest, input);
    await this.requireActiveContact(userId, characterId);
    const occurredAt = body.occurredAt ? new Date(body.occurredAt) : this.clock.now();

    // Determine user timezone from contact.knownSince origin; fall back to
    // a reasonable default. The contacts module already stores the local date,
    // so we can derive timezone from the identity profile. For now we use the
    // IdentityReadPort indirectly: since we don't have the tz here we use
    // todayInTz which accepts the full date string and the clock for comparison.
    // The timezone is stored on the identity profile; we pass the occurred date
    // directly as the local date string for the daily-points-reset comparison.
    const localDateStr = occurredAt.toISOString().slice(0, 10); // YYYY-MM-DD (UTC as proxy)

    return this.db.transaction(async (tx) => {
      // Advisory lock per (userId, characterId) to prevent concurrent updates.
      await tx.query(
        "SELECT pg_advisory_xact_lock(hashtextextended('growth:familiarity:' || $1 || ':' || $2, 0))",
        [userId, characterId],
      );

      // Idempotency: skip if this key was already processed.
      const [existing] = await tx.db
        .select({ id: familiarityEvents.id })
        .from(familiarityEvents)
        .where(eq(familiarityEvents.idempotencyKey, body.idempotencyKey));
      if (existing) {
        // Return current state without mutation.
        const [cur] = await tx.db
          .select()
          .from(familiarity)
          .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)));
        const info = cur
          ? this.familiarityDto(cur)
          : FamiliarityInfo.parse({
              characterId,
              level: 1,
              pointsInLevel: 0,
              pointsToNextLevel: pointsToNextLevel(1),
              totalPoints: 0,
              updatedAt: this.clock.now().toISOString(),
            });
        return AddFamiliarityPointsResponse.parse({
          familiarity: info,
          pointsAdded: 0,
          leveledUp: false,
        });
      }

      const rawPoints =
        P25_FAMILIARITY.points[body.eventType as keyof typeof P25_FAMILIARITY.points] ?? 0;
      if (rawPoints <= 0) throw new AppError('bad_request', '不支持的熟悉度事件类型');

      // Load or initialise familiarity row.
      const [cur] = await tx.db
        .select()
        .from(familiarity)
        .where(and(eq(familiarity.userId, userId), eq(familiarity.characterId, characterId)))
        .for('update');

      const isSameDay = cur?.dailyPointsDate === localDateStr;
      const todayUsed = isSameDay ? cur.dailyPoints : 0;
      const remaining = Math.max(0, P25_FAMILIARITY.maxPointsPerCharacterPerDay - todayUsed);
      const pointsAdded = Math.min(rawPoints, remaining);

      let leveledUp = false;
      let updatedRow: typeof familiarity.$inferSelect;

      if (pointsAdded > 0) {
        const newTotal = (cur?.totalPoints ?? 0) + pointsAdded;
        const oldLevel = cur?.level ?? 1;
        const newLevel = levelFromPoints(newTotal);
        leveledUp = newLevel > oldLevel;

        const values = {
          id: cur?.id ?? newId(),
          userId,
          characterId,
          totalPoints: newTotal,
          level: newLevel,
          dailyPoints: todayUsed + pointsAdded,
          dailyPointsDate: localDateStr,
          updatedAt: occurredAt,
        };
        const [saved] = await tx.db
          .insert(familiarity)
          .values(values)
          .onConflictDoUpdate({
            target: [familiarity.userId, familiarity.characterId],
            set: {
              totalPoints: sql`excluded.total_points`,
              level: sql`excluded.level`,
              dailyPoints: sql`excluded.daily_points`,
              dailyPointsDate: sql`excluded.daily_points_date`,
              updatedAt: sql`excluded.updated_at`,
            },
          })
          .returning();
        updatedRow = saved!;

        // Record the event for audit / idempotency.
        await tx.db.insert(familiarityEvents).values({
          id: newId(),
          userId,
          characterId,
          eventType: body.eventType,
          points: pointsAdded,
          idempotencyKey: body.idempotencyKey,
          occurredAt,
        });
      } else {
        // Daily cap already reached — still record the key so it's idempotent.
        await tx.db.insert(familiarityEvents).values({
          id: newId(),
          userId,
          characterId,
          eventType: body.eventType,
          points: rawPoints, // original intent; actual effect is 0
          idempotencyKey: body.idempotencyKey,
          occurredAt,
        });
        updatedRow = cur ?? {
          id: newId(),
          userId,
          characterId,
          totalPoints: 0,
          level: 1,
          dailyPoints: 0,
          dailyPointsDate: localDateStr,
          updatedAt: occurredAt,
        };
      }

      return AddFamiliarityPointsResponse.parse({
        familiarity: this.familiarityDto(updatedRow),
        pointsAdded,
        leveledUp,
      });
    });
  }

  async getDaysKnown(userId: string, characterId: string): Promise<DaysKnownInfo> {
    parseContract(Id, characterId);
    const contact = await this.requireActiveContact(userId, characterId);
    const now = this.clock.now();
    // knownSince is stored as the user's local date (YYYY-MM-DD) at the time of adding.
    const knownSince = contact.knownSince;
    const daysKnown = daysKnownFromDate(knownSince, now);

    const customRows = await this.db.db
      .select()
      .from(anniversaries)
      .where(and(eq(anniversaries.userId, userId), eq(anniversaries.characterId, characterId)))
      .orderBy(anniversaries.date);

    const todayStr = now.toISOString().slice(0, 10);

    // Build system anniversaries list from standard day milestones.
    const sysAnniversaries: Anniversary[] = SYSTEM_ANNIVERSARY_DAYS.map((days) => {
      const d = new Date(new Date(knownSince).getTime() + (days - 1) * 86400000);
      const dateStr = d.toISOString().slice(0, 10);
      return Anniversary.parse({
        id: `system-${days}`,
        kind: 'system',
        label: systemAnniversaryLabel(days),
        date: dateStr,
        nextOccurrence: computeNextOccurrence(dateStr, todayStr, 'system'),
      });
    });

    const customAnniversaries: Anniversary[] = customRows.map((r) =>
      Anniversary.parse({
        id: r.id,
        kind: 'custom',
        label: r.label,
        date: r.date,
        nextOccurrence: computeNextOccurrence(r.date, todayStr, 'custom'),
      }),
    );

    const allAnniversaries = [...sysAnniversaries, ...customAnniversaries].sort((a, b) =>
      a.date.localeCompare(b.date),
    );

    // Next anniversary = earliest whose nextOccurrence >= today.
    const upcoming = allAnniversaries
      .filter((a) => a.nextOccurrence && a.nextOccurrence >= todayStr)
      .sort((a, b) => (a.nextOccurrence ?? '').localeCompare(b.nextOccurrence ?? ''));
    const nextAnniversary = upcoming[0] ?? null;

    const isRomantic = contact.relationship === '恋人';

    return DaysKnownInfo.parse({
      characterId,
      daysKnown,
      knownSince,
      nextAnniversary,
      anniversaries: allAnniversaries,
      isRomantic,
    });
  }

  async addAnniversary(userId: string, characterId: string, input: unknown): Promise<Anniversary> {
    parseContract(Id, characterId);
    const body = parseContract(AddAnniversaryRequest, input);
    await this.requireActiveContact(userId, characterId);

    const [countRow] = await this.db.db
      .select({ n: sql<number>`count(*)::int` })
      .from(anniversaries)
      .where(and(eq(anniversaries.userId, userId), eq(anniversaries.characterId, characterId)));
    if ((countRow?.n ?? 0) >= MAX_CUSTOM_ANNIVERSARIES)
      throw new AppError(
        'bad_request',
        `每个角色最多添加 ${MAX_CUSTOM_ANNIVERSARIES} 个自定义纪念日`,
      );

    const now = this.clock.now();
    const todayStr = now.toISOString().slice(0, 10);
    const [row] = await this.db.db
      .insert(anniversaries)
      .values({
        id: newId(),
        userId,
        characterId,
        label: body.label,
        date: body.date,
        createdAt: now,
      })
      .returning();

    return Anniversary.parse({
      id: row!.id,
      kind: 'custom',
      label: row!.label,
      date: row!.date,
      nextOccurrence: computeNextOccurrence(row!.date, todayStr, 'custom'),
    });
  }

  async removeAnniversary(
    userId: string,
    characterId: string,
    anniversaryId: string,
  ): Promise<void> {
    parseContract(Id, characterId);
    parseContract(Id, anniversaryId);
    await this.requireActiveContact(userId, characterId);

    const deleted = await this.db.db
      .delete(anniversaries)
      .where(
        and(
          eq(anniversaries.id, anniversaryId),
          eq(anniversaries.userId, userId),
          eq(anniversaries.characterId, characterId),
        ),
      )
      .returning({ id: anniversaries.id });
    if (!deleted.length) throw new AppError('bad_request', '系统纪念日不可删除，或纪念日不存在');
  }
}
