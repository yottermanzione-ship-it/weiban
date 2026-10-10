/**
 * 共同领养宠物（PLAY-02，T-077）与宠物图鉴（ADM-04 第 5 条）。
 * - 不惩罚：没有饥饿、生病、离家等任何负面状态；成长阶段按领养天数推进、亲密值只升不降（第 8 条，P-39）。
 * - 按钮互动不调用模型、不花钱；每只宠物每天前 5 次各 +1 亲密值（P-39）；角色经 PetReadPort 知道今天玩过几次。
 * - 数量：每个角色同时最多 1 只、总共同时在养最多 3 只（P-38）；名字 1～8 个字（第 3、13 条）。
 * - 领养当天发「我们的 XX」瞬间卡；每进入新阶段发一张（不受名场面周限）；成就 29、30 与「首次互动」+5 由
 *   growth-events 订阅 growth.pet_adopted / pet_stage_changed 处理。
 * - 删除角色：宠物保留（随角色 30 天内恢复）；彻底删除时一起删除（第 10 条）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { and, asc, count, desc, eq, inArray } from 'drizzle-orm';
import {
  Id,
  PET_LIMITS,
  Pet,
  PetAlbumPhoto,
  PetDetail,
  PetName,
  PetNamingRequest,
  PetSpecies,
  PetSpeciesWrite,
  type MediaReadPort,
  type MediaSystemPort,
  type PetForRuntime,
  type PetNamingPort,
  type PetReadPort,
  type PetStage,
  type PortResult,
} from '@weiban/contracts';
import { z } from 'zod';
import {
  AUDIT_LOG,
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  newId,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
  type DbTx,
  type Outbox,
} from '../../../platform/index.js';
import { MEDIA_READ_PORT, MEDIA_SYSTEM_PORT } from '../../media/index.js';
import { daysKnownOn } from '../domain/familiarity-rules.js';
import {
  petAlbum,
  petAppearances,
  petInteractions,
  petNamingRequests,
  petSpecies,
  petTimeline,
  pets,
} from '../infra/db/schema.js';
import { CardsService } from './cards.service.js';
import { GrowthContext } from './context.js';

type PetRow = typeof pets.$inferSelect;
type AppearanceRow = typeof petAppearances.$inferSelect;
type Runner = Database['db'];

const STAGES: PetStage[] = ['baby', 'junior', 'adult'];
const STAGE_LABEL: Record<PetStage, string> = { baby: '幼年', junior: '少年', adult: '成年' };
const FALLBACK_URL = 'data:,';

export function stageForDay(daysAdopted: number): PetStage {
  if (daysAdopted >= PET_LIMITS.stageStartDay.adult) return 'adult';
  if (daysAdopted >= PET_LIMITS.stageStartDay.junior) return 'junior';
  return 'baby';
}

/** 名字按字（码点）计 1～8 个；不合规抛 bad_request。 */
function checkName(raw: string): string {
  const name = raw.trim();
  const len = [...name].length;
  if (len < 1 || len > PET_LIMITS.nameMaxChars)
    throw new AppError('bad_request', `名字需要 1～${PET_LIMITS.nameMaxChars} 个字`);
  return name;
}

const AdoptBody = z.object({
  clientRequestId: Id,
  characterId: Id,
  speciesId: Id,
  appearanceId: Id,
  name: PetName,
  namingRequestId: Id.nullable().optional(),
});
const UpdateBody = z.object({
  name: PetName.optional(),
  allowMomentsShare: z.boolean().optional(),
});

@Injectable()
export class PetsService implements PetReadPort, PetNamingPort {
  constructor(
    @Inject(DATABASE) private readonly db: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(MEDIA_READ_PORT) private readonly media: MediaReadPort,
    @Inject(MEDIA_SYSTEM_PORT) private readonly mediaSystem: MediaSystemPort,
    @Inject(CardsService) private readonly cards: CardsService,
    @Inject(GrowthContext) private readonly ctx: GrowthContext,
  ) {}

  // ---------- 图鉴 ----------

  private async url(userId: string, mediaId: string): Promise<string> {
    return this.media
      .getMedia(userId, mediaId)
      .then((m) => m.url)
      .catch(() => FALLBACK_URL);
  }

  private stageMedia(a: AppearanceRow, stage: PetStage): string {
    return stage === 'adult'
      ? a.adultMediaId
      : stage === 'junior'
        ? a.juniorMediaId
        : a.babyMediaId;
  }

