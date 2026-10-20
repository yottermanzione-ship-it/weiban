/**
 * 用户详情抽屉（10-20 批 E2）：基本资料 / 会员 / 积分 / 用量 / 封禁与删除。
 * 开通会员、调整到期日、加扣积分、订阅记录详情都在右侧子抽屉里完成；危险操作仍用确认框二次确认。
 */
import { useRef, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Space,
  Switch,
  Tabs,
} from 'antd';
import dayjs, { type Dayjs } from 'dayjs';
import {
  AdminUsersEndpoints,
  BillingAdminEndpoints,
  MembershipAdminEndpoints,
  MembershipOrderAdminEndpoints,
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  type AdminLedgerEntry,
  type AdminModel,
  type MembershipPlanId,
  type MembershipSettings,
} from '@weiban/contracts';
import type { z } from 'zod';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
import { useAsync } from '../../data/use-async.js';
import { useFormFeedback } from '../../data/form-feedback.js';
import { DrawerActions, RecordDrawer } from '../../ui/drawer.js';
import { FieldHelp, FormSection, SectionCard, useDangerConfirm, useToast } from '../../ui/page.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import {
  formatDate,
  formatDateTime,
  formatInt,
  formatPoints,
  formatYuan,
  relativeTime,
} from '../../ui/format.js';
import {
  AccountStateTag,
  DAY_MS,
  MembershipTag,
  daysLeft,
  displayName,
  yuanFen,
  type SubRecord,
  type UserRow,
} from './shared.js';
import { SubRecordDrawer, loadUserSubRecords, subColumns } from './sub-records.js';

type LedgerEntry = z.infer<typeof AdminLedgerEntry>;
type TabKey = 'profile' | 'membership' | 'points' | 'usage' | 'safety';

export function UserDetailDrawer({
  row,
  nameOf,
  initialTab = 'profile',
  onClose,
  onChanged,
}: {
  row: UserRow;
  nameOf: (userId: string | null) => string;
  initialTab?: TabKey;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<TabKey>(initialTab);
  const { user, account } = row;
  return (
    <RecordDrawer
      open
      onClose={onClose}
      width={760}
      title={
        <Space size={8}>
          <span>{displayName(user)}</span>
          <MembershipTag user={user} />
          <AccountStateTag user={user} />
        </Space>
      }
      subtitle={
        account
          ? `余额 ${formatPoints(account.balanceMicros)} 积分（${formatYuan(account.balanceMicros)}）· 注册于 ${formatDate(user.createdAt)}`
          : `注册于 ${formatDate(user.createdAt)}`
      }
    >
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as TabKey)}
        items={[
          { key: 'profile', label: '基本资料' },
          { key: 'membership', label: '会员' },
          { key: 'points', label: '积分' },
          { key: 'usage', label: '用量' },
          { key: 'safety', label: '封禁与删除' },
        ]}
      />
      {tab === 'profile' && <ProfilePanel row={row} nameOf={nameOf} />}
      {tab === 'membership' && <MembershipPanel row={row} nameOf={nameOf} onChanged={onChanged} />}
      {tab === 'points' && <PointsPanel row={row} nameOf={nameOf} onChanged={onChanged} />}
      {tab === 'usage' && <UsagePanel row={row} />}
      {tab === 'safety' && (
        <SafetyPanel row={row} nameOf={nameOf} onChanged={onChanged} onClose={onClose} />
      )}
    </RecordDrawer>
  );
}

// ---------- 基本资料 ----------

