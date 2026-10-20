/**
 * 计费上限（billing-bounds-v1）的结构化表单：管理员填几个数字，前端拼成契约要求的 JSON。
 * 契约：packages/contracts/src/http/model-access.ts RouteBillingBounds。
 * 没有计费上限的线路，调用前会被服务器拒绝（角色不回消息）。
 */
import dayjs, { type Dayjs } from 'dayjs';
import { DatePicker, Form, Input, InputNumber, Select } from 'antd';
import type { RouteBillingBounds } from '@weiban/contracts';
import { FieldHelp } from '../../ui/page.js';

export type OutputParameter = 'max_tokens' | 'max_completion_tokens';

export interface BoundsFormValues {
  contextTokens?: number | null;
  maxOutputTokens?: number | null;
  outputParameter?: OutputParameter;
  maxImages?: number | null;
  sourceUrl?: string;
  checkedAt?: Dayjs | null;
}

export const DEFAULT_CONTEXT_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_VISION_IMAGES = 4;

/** 常见厂商的价格页，用来预填「资料来源链接」（管理员可以改）。 */
const VENDOR_PRICE_PAGES: Array<[RegExp, string]> = [
  [/google|gemini|谷歌/i, 'https://ai.google.dev/gemini-api/docs/pricing'],
  [/anthropic|claude/i, 'https://platform.claude.com/docs/en/about-claude/pricing'],
  [/openai|gpt|^o\d/i, 'https://developers.openai.com/api/docs/pricing'],
  [/deepseek|深度求索/i, 'https://api-docs.deepseek.com/quick_start/pricing/'],
  [/moonshot|kimi|月之暗面/i, 'https://platform.kimi.com/docs/pricing/chat'],
  [/xai|grok/i, 'https://docs.x.ai/developers/pricing'],
  [/qwen|dashscope|阿里|通义|百炼/i, 'https://help.aliyun.com/zh/model-studio/models'],
];

/** 按厂商名 / 模型名猜价格页；猜不到返回空串。 */
export function vendorPricePage(...hints: Array<string | null | undefined>): string {
  for (const hint of hints) {
    if (!hint) continue;
    const hit = VENDOR_PRICE_PAGES.find(([re]) => re.test(hint));
    if (hit) return hit[1];
  }
  return '';
}

/** ISO 时间 → 北京日期 YYYY-MM-DD。 */
function beijingDay(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 10);
}

/** 只有文字部分（普通聊天模型）的计费上限可以用表单编辑；语音 / 图片 / 搜索等走高级 JSON。 */
export function isTextOnlyBounds(bounds: RouteBillingBounds | null | undefined): boolean {
  return Boolean(
    bounds?.text && !bounds.tts && !bounds.asr && !bounds.image && !bounds.search && !bounds.decision,
  );
}

/** 已有计费上限 → 表单初始值；没有时按常见值预填。 */
export function boundsToForm(
  bounds: RouteBillingBounds | null | undefined,
  defaults: { vision: boolean; sourceUrl: string },
): BoundsFormValues {
  const text = bounds?.text;
  return {
    contextTokens: text?.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
    maxOutputTokens: text?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    outputParameter: text?.outputParameter ?? 'max_tokens',
    maxImages: text?.maxImages ?? (defaults.vision ? DEFAULT_VISION_IMAGES : 0),
    sourceUrl: bounds?.sourceUrl ?? defaults.sourceUrl,
    checkedAt: bounds ? dayjs(beijingDay(bounds.checkedAt)) : dayjs(),
  };
}

/**
 * 表单 → 契约结构（不在这里校验，交给 client-core 发请求前用契约校验，出错会定位回字段）。
 * 核对日期没改时保留原来的精确时间和暂停标记；改了日期 = 重新核对过，暂停解除。
 */
