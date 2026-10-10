/**
 * 作品链接库（MED-05 第 2、3 条）与预设角色默认音色（MED-03 第 1 条），T-069。
 * 契约：http/character-extras.ts WorkLinkAdminEndpoints（含 setDefaultVoice）；
 * 端口：CharacterWorkLinkReadPort、CharacterVoiceReadPort（ports/characters.ts）。
 * 可访问性检查用 media 的 LinkPreviewPort：保存后立即检查一次，之后每天检查一次；失败的链接角色不再分享。
 */
import { Inject, Injectable, type OnModuleInit } from '@nestjs/common';
import { and, asc, eq, isNull } from 'drizzle-orm';
import {
  WorkLinkWrite,
  type CharacterVoiceReadPort,
  type CharacterWorkLinkReadPort,
  type LinkPreviewPort,
  type MediaAssetReadPort,
  type WorkLink,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  DATABASE,
  JOB_QUEUE,
  AppError,
  newId,
  parseContract,
  type AuditLog,
  type Clock,
  type Database,
  type JobQueue,
} from '../../../platform/index.js';
import { LINK_PREVIEW_PORT, MEDIA_ASSET_READ_PORT } from '../../media/index.js';
import { characters, defaultVoices, workLinks } from '../infra/db/schema.js';

type Row = typeof workLinks.$inferSelect;

const dto = (row: Row): WorkLink => ({
  workLinkId: row.id,
  characterId: row.characterId,
  title: row.title,
  url: row.url,
  source: row.source,
  appHint: row.appHint as WorkLink['appHint'],
  coverMediaId: row.coverMediaId,
  lastCheck:
    row.checkOk === null || !row.checkedAt
      ? null
      : { ok: row.checkOk, checkedAt: row.checkedAt.toISOString() },
  enabled: row.enabled,
  updatedAt: row.updatedAt.toISOString(),
});

