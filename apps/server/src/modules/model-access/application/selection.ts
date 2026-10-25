/**
 * 旧「模型选择」接口（全局聊天 / 后台 / 成人模式 + 角色单独聊天模型）的兼容层。
 *
 * 3.22 起数据只存在按场景的配置里（ScenarioService）：
 * - chat ↔ 场景「文本聊天」；adult ↔ 场景「私密模式」；background 不再单独存在（后台文字任务跟随文本聊天），
 *   读出来恒为 null，写入忽略；
 * - 角色单独聊天模型 ↔ 该角色「文本聊天」场景的单独设置。
 * 旧客户端（未升级的安卓）照常可用；新客户端用 /model/scenarios。
 */
import { Inject, Injectable } from '@nestjs/common';
import type { ModelNotificationReadPort, Tx, ModelSelection } from '@weiban/contracts';
import { AppError, asDbTx, DATABASE, type Database } from '../../../platform/index.js';
import { CatalogService } from './catalog.js';
import { ScenarioService } from './scenarios.js';
import { refState, type ModelRefStateOut } from './selection-state.js';

export { refState, type ModelRefStateOut } from './selection-state.js';

type Field = 'chat' | 'background' | 'adult';

@Injectable()
export class SelectionService implements ModelNotificationReadPort {
  constructor(
    @Inject(DATABASE) private readonly database: Database,
    @Inject(CatalogService) private readonly catalog: CatalogService,
    @Inject(ScenarioService) private readonly scenarios: ScenarioService,
  ) {}

  /** 模型变得不可用时，哪些用户受影响：任一场景配置或角色单独设置用到了它。 */
  async affectedUsers(
    userIds: readonly string[],
    modelKey: string,
    tx?: Tx,
    _previousDefaultFor: readonly ('chat' | 'background' | 'vision')[] = [],
  ): Promise<string[]> {
    if (!userIds.length) return [];
    const connection = tx ? asDbTx(tx) : this.database;
    const result = await connection.query<{ user_id: string }>(
      `
      WITH model AS (
        SELECT c.enabled, u.status FROM model_access.model_catalog c
        LEFT JOIN model_access.upstreams u ON u.id=c.upstream_id WHERE c.model_key=$2
      )
      SELECT candidate.user_id FROM unnest($1::uuid[]) AS candidate(user_id)
      WHERE NOT EXISTS (SELECT 1 FROM model WHERE enabled AND status='active') AND (
        EXISTS (SELECT 1 FROM model_access.scenario_selections s WHERE s.user_id=candidate.user_id AND s.model_key=$2)
        OR EXISTS (SELECT 1 FROM model_access.character_scenario_overrides o WHERE o.user_id=candidate.user_id AND o.model_key=$2)
      )`,
      [[...userIds], modelKey],
    );
    return result.rows.map((row) => row.user_id);
  }

  /** 用户原始选择（旧口径）。 */
  async raw(userId: string): Promise<Record<Field, string | null>> {
    const map = await this.scenarios.raw(userId);
    return { chat: map.get('chat') ?? null, background: null, adult: map.get('private') ?? null };
  }

  async getSelection(userId: string): Promise<ModelSelection> {
    const raw = await this.raw(userId);
    // 3.28：adult 不再是用户选择，统一读平台固定私密模型。
    const fixedKey = (await this.catalog.modelUses()).fixed?.private ?? null;
    const facts = await this.catalog.facts(
      [raw.chat, fixedKey].filter((k): k is string => k !== null),
    );
    const state = (key: string | null) => {
      if (key === null) return null;
      const f = facts.get(key);
      return f ? refState(f) : null;
    };
    return { chat: state(raw.chat), background: null, adult: state(fixedKey) };
  }

  async updateSelection(
    userId: string,
    body: Partial<Record<Field, { modelKey: string } | null>>,
  ): Promise<ModelSelection> {
    // 3.28：私密模型由平台固定；旧客户端的 adult 写入一律拒绝。
    if (body.adult !== undefined)
      throw new AppError('model_not_allowed', '私密模型由平台统一提供，不能自行选择或修改', {
        status: 422,
        details: { field: 'adult' },
      });
    await this.scenarios.updateConfig(userId, {
      ...(body.chat !== undefined ? { chat: body.chat } : {}),
    });
    return this.getSelection(userId);
  }

  async getOverride(
    userId: string,
    characterId: string,
  ): Promise<{ characterId: string; chat: ModelRefStateOut | null }> {
    const key = (await this.scenarios.rawOverrides(userId, characterId)).get('chat') ?? null;
    return { characterId, chat: key === null ? null : refState(await this.catalog.fact(key)) };
  }

  async setOverride(
    userId: string,
    characterId: string,
    chat: { modelKey: string } | null,
  ): Promise<{ characterId: string; chat: ModelRefStateOut | null }> {
    await this.scenarios.updateCharacter(userId, characterId, { chat });
    return this.getOverride(userId, characterId);
  }
}
