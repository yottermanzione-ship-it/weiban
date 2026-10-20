/**
 * 套餐与价格（10-20 批 E2）：会员档位价格与开通赠送积分、充值档位、注册赠送积分集中在一页。
 * 页面只展示，改动一律在右侧抽屉里编辑后保存。
 */
import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber } from 'antd';
import { MinusCircleOutlined, PlusOutlined } from '@ant-design/icons';
import {
  BillingAdminEndpoints,
  MembershipOrderAdminEndpoints,
  type MembershipSettings,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { useRemote } from '../../data/hooks.js';
import { useFormFeedback } from '../../data/form-feedback.js';
import { DrawerActions, RecordDrawer } from '../../ui/drawer.js';
import { FieldHelp, FormSection, Page, SectionCard, useToast } from '../../ui/page.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import { formatInt } from '../../ui/format.js';
import { yuanFen } from './shared.js';

type Plan = MembershipSettings['plans'][number];
type Editing = 'plans' | 'signup' | 'recharge' | null;

export function PlansPage() {
  const settings = useRemote(MembershipOrderAdminEndpoints.getSettings);
  const recharge = useRemote(BillingAdminEndpoints.getRechargeOptions);
  const [editing, setEditing] = useState<Editing>(null);
  const s = settings.data;
  const r = recharge.data;

  const planColumns: ProColumns<Plan>[] = [
    { title: '档位', width: 100, render: (_, p) => p.name },
    { title: '时长', width: 90, render: (_, p) => `${p.months} 个月` },
    { title: '原价', width: 100, render: (_, p) => yuanFen(p.priceFen) },
    {
      title: '首次价',
      width: 120,
      render: (_, p) => (
        <span>
          {yuanFen(p.firstPriceFen)}
          {p.priceFen > 0 && p.firstPriceFen < p.priceFen && (
            <span className="cell-sub">
              {' '}
              · {Math.round((p.firstPriceFen / p.priceFen) * 100) / 10} 折
            </span>
          )}
        </span>
      ),
    },
    { title: '开通赠送积分', width: 130, render: (_, p) => formatInt(p.bonusPoints) },
    {
      title: '赠送折合',
      render: (_, p) => `约 ${(p.bonusPoints / 100).toFixed(0)} 元的积分`,
    },
  ];

  type Tier = NonNullable<typeof r>['tiers'][number];
  const tierColumns: ProColumns<Tier>[] = [
    { title: '档位编号', width: 120, render: (_, t) => t.tierId },
    { title: '价格', width: 120, render: (_, t) => `¥${t.priceMicros / 1_000_000}` },
    {
      title: '到账积分',
      render: (_, t) =>
        `${formatInt((t.priceMicros / 1_000_000) * (r?.pointsPerYuan ?? 100))} 积分`,
    },
  ];

  return (
    <Page
      title="套餐与价格"
      desc="会员价格与开通赠送、充值档位、注册赠送积分都在这一页。点「编辑」在右侧修改，保存后用户端立即生效。"
      extra={
        <Button
          onClick={() => {
            settings.refresh();
            recharge.refresh();
          }}
        >
          刷新
        </Button>
      }
    >
      {(settings.error || recharge.error) && (
        <Alert type="error" showIcon message={settings.error || recharge.error} />
      )}
      <SectionCard
        title="PRO+ 会员档位"
        desc="首次价每人一次（任一档）；开通即一次性送积分，计入赠送积分"
        extra={
          <Button type="primary" disabled={!s} onClick={() => setEditing('plans')}>
            编辑
          </Button>
        }
      >
        <DataTable<Plan>
          rowKey="planId"
          size="small"
          columns={planColumns}
          data={s?.plans}
          loading={settings.loading}
          pagination={false}
          onRowClick={() => setEditing('plans')}
        />
        {s && (
          <div className="detail-muted" style={{ marginTop: 8 }}>
            用户端「联系管理员开通」说明：{s.contactHint || '（未填写）'}
          </div>
        )}
      </SectionCard>
      <SectionCard
        title="充值档位"
        desc={
          r
            ? `1 元 = ${r.pointsPerYuan} 积分，不赠送；暂未接在线支付，用户点充值会看到联系说明`
            : undefined
        }
        extra={
          <Button type="primary" disabled={!r} onClick={() => setEditing('recharge')}>
            编辑
          </Button>
        }
      >
        <DataTable<Tier>
          rowKey="tierId"
          size="small"
          columns={tierColumns}
          data={r?.tiers}
          loading={recharge.loading}
          pagination={false}
          onRowClick={() => setEditing('recharge')}
        />
        {r && (
          <div className="detail-muted" style={{ marginTop: 8 }}>
            用户端「联系管理员充值」说明：{r.contactHint || '（未填写）'}
          </div>
        )}
      </SectionCard>
      <SectionCard
        title="注册赠送积分"
        desc="新用户注册时一次性赠送（赠送积分，永久有效）"
        extra={
          <Button type="primary" disabled={!s} onClick={() => setEditing('signup')}>
            编辑
          </Button>
        }
      >
        <div className="mini-stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
          <div className="mini-stat">
            <span>每个新用户</span>
            <strong>{s ? formatInt(s.signupBonusPoints) : '—'}</strong>
            <em>{s && s.signupBonusPoints === 0 ? '0 = 不送' : '积分'}</em>
          </div>
        </div>
      </SectionCard>
      {editing === 'plans' && s && (
        <PlansDrawer
          settings={s}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            settings.refresh();
          }}
        />
      )}
      {editing === 'signup' && s && (
        <SignupDrawer
          settings={s}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            settings.refresh();
          }}
        />
      )}
      {editing === 'recharge' && r && (
        <RechargeDrawer
          options={r}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            recharge.refresh();
          }}
        />
      )}
    </Page>
  );
}