function ProfilePanel({ row, nameOf }: { row: UserRow; nameOf: (id: string | null) => string }) {
  const { user } = row;
  return (
    <div className="detail-grid">
      <div>
        <span className="detail-label">登录名</span>
        <span>{user.username || '—'}</span>
      </div>
      <div>
        <span className="detail-label">昵称</span>
        <span>{user.nickname || '还没填资料'}</span>
      </div>
      <div>
        <span className="detail-label">用户 ID</span>
        <span className="mono">{user.userId}</span>
      </div>
      <div>
        <span className="detail-label">身份</span>
        <span>{user.role === 'admin' ? '管理员' : '普通用户'}</span>
      </div>
      <div>
        <span className="detail-label">注册时间</span>
        <span>{formatDateTime(user.createdAt)}</span>
      </div>
      <div>
        <span className="detail-label">最近活跃</span>
        <span>
          {user.lastActiveAt
            ? `${formatDateTime(user.lastActiveAt)}（${relativeTime(user.lastActiveAt)}）`
            : '—'}
        </span>
      </div>
      <div>
        <span className="detail-label">账号状态</span>
        <span>
          <AccountStateTag user={user} />
        </span>
      </div>
      <div>
        <span className="detail-label">会员</span>
        <span>
          <MembershipTag user={user} />
          {user.membership.expiresAt && ` 到期 ${formatDate(user.membership.expiresAt)}`}
        </span>
      </div>
      {user.ban && (
        <div>
          <span className="detail-label">封禁</span>
          <span>
            {formatDateTime(user.ban.bannedAt)} 由 {nameOf(user.ban.operatorUserId)} 封禁：
            {user.ban.reason}
          </span>
        </div>
      )}
    </div>
  );
}

// ---------- 会员 ----------

