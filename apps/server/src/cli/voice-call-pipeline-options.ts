/**
 * `voice-call-pipeline` 运维 CLI 的可测部分：参数解析、写入前的组件校验、组合目录条目载荷。
 * 纯函数，不碰数据库 / Nest，单测直接调用；CLI 入口见 voice-call-pipeline.ts。
 *
 * 组合通话模型（ADR-20261024）自身不调用任何上游，三个组件必须都能真实调用：
 * 目录里存在且启用、上游账号存在（未删除）且不是本机 loopback 地址。任一不满足就整体失败、不写库。
 */
import type { ModelScenario, UpstreamStatus } from '@weiban/contracts';
import { AdminCatalogEntryWrite as AdminCatalogEntryWriteSchema } from '@weiban/contracts';
import type { z } from 'zod';
import {
  parseVoiceCallPipeline,
  VOICE_CALL_CASCADE_MODEL_KEY,
  VOICE_CALL_PIPELINE_TAG,
  type VoiceCallPipeline,
} from '../modules/model-access/index.js';

/** 与 catalog.upsert 的写入类型一致（契约里的 AdminCatalogEntryWrite）。 */
export type CatalogEntryWrite = z.infer<typeof AdminCatalogEntryWriteSchema>;

export type VoiceCallComponentName = 'asr' | 'text' | 'tts';

/** 三个组件与命令行参数、设置字段的对应关系（报错与解析共用，顺序固定：识别 → 文本 → 合成）。 */
export const VOICE_CALL_PIPELINE_FLAGS: ReadonlyArray<{
  component: VoiceCallComponentName;
  flag: string;
  field: keyof VoiceCallPipeline;
}> = [
  { component: 'asr', flag: '--asr', field: 'asrModelKey' },
  { component: 'text', flag: '--text', field: 'textModelKey' },
  { component: 'tts', flag: '--tts', field: 'ttsModelKey' },
];

/** 组合目录条目在后台显示的名字（ADR-20261024）。 */
export const VOICE_CALL_COMPOSITE_ENTRY_NAME = 'Voice Cascade';
export const VOICE_CALL_COMPOSITE_ENTRY_VENDOR = 'Weiban';
/** 后台契约 AdminCatalogEntry.tags 里每个标签的长度上限。 */
export const CATALOG_TAG_MAX_LENGTH = 16;

/**
 * 组合标签本身带来的非阻断提示：`pipeline:voice_call` 有 19 个字符，超过后台契约 tags 的长度上限，
 * 后台模型列表 / 价格页按契约解析会失败。写入仍按 ADR 执行（组合判定依赖这个标签），
 * 由维护方决定缩短标签还是放宽契约。
 */
export function compositeEntryWarnings(): string[] {
  return VOICE_CALL_PIPELINE_TAG.length > CATALOG_TAG_MAX_LENGTH
    ? [
        `目录标签 ${VOICE_CALL_PIPELINE_TAG} 有 ${VOICE_CALL_PIPELINE_TAG.length} 个字符，超过后台契约 tags 上限 ${CATALOG_TAG_MAX_LENGTH}：放宽契约前，后台模型列表会解析失败`,
      ]
    : [];
}

/** --set 解析结果：三个组件键已通过结构校验。 */
export interface VoiceCallSetCommand {
  kind: 'set';
  operatorId: string;
  pipeline: VoiceCallPipeline;
  createEntry: boolean;
}

export type VoiceCallCommand = { kind: 'show' } | VoiceCallSetCommand;

export type VoiceCallCommandResult =
  { ok: true; command: VoiceCallCommand } | { ok: false; code: string; message: string };

const VALUE_FLAGS = new Set(['--operator-id', '--asr', '--text', '--tts']);

const invalid = (message: string, code = 'ARGUMENT_INVALID'): VoiceCallCommandResult => ({
  ok: false,
  code,
  message,
});

/**
 * 解析命令行：`--show` 或 `--set`（必填 `--operator-id --asr --text --tts`），
 * `--create-entry` 只能跟 `--set` 一起用。参数问题在连数据库之前就失败。
 */
