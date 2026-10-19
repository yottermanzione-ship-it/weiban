/**
 * 会员与订单（3.17 会员 v5，docs/refactor/16-membership-v5.md §3、§7）。
 * - 开通 PRO+：现阶段没有在线支付，管理员收款后在这里替用户开通某档。系统自动判断首次价、记订单、
 *   叠加到期时间并一次性发赠送积分（同一事务，重复点不会重复开通）。
 * - 订单列表；会员档位价格 / 赠送积分 / 联系说明 / 注册赠送积分配置。
 * - 手动改到期时间保留为「纠错」用：不记订单、不发积分。
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Switch,
} from 'antd';
import {
  MembershipAdminEndpoints,
  MembershipOrderAdminEndpoints,
  type MembershipOrder,
  type MembershipSettings,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import {
  FieldHelp,
  Page,
  SectionCard,
  StatusTag,
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { formatDateTime } from '../ui/format.js';

const PLAN_NAME: Record<string, string> = { month: '月卡', quarter: '季卡', year: '年卡' };
const yuan = (fen: number) => `¥${(fen / 100).toFixed(fen % 100 === 0 ? 0 : 1)}`;

interface Loaded {
  userId: string;
  tier: string;
  expiresAt: string | null;
}

function OpenMembership({ settings, onDone }: { settings?: MembershipSettings; onDone(): void }) {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [userId, setUserId] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [firstUsed, setFirstUsed] = useState(false);
  const [planId, setPlanId] = useState<'month' | 'quarter' | 'year'>('month');
  const [useFirst, setUseFirst] = useState(true);
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [expiry, setExpiry] = useState('');
  // 一次开通操作一个幂等键：网络重试不会重复开通；开通成功后换新键。
  const [orderKey, setOrderKey] = useState(() => crypto.randomUUID());
  const plan = settings?.plans.find((p) => p.planId === planId);
  const firstApplies = !firstUsed && useFirst;

  async function load() {
    const id = userId.trim();
    if (!id) return;
    setLoading(true);
    setError('');
    try {
      const result = await api.call(MembershipAdminEndpoints.get, { params: { userId: id } });
      const orders = await api.call(MembershipOrderAdminEndpoints.listOrders, {
        query: { userId: id, limit: 100 },
      });
      setLoaded({ userId: id, tier: result.tier, expiresAt: result.expiresAt });
      setFirstUsed(orders.items.some((o) => o.firstPurchase));
    } catch (e) {
      setLoaded(null);
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function open() {
    if (!loaded || !plan) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.call(MembershipOrderAdminEndpoints.createOrder, {
        body: {
          clientOrderId: orderKey,
          userId: loaded.userId,
          planId,
          useFirstPrice: useFirst,
          ...(note.trim() ? { note: note.trim() } : {}),
        },
      });
      setLoaded({
        userId: loaded.userId,
        tier: result.membership.tier,
        expiresAt: result.membership.expiresAt,
      });
      if (result.order.firstPurchase) setFirstUsed(true);
      setOrderKey(crypto.randomUUID());
      setNote('');
      toast.success(
        `已开通 ${PLAN_NAME[planId]}，到期 ${formatDateTime(result.order.endsAt)}，已送 ${result.order.bonusPoints} 积分`,
      );
      onDone();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function setExpiryDirect(revoke: boolean) {
    if (!loaded) return;
    setSaving(true);
    setError('');
    try {
      const result = await api.call(MembershipAdminEndpoints.set, {
        params: { userId: loaded.userId },
        body: { expiresAt: revoke ? null : new Date(`${expiry}T23:59:59+08:00`).toISOString() },
      });
      setLoaded({ userId: loaded.userId, tier: result.tier, expiresAt: result.expiresAt });
      toast.success(revoke ? '已撤销 PRO+' : '已保存');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="开通 PRO+"
      desc="收到用户付款后在这里开通。系统自动记订单、叠加到期时间、一次性发赠送积分；重复点击不会重复开通。"
    >
      <Space.Compact style={{ width: 520, maxWidth: '100%' }}>
        <Input
          placeholder="粘贴用户 ID（在「用户列表」点开一行可以看到）"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
          onPressEnter={() => void load()}
          allowClear
        />
        <Button type="primary" loading={loading} onClick={() => void load()}>
          查询
        </Button>
      </Space.Compact>
      {error && <Alert type="error" showIcon message={error} style={{ marginTop: 12 }} />}
      {loaded && (
        <>
          <div style={{ height: 14 }} />
          <div className="detail-grid">
            <div>
              <span className="detail-label">当前档位</span>
              <StatusTag tone={loaded.tier === 'pro_plus' ? 'success' : 'default'}>
                {loaded.tier === 'pro_plus' ? 'PRO+' : '免费'}
              </StatusTag>
            </div>
            <div>
              <span className="detail-label">到期时间</span>
              <span>{loaded.expiresAt ? formatDateTime(loaded.expiresAt) : '无'}</span>
            </div>
            <div>
              <span className="detail-label">首次价</span>
              <span>{firstUsed ? '已用过' : '还可以用'}</span>
            </div>
          </div>
          <div style={{ height: 14 }} />
          <Form layout="vertical">
            <Form.Item label="档位">
              <Radio.Group value={planId} onChange={(e) => setPlanId(e.target.value)}>
                {settings?.plans.map((p) => (
                  <Radio.Button key={p.planId} value={p.planId}>
                    {p.name} {yuan(p.priceFen)}（首次 {yuan(p.firstPriceFen)}）
                  </Radio.Button>
                ))}
              </Radio.Group>
            </Form.Item>
            <Form.Item
              label="按首次价"
              extra={
                <FieldHelp>
                  每人只有一次首次价（任一档）。用户已经按原价付款时关掉它。
                </FieldHelp>
              }
            >
              <Switch checked={useFirst} disabled={firstUsed} onChange={setUseFirst} />
            </Form.Item>
            <Form.Item label="备注（可选）">
              <Input
                value={note}
                maxLength={200}
                onChange={(e) => setNote(e.target.value)}
                placeholder="例：微信收款 12.9 元"
                style={{ width: 360, maxWidth: '100%' }}
              />
            </Form.Item>
          </Form>
          {plan && (
            <p>
              本次：{plan.name}，收 {yuan(firstApplies ? plan.firstPriceFen : plan.priceFen)}，
              会员延长 {plan.months} 个月，送 {plan.bonusPoints} 积分。
            </p>
          )}
          <Button
            type="primary"
            loading={saving}
            disabled={!plan}
            onClick={() =>
              confirm({
                title: `给这个用户开通 ${plan?.name ?? ''}？`,
                content: '开通后积分立即到账，不能自动撤回（需要时用「用户列表」扣积分）。',
                okText: '开通',
                onOk: () => open(),
              })
            }
          >
            开通
          </Button>
          <Collapse
            style={{ marginTop: 16 }}
            items={[
              {
                key: 'manual',
                label: '手动改到期时间（纠错用：不记订单、不发积分）',
                children: (
                  <Space wrap>
                    <Input
                      type="date"
                      style={{ width: 200 }}
                      value={expiry}
                      onChange={(e) => setExpiry(e.target.value)}
                    />
                    <Button
                      disabled={!expiry || saving}
                      onClick={() => void setExpiryDirect(false)}
                    >
                      改到期日
                    </Button>
                    <Button
                      danger
                      disabled={loaded.tier !== 'pro_plus' || saving}
                      onClick={() =>
                        confirm({
                          title: '撤销 PRO+？',
                          content: '撤销后用户立即回到免费档位，不会改变积分余额。',
                          okText: '撤销',
                          onOk: () => setExpiryDirect(true),
                        })
                      }
                    >
                      撤销 PRO+
                    </Button>
                  </Space>
                ),
              },
            ]}
          />
        </>
      )}
    </SectionCard>
  );
}

function SettingsCard({
  settings,
  onSaved,
}: {
  settings: MembershipSettings;
  onSaved(): void;
}) {
  const toast = useToast();
  const [form] = Form.useForm<MembershipSettings>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    setError('');
    try {
      await api.call(MembershipOrderAdminEndpoints.updateSettings, {
        body: {
          contactHint: values.contactHint ?? '',
          signupBonusPoints: values.signupBonusPoints,
          plans: settings.plans.map((p, i) => ({
            ...p,
            name: values.plans[i]!.name,
            priceFen: Math.round(Number(values.plans[i]!.priceFen)),
            firstPriceFen: Math.round(Number(values.plans[i]!.firstPriceFen)),
            bonusPoints: values.plans[i]!.bonusPoints,
          })),
        },
      });
      toast.success('已保存');
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="会员配置"
      desc="价格以「分」填写（20 元填 2000）。赠送积分开通即到账、永久有效。"
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存配置
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Form<MembershipSettings> form={form} layout="vertical" initialValues={settings}>
        {settings.plans.map((p, i) => (
          <Space key={p.planId} wrap align="start">
            <Form.Item label={`${PLAN_NAME[p.planId]}名称`} name={['plans', i, 'name']} rules={[{ required: true }]}>
              <Input style={{ width: 100 }} maxLength={10} />
            </Form.Item>
            <Form.Item label="原价（分）" name={['plans', i, 'priceFen']} rules={[{ required: true }]}>
              <InputNumber min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="首次价（分）" name={['plans', i, 'firstPriceFen']} rules={[{ required: true }]}>
              <InputNumber min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="赠送积分" name={['plans', i, 'bonusPoints']} rules={[{ required: true }]}>
              <InputNumber min={0} precision={0} style={{ width: 120 }} />
            </Form.Item>
            <Form.Item label="时长">
              <span>{p.months} 个月</span>
            </Form.Item>
          </Space>
        ))}
        <Form.Item
          label="注册赠送积分"
          name="signupBonusPoints"
          rules={[{ required: true }]}
          extra={<FieldHelp>新用户注册时一次性赠送（赠送积分）。0 = 不送；数额待总经理定。</FieldHelp>}
        >
          <InputNumber min={0} max={1_000_000} precision={0} style={{ width: 160 }} />
        </Form.Item>
        <Form.Item label="用户端「联系管理员开通」说明" name="contactHint">
          <Input.TextArea maxLength={200} rows={2} style={{ maxWidth: 520 }} />
        </Form.Item>
      </Form>
    </SectionCard>
  );
}

export function MembershipPage() {
  const settings = useRemote(MembershipOrderAdminEndpoints.getSettings);
  const [filterUser, setFilterUser] = useState('');
  const userFilter = filterUser.trim();
  const orders = useRemote(MembershipOrderAdminEndpoints.listOrders, {
    query: { limit: 100, ...(/^[0-9a-f-]{36}$/i.test(userFilter) ? { userId: userFilter } : {}) },
  });
  const columns: ProColumns<MembershipOrder>[] = [
    { title: '时间', dataIndex: 'createdAt', render: (_, r) => formatDateTime(r.createdAt) },
    { title: '用户 ID', dataIndex: 'userId', ellipsis: true },
    { title: '档位', dataIndex: 'planId', render: (_, r) => PLAN_NAME[r.planId] ?? r.planId },
    {
      title: '价格',
      dataIndex: 'priceFen',
      render: (_, r) => (
        <span>
          {yuan(r.priceFen)} {r.firstPurchase && <StatusTag tone="success">首次</StatusTag>}
        </span>
      ),
    },
    { title: '赠送积分', dataIndex: 'bonusPoints' },
    {
      title: '生效区间',
      dataIndex: 'endsAt',
      render: (_, r) => `${formatDateTime(r.startsAt)} → ${formatDateTime(r.endsAt)}`,
    },
    { title: '备注', dataIndex: 'note', ellipsis: true, render: (_, r) => r.note ?? '—' },
  ];
  return (
    <Page title="会员与订单" desc="PRO+ 开通、订单记录、价格与赠送配置。暂未接在线支付。">
      {settings.error && <Alert type="error" showIcon message={settings.error} />}
      <OpenMembership settings={settings.data} onDone={() => orders.refresh()} />
      <SectionCard title="订单" desc="新到旧，最多显示 100 条。">
        <Input
          placeholder="按用户 ID 筛选"
          value={filterUser}
          onChange={(e) => setFilterUser(e.target.value)}
          allowClear
          style={{ width: 360, maxWidth: '100%', marginBottom: 12 }}
        />
        <DataTable<MembershipOrder>
          rowKey="orderId"
          columns={columns}
          data={orders.data?.items}
          loading={orders.loading}
          error={orders.error}
          onRefresh={() => orders.refresh()}
          emptyTitle="还没有开通订单"
          emptyHint="在上面「开通 PRO+」里给用户开通后，这里会出现记录。"
        />
      </SectionCard>
      {settings.data && (
        <SettingsCard settings={settings.data} onSaved={() => settings.refresh()} />
      )}
    </Page>
  );
}