function MembershipPanel({
  row,
  nameOf,
  onChanged,
}: {
  row: UserRow;
  nameOf: (id: string | null) => string;
  onChanged: () => void;
}) {
  const { user } = row;
  const toast = useToast();
  const confirm = useDangerConfirm();
  const settings = useRemote(MembershipOrderAdminEndpoints.getSettings);
  const records = useAsync(`sub:${user.userId}`, () => loadUserSubRecords(user.userId));
  const [drawer, setDrawer] = useState<'open' | 'adjust' | null>(null);
  const [selected, setSelected] = useState<SubRecord | null>(null);
  const [error, setError] = useState('');
  const isPro = user.membership.tier === 'pro_plus';
  const left = daysLeft(user.membership.expiresAt);
  const firstUsed = (records.data ?? []).some((r) => r.order?.firstPurchase);
  const inactive = user.status !== 'active';

  function changed() {
    records.refresh();
    onChanged();
  }

  async function cancel() {
    setError('');
    try {
      await api.call(MembershipAdminEndpoints.set, {
        params: { userId: user.userId },
        body: { expiresAt: null, reason: '后台取消会员' },
      });
      toast.success('已取消 PRO+');
      changed();
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <div className="drawer-body">
      <SectionCard
        title="会员状态"
        extra={
          <Space>
            <Button
              type="primary"
              disabled={inactive || !settings.data}
              onClick={() => setDrawer('open')}
            >
              {isPro ? '续期' : '开通'}
            </Button>
            <Button disabled={inactive} onClick={() => setDrawer('adjust')}>
              调整到期日
            </Button>
            <Button
              danger
              disabled={!isPro || inactive}
              onClick={() =>
                confirm({
                  title: '取消这个用户的 PRO+？',
                  content: '立即回到免费档位。已送的积分不会收回，订单记录保留；之后可以重新开通。',
                  okText: '取消会员',
                  onOk: cancel,
                })
              }
            >
              取消会员
            </Button>
          </Space>
        }
      >
        {(error || settings.error) && (
          <Alert
            type="error"
            showIcon
            message={error || settings.error}
            style={{ marginBottom: 12 }}
          />
        )}
        <div className="detail-grid">
          <div>
            <span className="detail-label">当前档位</span>
            <span>
              <MembershipTag user={user} />
            </span>
          </div>
          <div>
            <span className="detail-label">到期时间</span>
            <span>
              {user.membership.expiresAt ? formatDateTime(user.membership.expiresAt) : '无'}
              {isPro && left !== null && `（还剩 ${left} 天）`}
              {!isPro && user.membership.expiresAt && '（已过期）'}
            </span>
          </div>
          <div>
            <span className="detail-label">首次价</span>
            <span>
              {records.loading
                ? '…'
                : firstUsed
                  ? '已用过（之后按原价）'
                  : '还没用过（开通自动按首次价）'}
            </span>
          </div>
          <div>
            <span className="detail-label">说明</span>
            <span>
              开通 / 续期记订单并发赠送积分；调整到期日、取消只改时间，不记订单、不动积分。
            </span>
          </div>
        </div>
      </SectionCard>
      <div className="detail-section">该用户的订阅记录</div>
      <DataTable<SubRecord>
        rowKey="key"
        size="small"
        columns={subColumns(nameOf, { compact: true })}
        data={records.data}
        loading={records.loading}
        error={records.error}
        onRefresh={records.refresh}
        onRowClick={setSelected}
        pagination={false}
        emptyTitle="还没有订阅记录"
        emptyHint="点上面的「开通」给这个用户开通 PRO+。"
      />
      {drawer === 'open' && settings.data && (
        <OpenMembershipDrawer
          row={row}
          settings={settings.data}
          firstUsed={firstUsed}
          onClose={() => setDrawer(null)}
          onDone={() => {
            setDrawer(null);
            changed();
          }}
        />
      )}
      {drawer === 'adjust' && (
        <AdjustExpiryDrawer
          row={row}
          onClose={() => setDrawer(null)}
          onDone={() => {
            setDrawer(null);
            changed();
          }}
        />
      )}
      {selected && (
        <SubRecordDrawer record={selected} nameOf={nameOf} onClose={() => setSelected(null)} />
      )}
    </div>
  );
}

const BEIJING_OFFSET_MS = 8 * 3_600_000;
/** 和服务器一致：按北京时间自然月往后加（月末对齐）。只用于开通前的预览。 */
function addBeijingMonths(at: Date, months: number): Date {
  const local = new Date(at.getTime() + BEIJING_OFFSET_MS);
  const y = local.getUTCFullYear();
  const m = local.getUTCMonth() + months;
  const lastDay = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  const moved = Date.UTC(
    y,
    m,
    Math.min(local.getUTCDate(), lastDay),
    local.getUTCHours(),
    local.getUTCMinutes(),
  );
  return new Date(moved - BEIJING_OFFSET_MS);
}

interface OpenValues {
  planId: MembershipPlanId;
  useFirstPrice: boolean;
  note?: string;
}

function OpenMembershipDrawer({
  row,
  settings,
  firstUsed,
  onClose,
  onDone,
}: {
  row: UserRow;
  settings: MembershipSettings;
  firstUsed: boolean;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = row;
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [form] = Form.useForm<OpenValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  // 一次开通一个幂等键：网络重试不会重复开通。
  const orderKey = useRef(crypto.randomUUID());
  const planId = Form.useWatch('planId', form) ?? 'month';
  const useFirst = (Form.useWatch('useFirstPrice', form) ?? true) && !firstUsed;
  const plan = settings.plans.find((p) => p.planId === planId);
  const isPro = user.membership.tier === 'pro_plus';
  const base =
    isPro && user.membership.expiresAt ? new Date(user.membership.expiresAt) : new Date();
  const until = plan ? addBeijingMonths(base, plan.months) : null;
  const price = plan ? (useFirst ? plan.firstPriceFen : plan.priceFen) : 0;

  async function submit() {
    const values = await feedback.validate();
    if (!values || !plan) return;
    confirm({
      title: `给 ${displayName(user)} ${isPro ? '续期' : '开通'} ${plan.name}？`,
      content: `收 ${yuanFen(price)}，会员到 ${formatDate(until?.toISOString())}，立即送 ${plan.bonusPoints} 积分。积分到账后不能自动撤回。`,
      okText: isPro ? '确认续期' : '确认开通',
      onOk: async () => {
        setSaving(true);
        setError('');
        try {
          const result = await api.call(MembershipOrderAdminEndpoints.createOrder, {
            body: {
              clientOrderId: orderKey.current,
              userId: user.userId,
              planId: values.planId,
              useFirstPrice: !firstUsed && values.useFirstPrice !== false,
              ...(values.note?.trim() ? { note: values.note.trim() } : {}),
            },
          });
          toast.success(
            `已${isPro ? '续期' : '开通'} ${plan.name}，到期 ${formatDate(result.order.endsAt)}，已送 ${result.order.bonusPoints} 积分`,
          );
          onDone();
        } catch (e) {
          setError(feedback.report(e));
        } finally {
          setSaving(false);
        }
      },
    });
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      width={520}
      form={form}
      draftKey={`membership-open:${user.userId}`}
      title={`${isPro ? '续期' : '开通'} PRO+`}
      subtitle={displayName(user)}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void submit()}
          saving={saving}
          submitText={isPro ? '续期' : '开通'}
          error={error}
        />
      }
    >
      <Form<OpenValues>
        form={form}
        layout="vertical"
        initialValues={{ planId: 'month', useFirstPrice: !firstUsed }}
      >
        <FormSection title="档位" desc="收到用户付款后再开通" />
        <Form.Item name="planId">
          <Radio.Group className="plan-radio">
            {settings.plans.map((p) => (
              <Radio.Button key={p.planId} value={p.planId}>
                <div className="plan-radio-name">{p.name}</div>
                <div className="plan-radio-price">
                  {!firstUsed ? (
                    <>
                      {yuanFen(p.firstPriceFen)} <s>{yuanFen(p.priceFen)}</s>
                    </>
                  ) : (
                    yuanFen(p.priceFen)
                  )}
                </div>
                <div className="plan-radio-sub">
                  {p.months} 个月 · 送 {p.bonusPoints} 积分
                </div>
              </Radio.Button>
            ))}
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="useFirstPrice"
          label="按首次价"
          valuePropName="checked"
          extra={
            <FieldHelp>
              {firstUsed
                ? '这个用户已经用过首次价，本次自动按原价。'
                : '系统识别到这个用户还没用过首次价（每人一次，任一档），默认按首次价；用户已按原价付款时关掉。'}
            </FieldHelp>
          }
        >
          <Switch disabled={firstUsed} />
        </Form.Item>
        <Form.Item name="note" label="备注（可选）">
          <Input maxLength={200} placeholder="例：微信收款 12.9 元" />
        </Form.Item>
      </Form>
      {plan && (
        <Alert
          type="info"
          showIcon
          message={`本次收 ${yuanFen(price)}${useFirst ? '（首次价）' : ''}`}
          description={
            <>
              会员{isPro ? `从 ${formatDate(base.toISOString())} 续` : '从现在开始'} {plan.months}{' '}
              个月，约到 {formatDate(until?.toISOString())}；立即送 {plan.bonusPoints}{' '}
              积分（计入赠送积分）。
            </>
          }
        />
      )}
    </RecordDrawer>
  );
}