// ---------- 会员档位 ----------

interface PlansForm {
  contactHint: string;
  plans: Array<{ name: string; priceYuan: number; firstPriceYuan: number; bonusPoints: number }>;
}

const toFen = (yuan: number) => Math.round(Number(yuan) * 100);

function PlansDrawer({
  settings,
  onClose,
  onSaved,
}: {
  settings: MembershipSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form] = Form.useForm<PlansForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    const bad = values.plans.findIndex((p) => toFen(p.firstPriceYuan) > toFen(p.priceYuan));
    if (bad >= 0) {
      setError(feedback.reportField(['plans', bad, 'firstPriceYuan'], '首次价不能高于原价'));
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.call(MembershipOrderAdminEndpoints.updateSettings, {
        body: {
          ...settings,
          contactHint: values.contactHint ?? '',
          plans: settings.plans.map((p, i) => ({
            ...p,
            name: values.plans[i]!.name.trim(),
            priceFen: toFen(values.plans[i]!.priceYuan),
            firstPriceFen: toFen(values.plans[i]!.firstPriceYuan),
            bonusPoints: values.plans[i]!.bonusPoints,
          })),
        },
      });
      toast.success('会员档位已保存');
      onSaved();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      width={600}
      form={form}
      draftKey="membership-plans:all"
      title="编辑 PRO+ 会员档位"
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void save()}
          saving={saving}
          error={error}
        />
      }
    >
      <Form<PlansForm>
        form={form}
        layout="vertical"
        initialValues={{
          contactHint: settings.contactHint,
          plans: settings.plans.map((p) => ({
            name: p.name,
            priceYuan: p.priceFen / 100,
            firstPriceYuan: p.firstPriceFen / 100,
            bonusPoints: p.bonusPoints,
          })),
        }}
      >
        {settings.plans.map((p, i) => (
          <div key={p.planId}>
            <FormSection title={`${p.name}（${p.months} 个月）`} />
            <div className="form-row-4">
              <Form.Item
                label="名称"
                name={['plans', i, 'name']}
                rules={[{ required: true, message: '填写名称' }]}
              >
                <Input maxLength={10} />
              </Form.Item>
              <Form.Item
                label="原价"
                name={['plans', i, 'priceYuan']}
                rules={[{ required: true, message: '填写原价' }]}
              >
                <InputNumber
                  min={0}
                  max={100000}
                  precision={2}
                  addonAfter="元"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item
                label="首次价"
                name={['plans', i, 'firstPriceYuan']}
                rules={[{ required: true, message: '填写首次价' }]}
              >
                <InputNumber
                  min={0}
                  max={100000}
                  precision={2}
                  addonAfter="元"
                  style={{ width: '100%' }}
                />
              </Form.Item>
              <Form.Item
                label="开通赠送"
                name={['plans', i, 'bonusPoints']}
                rules={[{ required: true, message: '填写赠送积分' }]}
              >
                <InputNumber
                  min={0}
                  max={10_000_000}
                  precision={0}
                  addonAfter="积分"
                  style={{ width: '100%' }}
                />
              </Form.Item>
            </div>
          </div>
        ))}
        <FormSection title="用户端说明" />
        <Form.Item
          name="contactHint"
          label="「联系管理员开通」说明"
          extra={<FieldHelp>用户在会员页点开通时看到的话，例：加微信 xxx，备注微伴号。</FieldHelp>}
        >
          <Input.TextArea rows={2} maxLength={200} showCount />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

