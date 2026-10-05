/**
 * 用户的模型选择（全局聊天 / 后台 / 成人模式，按角色覆盖聊天模型）与无审查模型闸门（billing.md 第 9 节第 1 条）。
 *
 * - 全局 chat / background 不能选 adult_content 模型：422 model_not_allowed（全局选择会作用到真人和儿童角色）；
 * - adult（成人模式模型）可以选目录里任何启用的模型（pm-rulings-2 B1）；
 * - 角色单独模型：先问 policy 的 checkModelForCharacter，无成人资格的角色用 adult_content 模型 → 403 model_not_allowed；
 * - 选不存在 / 已停用的模型：422 model_unavailable。
 * 选择变化发 model_access.selection_changed。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ModelSelection } from '@weiban/contracts';
import { and, eq } from 'drizzle-orm';
import {
  AppError,
  CLOCK,
  DATABASE,
  OUTBOX,
  type Clock,
  type Database,
  type Outbox,
} from '../../../platform/index.js';
import { hasAdultContent, unavailableReason } from '../domain/rules.js';
import { characterOverrides, selections } from '../infra/db/schema.js';
import { MODEL_ACCESS_POLICY, type ModelPolicy } from '../tokens.js';
import { CatalogService, type ModelFacts } from './catalog.js';

export interface ModelRefStateOut {
  modelKey: string;
  available: boolean;
  unavailableReason: 'model_removed' | 'provider_unavailable' | null;
}

export function refState(f: ModelFacts): ModelRefStateOut {
  const reason = unavailableReason(f.entry, f.upstreamStatus);
  return { modelKey: f.modelKey, available: reason === null, unavailableReason: reason };
}

type Field = 'chat' | 'background' | 'adult';
const COLUMN = {
  chat: 'chatModelKey',
  background: 'backgroundModelKey',
  adult: 'adultModelKey',
} as const;

@Injectable()
export class SelectionService {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CLOCK) private readonly clock: Clock,
    @Inject(OUTBOX) private readonly outbox: Outbox,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(MODEL_ACCESS_POLICY) private readonly policy: ModelPolicy,
  ) {}

  /** 用户原始选择（未设置为 null）。 */
  async raw(userId: string): Promise<Record<Field, string | null>> {
    const [row] = await this.database.db
      .select()
      .from(selections)
      .where(eq(selections.userId, userId));
    return {
      chat: row?.chatModelKey ?? null,
      background: row?.backgroundModelKey ?? null,
      adult: row?.adultModelKey ?? null,
    };
  }

  async rawOverride(userId: string, characterId: string): Promise<string | null> {
    const [row] = await this.database.db
      .select({ key: characterOverrides.chatModelKey })
      .from(characterOverrides)
      .where(
        and(eq(characterOverrides.userId, userId), eq(characterOverrides.characterId, characterId)),
      );
    return row?.key ?? null;
  }

  async getSelection(userId: string): Promise<ModelSelection> {
    const raw = await this.raw(userId);
    const facts = await this.catalog.facts(
      [raw.chat, raw.background, raw.adult].filter((k): k is string => k !== null),
    );
    const state = (key: string | null) => {
      if (key === null) return null;
      const f = facts.get(key);
      return f ? refState(f) : null;
    };
    return { chat: state(raw.chat), background: state(raw.background), adult: state(raw.adult) };
  }

  async updateSelection(
    userId: string,
    body: Partial<Record<Field, { modelKey: string } | null>>,
  ): Promise<ModelSelection> {
    const changes: Partial<Record<(typeof COLUMN)[Field], string | null>> = {};
    for (const field of ['chat', 'background', 'adult'] as const) {
      const value = body[field];
      if (value === undefined) continue;
      if (value === null) {
        changes[COLUMN[field]] = null;
        continue;
      }
      const f = await this.catalog.fact(value.modelKey);
      if (!f.entry || !f.entry.enabled) {
        throw new AppError('model_unavailable', '这个模型不存在或已下架', {
          status: 422,
          details: { field },
        });
      }
      if (field !== 'adult' && hasAdultContent(f.entry.capabilities)) {
        throw new AppError(
          'model_not_allowed',
          '允许成人内容的模型不能设为全局聊天或后台模型，只能选为成人模式模型或给有成人资格的角色单独设置',
          { status: 422, details: { field } },
        );
      }
      changes[COLUMN[field]] = value.modelKey;
    }
    if (Object.keys(changes).length > 0) {
      await this.database.transaction(async (tx) => {
        const now = this.clock.now();
        await tx.db
          .insert(selections)
          .values({ userId, updatedAt: now, ...changes })
          .onConflictDoUpdate({ target: selections.userId, set: { ...changes, updatedAt: now } });
        await this.outbox.publish(tx, 'model_access.selection_changed', 'model_access', {
          userId,
          characterId: null,
        });
      });
    }
    return this.getSelection(userId);
  }

  async getOverride(
    userId: string,
    characterId: string,
  ): Promise<{ characterId: string; chat: ModelRefStateOut | null }> {
    const key = await this.rawOverride(userId, characterId);
    return { characterId, chat: key === null ? null : refState(await this.catalog.fact(key)) };
  }

  async setOverride(
    userId: string,
    characterId: string,
    chat: { modelKey: string } | null,
  ): Promise<{ characterId: string; chat: ModelRefStateOut | null }> {
    if (chat === null) {
      await this.database.transaction(async (tx) => {
        const deleted = await tx.db
          .delete(characterOverrides)
          .where(
            and(
              eq(characterOverrides.userId, userId),
              eq(characterOverrides.characterId, characterId),
            ),
          )
          .returning({ userId: characterOverrides.userId });
        if (deleted.length > 0) {
          await this.outbox.publish(tx, 'model_access.selection_changed', 'model_access', {
            userId,
            characterId,
          });
        }
      });
      return { characterId, chat: null };
    }

    const f = await this.catalog.fact(chat.modelKey);
    if (!f.entry || !f.entry.enabled) {
      throw new AppError('model_unavailable', '这个模型不存在或已下架', { status: 422 });
    }
    // 无审查模型闸门（hard-boundaries.md 第 4 节「模型层闸门」）：每次都问 policy，普通模型也问
    // （policy 同时确认角色属于该用户，不存在时 character_not_found）
    const decision = await this.policy.checkModelForCharacter({
      userId,
      characterId,
      modelHasAdultContent: hasAdultContent(f.entry.capabilities),
    });
    if (!decision.allowed) {
      if (decision.reason === 'character_not_found') {
        throw new AppError('not_found', '角色不存在');
      }
      if (decision.reason === 'model_not_allowed') {
        throw new AppError('model_not_allowed', '这个角色不能使用允许成人内容的模型');
      }
      throw new AppError('policy_denied', '这个角色不能使用该模型');
    }
    await this.database.transaction(async (tx) => {
      const now = this.clock.now();
      await tx.db
        .insert(characterOverrides)
        .values({ userId, characterId, chatModelKey: chat.modelKey, updatedAt: now })
        .onConflictDoUpdate({
          target: [characterOverrides.userId, characterOverrides.characterId],
          set: { chatModelKey: chat.modelKey, updatedAt: now },
        });
      await this.outbox.publish(tx, 'model_access.selection_changed', 'model_access', {
        userId,
        characterId,
      });
    });
    return { characterId, chat: refState(f) };
  }
}
