/**
 * 把「哪个字段错了、为什么错」翻译成大白话。
 *
 * 来源有两种：
 * - client-core 发请求前用契约校验请求体失败，抛出 ZodError（issue.path 是数组）；
 * - 服务器返回 400 bad_request，details.issues = [{ path: 'a.b.0', message }]（contract-pipe.ts）。
 * 两种都统一成 FieldIssue，再由 describeIssue 生成「模型键：格式应为 …」这样的句子。
 */
import { z } from 'zod';
import { ApiFailure } from '@weiban/client-core';

export type IssuePath = (string | number)[];

export interface FieldIssue {
  path: IssuePath;
  /** 原始英文说明（只在没有更好的翻译时兜底用）。 */
  message: string;
  /** zod issue code；服务器返回的没有。 */
  code?: string;
  /** zod issue 的其余字段（minimum / maximum / format / values / keys / origin …）。 */
  detail: Record<string, unknown>;
}

interface FieldInfo {
  label: string;
  /** 格式类错误时直接给出的正确写法（含例子）。 */
  hint?: string;
  /** 只作为路径中间的分组名出现（例「计费上限」）。 */
  group?: boolean;
}

export const MODEL_KEY_HINT =
  '格式应为「厂商/模型名」：厂商部分只能用小写字母、数字和 . _ -，模型名部分可以用字母、数字和 . _ : -，例 google/gemini-3.8-flash';

/** 常见字段的中文名与正确写法；按字段名（路径最后一段）查。 */
const FIELD_INFO: Record<string, FieldInfo> = {
  modelKey: { label: '模型键', hint: MODEL_KEY_HINT },
  baseModelKey: { label: '基准模型', hint: MODEL_KEY_HINT },
  modelKeys: { label: '模型', hint: MODEL_KEY_HINT },
  displayName: { label: '显示名' },
  vendorName: { label: '出品方（厂商）' },
  upstreamId: { label: '上游账号', hint: '请从下拉里重新选择上游账号' },
  upstreamModelId: { label: '上游模型名' },
  capabilities: { label: '能力' },
  defaultFor: { label: '默认给谁用' },
  tags: { label: '标签', hint: '最多 10 个，每个不超过 16 个字' },
  sortOrder: { label: '排序', hint: '填整数' },
  weight: { label: '权重', hint: '填 1 到 1000 的整数' },
  priority: { label: '优先级', hint: '填 0 到 1000 的整数' },
  enabled: { label: '启用' },
  rates: { label: '售价', group: true },
  costRates: { label: '成本价', group: true },
  input: { label: '输入价' },
  output: { label: '输出价' },
  cache: { label: '缓存命中价' },
  displayMultiplierManual: { label: '展示倍率', hint: '填 0 到 1000 的数字，最多 2 位小数；不填 = 自动' },
  billingBounds: { label: '计费上限', group: true },
  billingBoundsDraft: { label: '计费上限 JSON' },
  sourceUrl: { label: '资料来源链接', hint: '需要是以 https:// 开头的完整网址，例 https://ai.google.dev/gemini-api/docs/pricing' },
  checkedAt: { label: '核对日期', hint: '选一个不晚于今天的日期' },
  contextTokens: { label: '上下文长度', hint: '填 1 到 10000000 的整数（token），不确定填 128000' },
  maxOutputTokens: { label: '最大输出', hint: '填 1 到 32000 的整数（token），不确定填 8192' },
  outputParameter: { label: '输出参数名', hint: '只能是 max_tokens 或 max_completion_tokens' },
  maxImages: { label: '最多图片数', hint: '填 0 到 20 的整数；不支持识图填 0' },
  totalOutputIncludesReasoning: { label: '输出含推理', hint: '固定为 true' },
  format: { label: '格式版本', hint: '固定为 billing-bounds-v1' },
  name: { label: '名称' },
  baseUrl: { label: '接口地址', hint: '需要是完整网址，例 https://api.example.com/v1' },
  provider: { label: '供应商' },
  apiKey: { label: 'API 密钥' },
  maxConcurrency: { label: '最大并发' },
  rpmLimit: { label: '每分钟请求上限' },
  note: { label: '备注' },
  reason: { label: '原因' },
  points: { label: '积分' },
  direction: { label: '操作' },
  title: { label: '标题' },
  body: { label: '正文' },
  content: { label: '内容' },
  summary: { label: '摘要' },
  url: { label: '链接', hint: '需要是完整网址，例 https://example.com' },
  imageUrl: { label: '图片链接' },
  coverUrl: { label: '封面链接' },
  version: { label: '版本号' },
  tierId: { label: '档位编号' },
  priceMicros: { label: '价格' },
  contactHint: { label: '联系说明' },
  prompt: { label: '提示词' },
  question: { label: '问题' },
  date: { label: '日期' },
  startsAt: { label: '开始时间' },
  endsAt: { label: '结束时间' },
  description: { label: '说明' },
};

/** 列表字段：后面跟数字下标时显示成「第 N 条线路」。 */
const LIST_LABELS: Record<string, string> = {
  routes: '条线路',
  tiers: '个档位',
  bands: '个时段',
  items: '项',
  options: '个选项',
  entries: '项',
};

export function isZodError(value: unknown): value is z.ZodError {
  return (
    value instanceof z.ZodError ||
    (typeof value === 'object' &&
      value !== null &&
      (value as { name?: unknown }).name === 'ZodError' &&
      Array.isArray((value as { issues?: unknown }).issues))
  );
}