export function parseVoiceCallPipelineCommand(argv: readonly string[]): VoiceCallCommandResult {
  let action: 'show' | 'set' | null = null;
  let createEntry = false;
  const values = new Map<string, string>();
  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i]!;
    // pnpm / npm 传参时会多带一个 "--"
    if (arg === '--') continue;
    if (arg === '--show' || arg === '--set') {
      if (action) return invalid('只能指定一个子命令：--show 或 --set', 'ACTION_CONFLICT');
      action = arg === '--show' ? 'show' : 'set';
      continue;
    }
    if (arg === '--create-entry') {
      if (createEntry) return invalid('--create-entry 写了两次');
      createEntry = true;
      continue;
    }
    if (!VALUE_FLAGS.has(arg))
      return invalid(
        `不认识的参数 ${arg}；可用：--show / --set / --operator-id / --asr / --text / --tts / --create-entry`,
      );
    const value = argv[i + 1];
    if (!value || value.startsWith('--')) return invalid(`${arg} 缺少取值`);
    if (values.has(arg)) return invalid(`${arg} 写了两次`);
    values.set(arg, value);
    i++;
  }
  if (!action) return invalid('需要 --show（查看现状）或 --set（写入）', 'ONE_ACTION_REQUIRED');
  if (action === 'show') {
    const extra = [...values.keys(), ...(createEntry ? ['--create-entry'] : [])];
    if (extra.length) return invalid(`--show 只读，不接受 ${extra.join('、')}；写入请用 --set`);
    return { ok: true, command: { kind: 'show' } };
  }
  const operatorId = values.get('--operator-id');
  if (!operatorId)
    return invalid('缺少 --operator-id（操作人的管理员用户 ID，写审计用）', 'ARGUMENT_REQUIRED');
  const pipeline: Record<string, string> = {};
  for (const { flag, field } of VOICE_CALL_PIPELINE_FLAGS) {
    const value = values.get(flag);
    if (!value) return invalid(`缺少 ${flag}`, 'ARGUMENT_REQUIRED');
    pipeline[field] = value;
  }
  const parsed = parseVoiceCallPipeline(pipeline);
  if (!parsed.ok)
    return invalid(
      parsed.error === 'pipeline_duplicate_components'
        ? '识别、文本、合成不能选同一个模型'
        : '模型键格式不正确：需要 3 个「厂商/模型」形式的合法模型键',
      'PIPELINE_INVALID',
    );
  if (Object.values(parsed.value).includes(VOICE_CALL_CASCADE_MODEL_KEY))
    return invalid('组合模型不能把自己当组件：请填三个真实模型键', 'PIPELINE_SELF_REFERENCE');
  return { ok: true, command: { kind: 'set', operatorId, pipeline: parsed.value, createEntry } };
}

/** 组件在目录里的事实（CatalogService.facts 的子集，便于单测造假）。 */
export interface VoiceCallCatalogFact {
  entry: { enabled: boolean; upstreamId: string } | null;
  upstreamStatus?: UpstreamStatus | null;
}

/** 上游账号（UpstreamService.list 的子集）；deletedAt 非空 = 已软删。 */
export interface VoiceCallUpstreamInfo {
  upstreamId: string;
  name: string;
  baseUrl: string;
  enabled?: boolean;
  status: UpstreamStatus;
  deletedAt?: string | null;
}

export interface VoiceCallComponentStatus {
  component: VoiceCallComponentName;
  modelKey: string;
  inCatalog: boolean;
  enabled: boolean;
  upstreamName: string | null;
  upstreamStatus: UpstreamStatus | null;
  /** 阻断写入的原因；为空 = 这个组件就绪。 */
  problems: string[];
  /** 不阻断、但生产通话可能不可用的提示。 */
  warnings: string[];
}

export interface VoiceCallPreparation {
  ok: boolean;
  components: VoiceCallComponentStatus[];
  /** 汇总的阻断原因（带组件名），供 CLI 原样输出。 */
  problems: string[];
  warnings: string[];
}

/** 上游地址是不是本机（loopback / 通配地址）：生产不能靠它接真实通话。 */
export function isLoopbackBaseUrl(baseUrl: string): boolean {
  let hostname: string;
  try {
    hostname = new URL(baseUrl).hostname.toLowerCase().replace(/^\[|\]$/g, '');
  } catch {
    return false;
  }
  if (['localhost', '::1', '0.0.0.0'].includes(hostname)) return true;
  return hostname.startsWith('127.') || hostname.startsWith('::ffff:127.');
}

