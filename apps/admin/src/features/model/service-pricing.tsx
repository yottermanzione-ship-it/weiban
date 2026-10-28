import { Alert, Button, Checkbox, Form, InputNumber, Select } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import type { RouteBillingBounds } from '@weiban/contracts';
import { FieldHelp } from '../../ui/page.js';

export const SERVICE_UNIT_LABELS = {
  search_call: '每次成功搜索',
  tts_10k_chars: '每万字语音合成',
  asr_minute: '每分钟语音识别',
  realtime_minute: '每分钟通话',
  image: '每张图片',
  audio_input_tokens_per_million: '实时通话音频输入 / 百万 token',
  audio_output_tokens_per_million: '实时通话音频输出 / 百万 token',
  // 4.6：实时通话按需复刻音色（只对成功的复刻收费；Omni 成本 0.01 元/个）
  voice_clone: '每个复刻音色（实时通话）',
} as const;
export type ServiceUnit = keyof typeof SERVICE_UNIT_LABELS;
export interface ServicePriceDraft {
  unit: ServiceUnit;
  price?: number | null;
  cost?: number | null;
  hasTimeBands?: boolean;
}
export const isSearchKind = (kind: string | undefined) =>
  kind === 'deepseek_search' || kind === 'bocha_search';
export const isSearchOnlyBounds = (bounds: RouteBillingBounds | null | undefined) =>
  Boolean(
    bounds?.search &&
    !bounds.text &&
    !bounds.tts &&
    !bounds.asr &&
    !bounds.image &&
    !bounds.decision &&
    !bounds.realtime,
  );
export function searchFormToBounds(
  maxResults: number | null | undefined,
  resume: boolean | undefined,
  origin: RouteBillingBounds | null | undefined,
): RouteBillingBounds {
  const count = maxResults ?? origin?.search?.maxResults ?? 5;
  if (isSearchOnlyBounds(origin) && origin?.search?.maxResults === count && !resume) return origin!;
  return {
    format: 'billing-bounds-v1',
    ...(origin?.sourceUrl ? { sourceUrl: origin.sourceUrl } : {}),
    search: { maxResults: count, billableCalls: 1 },
  };
}
export function SearchBoundsFields({ name, paused }: { name: number; paused: boolean }) {
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="搜索按成功请求次数计费，不按输入/输出 token 计价。"
        description="一次请求固定最多记 1 次；返回条数不是扣费次数。空结果与失败依搜索网关的实际回执结算。"
      />
      <Form.Item
        name={[name, 'bounds', 'searchMaxResults']}
        label="单次最多返回条数"
        initialValue={5}
        rules={[
          { required: true, type: 'integer', min: 1, max: 10, message: '填写 1 到 10 的整数' },
        ]}
        extra={
          <FieldHelp>
            微伴单次最多 10 条；DeepSeek 的 count 不是计费次数。无需填写 token 上下文或最大输出。
          </FieldHelp>
        }
      >
        <InputNumber min={1} max={10} precision={0} />
      </Form.Item>
      {paused && (
        <Form.Item name={[name, 'bounds', 'resume']} valuePropName="checked">
          <Checkbox>已重新核对搜索上限，保存后恢复线路</Checkbox>
        </Form.Item>
      )}
    </>
  );
}
export function ServicePriceFields() {
  return (
    <>
      <Alert
        type="info"
        showIcon
        message="按服务实际用量定价"
        description="单位是什么，就填写每个该单位的人民币金额。搜索填「元/次」，不是「元/千次」，也不用伪造 token 价格。字数/分钟单位仅用于上游确实按该维度计费的旧语音；实时语音 / Omni 通话模型：文字 token 填在上方「输入 / 输出」价格，音频 token 在这里分别填「实时通话音频输入 / 输出」（元 / 百万 token），不要换算成分钟。DeepSeek 公开标价 5 元/千次成功请求相当于 0.005 元/次；请核对供应商当前价及账户优惠后保存。"
      />
      <Form.List
        name="serviceRates"
        rules={[
          {
            validator: async (_, rows: ServicePriceDraft[] | undefined) => {
              if (!rows?.length) throw new Error('至少添加一项服务单价');
              if (new Set(rows.map((r) => r.unit)).size !== rows.length)
                throw new Error('同一个计费单位只填一次');
            },
          },
        ]}
      >
        {(fields, { add, remove }, { errors }) => (
          <>
            {fields.map((field) => (
              <div className="form-three" key={field.key}>
                <Form.Item
                  name={[field.name, 'unit']}
                  label="计费单位"
                  rules={[{ required: true, message: '选择计费单位' }]}
                >
                  <Select
                    options={Object.entries(SERVICE_UNIT_LABELS).map(([value, label]) => ({
                      value,
                      label,
                    }))}
                  />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'price']}
                  label="售价（元 / 该单位）"
                  rules={[
                    {
                      required: true,
                      type: 'number',
                      min: 0,
                      max: 100000,
                      message: '填写非负单价；免费请明确填 0',
                    },
                  ]}
                >
                  <InputNumber
                    min={0}
                    max={100000}
                    precision={6}
                    step={0.001}
                    style={{ width: '100%' }}
                    placeholder="如 0.005 元/次"
                  />
                </Form.Item>
                <Form.Item
                  name={[field.name, 'cost']}
                  label="成本（元 / 该单位）"
                  extra={<FieldHelp>不填＝同售价；账户明确免费时可填 0。</FieldHelp>}
                >
                  <InputNumber
                    min={0}
                    max={100000}
                    precision={6}
                    step={0.001}
                    style={{ width: '100%' }}
                    placeholder="同售价"
                  />
                </Form.Item>
                <Button
                  type="text"
                  danger
                  icon={<MinusCircleOutlined />}
                  onClick={() => remove(field.name)}
                >
                  移除本次编辑项
                </Button>
              </div>
            ))}
            <Form.ErrorList errors={errors} />
            <Button
              type="dashed"
              icon={<PlusOutlined />}
              disabled={fields.length >= Object.keys(SERVICE_UNIT_LABELS).length}
              onClick={() => add({ unit: 'search_call', price: null, cost: null })}
            >
              添加服务单价
            </Button>
          </>
        )}
      </Form.List>
      <p className="field-help">
        保存会复制当前有效价目表，仅替换本次提交的单位；其他模型、其他单位的现有价格保留。已有分时价会先提示确认，保存后该单位改为全天价。
      </p>
    </>
  );
}