  private async speciesDtos(userId: string, onlyListed: boolean): Promise<PetSpecies[]> {
    const rows = await this.db.db
      .select()
      .from(petSpecies)
      .where(onlyListed ? eq(petSpecies.listed, true) : undefined)
      .orderBy(asc(petSpecies.createdAt));
    if (!rows.length) return [];
    const appearances = await this.db.db
      .select()
      .from(petAppearances)
      .where(
        inArray(
          petAppearances.speciesId,
          rows.map((r) => r.id),
        ),
      )
      .orderBy(asc(petAppearances.sortOrder), asc(petAppearances.createdAt));
    const out: PetSpecies[] = [];
    for (const s of rows) {
      const own = appearances.filter((a) => a.speciesId === s.id);
      if (!own.length) continue;
      out.push(
        PetSpecies.parse({
          speciesId: s.id,
          name: s.name,
          intro: s.intro,
          presetNames: s.presetNames,
          listed: s.listed,
          appearances: await Promise.all(
            own.map(async (a) => ({
              appearanceId: a.id,
              name: a.name,
              images: {
                baby: { mediaId: a.babyMediaId, url: await this.url(userId, a.babyMediaId) },
                junior: { mediaId: a.juniorMediaId, url: await this.url(userId, a.juniorMediaId) },
                adult: { mediaId: a.adultMediaId, url: await this.url(userId, a.adultMediaId) },
              },
            })),
          ),
        }),
      );
    }
    return out;
  }

  listSpecies(userId: string) {
    return this.speciesDtos(userId, true).then((items) => ({ items }));
  }

  adminListSpecies(adminId: string) {
    return this.speciesDtos(adminId, false).then((items) => ({ items }));
  }

  async adminCreateSpecies(adminId: string, input: unknown): Promise<PetSpecies> {
    const body = parseContract(PetSpeciesWrite, input);
    const id = newId();
    await this.db.transaction(async (tx) => {
      const now = this.clock.now();
      await tx.db.insert(petSpecies).values({
        id,
        name: body.name,
        intro: body.intro,
        presetNames: body.presetNames,
        listed: body.listed,
        createdAt: now,
        updatedAt: now,
      });
      await this.writeAppearances(tx, id, body.appearances);
      await this.audit.record(
        {
          module: 'growth',
          action: 'pet_species.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'pet_species',
          targetId: id,
          details: { name: body.name, appearances: body.appearances.length },
        },
        tx,
      );
    });
    return this.adminGet(adminId, id);
  }

  async adminUpdateSpecies(adminId: string, speciesId: string, input: unknown) {
    parseContract(Id, speciesId);
    const body = parseContract(PetSpeciesWrite.partial(), input);
    await this.db.transaction(async (tx) => {
      const [row] = await tx.db.select().from(petSpecies).where(eq(petSpecies.id, speciesId));
      if (!row) throw new AppError('not_found', '物种不存在');
      await tx.db
        .update(petSpecies)
        .set({
          ...(body.name !== undefined ? { name: body.name } : {}),
          ...(body.intro !== undefined ? { intro: body.intro } : {}),
          ...(body.presetNames !== undefined ? { presetNames: body.presetNames } : {}),
          ...(body.listed !== undefined ? { listed: body.listed } : {}),
          updatedAt: this.clock.now(),
        })
        .where(eq(petSpecies.id, speciesId));
      if (body.appearances) await this.writeAppearances(tx, speciesId, body.appearances);
      await this.audit.record(
        {
          module: 'growth',
          action: 'pet_species.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'pet_species',
          targetId: speciesId,
          details: { fields: Object.keys(body) },
        },
        tx,
      );
    });
    return this.adminGet(adminId, speciesId);
  }

  /** 外观只新增和改图，不删除（列表里没出现的旧外观保留，已领养的不受影响）。 */
  private async writeAppearances(
    tx: DbTx,
    speciesId: string,
    list: Array<{
      appearanceId?: string;
      name: string;
      imageMediaIds: { baby: string; junior: string; adult: string };
    }>,
  ): Promise<void> {
    let order = 0;
    for (const a of list) {
      order += 1;
      if (a.appearanceId) {
        const updated = await tx.db
          .update(petAppearances)
          .set({
            name: a.name,
            babyMediaId: a.imageMediaIds.baby,
            juniorMediaId: a.imageMediaIds.junior,
            adultMediaId: a.imageMediaIds.adult,
            sortOrder: order,
          })
          .where(
            and(eq(petAppearances.id, a.appearanceId), eq(petAppearances.speciesId, speciesId)),
          )
          .returning({ id: petAppearances.id });
        if (!updated.length) throw new AppError('bad_request', '外观不属于该物种');
        continue;
      }
      await tx.db.insert(petAppearances).values({
        id: newId(),
        speciesId,
        name: a.name,
        babyMediaId: a.imageMediaIds.baby,
        juniorMediaId: a.imageMediaIds.junior,
        adultMediaId: a.imageMediaIds.adult,
        sortOrder: order,
        createdAt: this.clock.now(),
      });
    }
  }