interface ExpiryValues {
  date: Dayjs;
  reason: string;
}

function AdjustExpiryDrawer({
  row,
  onClose,
  onDone,
}: {
  row: UserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user } = row;
  const toast = useToast();
  const [form] = Form.useForm<ExpiryValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = user.membership.expiresAt ? dayjs(user.membership.expiresAt) : null;
  const base = current && current.isAfter(dayjs()) ? current : dayjs();

  async function submit() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(MembershipAdminEndpoints.set, {
        params: { userId: user.userId },
        body: {
          expiresAt: new Date(`${values.date.format('YYYY-MM-DD')}T23:59:59+08:00`).toISOString(),
          reason: values.reason.trim(),
        },
      });
      toast.success(`已把到期日改为 ${values.date.format('YYYY-MM-DD')}`);
      onDone();
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
      width={480}
      form={form}
      draftKey={`membership-expiry:${user.userId}`}
      title="调整到期日"
      subtitle={`${displayName(user)} · 现在 ${current ? formatDate(current.toISOString()) : '不是会员'}`}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void submit()}
          saving={saving}
          error={error}
        />
      }
    >
      <Alert
        type="warning"
        showIcon
        message="只改到期时间：不记订单、不收钱、不发积分"
        description="用于补偿、纠错。正常收款开通请用「开通 / 续期」。"
        style={{ marginBottom: 12 }}
      />
      <Form<ExpiryValues> form={form} layout="vertical" initialValues={{ reason: '' }}>
        <Form.Item
          name="date"
          label="新的到期日"
          rules={[{ required: true, message: '选一个日期' }]}
          extra={
            <Space size={6} wrap>
              <FieldHelp>到期当天 23:59（北京时间）失效。快捷：</FieldHelp>
              {[7, 30, 90].map((d) => (
                <Button
                  key={d}
                  size="small"
                  onClick={() => form.setFieldsValue({ date: base.add(d, 'day') })}
                >
                  +{d} 天
                </Button>
              ))}
            </Space>
          }
        >
          <DatePicker
            style={{ width: '100%' }}
            placeholder="选择日期"
            disabledDate={(d) => d.isBefore(dayjs().startOf('day'))}
          />
        </Form.Item>
        <Form.Item
          name="reason"
          label="原因"
          rules={[
            { required: true, message: '写一下原因' },
            { min: 2, message: '至少 2 个字' },
          ]}
          extra={<FieldHelp>会出现在会员订阅记录里。</FieldHelp>}
        >
          <Input maxLength={200} placeholder="例：服务故障补偿 7 天" />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

