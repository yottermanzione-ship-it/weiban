import { Inject, Injectable, Optional, type OnModuleInit } from '@nestjs/common';
import { and, count, eq, gt, ilike, inArray, sql, type SQL } from 'drizzle-orm';
import {
  CharacterCard,
  CharacterSummary,
  AdminCharacterWrite,
  Id,
  type AdminCharacter,
  type AdminCharacterUpdate,
  type CharacterReadPort,
  type Tx,
  type CharacterForRuntime,
  type CharacterClassification,
  type CharacterProfile,
  type MediaReadPort,
  type UserDataOwner,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  ENVELOPE_CRYPTO,
  JOB_QUEUE,
  OUTBOX,
  PLATFORM_KEY_OWNER,
  USER_DATA_REGISTRY,
  AppError,
  asDbTx,
  newId,
  type AuditLog,
  type Clock,
  type Database,
  type EnvelopeCrypto,
  type JobQueue,
  type Outbox,
  type UserDataRegistry,
  type DbTx,
} from '../../../platform/index.js';
import { MEDIA_READ_PORT } from '../../media/index.js';
import { deriveClassification, classificationCanChange } from '../../policy/index.js';
import { childFeaturesIn } from '../domain/child-features.js';
import { categories, characters, personaVersions } from '../infra/db/schema.js';
import { CHARACTER_CONTACT_ACCESS, type CharacterContactAccess } from '../tokens.js';
import type { CharacterEvaluator } from './evaluator.js';
type Row = typeof characters.$inferSelect;
const initialCategories = [
  ['celebrity', '明星'],
  ['fictional', '虚构角色'],
  ['historical', '历史人物'],
  ['original', '原创'],
];
@Injectable()
export class CharacterService implements OnModuleInit, CharacterReadPort, UserDataOwner {
  readonly module = 'characters';
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(ENVELOPE_CRYPTO) private readonly crypto: EnvelopeCrypto,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(USER_DATA_REGISTRY) private readonly registry: UserDataRegistry,
    @Inject(MEDIA_READ_PORT) private readonly media: MediaReadPort,
    @Optional()
    @Inject(CHARACTER_CONTACT_ACCESS)
    private readonly contacts: CharacterContactAccess | null,
  ) {}
  async onModuleInit(): Promise<void> {
    this.registry.register(this);
    await this.database.db
      .insert(categories)
      .values(initialCategories.map(([id, name], order) => ({ id: id!, name: name!, order })))
      .onConflictDoNothing();
  }
  listCategories() {
    return this.database.db
      .select({ categoryId: categories.id, name: categories.name, order: categories.order })
      .from(categories)
      .orderBy(categories.order, categories.id);
  }
  private classify(row: Row): CharacterClassification {
    return deriveClassification(
      {
        basis: row.basis as 'real_person' | 'fictional' | 'original',
        realPersonKind: row.realPersonKind as 'celebrity' | 'historical' | 'private_person' | null,
        ageSetting: row.ageSetting as 'minor' | 'adult',
        childAppearance: row.childAppearance,
      },
      row.kind as 'preset' | 'custom',
      row.childFeaturesDetected ||
        (!!row.publishedCiphertext && row.publishedChildFeaturesDetected),
    );
  }
  private async decode(row: Row, published = false, tx?: DbTx): Promise<AdminCharacterWrite> {
    const cipher = published ? row.publishedCiphertext : row.draftCiphertext;
    if (!cipher) throw new AppError('character_not_available', '角色尚未上架');
    const aad = published
      ? `character:${row.id}:published:${row.personaVersion}`
      : `character:${row.id}:draft:${row.revision}`;
    const plain = await this.crypto.open(row.ownerId ?? PLATFORM_KEY_OWNER, aad, cipher, tx);
    try {
      return AdminCharacterWrite.parse(JSON.parse(plain.toString('utf8')));
    } finally {
      plain.fill(0);
    }
  }
  private async row(id: string): Promise<Row> {
    const [row] = await this.database.db.select().from(characters).where(eq(characters.id, id));
    if (!row) throw new AppError('not_found', '找不到角色');
    return row;
  }
  private async avatar(userId: string, body: AdminCharacterWrite) {
    const id = body.avatar.imageMediaId;
    if (!id) return { image: null, display: body.avatar.display };
    const media = await this.media.getMedia(userId, id);
    if (media.purpose !== 'character_avatar')
      throw new AppError('bad_request', '预设角色必须使用管理员预设头像');
    return { image: { mediaId: id, url: media.url }, display: body.avatar.display };
  }
  private async validateAvatar(adminId: string, body: AdminCharacterWrite): Promise<void> {
    if (body.avatar.imageMediaId) await this.avatar(adminId, body);
    if (
      body.categoryId &&
      !(
        await this.database.db.select().from(categories).where(eq(categories.id, body.categoryId))
      )[0]
    )
      throw new AppError('bad_request', '分类不存在');
    const classified = deriveClassification(
      body.classification,
      'preset',
      childFeaturesIn(this.detectText(body)),
    );
    if (classified.derived.isMinor && body.avatar.display.avatarPattern === 'heart')
      throw new AppError('bad_request', '儿童角色不能使用爱心图案', { status: 422 });
  }
  private detectText(body: AdminCharacterWrite): string {
    const card = body.card.data;
    return JSON.stringify({
      persona: card.persona,
      speech: card.speech,
      examples: card.examples,
      age: card.profileExtra?.ageDisplay,
      intro: body.intro,
      fallbackGreetings: body.fallbackGreetings,
    });
  }
  private checks(body: AdminCharacterWrite, revision: number) {
    const card = CharacterCard.safeParse(body.card);
    let complete = card.success;
    if (card.success && body.classification.basis === 'real_person') {
      complete =
        !!card.data.data.safetyStyle.deflectStyle &&
        !!card.data.data.safetyStyle.refuseSelfieStyle &&
        (card.data.data.admin.sourceList?.length ?? 0) > 0 &&
        card.data.data.examples.some((e) => e.scene === 'deflectRumor') &&
        card.data.data.knowledge.entries.every((e) => (e.sources?.length ?? 0) > 0);
    }
    if (card.success && body.classification.basis === 'fictional')
      complete &&= !!card.data.data.profileExtra.workSource;
    return {
      revision,
      requiredFieldsComplete: complete,
      hasFallbackGreeting: body.fallbackGreetings.length > 0,
      personaStabilityPassed: false,
      hardBoundaryCasesPassed: false,
      checked: false,
    };
  }
  async create(adminId: string, body: AdminCharacterWrite): Promise<AdminCharacter> {
    await this.validateAvatar(adminId, body);
    const id = newId();
    const now = this.clock.now();
    const sealed = await this.crypto.seal(
      PLATFORM_KEY_OWNER,
      `character:${id}:draft:1`,
      JSON.stringify(body),
    );
    await this.database.transaction(async (tx) => {
      await tx.db.insert(characters).values({
        id,
        kind: 'preset',
        ownerId: null,
        status: 'draft',
        name: body.name,
        searchText: [
          body.name,
          ...body.aliases,
          ...body.works,
          ...(body.card.data.profileExtra?.searchKeywords ?? []),
        ].join('\n'),
        categoryId: body.categoryId,
        ...body.classification,
        childFeaturesDetected: true,
        everPrivatePerson: body.classification.realPersonKind === 'private_person',
        draftCiphertext: sealed,
        checks: this.checks(body, 1),
        createdAt: now,
        updatedAt: now,
      });
      await this.audit.record(
        {
          module: 'characters',
          action: 'preset.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: id,
        },
        tx,
      );
    });
    return this.admin(adminId, await this.row(id));
  }
  async update(adminId: string, id: string, patch: AdminCharacterUpdate): Promise<AdminCharacter> {
    const current = await this.row(id);
    const before = await this.decode(current);
    const body = AdminCharacterWrite.parse({ ...before, ...patch });
    if (
      !classificationCanChange(
        before.classification,
        body.classification,
        current.kind as 'preset' | 'custom',
      )
    )
      throw new AppError('classification_change_forbidden', '分类不能向更宽松方向修改');
    await this.validateAvatar(adminId, body);
    const revision = current.revision + 1;
    const sealed = await this.crypto.seal(
      current.ownerId ?? PLATFORM_KEY_OWNER,
      `character:${id}:draft:${revision}`,
      JSON.stringify(body),
    );
    const requiresCheck =
      patch.card !== undefined ||
      patch.classification !== undefined ||
      patch.fallbackGreetings !== undefined ||
      patch.intro !== undefined;
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .update(characters)
        .set({
          name: body.name,
          searchText: [
            body.name,
            ...body.aliases,
            ...body.works,
            ...(body.card.data.profileExtra?.searchKeywords ?? []),
          ].join('\n'),
          categoryId: body.categoryId,
          ...body.classification,
          draftCiphertext: sealed,
          revision,
          checks: requiresCheck ? this.checks(body, revision) : { ...current.checks, revision },
          childFeaturesDetected: requiresCheck ? true : current.childFeaturesDetected,
          everPrivatePerson:
            current.everPrivatePerson || body.classification.realPersonKind === 'private_person',
          updatedAt: this.clock.now(),
          status: current.status === 'pending_check' ? 'draft' : current.status,
        })
        .where(and(eq(characters.id, id), eq(characters.revision, current.revision)))
        .returning();
      if (!row) throw new AppError('conflict', '角色已被修改，请刷新后重试');
      if (patch.classification !== undefined || requiresCheck)
        await this.classificationEvent(tx, row);
      await this.audit.record(
        {
          module: 'characters',
          action: 'preset.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: id,
          details: { revision },
        },
        tx,
      );
    });
    return this.admin(adminId, await this.row(id));
  }
  private async classificationEvent(tx: DbTx, row: Row): Promise<void> {
    const c = this.classify(row);
    await this.outbox.publish(tx, 'characters.character_classification_changed', 'characters', {
      characterId: row.id,
      ownerUserId: row.ownerId,
      basis: c.basis,
      realPersonKind: c.realPersonKind,
      isMinor: c.derived.isMinor,
      adultModeEligible: c.derived.adultModeEligible,
      romanceAllowed: c.derived.romanceAllowed,
      portraitPolicy:
        c.derived.portraitPolicy === 'unsupported' ? 'forbidden' : c.derived.portraitPolicy,
      publicStatementGuard: c.derived.publicStatementGuard,
    });
  }
  async runChecks(
    input: {
      characterId: string;
      adminId: string;
      revision: number;
    },
    evaluator: CharacterEvaluator,
  ): Promise<void> {
    const row = await this.row(input.characterId);
    if (row.revision !== input.revision) return;
    if (row.checks.checked) return;
    const body = await this.decode(row);
    const checks = this.checks(body, row.revision);
    if (!checks.requiredFieldsComplete || !checks.hasFallbackGreeting) return;
    let grade: Awaited<ReturnType<CharacterEvaluator['evaluate']>> | null = null;
    try {
      grade = await evaluator.evaluate(input.adminId, body);
    } catch {
      /* 不确定保持失败，不把基础设施故障记为通过。 */
    }
    await this.database.transaction(async (tx) => {
      const [updated] = await tx.db
        .update(characters)
        .set({
          checks: {
            ...checks,
            checked: grade !== null,
            personaStabilityPassed: grade?.personaStabilityPassed ?? false,
            hardBoundaryCasesPassed: grade?.hardBoundaryCasesPassed ?? false,
            ...(grade ? {} : { error: 'evaluation_unavailable' }),
          },
          childFeaturesDetected:
            childFeaturesIn(this.detectText(body)) || grade?.childFeaturesDetected !== false,
          status: sql`CASE WHEN ${characters.status} = 'pending_check' THEN 'draft' ELSE ${characters.status} END`,
          updatedAt: this.clock.now(),
        })
        .where(
          and(
            eq(characters.id, row.id),
            eq(characters.revision, row.revision),
            sql`(${characters.checks}->>'checked')::boolean = false`,
          ),
        )
        .returning();
      if (updated) {
        await this.classificationEvent(tx, updated);
        await this.audit.record(
          {
            module: 'characters',
            action: 'publish.checked',
            actorType: 'admin',
            actorId: input.adminId,
            targetType: 'character',
            targetId: row.id,
            details: {
              revision: row.revision,
              available: grade !== null,
              personaStabilityPassed: grade?.personaStabilityPassed ?? false,
              hardBoundaryCasesPassed: grade?.hardBoundaryCasesPassed ?? false,
            },
          },
          tx,
        );
      }
    });
  }
  async publish(adminId: string, id: string): Promise<AdminCharacter> {
    const row = await this.row(id);
    const body = await this.decode(row);
    const structural = this.checks(body, row.revision);
    if (!structural.requiredFieldsComplete || !structural.hasFallbackGreeting)
      throw new AppError('bad_request', '角色卡或备用开场白未补齐', { status: 422 });
    if (this.classify(row).derived.isMinor && body.avatar.display.avatarPattern === 'heart')
      throw new AppError('bad_request', '儿童角色不能使用爱心图案', { status: 422 });
    if (
      !row.checks.checked ||
      row.checks.revision !== row.revision ||
      !row.checks.personaStabilityPassed ||
      !row.checks.hardBoundaryCasesPassed
    ) {
      if (!row.checks.checked) {
        await this.database.transaction(async (tx) => {
          await this.jobs.send(
            'characters.check_publish',
            { characterId: id, adminId, revision: row.revision },
            { tx, singletonKey: `${id}:${row.revision}` },
          );
          if (row.status === 'draft')
            await tx.db
              .update(characters)
              .set({ status: 'pending_check' })
              .where(and(eq(characters.id, id), eq(characters.revision, row.revision)));
        });
      }
      throw new AppError('bad_request', '人设稳定与硬性边界检查尚未通过', {
        status: 422,
        details: { checking: !row.checks.checked },
      });
    }
    const version = row.publishedCiphertext ? row.personaVersion + 1 : 1;
    const sealed = await this.crypto.seal(
      row.ownerId ?? PLATFORM_KEY_OWNER,
      `character:${id}:published:${version}`,
      JSON.stringify(body),
    );
    await this.database.transaction(async (tx) => {
      const [locked] = await tx.db
        .select()
        .from(characters)
        .where(eq(characters.id, id))
        .for('update');
      if (locked?.publishedRevision === row.revision && locked.status === 'published') return;
      const [updated] = await tx.db
        .update(characters)
        .set({
          publishedRevision: row.revision,
          status: 'published',
          personaVersion: version,
          publishedCiphertext: sealed,
          publishedChildFeaturesDetected: row.childFeaturesDetected,
          updatedAt: this.clock.now(),
        })
        .where(and(eq(characters.id, id), eq(characters.revision, row.revision)))
        .returning();
      if (!updated) throw new AppError('conflict', '角色已修改，请重新检查');
      await tx.db
        .insert(personaVersions)
        .values({ characterId: id, version, ciphertext: sealed, publishedAt: this.clock.now() });
      await this.outbox.publish(tx, 'characters.character_published', 'characters', {
        characterId: id,
      });
      await this.outbox.publish(tx, 'characters.persona_version_published', 'characters', {
        characterId: id,
        personaVersion: version,
      });
      await this.classificationEvent(tx, updated);
      await this.audit.record(
        {
          module: 'characters',
          action: 'preset.published',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: id,
          details: { version },
        },
        tx,
      );
    });
    return this.admin(adminId, await this.row(id));
  }
  async unpublish(adminId: string, id: string): Promise<AdminCharacter> {
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .update(characters)
        .set({ status: 'unpublished', updatedAt: this.clock.now() })
        .where(eq(characters.id, id))
        .returning();
      if (!row) throw new AppError('not_found', '找不到角色');
      await this.outbox.publish(tx, 'characters.character_unpublished', 'characters', {
        characterId: id,
      });
      await this.audit.record(
        {
          module: 'characters',
          action: 'preset.unpublished',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: id,
        },
        tx,
      );
    });
    return this.admin(adminId, await this.row(id));
  }
  async adminList(
    adminId: string,
    query: { status?: string; q?: string },
  ): Promise<AdminCharacter[]> {
    const filters: SQL[] = [eq(characters.kind, 'preset')];
    if (query.status) filters.push(eq(characters.status, query.status));
    if (query.q)
      filters.push(ilike(characters.searchText, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`));
    const rows = await this.database.db
      .select()
      .from(characters)
      .where(and(...filters))
      .orderBy(characters.id)
      .limit(2000);
    return Promise.all(rows.map((r) => this.admin(adminId, r)));
  }
  private async admin(userId: string, row: Row): Promise<AdminCharacter> {
    const body = await this.decode(row);
    return {
      ...body,
      characterId: row.id,
      status: row.status as AdminCharacter['status'],
      avatar: await this.avatar(userId, body),
      classification: this.classify(row),
      personaVersion: row.personaVersion,
      publishChecks: {
        requiredFieldsComplete: row.checks.requiredFieldsComplete,
        hasFallbackGreeting: row.checks.hasFallbackGreeting,
        personaStabilityPassed: row.checks.personaStabilityPassed,
        hardBoundaryCasesPassed: row.checks.hardBoundaryCasesPassed,
      },
      updatedAt: row.updatedAt.toISOString(),
    };
  }
  async search(
    userId: string,
    query: { q?: string; categoryId?: string; cursor?: string; limit: number },
  ) {
    const filters: SQL[] = [eq(characters.kind, 'preset'), eq(characters.status, 'published')];
    if (query.categoryId) filters.push(eq(characters.categoryId, query.categoryId));
    if (query.q)
      filters.push(ilike(characters.searchText, `%${query.q.replace(/[\\%_]/g, '\\$&')}%`));
    if (query.cursor) {
      let id: string;
      try {
        id = Id.parse(JSON.parse(Buffer.from(query.cursor, 'base64url').toString('utf8')).id);
      } catch {
        throw new AppError('bad_request', '游标无效');
      }
      filters.push(gt(characters.id, id));
    }
    const rows = await this.database.db
      .select()
      .from(characters)
      .where(and(...filters))
      .orderBy(characters.id)
      .limit(query.limit + 1);
    const page = rows.slice(0, query.limit);
    return {
      items: await Promise.all(
        page.map(async (r) => CharacterSummary.parse(await this.profile(userId, r))),
      ),
      nextCursor:
        rows.length > query.limit && page.at(-1)
          ? Buffer.from(JSON.stringify({ id: page.at(-1)!.id })).toString('base64url')
          : null,
    };
  }
  private async visible(userId: string, row: Row): Promise<boolean> {
    return row.kind === 'custom'
      ? row.ownerId === userId
      : row.status === 'published' ||
          (row.status === 'unpublished' &&
            ((await this.contacts?.hasContact(userId, row.id)) ?? false));
  }
  private async profile(userId: string, row: Row): Promise<CharacterProfile> {
    const body = await this.decode(row, row.kind === 'preset');
    const c = this.classify(row);
    return {
      characterId: row.id,
      kind: row.kind as 'preset' | 'custom',
      name: body.name,
      aliases: body.aliases,
      works: body.works,
      avatar: await this.avatar(userId, {
        ...body,
        avatar: {
          ...body.avatar,
          display: {
            ...body.avatar.display,
            avatarPattern:
              c.derived.isMinor && body.avatar.display.avatarPattern === 'heart'
                ? 'star'
                : body.avatar.display.avatarPattern,
          },
        },
      }),
      tagline: body.tagline,
      tags: body.tags,
      categoryId: body.categoryId,
      basis: c.basis,
      added: (await this.contacts?.hasContact(userId, row.id)) ?? false,
      intro: body.intro,
      birthday: body.birthday,
      fanName: body.fanName,
      classification: c,
      showPublicSourceNotice: c.basis === 'real_person',
      personaVersion: row.personaVersion,
      personaUpdatedUnseen: false,
    };
  }
  async getProfile(userId: string, id: string): Promise<CharacterProfile> {
    const row = await this.row(id);
    if (!(await this.visible(userId, row))) throw new AppError('not_found', '找不到角色');
    return this.profile(userId, row);
  }
  async getForRuntime(userId: string, id: string): Promise<CharacterForRuntime | null> {
    const [row] = await this.database.db.select().from(characters).where(eq(characters.id, id));
    if (!row || !(await this.visible(userId, row))) return null;
    const body = await this.decode(row, row.kind === 'preset');
    const card = CharacterCard.safeParse(body.card);
    if (!card.success) return null;
    return {
      profile: await this.profile(userId, row),
      classification: this.classify(row),
      card: card.data,
      personaVersion: row.personaVersion,
      fallbackGreetings: body.fallbackGreetings,
      userSupplement: null,
    };
  }
  async canAdd(userId: string, id: string, transaction?: Tx): Promise<boolean> {
    const db = transaction ? asDbTx(transaction).db : this.database.db;
    const query = db.select().from(characters).where(eq(characters.id, id));
    const [row] = await (transaction ? query.for('share') : query);
    return !!row && row.status === 'published' && (row.kind === 'preset' || row.ownerId === userId);
  }
  async getClassification(id: string, transaction?: Tx): Promise<CharacterClassification | null> {
    const db = transaction ? asDbTx(transaction).db : this.database.db;
    const query = db.select().from(characters).where(eq(characters.id, id));
    const [row] = await (transaction ? query.for('share') : query);
    return row ? this.classify(row) : null;
  }
  async getProfiles(userId: string, ids: string[]): Promise<CharacterProfile[]> {
    if (ids.length > 500) throw new AppError('bad_request', '最多查询500个角色');
    if (!ids.length) return [];
    const rows = await this.database.db
      .select()
      .from(characters)
      .where(inArray(characters.id, ids));
    const profiles = [];
    for (const row of rows)
      if (await this.visible(userId, row)) profiles.push(await this.profile(userId, row));
    return profiles;
  }
  async getDisplayName(userId: string, id: string, input?: Tx): Promise<string | null> {
    Id.parse(userId);
    Id.parse(id);
    const tx = input ? asDbTx(input) : undefined;
    const [row] = await (tx?.db ?? this.database.db)
      .select()
      .from(characters)
      .where(eq(characters.id, id));
    if (
      !row ||
      (row.kind === 'custom'
        ? row.ownerId !== userId
        : !['published', 'unpublished'].includes(row.status))
    )
      return null;
    return (await this.decode(row, row.kind === 'preset', tx)).name;
  }
  async purgeUser(userId: string): Promise<number> {
    const removed = await this.database.db
      .delete(characters)
      .where(eq(characters.ownerId, userId))
      .returning({ id: characters.id });
    return removed.length;
  }
  async countUserData(userId: string): Promise<number> {
    const [row] = await this.database.db
      .select({ n: count() })
      .from(characters)
      .where(eq(characters.ownerId, userId));
    return row?.n ?? 0;
  }
}
