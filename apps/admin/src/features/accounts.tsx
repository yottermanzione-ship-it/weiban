/**
 * 用户列表：余额与近 30 天消耗；点一行从右侧抽屉里加扣积分、看流水、改会员。
 * 金额统一同时显示积分与元（1 元 = 100 积分）。
 */
import { useRef, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Radio, Space, Tabs } from 'antd';
import type { z } from 'zod';
import {
  BillingAdminEndpoints,
  MembershipAdminEndpoints,
  AdminAccountSummary,
  AdminLedgerEntry,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { RecordDrawer } from '../ui/drawer.js';
import {
  FieldHelp,
  Page,
  SectionCard,
  StatusTag,
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import {
  Money,
  formatDateTime,
  formatInt,
  formatPoints,
  formatYuan,
} from '../ui/format.js';

type Account = z.infer<typeof AdminAccountSummary>;
type LedgerEntry = z.infer<typeof AdminLedgerEntry>;

export function AccountsPage() {
  const accounts = useRemote(BillingAdminEndpoints.listAccounts);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Account | null>(null);

  const list = (accounts.data?.items ?? []).filter(
    (a) =>
      !query.trim() ||
      a.username.includes(query.trim()) ||
      a.userId.includes(query.trim()),
  );

  const columns: ProColumns<Account>[] = [
    {
      title: '用户',
      width: 220,
      render: (_, a) => (
        <div className="cell-main">
          <span className="cell-title">{a.username || '已注销账号'}</span>
          <span className="cell-sub mono">{a.userId}</span>
        </div>
      ),
    },
    {
      title: '余额',
      width: 170,
      sorter: (a, b) => a.balanceMicros - b.balanceMicros,
      render: (_, a) => <Money micros={a.balanceMicros} strong />,
    },
    {
      title: '处理中（冻结）',
      width: 140,
      render: (_, a) => `${formatPoints(a.heldMicros)} 积分`,
    },
    {
      title: '近 30 天消耗',
      width: 170,
      sorter: (a, b) => a.spentLast30DaysMicros - b.spentLast30DaysMicros,
      render: (_, a) => <Money micros={a.spentLast30DaysMicros} points={false} />,
    },
    {
      title: '最近变动',
      width: 150,
      render: (_, a) => formatDateTime(a.updatedAt),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, a) => (
        <Button type="link" size="small" onClick={() => setSelected(a)}>
          积分 / 流水 / 会员
        </Button>
      ),
    },
  ];

  return (
    <Page
      title="用户列表"
      desc="每个用户的积分余额与近 30 天消耗。点一行可以加扣积分、查看每一笔流水、改会员档位。"
      extra={<Button onClick={() => accounts.refresh()}>刷新</Button>}
    >
      <DataTable<Account>
        rowKey="userId"
        columns={columns}
        data={list}
        loading={accounts.loading}
        error={accounts.error}
        onRefresh={accounts.refresh}
        onRowClick={(a) => setSelected(a)}
        filters={
          <Input.Search
            allowClear
            placeholder="搜索用户名或用户 ID"
            style={{ width: 260 }}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        }
        emptyTitle="还没有用户"
        emptyHint="用户在网页端注册后会自动出现在这里，不需要手动添加。"
      />
      {selected && (
        <AccountDrawer
          account={selected}
          onClose={() => setSelected(null)}
          onChanged={accounts.refresh}
        />
      )}
    </Page>
  );
}

function AccountDrawer({
  account,
  onClose,
  onChanged,
}: {
  account: Account;
  onClose: () => void;
  onChanged: () => void;
}) {
  const [tab, setTab] = useState<'points' | 'ledger' | 'membership'>('points');
  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={account.username || '已注销账号'}
      subtitle={`余额 ${formatPoints(account.balanceMicros)} 积分（${formatYuan(account.balanceMicros)}）`}
      width={720}
    >
      <Tabs
        activeKey={tab}
        onChange={(key) => setTab(key as typeof tab)}
        items={[
          { key: 'points', label: '加扣积分' },
          { key: 'ledger', label: '流水' },
          { key: 'membership', label: '会员' },
        ]}
      />
      {tab === 'points' && <AdjustPanel account={account} onChanged={onChanged} />}
      {tab === 'ledger' && <LedgerPanel account={account} />}
      {tab === 'membership' && <MembershipPanel account={account} />}
    </RecordDrawer>
  );
}

interface AdjustValues {
  direction: 'grant' | 'deduct';
  points: number;
  reason: string;
}