// ---------- 积分 ----------

const LEDGER_TYPE: Record<string, string> = {
  admin_grant: '加积分',
  admin_deduct: '扣积分',
  charge: '消耗',
  refund: '退款',
  adjustment: '冲正',
};

function PointsPanel({
  row,
  nameOf,
  onChanged,
}: {
  row: UserRow;
  nameOf: (id: string | null) => string;
  onChanged: () => void;
}) {
  const { user, account } = row;
  const [adjusting, setAdjusting] = useState(false);
  const [pages, setPages] = useState<LedgerEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [more, setMore] = useState(false);
  const ledger = useAsync(`ledger:${user.userId}:${account?.updatedAt ?? ''}`, async () => {
    if (!account) return { items: [], nextCursor: null };
    const page = await api.call(BillingAdminEndpoints.listAccountLedger, {
      params: { userId: user.userId },
      query: { limit: 50 },
    });
    setPages([]);
    setCursor(page.nextCursor);
    return page;
  });

  async function loadMore() {
    const next = cursor;
    if (!next) return;
    setMore(true);
    try {
      const page = await api.call(BillingAdminEndpoints.listAccountLedger, {
        params: { userId: user.userId },
        query: { limit: 50, cursor: next },
      });
      setPages((p) => [...p, ...page.items]);
      setCursor(page.nextCursor);
    } finally {
      setMore(false);
    }
  }

  const balance = account?.balanceMicros ?? 0;
  const bonus = Math.min(Math.max(0, account?.bonusBalanceMicros ?? 0), Math.max(0, balance));
  const paid = balance - bonus;

  const columns: ProColumns<LedgerEntry>[] = [
    { title: '时间', width: 150, render: (_, r) => formatDateTime(r.createdAt) },
    { title: '类型', width: 80, render: (_, r) => LEDGER_TYPE[r.type] ?? r.type },
    {
      title: '积分',
      width: 100,
      render: (_, r) => {
        const v = r.points ?? r.amountMicros / 10_000;
        return (
          <span className={v > 0 ? 'income' : ''}>
            {v > 0 ? '+' : ''}
            {formatPoints(r.amountMicros)}
          </span>
        );
      },
    },
    { title: '剩余', width: 90, render: (_, r) => formatPoints(r.balanceAfterMicros) },
    {
      title: '说明',
      render: (_, r) => (
        <span>
          {r.note ?? r.modelKey ?? '—'}
          {r.operatorUserId && <span className="cell-sub"> · {nameOf(r.operatorUserId)}</span>}
        </span>
      ),
    },
  ];

  return (
    <div className="drawer-body">
      <div className="mini-stats" style={{ gridTemplateColumns: 'repeat(4, minmax(0, 1fr))' }}>
        <div className="mini-stat">
          <span>余额</span>
          <strong>{formatPoints(balance)}</strong>
          <em>{formatYuan(balance)}</em>
        </div>
        <div className="mini-stat">
          <span>赠送积分</span>
          <strong>{formatPoints(bonus)}</strong>
          <em>开通会员 / 注册赠送，先扣</em>
        </div>
        <div className="mini-stat">
          <span>充值积分</span>
          <strong>{formatPoints(paid)}</strong>
          <em>余额 − 赠送</em>
        </div>
        <div className="mini-stat">
          <span>处理中（冻结）</span>
          <strong>{formatPoints(account?.heldMicros ?? 0)}</strong>
          <em>回复完成后结算</em>
        </div>
      </div>
      <div className="drawer-row-head">
        <div className="detail-section">积分流水</div>
        <Button
          type="primary"
          disabled={user.status !== 'active'}
          onClick={() => setAdjusting(true)}
        >
          加 / 扣积分
        </Button>
      </div>
      <DataTable<LedgerEntry>
        rowKey="entryId"
        size="small"
        columns={columns}
        data={[...(ledger.data?.items ?? []), ...pages]}
        loading={ledger.loading}
        error={ledger.error}
        onRefresh={ledger.refresh}
        pagination={false}
        footer={
          cursor ? (
            <div style={{ textAlign: 'center' }}>
              <Button loading={more} onClick={() => void loadMore()}>
                加载更早的流水
              </Button>
            </div>
          ) : undefined
        }
        emptyTitle={account ? '还没有流水' : '这个用户还没有钱包'}
        emptyHint="用户每发一条消息、每次加扣积分都会在这里留一行。"
      />
      {adjusting && (
        <AdjustPointsDrawer
          row={row}
          onClose={() => setAdjusting(false)}
          onDone={() => {
            setAdjusting(false);
            ledger.refresh();
            onChanged();
          }}
        />
      )}
    </div>
  );
}