function SignupDrawer({
  settings,
  onClose,
  onSaved,
}: {
  settings: MembershipSettings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form] = Form.useForm<{ signupBonusPoints: number }>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(MembershipOrderAdminEndpoints.updateSettings, {
        body: { ...settings, signupBonusPoints: values.signupBonusPoints },
      });
      toast.success('注册赠送已保存');
      onSaved();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      width={460}
      form={form}
      draftKey="signup-bonus:all"
      title="编辑注册赠送积分"
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void save()}
          saving={saving}
          error={error}
        />
      }
    >
      <Form
        form={form}
        layout="vertical"
        initialValues={{ signupBonusPoints: settings.signupBonusPoints }}
      >
        <Form.Item
          name="signupBonusPoints"
          label="每个新用户赠送"
          rules={[{ required: true, message: '填写积分数（不送填 0）' }]}
          extra={<FieldHelp>只对保存之后注册的新用户生效；0 = 不送。1 元 = 100 积分。</FieldHelp>}
        >
          <InputNumber
            min={0}
            max={1_000_000}
            precision={0}
            addonAfter="积分"
            style={{ width: '100%' }}
          />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

// ---------- 充值档位 ----------

interface TierForm {
  contactHint: string;
  tiers: Array<{ tierId: string; yuan: number }>;
}

function RechargeDrawer({
  options,
  onClose,
  onSaved,
}: {
  options: {
    tiers: Array<{ tierId: string; priceMicros: number }>;
    contactHint: string;
    pointsPerYuan: number;
  };
  onClose: () => void;
  onSaved: () => void;
}) {
  const toast = useToast();
  const [form] = Form.useForm<TierForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

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
      toast.success('充值档位已保存');
      onSaved();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      width={560}
      form={form}
      draftKey="recharge-tiers:all"
      title="编辑充值档位"
      subtitle={`1 元 = ${options.pointsPerYuan} 积分，不赠送`}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void save()}
          saving={saving}
          error={error}
        />
      }
    >
      <Form<TierForm>
        form={form}
        layout="vertical"
        initialValues={{
          contactHint: options.contactHint,
          tiers: options.tiers.map((t) => ({ tierId: t.tierId, yuan: t.priceMicros / 1_000_000 })),
        }}
      >
        <FormSection title="档位" desc="最多 12 个" />
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
                    shouldUpdate={(prev: TierForm, next: TierForm) =>
                      prev.tiers?.[field.name]?.yuan !== next.tiers?.[field.name]?.yuan
                    }
                  >
                    {({ getFieldValue }) => (
                      <span className="tier-points">
                        到账{' '}
                        {formatInt(
                          Number(getFieldValue(['tiers', field.name, 'yuan']) ?? 0) *
                            options.pointsPerYuan,
                        )}{' '}
                        积分
                      </span>
                    )}
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
                添加档位
              </Button>
            </div>
          )}
        </Form.List>
        <FormSection title="用户端说明" />
        <Form.Item
          name="contactHint"
          label="「联系管理员充值」说明"
          rules={[{ required: true, message: '填写联系说明' }]}
          extra={
            <FieldHelp>用户点「充值」时弹窗里显示的话，例：加微信 xxx，备注微伴号。</FieldHelp>
          }
        >
          <Input.TextArea rows={3} maxLength={200} showCount />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}