@Injectable()
export class CharacterWorkLinkService
  implements CharacterWorkLinkReadPort, CharacterVoiceReadPort, OnModuleInit
{
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
    @Inject(JOB_QUEUE) private readonly jobs: JobQueue,
    @Inject(LINK_PREVIEW_PORT) private readonly links: LinkPreviewPort,
    @Inject(MEDIA_ASSET_READ_PORT) private readonly assets: MediaAssetReadPort,
  ) {}

  async onModuleInit(): Promise<void> {
    await this.jobs.work('characters.work_links_check', () => this.checkAll());
    await this.jobs.schedule('characters.work_links_check', '40 4 * * *');
  }

  private async assertPreset(characterId: string): Promise<void> {
    const [row] = await this.database.db
      .select({ id: characters.id })
      .from(characters)
      .where(and(eq(characters.id, characterId), isNull(characters.ownerId)));
    if (!row) throw new AppError('not_found', '预设角色不存在');
  }

  // ---------- 管理端 ----------

  async adminList(characterId: string): Promise<{ items: WorkLink[] }> {
    await this.assertPreset(characterId);
    const rows = await this.database.db
      .select()
      .from(workLinks)
      .where(eq(workLinks.characterId, characterId))
      .orderBy(asc(workLinks.createdAt));
    return { items: rows.map(dto) };
  }

  async adminCreate(adminId: string, characterId: string, input: unknown): Promise<WorkLink> {
    const body = parseContract(WorkLinkWrite, input);
    await this.assertPreset(characterId);
    const id = newId();
    const at = this.clock.now();
    await this.database.transaction(async (tx) => {
      await tx.db.insert(workLinks).values({
        id,
        characterId,
        title: body.title,
        url: body.url,
        source: body.source,
        appHint: body.appHint,
        coverMediaId: body.coverMediaId,
        checkOk: null,
        checkedAt: null,
        enabled: body.enabled,
        createdAt: at,
        updatedAt: at,
      });
      await this.audit.record(
        {
          module: 'characters',
          action: 'work_link.created',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: characterId,
          details: { workLinkId: id },
        },
        tx,
      );
    });
    return this.checkOne(id);
  }

  async adminUpdate(
    adminId: string,
    characterId: string,
    workLinkId: string,
    input: unknown,
  ): Promise<WorkLink> {
    const body = parseContract(WorkLinkWrite.partial(), input);
    const urlChanged = await this.database.transaction(async (tx) => {
      const [current] = await tx.db
        .select()
        .from(workLinks)
        .where(and(eq(workLinks.id, workLinkId), eq(workLinks.characterId, characterId)));
      if (!current) throw new AppError('not_found', '作品链接不存在');
      const changed = body.url !== undefined && body.url !== current.url;
      await tx.db
        .update(workLinks)
        .set({
          ...(body.title !== undefined ? { title: body.title } : {}),
          ...(body.url !== undefined ? { url: body.url } : {}),
          ...(body.source !== undefined ? { source: body.source } : {}),
          ...(body.appHint !== undefined ? { appHint: body.appHint } : {}),
          ...(body.coverMediaId !== undefined ? { coverMediaId: body.coverMediaId } : {}),
          ...(body.enabled !== undefined ? { enabled: body.enabled } : {}),
          ...(changed ? { checkOk: null, checkedAt: null } : {}),
          updatedAt: this.clock.now(),
        })
        .where(eq(workLinks.id, workLinkId));
      await this.audit.record(
        {
          module: 'characters',
          action: 'work_link.updated',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: characterId,
          details: { workLinkId, fields: Object.keys(body) },
        },
        tx,
      );
      return changed;
    });
    if (urlChanged) return this.checkOne(workLinkId);
    const [row] = await this.database.db
      .select()
      .from(workLinks)
      .where(eq(workLinks.id, workLinkId));
    return dto(row!);
  }

  async adminDelete(adminId: string, characterId: string, workLinkId: string): Promise<void> {
    await this.database.transaction(async (tx) => {
      const [row] = await tx.db
        .delete(workLinks)
        .where(and(eq(workLinks.id, workLinkId), eq(workLinks.characterId, characterId)))
        .returning();
      if (!row) throw new AppError('not_found', '作品链接不存在');
      await this.audit.record(
        {
          module: 'characters',
          action: 'work_link.deleted',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: characterId,
          details: { workLinkId },
        },
        tx,
      );
    });
  }

  async setDefaultVoice(
    adminId: string,
    characterId: string,
    voiceId: string | null,
  ): Promise<{ characterId: string; voiceId: string | null }> {
    await this.assertPreset(characterId);
    if (voiceId) {
      const voice = await this.assets.getVoice(voiceId);
      if (!voice) throw new AppError('bad_request', '音色不存在');
    }
    await this.database.transaction(async (tx) => {
      if (voiceId)
        await tx.db
          .insert(defaultVoices)
          .values({ characterId, voiceId, updatedAt: this.clock.now() })
          .onConflictDoUpdate({
            target: defaultVoices.characterId,
            set: { voiceId, updatedAt: this.clock.now() },
          });
      else await tx.db.delete(defaultVoices).where(eq(defaultVoices.characterId, characterId));
      await this.audit.record(
        {
          module: 'characters',
          action: 'default_voice.set',
          actorType: 'admin',
          actorId: adminId,
          targetType: 'character',
          targetId: characterId,
          details: { voiceId },
        },
        tx,
      );
    });
    return { characterId, voiceId };
  }

  /** 3.1 getDefaultVoice：后台下拉框显示当前默认音色；音色已停用或未设置时 voiceName = null。 */
  async getDefaultVoice(
    characterId: string,
  ): Promise<{ characterId: string; voiceId: string | null; voiceName: string | null }> {
    await this.assertPreset(characterId);
    const [row] = await this.database.db
      .select({ voiceId: defaultVoices.voiceId })
      .from(defaultVoices)
      .where(eq(defaultVoices.characterId, characterId));
    if (!row) return { characterId, voiceId: null, voiceName: null };
    const voice = await this.assets.getVoice(row.voiceId).catch(() => null);
    return {
      characterId,
      voiceId: row.voiceId,
      voiceName: voice && voice.enabled ? voice.name : null,
    };
  }

  // ---------- 可访问性检查 ----------

  private async checkOne(workLinkId: string): Promise<WorkLink> {
    const [row] = await this.database.db
      .select()
      .from(workLinks)
      .where(eq(workLinks.id, workLinkId));
    if (!row) throw new AppError('not_found', '作品链接不存在');
    let ok: boolean;
    try {
      ok = (await this.links.preview(row.url)).reachable;
    } catch {
      ok = false;
    }
    const [updated] = await this.database.db
      .update(workLinks)
      .set({ checkOk: ok, checkedAt: this.clock.now() })
      .where(eq(workLinks.id, workLinkId))
      .returning();
    return dto(updated ?? row);
  }

  /** 每天检查一次全部启用的链接。 */
  async checkAll(): Promise<void> {
    const rows = await this.database.db
      .select({ id: workLinks.id })
      .from(workLinks)
      .where(eq(workLinks.enabled, true));
    for (const row of rows) {
      try {
        await this.checkOne(row.id);
      } catch {
        // 单条失败不影响其他链接。
      }
    }
  }

  // ---------- 端口 ----------

  async listUsableWorkLinks(characterId: string): Promise<
    Array<{
      workLinkId: string;
      title: string;
      url: string;
      source: string | null;
      appHint: 'music' | 'video' | 'web';
      coverMediaId: string | null;
    }>
  > {
    const rows = await this.database.db
      .select()
      .from(workLinks)
      .where(
        and(
          eq(workLinks.characterId, characterId),
          eq(workLinks.enabled, true),
          eq(workLinks.checkOk, true),
        ),
      )
      .orderBy(asc(workLinks.createdAt));
    return rows.map((r) => ({
      workLinkId: r.id,
      title: r.title,
      url: r.url,
      source: r.source,
      appHint: (['music', 'video', 'web'].includes(r.appHint) ? r.appHint : 'web') as
        'music' | 'video' | 'web',
      coverMediaId: r.coverMediaId,
    }));
  }

  async recordLinkCheck(workLinkId: string, ok: boolean): Promise<void> {
    await this.database.db
      .update(workLinks)
      .set({ checkOk: ok, checkedAt: this.clock.now() })
      .where(eq(workLinks.id, workLinkId));
  }

  async getDefaultVoiceId(characterId: string): Promise<string | null> {
    const [row] = await this.database.db
      .select()
      .from(defaultVoices)
      .where(eq(defaultVoices.characterId, characterId));
    return row?.voiceId ?? null;
  }

  /** 给 media 的音色名称检查（MEDIA_REAL_PERSON_NAMES，由装配入口绑定）：已录入的真人预设角色姓名。 */
  async listRealPersonNames(): Promise<string[]> {
    const rows = await this.database.db
      .select({ name: characters.name })
      .from(characters)
      .where(and(eq(characters.basis, 'real_person'), isNull(characters.ownerId)));
    return rows.map((r) => r.name);
  }
}
