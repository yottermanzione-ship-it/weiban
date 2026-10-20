/**
 * 模型键「厂商/模型名」的生成与校验。
 * 规则以契约为准：packages/contracts/src/http/model-access.ts ModelKey。
 */
import { ModelKey } from '@weiban/contracts';

export { MODEL_KEY_HINT } from '../../data/issues.js';

export function isValidModelKey(value: string): boolean {
  return ModelKey.safeParse(value).success;
}

/** 中文厂商名 / 常见别名 → 英文小写标识。 */
const VENDOR_SLUGS: Array<[RegExp, string]> = [
  [/谷歌|google|gemini/i, 'google'],
  [/anthropic|claude/i, 'anthropic'],
  [/openai/i, 'openai'],
  [/深度求索|deepseek/i, 'deepseek'],
  [/月之暗面|moonshot|kimi/i, 'moonshot'],
  [/智谱|zhipu|glm/i, 'zhipu'],
  [/阿里|通义|百炼|qwen|dashscope/i, 'qwen'],
  [/小米|xiaomi|mimo/i, 'xiaomi'],
  [/^x\.?ai$|grok/i, 'xai'],
  [/字节|豆包|doubao|bytedance/i, 'bytedance'],
  [/腾讯|混元|tencent|hunyuan/i, 'tencent'],
  [/百度|文心|baidu|ernie/i, 'baidu'],
  [/minimax|稀宇/i, 'minimax'],
  [/meta|llama/i, 'meta'],
  [/mistral/i, 'mistral'],
];

export function vendorSlug(vendor: string | null | undefined): string {
  const raw = (vendor ?? '').trim();
  if (!raw) return '';
  const known = VENDOR_SLUGS.find(([re]) => re.test(raw));
  if (known) return known[1];
  return raw
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 48);
}

function modelSlug(model: string): string {
  return model
    .trim()
    .toLowerCase()
    .replace(/\s+/g, '-')
    .replace(/[^a-z0-9._:-]/g, '')
    .replace(/^[^a-z0-9]+/, '')
    .slice(0, 80);
}

/**
 * 按「厂商」和「上游模型名」给出建议的模型键（小写、去空格）。
 * 上游模型名本身就是「厂商/模型名」格式（例 OpenRouter 的 google/gemini-x）时直接用它。
 */
export function suggestModelKey(
  vendor: string | null | undefined,
  upstreamModelId: string | null | undefined,
): string {
  const model = (upstreamModelId ?? '').trim();
  if (!model) return '';
  if (model.includes('/')) {
    const whole = model.toLowerCase().replace(/\s+/g, '-');
    if (isValidModelKey(whole)) return whole;
    const tail = model.slice(model.lastIndexOf('/') + 1);
    const head = model.slice(0, model.indexOf('/'));
    const candidate = `${vendorSlug(vendor) || vendorSlug(head)}/${modelSlug(tail)}`;
    return isValidModelKey(candidate) ? candidate : '';
  }
  const v = vendorSlug(vendor) || vendorSlug(model.split(/[-_\s]/)[0]);
  const m = modelSlug(model);
  const candidate = `${v}/${m}`;
  return v && m && isValidModelKey(candidate) ? candidate : '';
}

/** gemini-4-argon → Gemini 4 Argon；gpt-6.1-sol → GPT 6.1 Sol。只是预填，管理员可以改。 */
export function prettyModelName(model: string): string {
  // claude-opus-5-5 → 5.5：相邻的纯数字段合成版本号。
  const parts = model.split(/[-_\s]+/).filter(Boolean).reduce<string[]>((acc, part) => {
    const prev = acc[acc.length - 1];
    if (prev && /^\d+(\.\d+)*$/.test(prev) && /^\d+$/.test(part)) acc[acc.length - 1] = `${prev}.${part}`;
    else acc.push(part);
    return acc;
  }, []);
  return parts
    .map((part) =>
      /^(gpt|glm|ai|llm)$/i.test(part)
        ? part.toUpperCase()
        : /^\d/.test(part)
          ? part
          : part.charAt(0).toUpperCase() + part.slice(1),
    )
    .join(' ')
    .slice(0, 60);
}

function shortHash(text: string): string {
  let h = 2166136261;
  for (let i = 0; i < text.length; i++) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0).toString(36).slice(0, 6);
}

/**
 * 3.26（G3-3）：模型键对管理员隐藏，按「出品方 / 上游模型名」自动生成，**总是**返回合法的键。
 * - 先用 suggestModelKey；生成不了（例 中文模型名）时退回「厂商/model-短哈希」；
 * - taken 里已有（新建时与现有模型重名）就在末尾加 -2、-3…，避免覆盖已有模型。
 */
export function autoModelKey(
  vendor: string | null | undefined,
  upstreamModelId: string | null | undefined,
  taken: ReadonlySet<string> = new Set(),
): string {
  const model = (upstreamModelId ?? '').trim();
  let base = suggestModelKey(vendor, model);
  if (!base) {
    const v = vendorSlug(vendor) || 'custom';
    const m = modelSlug(model.includes('/') ? model.slice(model.lastIndexOf('/') + 1) : model);
    const tail = m && /^[a-zA-Z0-9]/.test(m) ? m : `model-${shortHash(model || String(vendor ?? ''))}`;
    base = `${v.slice(0, 48)}/${tail.slice(0, 80)}`;
    if (!isValidModelKey(base)) base = `custom/model-${shortHash(`${vendor ?? ''}|${model}`)}`;
  }
  if (!taken.has(base)) return base;
  for (let n = 2; n < 1000; n++) {
    const suffix = `-${n}`;
    const [head, tail] = [base.slice(0, base.indexOf('/')), base.slice(base.indexOf('/') + 1)];
    const candidate = `${head}/${tail.slice(0, 80 - suffix.length)}${suffix}`;
    if (!taken.has(candidate) && isValidModelKey(candidate)) return candidate;
  }
  return `${base.slice(0, base.indexOf('/'))}/model-${shortHash(`${base}|${Date.now()}`)}`;
}
