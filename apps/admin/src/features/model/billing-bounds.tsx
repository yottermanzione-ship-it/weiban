/**
 * 计费上限（billing-bounds-v1）的结构化表单：管理员填几个数字，前端拼成契约要求的 JSON。
 * 契约：packages/contracts/src/http/model-access.ts RouteBillingBounds。
 * 没有计费上限的线路，调用前会被服务器拒绝（角色不回消息）。
 * 3.24（试用反馈第二轮 F2 第 1 条）：去掉「资料来源链接」「核对日期」；核对时间由服务器在保存时记下。
 */
import { Checkbox, Form, InputNumber, Select } from 'antd';
import type { RouteBillingBounds } from '@weiban/contracts';
import { FieldHelp } from '../../ui/page.js';

export type OutputParameter = 'max_tokens' | 'max_completion_tokens';

export interface BoundsFormValues {
  contextTokens?: number | null;
  maxOutputTokens?: number | null;
  outputParameter?: OutputParameter;
  maxImages?: number | null;
  /** 线路被「用量未知」暂停时：勾选 = 已重新核对，保存后恢复。 */
  resume?: boolean;
}

export const DEFAULT_CONTEXT_TOKENS = 128_000;
export const DEFAULT_MAX_OUTPUT_TOKENS = 8_192;
export const DEFAULT_VISION_IMAGES = 4;

/** 只有文字部分（普通聊天模型）的计费上限可以用表单编辑；语音 / 图片 / 搜索等走高级 JSON。 */
export function isTextOnlyBounds(bounds: RouteBillingBounds | null | undefined): boolean {
  return Boolean(
    bounds?.text && !bounds.tts && !bounds.asr && !bounds.image && !bounds.search && !bounds.decision,
  );
}

/** 已有计费上限 → 表单初始值；没有时按常见值预填。 */
export function boundsToForm(
  bounds: RouteBillingBounds | null | undefined,
  defaults: { vision: boolean },
): BoundsFormValues {
  const text = bounds?.text;
  return {
    contextTokens: text?.contextTokens ?? DEFAULT_CONTEXT_TOKENS,
    maxOutputTokens: text?.maxOutputTokens ?? DEFAULT_MAX_OUTPUT_TOKENS,
    outputParameter: text?.outputParameter ?? 'max_tokens',
    maxImages: text?.maxImages ?? (defaults.vision ? DEFAULT_VISION_IMAGES : 0),
    resume: false,
  };
}

/**
 * 表单 → 契约结构（不在这里校验，交给 client-core 发请求前用契约校验，出错会定位回字段）。
 * 数字都没改、也没勾「已重新核对」时原样提交原来的计费上限（保留服务器记下的核对时间和暂停标记）；
 * 改了数字或勾了「已重新核对」= 重新核对过：不带核对时间（服务器记为保存时刻），暂停解除。
 */
export function formToBounds(
  values: BoundsFormValues,
  origin: RouteBillingBounds | null | undefined,
): RouteBillingBounds {
  const text = {
    contextTokens: values.contextTokens as number,
    maxOutputTokens: values.maxOutputTokens as number,
    totalOutputIncludesReasoning: true as const,
    outputParameter: values.outputParameter ?? 'max_tokens',
    maxImages: values.maxImages as number,
  };
  const old = origin?.text;
  const unchanged =
    !!origin &&
    isTextOnlyBounds(origin) &&
    !!old &&
    old.contextTokens === text.contextTokens &&
    old.maxOutputTokens === text.maxOutputTokens &&
    old.outputParameter === text.outputParameter &&
    old.maxImages === text.maxImages;
  if (unchanged && !values.resume) return origin;
  return {
    format: 'billing-bounds-v1',
    // 旧数据里的资料链接原样保留（表单不再显示、不再要求）
    ...(origin?.sourceUrl ? { sourceUrl: origin.sourceUrl } : {}),
    text,
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

/** 一条线路的计费上限字段（放在 Form.List 里，name 是这条线路的下标）。paused = 这条线路被「用量未知」暂停。 */
export function BoundsFields({ name, paused = false }: { name: number; paused?: boolean }) {
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
              模型一次最多写多少 token（含思考过程），系统按它预扣积分；最多 32000，不确定填 8192。小于 600
              时一条聊天回复都不够，模型会显示「暂时无法使用」。
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
              以后）用 max_completion_tokens。Anthropic 协议的线路忽略这一项（固定用 max_tokens）。
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
      {paused && (
        <Form.Item name={[name, 'bounds', 'resume']} valuePropName="checked">
          <Checkbox>已重新核对上面的数字，保存后恢复这条线路</Checkbox>
        </Form.Item>
      )}
    </>
  );
}
