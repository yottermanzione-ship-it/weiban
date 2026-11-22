import { Button, Checkbox, Form, InputNumber, Select } from 'antd';
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
      <Form.Item
        name={[name, 'bounds', 'searchMaxResults']}
        label="单次最多返回条数"
        initialValue={5}
        rules={[
          { required: true, type: 'integer', min: 1, max: 10, message: '填写 1 到 10 的整数' },
        ]}
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
export function ServicePriceFields({ showCost = true }: { showCost?: boolean }) {
  return (
    <>
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
                {showCost && (
                  <Form.Item
                    name={[field.name, 'cost']}
                    label="成本（元 / 该单位）"
                    extra={<FieldHelp>留空沿用售价</FieldHelp>}
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
                )}
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
    </>
  );
}
