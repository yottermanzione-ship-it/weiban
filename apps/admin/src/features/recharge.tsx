/**
 * 充值档位：用户端「充值」页按这里的档位显示。第一版不开真实支付，按钮是「联系管理员」。
 */
import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Space } from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import { BillingAdminEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/hooks.js';
import { Page, SectionCard, useToast } from '../ui/page.js';
import { FieldHelp, FormSection } from '../ui/page.js';
import { formatInt } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';

interface TierForm {
  contactHint: string;
  tiers: Array<{ tierId: string; yuan: number }>;
}

export function RechargePage() {
  const toast = useToast();
  const options = useRemote(BillingAdminEndpoints.getRechargeOptions);
  const [form] = Form.useForm<TierForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const data = options.data;

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(BillingAdminEndpoints.updateRechargeOptions, {
        body: {
          tiers: values.tiers.map((tier) => ({
            tierId: tier.tierId.trim(),
            priceMicros: Math.round(tier.yuan * 1_000_000),
            bonusPercent: 0,
          })),
          contactHint: values.contactHint,
        },
      });
      toast.success('已保存');
      options.refresh();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <Page
      title="充值档位"
      desc="用户在「充值」页看到的档位。第一版没有接真实支付，按钮是「联系管理员充值」。"
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()} disabled={!data}>
          保存
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      {options.error && <Alert type="error" showIcon message={options.error} />}
      {data && (
        <Form<TierForm>
          form={form}
          layout="vertical"
          initialValues={{
            contactHint: data.contactHint,
            tiers: data.tiers.map((t) => ({
              tierId: t.tierId,
              yuan: t.priceMicros / 1_000_000,
            })),
          }}
        >
          <SectionCard title="档位" desc={`1 元 = ${data.pointsPerYuan} 积分，不赠送`}>
            <Form.List name="tiers">
              {(fields, { add, remove }) => (
                <div className="tier-list">
                  {fields.map((field, index) => (
                    <div className="tier-row" key={field.key}>
                      <Form.Item
                        name={[field.name, 'tierId']}
                        rules={[{ required: true, message: '填写档位编号' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <Input maxLength={32} placeholder="档位编号" addonBefore={`#${index + 1}`} />
                      </Form.Item>
                      <Form.Item
                        name={[field.name, 'yuan']}
                        rules={[{ required: true, message: '填写价格' }]}
                        style={{ marginBottom: 0 }}
                      >
                        <InputNumber
                          min={1}
                          step={10}
                          style={{ width: '100%' }}
                          addonAfter="元"
                          placeholder="价格"
                        />
                      </Form.Item>
                      <Form.Item
                        noStyle
                        shouldUpdate={(prev, next) =>
                          prev.tiers?.[field.name]?.yuan !== next.tiers?.[field.name]?.yuan
                        }
                      >
                        {({ getFieldValue }) => {
                          const yuan = Number(getFieldValue(['tiers', field.name, 'yuan']) ?? 0);
                          return (
                            <span className="tier-points">
                              到账 {formatInt(yuan * data.pointsPerYuan)} 积分
                            </span>
                          );
                        }}
                      </Form.Item>
                      <Button
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        onClick={() => remove(field.name)}
                      />
                    </div>
                  ))}
                  <Button
                    type="dashed"
                    block
                    icon={<PlusOutlined />}
                    disabled={fields.length >= 12}
                    onClick={() => add({ tierId: `t${fields.length + 1}`, yuan: 10 })}
                  >
                    添加档位（最多 12 个）
                  </Button>
                </div>
              )}
            </Form.List>
          </SectionCard>
          <div style={{ height: 12 }} />
          <SectionCard title="联系管理员说明" desc="用户点「充值」时弹窗里显示的话">
            <FormSection title="文案" />
            <Form.Item
              name="contactHint"
              rules={[{ required: true, message: '填写联系说明' }]}
              extra={<FieldHelp>写清楚怎么联系你，例：加微信 xxx，备注微伴号。</FieldHelp>}
            >
              <Input.TextArea rows={3} maxLength={200} showCount />
            </Form.Item>
            <Space>
              <Button type="primary" loading={saving} onClick={() => void save()}>
                保存
              </Button>
              <Button onClick={() => form.resetFields()}>还原</Button>
            </Space>
          </SectionCard>
        </Form>
      )}
    </Page>
  );
}