function toPath(raw: unknown): IssuePath {
  if (Array.isArray(raw))
    return raw.filter((p): p is string | number => typeof p === 'string' || typeof p === 'number');
  if (typeof raw === 'string' && raw)
    return raw.split('.').map((seg) => (/^\d+$/.test(seg) ? Number(seg) : seg));
  return [];
}

/** 从任意错误里取出字段级问题；不是字段问题时返回 null。 */
export function issuesOf(value: unknown): FieldIssue[] | null {
  if (isZodError(value)) {
    return value.issues.map((issue) => {
      const { code, path, message, ...detail } = issue as unknown as {
        code: string;
        path: unknown;
        message: string;
      } & Record<string, unknown>;
      return { code, path: toPath(path), message, detail };
    });
  }
  if (value instanceof ApiFailure) {
    const list = value.details?.issues;
    if (!Array.isArray(list) || !list.length) return null;
    return list.map((raw) => {
      const item = (raw ?? {}) as { path?: unknown; message?: unknown };
      return {
        path: toPath(item.path),
        message: typeof item.message === 'string' ? item.message : '',
        detail: {},
      };
    });
  }
  return null;
}

function fieldName(seg: string): string {
  return FIELD_INFO[seg]?.label ?? seg;
}

/** 「第 1 条线路 · 计费上限 · 上下文长度」 */
export function fieldLabel(path: IssuePath): string {
  const parts: string[] = [];
  for (let i = 0; i < path.length; i += 1) {
    const seg = path[i];
    if (typeof seg !== 'string') continue;
    const next = path[i + 1];
    const last = path.slice(i + 1).every((s) => typeof s === 'number');
    if (typeof next === 'number' && LIST_LABELS[seg]) {
      parts.push(`第 ${next + 1} ${LIST_LABELS[seg]}`);
      i += 1;
      continue;
    }
    if (last) {
      parts.push(fieldName(seg));
      break;
    }
    if (FIELD_INFO[seg]?.group) parts.push(fieldName(seg));
  }
  return parts.join(' · ') || '填写内容';
}

function lastField(path: IssuePath): string | undefined {
  for (let i = path.length - 1; i >= 0; i -= 1) {
    const seg = path[i];
    if (typeof seg === 'string') return seg;
  }
  return undefined;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' ? v : typeof v === 'bigint' ? Number(v) : undefined;
}

/** 只说原因（不带字段名）。 */
export function issueReason(issue: FieldIssue): string {
  const d = issue.detail;
  const origin = typeof d.origin === 'string' ? d.origin : '';
  switch (issue.code) {
    case 'invalid_type':
      return /received (undefined|null)/i.test(issue.message) ? '没有填' : '填写的类型不对';
    case 'too_small': {
      const min = num(d.minimum) ?? 0;
      if (origin === 'string') return min <= 1 ? '不能为空' : `至少 ${min} 个字`;
      if (origin === 'array' || origin === 'set') return min <= 1 ? '至少要有 1 项' : `至少要有 ${min} 项`;
      return d.inclusive === false ? `必须大于 ${min}` : `不能小于 ${min}`;
    }
    case 'too_big': {
      const max = num(d.maximum) ?? 0;
      if (origin === 'string') return `最多 ${max} 个字`;
      if (origin === 'array' || origin === 'set') return `最多 ${max} 项`;
      return d.inclusive === false ? `必须小于 ${max}` : `不能大于 ${max}`;
    }
    case 'invalid_format':
      switch (d.format) {
        case 'url':
          return '需要是以 https:// 开头的完整网址';
        case 'datetime':
        case 'date':
          return '日期格式不对';
        case 'uuid':
        case 'guid':
          return '选项无效，请重新选择';
        case 'email':
          return '邮箱格式不对';
        default:
          return '格式不对';
      }
    case 'invalid_value': {
      const values = Array.isArray(d.values) ? d.values.map(String) : [];
      return values.length ? `只能是 ${values.join(' / ')}` : '取值不对';
    }
    case 'unrecognized_keys': {
      const keys = Array.isArray(d.keys) ? d.keys.map(String) : [];
      return keys.length ? `有不认识的项：${keys.join('、')}` : '有不认识的项';
    }
    case 'not_multiple_of':
      return `需要是 ${String(d.divisor)} 的倍数`;
    default:
      return '格式不对';
  }
}

/** 只说「为什么错 / 应该怎么填」，不带字段名；用于字段下方的红字。 */
export function issueFieldText(issue: FieldIssue): string {
  const key = lastField(issue.path);
  const hint = key ? FIELD_INFO[key]?.hint : undefined;
  const formatLike =
    issue.code === undefined ||
    issue.code === 'invalid_format' ||
    issue.code === 'invalid_value' ||
    issue.code === 'invalid_union';
  if (hint && formatLike) return hint;
  const reason = issueReason(issue);
  return hint && (issue.code === 'too_small' || issue.code === 'too_big') ? `${reason}（${hint}）` : reason;
}

/** 完整一句话：「模型键：格式应为 …」 */
export function describeIssue(issue: FieldIssue): string {
  return `${fieldLabel(issue.path)}：${issueFieldText(issue)}`;
}

/** 多个问题时：第一处 +「等 N 处」。 */
export function describeIssues(issues: FieldIssue[]): string {
  const first = issues[0];
  if (!first) return '请检查填写内容';
  return issues.length > 1 ? `${describeIssue(first)}（共 ${issues.length} 处要改）` : describeIssue(first);
}