export function formToBounds(
  values: BoundsFormValues,
  origin: RouteBillingBounds | null | undefined,
): RouteBillingBounds {
  const day = values.checkedAt ? values.checkedAt.format('YYYY-MM-DD') : dayjs().format('YYYY-MM-DD');
  const sameDay = origin ? beijingDay(origin.checkedAt) === day : false;
  const checkedAt = sameDay && origin ? origin.checkedAt : new Date(`${day}T00:00:00+08:00`).toISOString();
  return {
    format: 'billing-bounds-v1',
    ...(sameDay && origin?.pauseReason ? { pauseReason: origin.pauseReason } : {}),
    sourceUrl: (values.sourceUrl ?? '').trim(),
    checkedAt,
    text: {
      contextTokens: values.contextTokens as number,
      maxOutputTokens: values.maxOutputTokens as number,
      totalOutputIncludesReasoning: true,
      outputParameter: values.outputParameter ?? 'max_tokens',
      maxImages: values.maxImages as number,
    },
  } as RouteBillingBounds;
}

const intRule = (min: number, max: number, label: string) => ({
  validator: (_: unknown, value: unknown) => {
    if (value == null || value === '') return Promise.reject(new Error(`填写${label}`));
    if (typeof value !== 'number' || !Number.isInteger(value) || value < min || value > max)
      return Promise.reject(new Error(`${label}要填 ${min} 到 ${max.toLocaleString('en-US')} 的整数`));
    return Promise.resolve();
  },
});

/** 一条线路的计费上限字段（放在 Form.List 里，name 是这条线路的下标）。 */
export function BoundsFields({ name }: { name: number }) {
  return (
    <>
      <div className="form-two">
        <Form.Item
          name={[name, 'bounds', 'contextTokens']}
          label="上下文长度（token）"
          rules={[intRule(1, 10_000_000, '上下文长度')]}
          extra={
            <FieldHelp>
              模型一次最多能读多少 token（聊天记录 + 人设 + 问题），查厂商文档；不确定填 128000。
            </FieldHelp>
          }
        >
          <InputNumber min={1} max={10_000_000} precision={0} step={1000} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name={[name, 'bounds', 'maxOutputTokens']}
          label="最大输出（token）"
          rules={[intRule(1, 32_000, '最大输出')]}
          extra={
            <FieldHelp>
              模型一次最多写多少 token（含思考过程），系统按它预扣积分；最多 32000，不确定填 8192。
            </FieldHelp>
          }
        >
          <InputNumber min={1} max={32_000} precision={0} step={512} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name={[name, 'bounds', 'outputParameter']}
          label="输出参数名"
          rules={[{ required: true, message: '选择输出参数名' }]}
          extra={
            <FieldHelp>
              告诉模型「最多写多少」用的参数名。大多数接口用 max_tokens；OpenAI 的新模型（o 系列、GPT-5
              以后）用 max_completion_tokens。
            </FieldHelp>
          }
        >
          <Select
            options={[
              { value: 'max_tokens', label: 'max_tokens（大多数接口）' },
              { value: 'max_completion_tokens', label: 'max_completion_tokens（OpenAI 新模型）' },
            ]}
          />
        </Form.Item>
        <Form.Item
          name={[name, 'bounds', 'maxImages']}
          label="最多图片数"
          rules={[intRule(0, 20, '最多图片数')]}
          extra={<FieldHelp>一条消息最多带几张图。不支持识图填 0；支持识图一般填 4。</FieldHelp>}
        >
          <InputNumber min={0} max={20} precision={0} style={{ width: '100%' }} />
        </Form.Item>
      </div>
      <Form.Item
        name={[name, 'bounds', 'sourceUrl']}
        label="资料来源链接"
        rules={[
          { required: true, message: '填写你核对上面数字时看的厂商页面链接' },
          { pattern: /^https:\/\/\S+\.\S+/, message: '需要是以 https:// 开头的完整网址' },
          { max: 2048, message: '链接太长了（最多 2048 个字符）' },
        ]}
        extra={<FieldHelp>你核对上面这些数字时看的厂商页面（价格页或模型文档），必须是 https 链接。</FieldHelp>}
      >
        <Input placeholder="https://ai.google.dev/gemini-api/docs/pricing" />
      </Form.Item>
      <Form.Item
        name={[name, 'bounds', 'checkedAt']}
        label="核对日期"
        rules={[{ required: true, message: '选择核对日期' }]}
        extra={<FieldHelp>你核对资料的日期，不能晚于今天（填未来日期这条线路会暂时用不了）。</FieldHelp>}
      >
        <DatePicker
          style={{ width: 200 }}
          allowClear={false}
          disabledDate={(d) => d.isAfter(dayjs(), 'day')}
        />
      </Form.Item>
    </>
  );
}