  private async adminGet(adminId: string, speciesId: string): Promise<PetSpecies> {
    const all = await this.speciesDtos(adminId, false);
    const found = all.find((s) => s.speciesId === speciesId);
    if (!found) throw new AppError('not_found', '物种不存在');
    return found;
  }

  // ---------- 宠物：读 ----------

  private async appearance(runner: Runner, appearanceId: string): Promise<AppearanceRow> {
    const [a] = await runner
      .select()
      .from(petAppearances)
      .where(eq(petAppearances.id, appearanceId));
    if (!a) throw new AppError('not_found', '外观不存在');
    return a;
  }

  private async petDto(userId: string, row: PetRow, today: string): Promise<Pet> {
    const a = await this.appearance(this.db.db, row.appearanceId);
    const stage = (STAGES.includes(row.stage as PetStage) ? row.stage : 'baby') as PetStage;
    const mediaId = this.stageMedia(a, stage);
    const [counted] = await this.db.db
      .select({ n: count() })
      .from(petInteractions)
      .where(
        and(
          eq(petInteractions.petId, row.id),
          eq(petInteractions.localDate, today),
          eq(petInteractions.counted, true),
        ),
      );
    return Pet.parse({
      petId: row.id,
      characterId: row.characterId,
      speciesId: row.speciesId,
      appearanceId: row.appearanceId,
      name: row.name,
      stage,
      adoptedOn: row.adoptedOn,
      daysAdopted: Math.max(1, daysKnownOn(row.adoptedOn, today)),
      intimacy: row.intimacy,
      todayCountedInteractions: Number(counted?.n ?? 0),
      allowMomentsShare: row.allowMomentsShare,
      status: row.status === 'sent_away' ? 'sent_away' : 'active',
      sentAwayAt: row.sentAwayAt?.toISOString() ?? null,
      image: { mediaId, url: await this.url(userId, mediaId) },
    });
  }

  private async detailDto(userId: string, row: PetRow, today: string): Promise<PetDetail> {
    const pet = await this.petDto(userId, row, today);
    const timeline = await this.db.db
      .select()
      .from(petTimeline)
      .where(eq(petTimeline.petId, row.id))
      .orderBy(asc(petTimeline.at));
    return PetDetail.parse({
      ...pet,
      timeline: timeline.map((t) => ({ kind: t.kind, at: t.at.toISOString(), detail: t.detail })),
    });
  }

  private async ownPet(runner: Runner, userId: string, petId: string): Promise<PetRow> {
    parseContract(Id, petId);
    const [row] = await runner
      .select()
      .from(pets)
      .where(and(eq(pets.id, petId), eq(pets.userId, userId)));
    if (!row) throw new AppError('not_found', '宠物不存在');
    return row;
  }

  /** 「我 → 服务 → 宠物」与聊天信息页：含「回忆」中的、含角色已删除（30 天内）的。 */
  async listPets(userId: string, characterId?: string) {
    const today = await this.ctx.localToday(userId);
    await this.advanceForUser(userId, today);
    const rows = await this.db.db
      .select()
      .from(pets)
      .where(
        and(eq(pets.userId, userId), characterId ? eq(pets.characterId, characterId) : undefined),
      )
      .orderBy(asc(pets.status), desc(pets.createdAt));
    return { items: await Promise.all(rows.map((r) => this.petDto(userId, r, today))) };
  }

  async getPet(userId: string, petId: string): Promise<PetDetail> {
    const today = await this.ctx.localToday(userId);
    let row = await this.ownPet(this.db.db, userId, petId);
    if (row.status === 'active') {
      await this.db.transaction((tx) => this.advanceStage(tx, row, today));
      row = await this.ownPet(this.db.db, userId, petId);
    }
    return this.detailDto(userId, row, today);
  }

  // ---------- 起名 ----------

  private async checkSpecies(runner: Runner, speciesId: string, appearanceId: string) {
    const [s] = await runner.select().from(petSpecies).where(eq(petSpecies.id, speciesId));
    if (!s || !s.listed) throw new AppError('bad_request', '这个物种暂时不能领养');
    const a = await this.appearance(runner, appearanceId);
    if (a.speciesId !== speciesId) throw new AppError('bad_request', '外观不属于该物种');
    return { species: s, appearance: a };
  }

