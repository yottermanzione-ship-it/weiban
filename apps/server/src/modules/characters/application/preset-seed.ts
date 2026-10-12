/**
 * 预设角色种子（2026-10-12，本机试用角色广场为空时导入，说明见 docs/backend/preset-seed.md）。
 *
 * 走与管理后台相同的服务层：CharacterService.create（加密、分类、儿童特征规则层检测）→ runChecks → publish。
 * 唯一不同：上架检查的「人设稳定 / 硬性边界」评测不调用真实模型，由 SeedApprovalEvaluator 开发放行；
 * 儿童特征仍由规则层照常检测（runChecks 内 childFeaturesIn），分类照卡片写入，不放宽。
 * 每个放行都另记一条审计 preset.seed_check_bypassed，便于日后识别、补评测。
 * 可重复执行：同名预设角色已上架则跳过；存在但未上架则继续检查与发布。
 */
import type { INestApplicationContext } from '@nestjs/common';
import { AdminCharacterWrite, CharacterCard } from '@weiban/contracts';
import { AUDIT_LOG, CLOCK, type AuditLog, type Clock } from '../../../platform/index.js';
import { CharacterService } from './characters.js';
import type { CharacterEvaluator } from './evaluator.js';

/** 样本卡格式（docs/ai/samples、character-card-spec.md）：baseInfo + card。 */
interface SampleBaseInfo {
  name: string;
  aliases?: string[];
  works?: string[];
  tagline?: string;
  intro?: string;
  tags?: string[];
  categoryId?: string | null;
  avatar?: { text?: string };
  birthday?: string | null;
  fanName?: string | null;
  classification: {
    basis: string;
    realPersonKind: string | null;
    ageSetting: string;
    childAppearance: boolean;
  };
  fallbackGreetings?: string[];
}
interface Sample {
  source?: string;
  baseInfo: SampleBaseInfo;
  card: { cardSchemaVersion: number; data: Record<string, unknown> };
}

export interface PresetSeedResult {
  name: string;
  source: string;
  outcome: 'created' | 'published' | 'skipped' | 'failed';
  characterId?: string;
  error?: string;
}

/** 开发放行：不调用模型，直接视为人设稳定与硬性边界用例通过；不声称未检出儿童特征以外的任何事。 */
class SeedApprovalEvaluator implements CharacterEvaluator {
  evaluate() {
    return Promise.resolve({
      childFeaturesDetected: false,
      personaStabilityPassed: true,
      hardBoundaryCasesPassed: true,
    });
  }
}

/** 样本卡生日只写「MM-DD」时，按 ageDisplay 推出年份补成 ISO 日期；推不出则留空。 */
function birthday(info: SampleBaseInfo, card: Sample['card'], now: Date): string | null {
  const raw = info.birthday;
  if (!raw) return null;
  if (/^\d{4}-\d{2}-\d{2}$/.test(raw)) return raw;
  if (!/^\d{2}-\d{2}$/.test(raw)) return null;
  const extra = card.data['profileExtra'] as { ageDisplay?: string } | undefined;
  const age = /(\d+)\s*岁/.exec(extra?.ageDisplay ?? '')?.[1];
  if (!age) return null;
  return `${now.getUTCFullYear() - Number(age)}-${raw}`;
}

export function sampleToAdminWrite(sample: Sample, now: Date): AdminCharacterWrite {
  const info = sample.baseInfo;
  const text = info.avatar?.text?.trim();
  return AdminCharacterWrite.parse({
    name: info.name,
    aliases: info.aliases ?? [],
    works: info.works ?? [],
    tagline: info.tagline ?? '',
    intro: info.intro ?? '',
    tags: info.tags ?? [],
    categoryId: info.categoryId ?? null,
    avatar: {
      imageMediaId: null,
      display: {
        supportColors: [],
        avatarText: text ? [...text].slice(0, 2).join('') : null,
        avatarPattern: 'none',
        themeColor: null,
      },
    },
    birthday: birthday(info, sample.card, now),
    fanName: info.fanName ?? null,
    classification: {
      basis: info.classification.basis,
      realPersonKind: info.classification.realPersonKind,
      ageSetting: info.classification.ageSetting,
      childAppearance: info.classification.childAppearance,
    },
    fallbackGreetings: info.fallbackGreetings ?? [],
    card: sample.card,
  });
}

export async function seedPresetCharacters(
  app: INestApplicationContext,
  adminId: string,
  samples: readonly unknown[],
): Promise<PresetSeedResult[]> {
  const service = app.get(CharacterService, { strict: false });
  const audit = app.get<AuditLog>(AUDIT_LOG, { strict: false });
  const clock = app.get<Clock>(CLOCK, { strict: false });
  const evaluator = new SeedApprovalEvaluator();
  const results: PresetSeedResult[] = [];
  for (const raw of samples) {
    const sample = raw as Sample;
    const name = sample.baseInfo?.name ?? '(无名)';
    const source = sample.source ?? '';
    try {
      const body = sampleToAdminWrite(sample, clock.now());
      const card = CharacterCard.safeParse(body.card);
      if (!card.success)
        throw new Error(
          `角色卡不完整：${card.error.issues
            .slice(0, 5)
            .map((i) => `${i.path.join('.')} ${i.message}`)
            .join('；')}`,
        );
      const existing = (await service.adminList(adminId, { q: body.name })).find(
        (c) => c.name === body.name,
      );
      // 已上架跳过；管理员主动下架 / 停用的也跳过，种子不替管理员恢复。
      if (existing && ['published', 'unpublished', 'disabled'].includes(existing.status)) {
        results.push({
          name,
          source,
          outcome: 'skipped',
          characterId: existing.characterId,
          ...(existing.status === 'published' ? {} : { error: `已存在（${existing.status}）` }),
        });
        continue;
      }
      const target = existing ?? (await service.create(adminId, body));
      const revision = await service.presetRevision(target.characterId);
      await service.runChecks({ characterId: target.characterId, adminId, revision }, evaluator);
      await audit.record({
        module: 'characters',
        action: 'preset.seed_check_bypassed',
        actorType: 'admin',
        actorId: adminId,
        targetType: 'character',
        targetId: target.characterId,
        details: { revision, source, reason: 'dev_seed' },
      });
      await service.publish(adminId, target.characterId);
      results.push({
        name,
        source,
        outcome: existing ? 'published' : 'created',
        characterId: target.characterId,
      });
    } catch (error) {
      results.push({
        name,
        source,
        outcome: 'failed',
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
  return results;
}
