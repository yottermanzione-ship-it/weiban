/**
 * 情景模式管理（ADM-05 第 8 条，MODE-04）。
 * 内置模式（is_builtin = true）不能删除，也不能改适用范围与内容标记；
 * 修改已有模式的 presetPrompt 需通过人设稳定检查（CHAT-14，由前端 / 后续任务协调，这里只做审计）。
 */
import { Inject, Injectable } from '@nestjs/common';
import { asc, eq } from 'drizzle-orm';
import type {
  AdminScenarioMode,
  AdminScenarioModeCreate,
  AdminScenarioModeUpdate,
} from '@weiban/contracts';
import {
  AUDIT_LOG,
  CLOCK,
  AppError,
  DATABASE,
  type AuditLog,
  type Clock,
  type Database,
} from '../../../platform/index.js';
import { scenarioModes } from '../infra/db/schema.js';

type Row = typeof scenarioModes.$inferSelect;
type CreateInput = AdminScenarioModeCreate;
type UpdateInput = AdminScenarioModeUpdate;

function toDto(r: Row): AdminScenarioMode {
  return {
    id: r.id,
    name: r.name,
    description: r.description,
    presetPrompt: r.presetPrompt,
    appliesTo: r.appliesTo as AdminScenarioMode['appliesTo'],
    hasRomanceContent: r.hasRomanceContent,
    hasAdultContent: r.hasAdultContent,
    isBuiltin: r.isBuiltin,
    enabled: r.enabled,
    sortOrder: r.sortOrder,
    updatedAt: r.updatedAt.toISOString(),
  };
}

@Injectable()
export class ScenarioModeService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(AUDIT_LOG) private readonly audit: AuditLog,
  ) {}

  async list(): Promise<AdminScenarioMode[]> {
    const rows = await this.database.db
      .select()
      .from(scenarioModes)
      .orderBy(asc(scenarioModes.sortOrder), asc(scenarioModes.id));
    return rows.map(toDto);
  }

  async create(adminId: string, input: CreateInput): Promise<AdminScenarioMode> {
    const [existing] = await this.database.db
      .select()
      .from(scenarioModes)
      .where(eq(scenarioModes.id, input.id));
    if (existing) throw new AppError('conflict', '已存在同 id 的情景模式');

    const now = this.clock.now();
    const [row] = await this.database.db
      .insert(scenarioModes)
      .values({
        id: input.id,
        name: input.name,
        description: input.description,
        presetPrompt: input.presetPrompt,
        appliesTo: input.appliesTo,
        hasRomanceContent: input.hasRomanceContent,
        hasAdultContent: input.hasAdultContent,
        isBuiltin: false,
        enabled: input.enabled,
        sortOrder: input.sortOrder,
        createdAt: now,
        updatedAt: now,
      })
      .returning();
    if (!row) throw new AppError('internal_error', '创建情景模式失败');
    await this.audit.record({
      module: 'characters',
      action: 'scenario_mode.created',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'scenario_mode',
      targetId: row.id,
      details: { name: input.name },
    });
    return toDto(row);
  }

  async update(adminId: string, id: string, input: UpdateInput): Promise<AdminScenarioMode> {
    const [current] = await this.database.db
      .select()
      .from(scenarioModes)
      .where(eq(scenarioModes.id, id));
    if (!current) throw new AppError('not_found', '情景模式不存在');

    // 内置模式的适用范围与内容标记不可改（MODE-01 第 3 条：内置模式固定其资格规则）。
    const patch = current.isBuiltin
      ? {
          name: input.name,
          description: input.description,
          presetPrompt: input.presetPrompt,
          enabled: input.enabled,
          sortOrder: input.sortOrder,
        }
      : input;

    const [updated] = await this.database.db
      .update(scenarioModes)
      .set({
        ...(patch.name !== undefined ? { name: patch.name } : {}),
        ...(patch.description !== undefined ? { description: patch.description } : {}),
        ...(patch.presetPrompt !== undefined ? { presetPrompt: patch.presetPrompt } : {}),
        ...(!current.isBuiltin && patch.appliesTo !== undefined
          ? { appliesTo: patch.appliesTo }
          : {}),
        ...(!current.isBuiltin && patch.hasRomanceContent !== undefined
          ? { hasRomanceContent: patch.hasRomanceContent }
          : {}),
        ...(!current.isBuiltin && patch.hasAdultContent !== undefined
          ? { hasAdultContent: patch.hasAdultContent }
          : {}),
        ...(patch.enabled !== undefined ? { enabled: patch.enabled } : {}),
        ...(patch.sortOrder !== undefined ? { sortOrder: patch.sortOrder } : {}),
        updatedAt: this.clock.now(),
      })
      .where(eq(scenarioModes.id, id))
      .returning();
    if (!updated) throw new AppError('conflict', '更新失败，请重试');
    await this.audit.record({
      module: 'characters',
      action: 'scenario_mode.updated',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'scenario_mode',
      targetId: id,
      details: { presetPromptChanged: input.presetPrompt !== undefined },
    });
    return toDto(updated);
  }

  async delete(adminId: string, id: string): Promise<void> {
    const [current] = await this.database.db
      .select()
      .from(scenarioModes)
      .where(eq(scenarioModes.id, id));
    if (!current) throw new AppError('not_found', '情景模式不存在');
    if (current.isBuiltin) {
      throw new AppError('bad_request', '内置情景模式不能删除', { status: 422 });
    }
    await this.database.db.delete(scenarioModes).where(eq(scenarioModes.id, id));
    await this.audit.record({
      module: 'characters',
      action: 'scenario_mode.deleted',
      actorType: 'admin',
      actorId: adminId,
      targetType: 'scenario_mode',
      targetId: id,
    });
  }
}