  private namingDto(row: typeof petNamingRequests.$inferSelect) {
    const names = [...row.names];
    if (row.chosenIndex !== null && names[row.chosenIndex]) {
      const [chosen] = names.splice(row.chosenIndex, 1);
      names.unshift(chosen!);
    }
    return PetNamingRequest.parse({
      requestId: row.id,
      characterId: row.characterId,
      status: row.status,
      names,
    });
  }

  async requestNames(userId: string, input: unknown) {
    const body = parseContract(
      z.object({ characterId: Id, speciesId: Id, appearanceId: Id }),
      input,
    );
    const contact = await this.ctx.contacts.getActiveContact(userId, body.characterId);
    if (!contact) throw new AppError('not_found', '联系人不存在');
    await this.checkSpecies(this.db.db, body.speciesId, body.appearanceId);
    return this.db.transaction(async (tx) => {
      const id = newId();
      const now = this.clock.now();
      const [row] = await tx.db
        .insert(petNamingRequests)
        .values({ id, userId, ...body, status: 'pending', createdAt: now, updatedAt: now })
        .returning();
      await this.outbox.publish(tx, 'growth.pet_naming_requested', 'growth', {
        userId,
        characterId: body.characterId,
        requestId: id,
        speciesId: body.speciesId,
        appearanceId: body.appearanceId,
      });
      return this.namingDto(row!);
    });
  }

  async getNamingRequest(userId: string, requestId: string) {
    parseContract(Id, requestId);
    const [row] = await this.db.db
      .select()
      .from(petNamingRequests)
      .where(and(eq(petNamingRequests.id, requestId), eq(petNamingRequests.userId, userId)));
    if (!row) throw new AppError('not_found', '起名请求不存在');
    return this.namingDto(row);
  }