interface AdjustValues {
  direction: 'grant' | 'deduct';
  points: number;
  reason: string;
}

function AdjustPointsDrawer({
  row,
  onClose,
  onDone,
}: {
  row: UserRow;
  onClose: () => void;
  onDone: () => void;
}) {
  const { user, account } = row;
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [form] = Form.useForm<AdjustValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const direction = Form.useWatch('direction', form) ?? 'grant';
  const points = Form.useWatch('points', form) ?? 0;
  const balance = account?.balanceMicros ?? 0;

  async function submit() {
    const values = await feedback.validate();
    if (!values) return;
    const run = async () => {
      setSaving(true);
      setError('');
      try {
        const body = {
          direction: values.direction,
          points: Math.round(values.points * 10_000) / 10_000,
          reason: values.reason.trim(),
        };
        const signature = JSON.stringify(body);
        if (operation.current?.signature !== signature)
          operation.current = { signature, key: crypto.randomUUID() };
        await api.call(BillingAdminEndpoints.adjustBalance, {
          params: { userId: user.userId },
          body: { ...body, idempotencyKey: operation.current.key },
        });
        operation.current = null;
        toast.success(
          values.direction === 'grant' ? `已加 ${body.points} 积分` : `已扣 ${body.points} 积分`,
        );
        onDone();
      } catch (e) {
        setError(feedback.report(e));
      } finally {
        setSaving(false);
      }
    };
    if (values.direction === 'deduct') {
      confirm({
        title: `扣掉 ${values.points} 积分？`,
        content: `扣完余额约 ${formatPoints(balance - values.points * 10_000)} 积分。扣减额不能超过可用余额，操作会记入审计日志。`,
        okText: '确认扣减',
        onOk: run,
      });
    } else {
      await run();
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      width={480}
      form={form}
      draftKey={`points-adjust:${user.userId}`}
      title="加 / 扣积分"
      subtitle={`${displayName(user)} · 余额 ${formatPoints(balance)} 积分`}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void submit()}
          saving={saving}
          submitText={direction === 'deduct' ? '确认扣减' : '确认加积分'}
          error={error}
        />
      }
    >
      <Form<AdjustValues>
        form={form}
        layout="vertical"
        initialValues={{ direction: 'grant', points: 100, reason: '' }}
      >
        <Form.Item name="direction" label="操作">
          <Radio.Group>
            <Radio.Button value="grant">加积分（充值 / 补偿）</Radio.Button>
            <Radio.Button value="deduct">扣积分</Radio.Button>
          </Radio.Group>
        </Form.Item>
        <Form.Item
          name="points"
          label="积分数"
          rules={[
            { required: true, message: '填写积分数量' },
            { type: 'number', min: 0.0001, message: '要大于 0' },
          ]}
          extra={
            <FieldHelp>
              1 元 = 100 积分。{points > 0 ? `折合 ${(points / 100).toFixed(2)} 元。` : ''}
              加的积分算「充值积分」，出现在「充值记录」里。
            </FieldHelp>
          }
        >
          <InputNumber min={0.0001} step={100} style={{ width: '100%' }} addonAfter="积分" />
        </Form.Item>
        <Form.Item
          name="reason"
          label="原因"
          rules={[
            { required: true, message: '填写原因' },
            { min: 2, message: '至少 2 个字' },
          ]}
          extra={<FieldHelp>会写进流水和审计日志，写清楚为什么加 / 扣。</FieldHelp>}
        >
          <Input maxLength={200} placeholder="例：微信收款 50 元充值" />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

// ---------- 用量 ----------

function UsagePanel({ row }: { row: UserRow }) {
  const { user, account } = row;
  const models = useRemote(ModelAccessAdminEndpoints.listModels);
  const usage = useAsync(`usage:${user.userId}`, () => {
    const to = new Date();
    const from = new Date(to.getTime() - 30 * DAY_MS);
    return api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
      body: {
        filter: { from: from.toISOString(), to: to.toISOString(), userIds: [user.userId] },
        groupBy: ['model'],
        sort: 'charged_desc',
        limit: 10,
      },
    });
  });
  const modelName = (key: string) =>
    (models.data?.items ?? []).find((m: AdminModel) => m.modelKey === key)?.displayName ?? key;
  const totals = usage.data?.totals;
  type UsageRow = NonNullable<typeof usage.data>['rows'][number];
  const totalCharged = totals?.chargedMicros ?? 0;
  const columns: ProColumns<UsageRow>[] = [
    {
      title: '模型',
      render: (_, r) => (
        <div className="cell-main">
          <span className="cell-title">{modelName(String(r.keys[0] ?? ''))}</span>
          <span className="cell-sub mono">{r.keys[0]}</span>
        </div>
      ),
    },
    { title: '调用次数', width: 100, render: (_, r) => formatInt(r.calls) },
    { title: '消耗积分', width: 110, render: (_, r) => formatPoints(r.chargedMicros) },
    {
      title: '占比',
      width: 80,
      render: (_, r) =>
        totalCharged > 0 ? `${Math.round((r.chargedMicros / totalCharged) * 100)}%` : '—',
    },
  ];
  return (
    <div className="drawer-body">
      <div className="mini-stats" style={{ gridTemplateColumns: 'repeat(3, minmax(0, 1fr))' }}>
        <div className="mini-stat">
          <span>近 30 天消耗</span>
          <strong>{formatPoints(account?.spentLast30DaysMicros ?? totalCharged)}</strong>
          <em>积分（{formatYuan(account?.spentLast30DaysMicros ?? totalCharged)}）</em>
        </div>
        <div className="mini-stat">
          <span>近 30 天调用</span>
          <strong>{formatInt(totals?.calls ?? 0)}</strong>
          <em>其中失败 {formatInt(totals?.failedCalls ?? 0)} 次</em>
        </div>
        <div className="mini-stat">
          <span>平台成本</span>
          <strong>{formatYuan(totals?.costMicros ?? 0)}</strong>
          <em>上游实际收费</em>
        </div>
      </div>
      <div className="detail-section">常用模型（近 30 天，按消耗排序）</div>
      <DataTable<UsageRow>
        rowKey={(r) => String(r.keys[0] ?? '')}
        size="small"
        columns={columns}
        data={usage.data?.rows}
        loading={usage.loading}
        error={usage.error}
        onRefresh={usage.refresh}
        pagination={false}
        emptyTitle="近 30 天没有调用"
        emptyHint="用户和角色聊天、角色自己活动时调用模型，都会算在这里。"
      />
    </div>
  );
}