/**
 * `--set` / `--show` 前的组件校验：三个模型都要在目录里且启用，上游要存在（未删除）且不是本机地址。
 * 返回全部问题（不是只报第一个），调用方据此在写入任何东西之前失败。
 */
export function assessVoiceCallPipeline(input: {
  pipeline: VoiceCallPipeline;
  facts: ReadonlyMap<string, VoiceCallCatalogFact>;
  upstreams: readonly VoiceCallUpstreamInfo[];
}): VoiceCallPreparation {
  const components: VoiceCallComponentStatus[] = [];
  const problems: string[] = [];
  const warnings: string[] = [];
  for (const { component, field } of VOICE_CALL_PIPELINE_FLAGS) {
    const modelKey = input.pipeline[field];
    const fact = input.facts.get(modelKey);
    const entry = fact?.entry ?? null;
    const status: VoiceCallComponentStatus = {
      component,
      modelKey,
      inCatalog: !!entry,
      enabled: !!entry?.enabled,
      upstreamName: null,
      upstreamStatus: fact?.upstreamStatus ?? null,
      problems: [],
      warnings: [],
    };
    if (!entry) status.problems.push('模型目录里没有这个模型');
    else if (!entry.enabled) status.problems.push('模型已停用');
    if (entry) {
      const upstream = input.upstreams.find((u) => u.upstreamId === entry.upstreamId);
      if (!upstream || upstream.deletedAt) {
        status.problems.push('上游账号不存在或已删除');
      } else {
        status.upstreamName = upstream.name;
        if (isLoopbackBaseUrl(upstream.baseUrl))
          status.problems.push('上游地址是本机（loopback），生产环境接不到真实供应商');
        if (upstream.enabled === false) status.warnings.push('上游账号已停用，通话会不可用');
        if (upstream.status !== 'active')
          status.warnings.push(`上游状态不是正常（${upstream.status}），通话会不可用`);
      }
    }
    for (const problem of status.problems)
      problems.push(`${component} 组件 ${modelKey}：${problem}`);
    for (const warning of status.warnings)
      warnings.push(`${component} 组件 ${modelKey}：${warning}`);
    components.push(status);
  }
  return { ok: problems.length === 0, components, problems, warnings };
}

export interface VoiceCallExistingCompositeEntry {
  tags: readonly string[];
  leaderboardRank: number | null;
  sortOrder: number;
}

/**
 * 组合目录条目的写入载荷（ADR-20261024）：固定键 `voice/cascade-call`、标签 `pipeline:voice_call`、
 * 只用于 `voice_call` 场景、启用。组合条目没有自己的上游 / token 价，主上游字段镜像文本组件，
 * 只为满足目录表的结构要求；运行时从 `voice_call_pipeline` 取三个组件。
 */
export function compositeEntryWrite(input: {
  upstreamId: string;
  upstreamModelId: string;
  existing?: VoiceCallExistingCompositeEntry | null;
}): CatalogEntryWrite {
  // 契约里标签最多 10 个；组合标记排第一，其余沿用原条目的标签（保留后台手填信息）。
  const tags = [VOICE_CALL_PIPELINE_TAG];
  for (const tag of input.existing?.tags ?? [])
    if (!tags.includes(tag) && tags.length < 10) tags.push(tag);
  return {
    modelKey: VOICE_CALL_CASCADE_MODEL_KEY,
    displayName: VOICE_CALL_COMPOSITE_ENTRY_NAME,
    vendorName: VOICE_CALL_COMPOSITE_ENTRY_VENDOR,
    upstreamId: input.upstreamId,
    upstreamModelId: input.upstreamModelId,
    capabilities: [],
    tags,
    leaderboardRank: input.existing?.leaderboardRank ?? null,
    sortOrder: input.existing?.sortOrder ?? 0,
    defaultFor: [],
    enabled: true,
    scenarios: ['voice_call'] satisfies ModelScenario[],
  };
}