function AdjustPanel({ account, onChanged }: { account: Account; onChanged: () => void }) {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [form] = Form.useForm<AdjustValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const operation = useRef<{ signature: string; key: string } | null>(null);
  const direction = Form.useWatch('direction', form) ?? 'grant';
  const points = Form.useWatch('points', form) ?? 0;

  async function submit() {
    const values = await form.validateFields();
    const run = async () => {
      setSaving(true);
      setError('');
      try {
        const body = {
          direction: values.direction,
          points: Math.round(values.points * 10_000) / 10_000,
          reason: values.reason,
        };
        const signature = JSON.stringify(body);
        if (operation.current?.signature !== signature)
          operation.current = { signature, key: crypto.randomUUID() };
        await api.call(BillingAdminEndpoints.adjustBalance, {
          params: { userId: account.userId },
          body: { ...body, idempotencyKey: operation.current.key },
        });
        operation.current = null;
        toast.success('已保存');
        form.resetFields(['points', 'reason']);
        onChanged();
      } catch (e) {
        setError(errorText(e));
      } finally {
        setSaving(false);
      }
    };
    if (values.direction === 'deduct') {
      confirm({
        title: `扣掉 ${values.points} 积分？`,
        content: `扣完余额约 ${formatPoints(account.balanceMicros - values.points * 10_000)} 积分。扣减额不能超过可用余额，操作会记入审计日志。`,
        okText: '确认扣减',
        onOk: run,
      });
    } else {
      await run();
    }
  }

  return (
    <div className="drawer-body">
      <SectionCard title="加 / 扣积分" desc="用于补偿、退款或人工纠正">
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        <Form<AdjustValues>
          form={form}
          layout="vertical"
          initialValues={{ direction: 'grant', points: 100 }}
        >
          <Form.Item name="direction" label="操作">
            <Radio.Group>
              <Radio.Button value="grant">加积分</Radio.Button>
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
            extra={<FieldHelp>会写进流水和审计日志，写清楚为什么加/扣。</FieldHelp>}
          >
            <Input maxLength={200} placeholder="例：8 月模型故障补偿" />
          </Form.Item>
        </Form>
        <div className="drawer-actions">
          <span />
          <Button
            type={direction === 'deduct' ? 'primary' : 'primary'}
            danger={direction === 'deduct'}
            loading={saving}
            onClick={() => void submit()}
          >
            {direction === 'deduct' ? '确认扣减' : '确认加积分'}
          </Button>
        </div>
      </SectionCard>
    </div>
  );
}

function LedgerPanel({ account }: { account: Account }) {
  const ledger = useRemote(BillingAdminEndpoints.listAccountLedger, {
    params: { userId: account.userId },
    query: { limit: 100 },
  });
  const columns: ProColumns<LedgerEntry>[] = [
    {
      title: '时间',
      width: 150,
      render: (_, row) => formatDateTime(row.createdAt),
    },
    {
      title: '积分',
      width: 120,
      render: (_, row) => {
        const value = row.points ?? 0;
        return (
          <span className={value > 0 ? 'income' : ''}>
            {value > 0 ? '+' : ''}
            {formatInt(value)}
          </span>
        );
      },
    },
    {
      title: '剩余',
      width: 100,
      render: (_, row) => formatInt(row.balanceAfterPoints ?? 0),
    },
    {
      title: '上游成本',
      width: 110,
      render: (_, row) => (row.costMicros == null ? '—' : formatYuan(row.costMicros, 4)),
    },
    {
      title: '说明',
      render: (_, row) => row.note ?? row.modelKey ?? '—',
    },
  ];
  return (
    <DataTable<LedgerEntry>
      rowKey="entryId"
      columns={columns}
      data={ledger.data?.items ?? []}
      loading={ledger.loading}
      error={ledger.error}
      onRefresh={ledger.refresh}
      pagination={false}
      emptyTitle="还没有流水"
      emptyHint="用户每发一条消息、每次加扣积分都会在这里留一行。"
    />
  );
}

function MembershipPanel({ account }: { account: Account }) {
  const remote = useRemote(MembershipAdminEndpoints.get, { params: { userId: account.userId } });
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [expiry, setExpiry] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function setMembership(revoke: boolean) {
    setSaving(true);
    setError('');
    try {
      await api.call(MembershipAdminEndpoints.set, {
        params: { userId: account.userId },
        body: { expiresAt: revoke ? null : new Date(`${expiry}T23:59:59+08:00`).toISOString() },
      });
      toast.success(revoke ? '已撤销 PRO+' : '已保存');
      remote.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const isPro = remote.data?.tier === 'pro_plus';

  return (
    <div className="drawer-body">
      <SectionCard title="会员档位" desc="只影响角色相关权益，不代表支付或赠送积分">
        {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
        <div className="detail-grid">
          <div>
            <span className="detail-label">当前档位</span>
            <StatusTag tone={isPro ? 'success' : 'default'}>{isPro ? 'PRO+' : '免费'}</StatusTag>
          </div>
          <div>
            <span className="detail-label">到期时间</span>
            <span>{remote.data?.expiresAt ? formatDateTime(remote.data.expiresAt) : '无'}</span>
          </div>
        </div>
        <div style={{ height: 12 }} />
        <Form layout="vertical">
          <Form.Item
            label="PRO+ 到期日期"
            extra={<FieldHelp>到期当天 23:59 失效。撤销不会改变积分。</FieldHelp>}
          >
            <Input type="date" value={expiry} onChange={(e) => setExpiry(e.target.value)} />
          </Form.Item>
        </Form>
        <Space>
          <Button
            type="primary"
            loading={saving}
            disabled={!expiry}
            onClick={() => void setMembership(false)}
          >
            授予 / 更新
          </Button>
          <Button
            danger
            disabled={!isPro || saving}
            onClick={() =>
              confirm({
                title: '撤销 PRO+？',
                content: '撤销后用户立即回到免费档位，不会改变积分余额。',
                okText: '撤销',
                onOk: () => setMembership(true),
              })
            }
          >
            撤销 PRO+
          </Button>
        </Space>
        {remote.error && <Alert type="error" showIcon message={remote.error} style={{ marginTop: 12 }} />}
      </SectionCard>
      <div className="detail-muted">
        「会员与订单」页面可以按用户 ID 直接查改档位；本页是同一个功能的快捷入口。
      </div>
    </div>
  );
}