// ---------- 封禁与删除 ----------

function SafetyPanel({
  row,
  nameOf,
  onChanged,
  onClose,
}: {
  row: UserRow;
  nameOf: (id: string | null) => string;
  onChanged: () => void;
  onClose: () => void;
}) {
  const { user } = row;
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [banReason, setBanReason] = useState('');
  const [confirmName, setConfirmName] = useState('');
  const [deleteReason, setDeleteReason] = useState('');
  const [error, setError] = useState('');
  const isAdmin = user.role === 'admin';
  const deleting = user.status === 'deleting';
  const nameMatches = confirmName.trim().toLowerCase() === user.username.toLowerCase();

  async function run(work: () => Promise<unknown>, done: string) {
    setError('');
    try {
      await work();
      toast.success(done);
      onChanged();
    } catch (e) {
      setError(errorText(e));
    }
  }

  if (deleting) {
    return (
      <Alert
        type="info"
        showIcon
        message="这个账号正在注销"
        description="已下线、不能登录，各模块删除完毕后账号会彻底消失。卡住的可以到「客服与安全 › 注销未完成」重新触发。"
      />
    );
  }

  return (
    <div className="drawer-body">
      {error && <Alert type="error" showIcon message={error} />}
      {isAdmin && <Alert type="info" showIcon message="管理员账号不能在这里封禁或删除。" />}
      <SectionCard title="封禁" desc="封禁后不能登录，已登录的设备全部下线；数据保留，随时可以解封">
        {user.ban ? (
          <Space direction="vertical" style={{ width: '100%' }}>
            <Alert
              type="error"
              showIcon
              message={`已于 ${formatDateTime(user.ban.bannedAt)} 封禁`}
              description={`原因：${user.ban.reason || '—'} · 操作人：${nameOf(user.ban.operatorUserId)}`}
            />
            <Button
              onClick={() =>
                confirm({
                  title: '解除封禁？',
                  content: '解封后用户可以重新登录。',
                  okText: '解除封禁',
                  onOk: () =>
                    run(
                      () =>
                        api.call(AdminUsersEndpoints.unbanUser, {
                          params: { userId: user.userId },
                        }),
                      '已解除封禁',
                    ),
                })
              }
            >
              解除封禁
            </Button>
          </Space>
        ) : (
          <Space.Compact style={{ width: '100%' }}>
            <Input
              placeholder="封禁原因（必填，至少 2 个字）"
              maxLength={200}
              value={banReason}
              disabled={isAdmin}
              onChange={(e) => setBanReason(e.target.value)}
            />
            <Button
              danger
              type="primary"
              disabled={isAdmin || banReason.trim().length < 2}
              onClick={() =>
                confirm({
                  title: `封禁 ${displayName(user)}？`,
                  content: '对方立即下线、不能再登录。数据保留，可以随时解封。',
                  okText: '封禁',
                  onOk: () =>
                    run(
                      () =>
                        api.call(AdminUsersEndpoints.banUser, {
                          params: { userId: user.userId },
                          body: { reason: banReason.trim() },
                        }),
                      '已封禁',
                    ),
                })
              }
            >
              封禁
            </Button>
          </Space.Compact>
        )}
      </SectionCard>
      <SectionCard
        title="删除账号"
        desc="和用户自己注销一样：立即下线，聊天、角色、记忆、积分等数据全部删除，不能恢复"
      >
        <Form layout="vertical">
          <Form.Item
            label={`输入登录名「${user.username}」确认`}
            validateStatus={confirmName && !nameMatches ? 'error' : undefined}
            help={confirmName && !nameMatches ? '和登录名不一致' : undefined}
          >
            <Input
              value={confirmName}
              disabled={isAdmin}
              onChange={(e) => setConfirmName(e.target.value)}
              placeholder={user.username}
            />
          </Form.Item>
          <Form.Item label="原因（必填，记入审计）">
            <Input
              value={deleteReason}
              disabled={isAdmin}
              maxLength={200}
              onChange={(e) => setDeleteReason(e.target.value)}
              placeholder="例：用户联系客服要求注销"
            />
          </Form.Item>
        </Form>
        <Button
          danger
          type="primary"
          disabled={isAdmin || !nameMatches || deleteReason.trim().length < 2}
          onClick={() =>
            confirm({
              title: `永久删除 ${displayName(user)}？`,
              content: '删除不可撤销，所有数据都会被清除。确定继续吗？',
              okText: '永久删除',
              onOk: () =>
                run(async () => {
                  await api.call(AdminUsersEndpoints.deleteUser, {
                    params: { userId: user.userId },
                    body: { confirmUsername: confirmName.trim(), reason: deleteReason.trim() },
                  });
                  onClose();
                }, '已进入注销流程'),
            })
          }
        >
          删除账号
        </Button>
      </SectionCard>
    </div>
  );
}