  async submitNameCandidates(
    requestId: string,
    names: string[],
  ): Promise<PortResult<void, 'not_found' | 'invalid_names'>> {
    if (!Id.safeParse(requestId).success) return { ok: false, error: 'not_found' };
    const clean = [...new Set(names.map((n) => n.trim()))].filter(
      (n) => [...n].length >= 1 && [...n].length <= PET_LIMITS.nameMaxChars,
    );
    if (!clean.length || clean.length > 3 || clean.length !== names.length)
      return {
        ok: false,
        error: 'invalid_names',
        message: '候选名需 1～3 个、每个 1～8 字、不重复',
      };
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .update(petNamingRequests)
        .set({ status: 'ready', names: clean, updatedAt: this.clock.now() })
        .where(eq(petNamingRequests.id, requestId))
        .returning();
      if (!row) return { ok: false as const, error: 'not_found' as const };
      await this.ctx.dataChanged(tx, row.userId, 'pets', row.characterId, row.id);
      return { ok: true as const, value: undefined };
    });
  }

  async failNaming(requestId: string): Promise<void> {
    if (!Id.safeParse(requestId).success) return;
    await this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .update(petNamingRequests)
        .set({ status: 'failed', updatedAt: this.clock.now() })
        .where(and(eq(petNamingRequests.id, requestId), eq(petNamingRequests.status, 'pending')))
        .returning();
      if (row) await this.ctx.dataChanged(tx, row.userId, 'pets', row.characterId, row.id);
    });
  }

  /** 用户在私聊 pet_names 卡片上选了一个候选（actionId 末尾数字 = 候选序号，0 起）。 */
  async onNameChosen(tx: DbTx, userId: string, requestId: string, actionId: string): Promise<void> {
    if (!Id.safeParse(requestId).success) return;
    const m = /(\d+)$/.exec(actionId);
    if (!m) return;
    const index = Number(m[1]);
    const [row] = await tx.db
      .update(petNamingRequests)
      .set({ chosenIndex: index, updatedAt: this.clock.now() })
      .where(and(eq(petNamingRequests.id, requestId), eq(petNamingRequests.userId, userId)))
      .returning();
    if (row) await this.ctx.dataChanged(tx, userId, 'pets', row.characterId, row.id);
  }

  // ---------- 领养、改名、互动、送养 ----------

  async adopt(userId: string, input: unknown): Promise<PetDetail> {
    const body = parseContract(AdoptBody, input);
    const name = checkName(body.name);
    const today = await this.ctx.localToday(userId);
    const petId = await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('growth:pets:' || $1, 0))", [
        userId,
      ]);
      const [again] = await tx.db
        .select({ id: pets.id })
        .from(pets)
        .where(and(eq(pets.userId, userId), eq(pets.clientRequestId, body.clientRequestId)));
      if (again) return again.id;

      const contact = await this.ctx.contacts.getActiveContact(userId, body.characterId, tx);
      if (!contact) throw new AppError('not_found', '联系人不存在');
      const { appearance } = await this.checkSpecies(tx.db, body.speciesId, body.appearanceId);
      const active = await tx.db
        .select({ characterId: pets.characterId })
        .from(pets)
        .where(and(eq(pets.userId, userId), eq(pets.status, 'active')));
      if (active.some((p) => p.characterId === body.characterId))
        throw new AppError('limit_reached', '你们已经一起养了一只，送养后才能再领养');
      if (active.length >= PET_LIMITS.activeTotal)
        throw new AppError('limit_reached', `同时最多养 ${PET_LIMITS.activeTotal} 只宠物`);

      let namedByCharacter = false;
      if (body.namingRequestId) {
        const [req] = await tx.db
          .select()
          .from(petNamingRequests)
          .where(
            and(
              eq(petNamingRequests.id, body.namingRequestId),
              eq(petNamingRequests.userId, userId),
            ),
          );
        namedByCharacter = !!req?.names.includes(name);
      }

      const id = newId();
      const now = this.clock.now();
      await tx.db.insert(pets).values({
        id,
        userId,
        characterId: body.characterId,
        speciesId: body.speciesId,
        appearanceId: body.appearanceId,
        name,
        stage: 'baby',
        adoptedOn: today,
        intimacy: 0,
        allowMomentsShare: true,
        status: 'active',
        namedByCharacter,
        clientRequestId: body.clientRequestId,
        createdAt: now,
        updatedAt: now,
      });
      const characterName = await this.ctx.characterName(userId, body.characterId, tx);
      await this.timeline(tx, id, userId, 'adopted', {
        name,
        characterName,
        namedBy: namedByCharacter ? 'character' : 'user',
      });
      await this.ctx.postSystem(
        tx,
        userId,
        body.characterId,
        'pet_adopted',
        { petId: id, petName: name, characterName },
        `pet_adopted:${id}`,
      );
      await this.cards.issue(tx, {
        userId,
        characterId: body.characterId,
        kind: 'pet',
        title: `我们的${name}`,
        line: `从今天起，${name}就是我们一起照顾的小家伙了。`,
        faceMediaId: appearance.babyMediaId,
        templateId: null,
        sourceMessageIds: [],
        idempotencyKey: `pet:${id}:adopted`,
        noticeParams: { petId: id, petName: name },
        obtainedOn: today,
      });
      await this.outbox.publish(tx, 'growth.pet_adopted', 'growth', {
        userId,
        characterId: body.characterId,
        petId: id,
        speciesId: body.speciesId,
      });
      await this.ctx.dataChanged(tx, userId, 'pets', body.characterId, id);
      return id;
    });
    return this.detailDto(userId, await this.ownPet(this.db.db, userId, petId), today);
  }

  async updatePet(userId: string, petId: string, input: unknown): Promise<PetDetail> {
    const body = parseContract(UpdateBody, input);
    const today = await this.ctx.localToday(userId);
    await this.db.transaction(async (tx) => {
      const row = await this.ownPet(tx.db, userId, petId);
      const patch: Partial<PetRow> = { updatedAt: this.clock.now() };
      if (body.allowMomentsShare !== undefined) patch.allowMomentsShare = body.allowMomentsShare;
      let renamed: { from: string; to: string } | null = null;
      if (body.name !== undefined) {
        const name = checkName(body.name);
        if (row.status !== 'active') throw new AppError('conflict', '回忆里的宠物不能改名');
        if (name !== row.name) {
          patch.name = name;
          renamed = { from: row.name, to: name };
        }
      }
      await tx.db.update(pets).set(patch).where(eq(pets.id, row.id));
      if (renamed) {
        await this.timeline(tx, row.id, userId, 'renamed', renamed);
        await this.ctx.postSystem(
          tx,
          userId,
          row.characterId,
          'pet_renamed',
          { petId: row.id, from: renamed.from, to: renamed.to },
          `pet_renamed:${row.id}:${this.clock.now().getTime()}`,
        );
        await this.outbox.publish(tx, 'growth.pet_renamed', 'growth', {
          userId,
          characterId: row.characterId,
          petId: row.id,
        });
      }
      await this.ctx.dataChanged(tx, userId, 'pets', row.characterId, row.id);
    });
    return this.detailDto(userId, await this.ownPet(this.db.db, userId, petId), today);
  }

  async interact(userId: string, petId: string, input: unknown) {
    const body = parseContract(
      z.object({ kind: z.enum(['feed', 'play', 'pat']), clientActionId: Id }),
      input,
    );
    const today = await this.ctx.localToday(userId);
    const intimacyAdded = await this.db.transaction(async (tx) => {
      await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('growth:pet:' || $1, 0))", [
        petId,
      ]);
      const row = await this.ownPet(tx.db, userId, petId);
      const [again] = await tx.db
        .select({ counted: petInteractions.counted })
        .from(petInteractions)
        .where(
          and(
            eq(petInteractions.petId, row.id),
            eq(petInteractions.clientActionId, body.clientActionId),
          ),
        );
      if (again) return 0;
      if (row.status !== 'active') throw new AppError('conflict', '回忆里的宠物不能互动');
      if (!(await this.ctx.contacts.getActiveContact(userId, row.characterId, tx)))
        throw new AppError('conflict', '角色已删除，恢复后才能互动');
      const [c] = await tx.db
        .select({ n: count() })
        .from(petInteractions)
        .where(
          and(
            eq(petInteractions.petId, row.id),
            eq(petInteractions.localDate, today),
            eq(petInteractions.counted, true),
          ),
        );
      const counted = Number(c?.n ?? 0) < PET_LIMITS.dailyIntimacyInteractions;
      await tx.db.insert(petInteractions).values({
        id: newId(),
        petId: row.id,
        userId,
        kind: body.kind,
        localDate: today,
        counted,
        clientActionId: body.clientActionId,
        createdAt: this.clock.now(),
      });
      if (counted)
        await tx.db
          .update(pets)
          .set({ intimacy: row.intimacy + 1, updatedAt: this.clock.now() })
          .where(eq(pets.id, row.id));
      await this.ctx.dataChanged(tx, userId, 'pets', row.characterId, row.id);
      return counted ? 1 : 0;
    });
    const row = await this.ownPet(this.db.db, userId, petId);
    return { pet: await this.petDto(userId, row, today), intimacyAdded };
  }

  async sendAway(userId: string, petId: string): Promise<PetDetail> {
    const today = await this.ctx.localToday(userId);
    await this.db.transaction(async (tx) => {
      const row = await this.ownPet(tx.db, userId, petId);
      if (row.status !== 'active') return;
      const now = this.clock.now();
      await tx.db
        .update(pets)
        .set({ status: 'sent_away', sentAwayAt: now, updatedAt: now })
        .where(eq(pets.id, row.id));
      await this.timeline(tx, row.id, userId, 'sent_away', { name: row.name });
      await this.outbox.publish(tx, 'growth.pet_sent_away', 'growth', {
        userId,
        characterId: row.characterId,
        petId: row.id,
      });
      await this.ctx.dataChanged(tx, userId, 'pets', row.characterId, row.id);
    });
    return this.detailDto(userId, await this.ownPet(this.db.db, userId, petId), today);
  }

  // ---------- 相册 ----------

  private albumDto(r: typeof petAlbum.$inferSelect) {
    return PetAlbumPhoto.parse({
      photoId: r.id,
      mediaId: r.mediaId,
      source: r.source,
      messageId: r.messageId,
      createdAt: r.createdAt.toISOString(),
    });
  }

  async listAlbum(userId: string, petId: string) {
    const pet = await this.ownPet(this.db.db, userId, petId);
    const rows = await this.db.db
      .select()
      .from(petAlbum)
      .where(eq(petAlbum.petId, pet.id))
      .orderBy(desc(petAlbum.createdAt));
    return { items: rows.map((r) => this.albumDto(r)) };
  }

  async addAlbumPhoto(userId: string, petId: string, input: unknown) {
    const body = parseContract(z.object({ mediaId: Id }), input);
    const pet = await this.ownPet(this.db.db, userId, petId);
    if (!(await this.mediaSystem.canUse(userId, body.mediaId, ['pet_photo', 'chat_image'])))
      throw new AppError('bad_request', '图片不可用');
    return this.db.transaction(async (tx) => {
      const [row] = await tx.db
        .insert(petAlbum)
        .values({
          id: newId(),
          petId: pet.id,
          userId,
          mediaId: body.mediaId,
          source: 'user',
          messageId: null,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing()
        .returning();
      const saved =
        row ??
        (
          await tx.db
            .select()
            .from(petAlbum)
            .where(and(eq(petAlbum.petId, pet.id), eq(petAlbum.mediaId, body.mediaId)))
        )[0]!;
      await this.ctx.dataChanged(tx, userId, 'pets', pet.characterId, pet.id);
      return this.albumDto(saved);
    });
  }

  async deleteAlbumPhoto(userId: string, petId: string, photoId: string): Promise<void> {
    parseContract(Id, photoId);
    const pet = await this.ownPet(this.db.db, userId, petId);
    await this.db.transaction(async (tx) => {
      const r = await tx.db
        .delete(petAlbum)
        .where(and(eq(petAlbum.id, photoId), eq(petAlbum.petId, pet.id)))
        .returning({ id: petAlbum.id });
      if (!r.length) throw new AppError('not_found', '照片不存在');
      await this.ctx.dataChanged(tx, userId, 'pets', pet.characterId, pet.id);
    });
  }

  /**
   * 角色发来的宠物照片进相册（PLAY-02 第 5 条）。ai-runtime 发出宠物照片消息后调用（经 GROWTH_PET_ALBUM）。
   * 该角色没有在养的宠物时忽略。
   */
  async addCharacterPhoto(input: {
    userId: string;
    characterId: string;
    mediaId: string;
    messageId: string | null;
  }): Promise<void> {
    const [pet] = await this.db.db
      .select()
      .from(pets)
      .where(
        and(
          eq(pets.userId, input.userId),
          eq(pets.characterId, input.characterId),
          eq(pets.status, 'active'),
        ),
      );
    if (!pet) return;
    await this.db.transaction(async (tx) => {
      await tx.db
        .insert(petAlbum)
        .values({
          id: newId(),
          petId: pet.id,
          userId: input.userId,
          mediaId: input.mediaId,
          source: 'character',
          messageId: input.messageId,
          createdAt: this.clock.now(),
        })
        .onConflictDoNothing();
      await this.ctx.dataChanged(tx, input.userId, 'pets', pet.characterId, pet.id);
    });
  }

  // ---------- PetReadPort ----------

  async listPetsForCharacter(userId: string, characterId: string): Promise<PetForRuntime[]> {
    const rows = await this.db.db
      .select()
      .from(pets)
      .where(and(eq(pets.userId, userId), eq(pets.characterId, characterId)))
      .orderBy(asc(pets.status), desc(pets.createdAt));
    if (!rows.length) return [];
    const today = await this.ctx.localToday(userId);
    const out: PetForRuntime[] = [];
    for (const r of rows) {
      const a = await this.appearance(this.db.db, r.appearanceId);
      const [s] = await this.db.db.select().from(petSpecies).where(eq(petSpecies.id, r.speciesId));
      const [c] = await this.db.db
        .select({ n: count() })
        .from(petInteractions)
        .where(and(eq(petInteractions.petId, r.id), eq(petInteractions.localDate, today)));
      const daysAdopted = Math.max(1, daysKnownOn(r.adoptedOn, today));
      const stage = r.status === 'active' ? stageForDay(daysAdopted) : (r.stage as PetStage);
      out.push({
        petId: r.id,
        name: r.name,
        speciesName: s?.name ?? '',
        appearanceName: a.name,
        stage,
        daysAdopted,
        allowMomentsShare: r.allowMomentsShare,
        todayInteractionCount: Number(c?.n ?? 0),
        status: r.status === 'sent_away' ? 'sent_away' : 'active',
        presetImageMediaId: this.stageMedia(a, stage),
      });
    }
    return out;
  }

  // ---------- 成长阶段推进（每小时扫描 + 读取时） ----------

  private async timeline(
    tx: DbTx,
    petId: string,
    userId: string,
    kind: 'adopted' | 'stage_changed' | 'renamed' | 'sent_away',
    detail: Record<string, string>,
  ): Promise<void> {
    await tx.db
      .insert(petTimeline)
      .values({ id: newId(), petId, userId, kind, detail, at: this.clock.now() });
  }

  /** 按领养天数推进阶段（只升不降）；角色已删除（30 天内）时暂停，恢复后补上。 */
  async advanceStage(tx: DbTx, row: PetRow, today: string): Promise<void> {
    if (row.status !== 'active') return;
    const target = stageForDay(Math.max(1, daysKnownOn(row.adoptedOn, today)));
    const from = STAGES.indexOf(row.stage as PetStage);
    const to = STAGES.indexOf(target);
    if (to <= from) return;
    if (!(await this.ctx.contacts.getActiveContact(row.userId, row.characterId, tx))) return;
    await tx.query("SELECT pg_advisory_xact_lock(hashtextextended('growth:pet:' || $1, 0))", [
      row.id,
    ]);
    const updated = await tx.db
      .update(pets)
      .set({ stage: target, updatedAt: this.clock.now() })
      .where(and(eq(pets.id, row.id), eq(pets.stage, row.stage)))
      .returning({ id: pets.id });
    if (!updated.length) return;
    const a = await this.appearance(tx.db, row.appearanceId);
    for (let i = Math.max(from, 0) + 1; i <= to; i += 1) {
      const stage = STAGES[i]!;
      await this.timeline(tx, row.id, row.userId, 'stage_changed', { stage, name: row.name });
      await this.cards.issue(tx, {
        userId: row.userId,
        characterId: row.characterId,
        kind: 'pet',
        title: `${row.name}长成${STAGE_LABEL[stage]}啦`.slice(0, 30),
        line: `${row.name}又长大了一点，我们一起见证的。`.slice(0, 60),
        faceMediaId: this.stageMedia(a, stage),
        templateId: null,
        sourceMessageIds: [],
        idempotencyKey: `pet:${row.id}:stage:${stage}`,
        noticeParams: { petId: row.id, petName: row.name, stage },
        obtainedOn: today,
      });
      await this.outbox.publish(tx, 'growth.pet_stage_changed', 'growth', {
        userId: row.userId,
        characterId: row.characterId,
        petId: row.id,
        stage,
      });
    }
    await this.ctx.dataChanged(tx, row.userId, 'pets', row.characterId, row.id);
  }

  private async advanceForUser(userId: string, today: string): Promise<void> {
    const rows = await this.db.db
      .select()
      .from(pets)
      .where(and(eq(pets.userId, userId), eq(pets.status, 'active')));
    for (const row of rows) {
      if (stageForDay(Math.max(1, daysKnownOn(row.adoptedOn, today))) === row.stage) continue;
      await this.db.transaction((tx) => this.advanceStage(tx, row, today));
    }
  }

  /** 每小时扫描所有在养宠物（GrowthEvents 调用）。 */
  async sweepStages(): Promise<void> {
    const rows = await this.db.db.select().from(pets).where(eq(pets.status, 'active'));
    const tz = new Map<string, string | null>();
    for (const row of rows) {
      if (row.stage === 'adult') continue;
      if (!tz.has(row.userId)) tz.set(row.userId, await this.ctx.timeZone(row.userId));
      const zone = tz.get(row.userId);
      if (!zone) continue;
      const today = this.ctx.todayIn(zone);
      if (stageForDay(Math.max(1, daysKnownOn(row.adoptedOn, today))) === row.stage) continue;
      await this.db.transaction((tx) => this.advanceStage(tx, row, today)).catch(() => undefined);
    }
  }

  // ---------- 删除清单 ----------

  private async petIds(runner: Runner, userId: string, characterId?: string) {
    const rows = await runner
      .select({ id: pets.id })
      .from(pets)
      .where(
        and(eq(pets.userId, userId), characterId ? eq(pets.characterId, characterId) : undefined),
      );
    return rows.map((r) => r.id);
  }

  /** 彻底删除角色：该角色的宠物、互动、成长记录、相册（用户上传的照片文件一并删除）。 */
  async purgeCharacter(tx: DbTx, userId: string, characterId: string): Promise<number> {
    const ids = await this.petIds(tx.db, userId, characterId);
    let n = 0;
    if (ids.length) {
      const uploads = await tx.db
        .select({ mediaId: petAlbum.mediaId })
        .from(petAlbum)
        .where(and(inArray(petAlbum.petId, ids), eq(petAlbum.source, 'user')));
      for (const t of [petInteractions, petTimeline, petAlbum] as const) {
        const r = await tx.db.delete(t).where(inArray(t.petId, ids));
        n += r.rowCount ?? 0;
      }
      const r = await tx.db.delete(pets).where(inArray(pets.id, ids));
      n += r.rowCount ?? 0;
      for (const u of uploads)
        await this.mediaSystem.deleteObject(u.mediaId, tx).catch(() => undefined);
    }
    const r = await tx.db
      .delete(petNamingRequests)
      .where(
        and(eq(petNamingRequests.userId, userId), eq(petNamingRequests.characterId, characterId)),
      );
    return n + (r.rowCount ?? 0);
  }

  async purgeUser(tx: DbTx, userId: string): Promise<number> {
    let n = 0;
    for (const t of [petInteractions, petTimeline, petAlbum, pets, petNamingRequests] as const) {
      const r = await tx.db.delete(t).where(eq(t.userId, userId));
      n += r.rowCount ?? 0;
    }
    return n;
  }

  async countUserData(userId: string): Promise<number> {
    let n = 0;
    for (const t of [petInteractions, petTimeline, petAlbum, pets, petNamingRequests] as const) {
      const [r] = await this.db.db.select({ n: count() }).from(t).where(eq(t.userId, userId));
      n += Number(r?.n ?? 0);
    }
    return n;
  }
}
