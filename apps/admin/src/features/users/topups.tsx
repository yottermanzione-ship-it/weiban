/**
 * 充值记录（10-20 批 E2）：只列积分充值 —— 管理员加 / 扣积分（现阶段收款后由管理员加积分）与注册赠送。
 * 开通会员送的积分在「会员订阅记录」，模型消耗在用户详情 › 积分流水。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Input, Select, Space } from 'antd';
import type { Dayjs } from 'dayjs';
import { BillingAdminEndpoints, type AdminTopupEntry } from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText } from '../../data/hooks.js';
import { RecordDrawer } from '../../ui/drawer.js';
import { Page, StatusTag } from '../../ui/page.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import { formatDateTime, formatPoints, formatYuan } from '../../ui/format.js';
import { displayName, useUserRows } from './shared.js';
import { UserDetailDrawer } from './detail.js';

type Kind = AdminTopupEntry['kind'];

const KIND_NAME: Record<Kind, string> = {
  grant: '加积分',
  deduct: '扣积分',
  signup_bonus: '注册赠送',
};

function KindTag({ kind }: { kind: Kind }) {
  return (
    <StatusTag tone={kind === 'grant' ? 'success' : kind === 'deduct' ? 'error' : 'processing'}>
      {KIND_NAME[kind]}
    </StatusTag>
  );
}

const PAGE = 100;

export function TopupRecordsPage() {
  const users = useUserRows();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [kind, setKind] = useState<Kind | 'all'>('all');
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<AdminTopupEntry[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<AdminTopupEntry | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const filter = useMemo(
    () => ({
      ...(range
        ? {
            from: range[0].startOf('day').toISOString(),
            to: range[1].add(1, 'day').startOf('day').toISOString(),
          }
        : {}),
      ...(kind !== 'all' ? { kind } : {}),
    }),
    [range, kind],
  );

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    api
      .call(BillingAdminEndpoints.listTopups, { query: { ...filter, limit: PAGE } })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setCursor(page.nextCursor);
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [filter, revision]);

  async function loadMore() {
    if (!cursor) return;
    setLoading(true);
    try {
      const page = await api.call(BillingAdminEndpoints.listTopups, {
        query: { ...filter, limit: PAGE, cursor },
      });
      setItems((list) => [...list, ...page.items]);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  const nameOf = (id: string | null) => {
    if (!id) return '系统';
    const row = users.byId.get(id);
    return row ? displayName(row.user) : `${id.slice(0, 8)}…`;
  };
  const userName = (r: AdminTopupEntry) => {
    const row = users.byId.get(r.userId);
    return row ? displayName(row.user) : r.username || '已注销账号';
  };

  const q = query.trim().toLowerCase();
  const list = items.filter((r) => {
    if (!q) return true;
    const u = users.byId.get(r.userId)?.user;
    return (
      r.userId.includes(q) ||
      r.username.toLowerCase().includes(q) ||
      !!u?.nickname?.toLowerCase().includes(q)
    );
  });
  const totalIn = list.filter((r) => r.amountMicros > 0).reduce((s, r) => s + r.amountMicros, 0);

  const columns: ProColumns<AdminTopupEntry>[] = [
    { title: '时间', width: 150, render: (_, r) => formatDateTime(r.createdAt) },
    {
      title: '用户',
      width: 200,
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={() => setOpenUserId(r.userId)}
        >
          {userName(r)}
        </Button>
      ),
    },
    { title: '类型', width: 100, render: (_, r) => <KindTag kind={r.kind} /> },
    {
      title: '积分',
      width: 120,
      render: (_, r) => (
        <div className="cell-main">
          <span className={r.amountMicros > 0 ? 'income' : ''}>
            {r.amountMicros > 0 ? '+' : ''}
            {formatPoints(r.amountMicros)}
          </span>
          <span className="cell-sub">{formatYuan(r.amountMicros)}</span>
        </div>
      ),
    },
    { title: '变动后余额', width: 110, render: (_, r) => formatPoints(r.balanceAfterMicros) },
    { title: '原因', ellipsis: true, render: (_, r) => r.note ?? '—' },
    { title: '操作人', width: 120, render: (_, r) => nameOf(r.operatorUserId) },
  ];

  const openUser = openUserId ? users.byId.get(openUserId) : undefined;

  return (
    <Page
      title="充值记录"
      desc="积分充值（管理员收款后加积分）、管理员扣积分与注册赠送。会员开通记录见「会员订阅记录」。"
    >
      <DataTable<AdminTopupEntry>
        rowKey="entryId"
        columns={columns}
        data={list}
        loading={loading}
        error={error}
        onRefresh={() => setRevision((v) => v + 1)}
        onRowClick={setSelected}
        filters={
          <Space wrap>
            <DatePicker.RangePicker
              value={range}
              onChange={(v) => setRange(v?.[0] && v[1] ? [v[0], v[1]] : null)}
              placeholder={['开始日期', '结束日期']}
            />
            <Select<Kind | 'all'>
              value={kind}
              onChange={setKind}
              style={{ width: 130 }}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'grant', label: '加积分' },
                { value: 'deduct', label: '扣积分' },
                { value: 'signup_bonus', label: '注册赠送' },
              ]}
            />
            <Input.Search
              allowClear
              placeholder="账号 / 昵称 / 用户 ID"
              style={{ width: 220 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <span className="detail-muted">
              当前列表加积分合计 {formatPoints(totalIn)} 积分（{formatYuan(totalIn)}）
            </span>
          </Space>
        }
        footer={
          cursor ? (
            <div style={{ textAlign: 'center' }}>
              <Button loading={loading} onClick={() => void loadMore()}>
                加载更早的记录
              </Button>
            </div>
          ) : undefined
        }
        emptyTitle="没有符合条件的充值记录"
        emptyHint="在「用户列表」点开一个用户，在「积分」里加积分后，这里会出现记录。"
      />
      {selected && (
        <RecordDrawer
          open
          onClose={() => setSelected(null)}
          width={480}
          title={
            <Space>
              <KindTag kind={selected.kind} />
              <span>{userName(selected)}</span>
            </Space>
          }
          subtitle={formatDateTime(selected.createdAt)}
        >
          <div className="detail-grid">
            <div>
              <span className="detail-label">积分</span>
              <span>
                {selected.amountMicros > 0 ? '+' : ''}
                {formatPoints(selected.amountMicros)}（{formatYuan(selected.amountMicros)}）
              </span>
            </div>
            <div>
              <span className="detail-label">变动后余额</span>
              <span>{formatPoints(selected.balanceAfterMicros)} 积分</span>
            </div>
            <div>
              <span className="detail-label">原因</span>
              <span>{selected.note ?? '—'}</span>
            </div>
            <div>
              <span className="detail-label">操作人</span>
              <span>{nameOf(selected.operatorUserId)}</span>
            </div>
            <div>
              <span className="detail-label">积分类别</span>
              <span>
                {selected.kind === 'signup_bonus'
                  ? '赠送积分（扣费时先扣）'
                  : selected.kind === 'grant'
                    ? '充值积分'
                    : '从余额扣除'}
              </span>
            </div>
            <div>
              <span className="detail-label">流水编号</span>
              <span className="mono">{selected.entryId}</span>
            </div>
            <div>
              <span className="detail-label">用户 ID</span>
              <span className="mono">{selected.userId}</span>
            </div>
          </div>
        </RecordDrawer>
      )}
      {openUser && (
        <UserDetailDrawer
          row={openUser}
          nameOf={nameOf}
          initialTab="points"
          onClose={() => setOpenUserId(null)}
          onChanged={() => {
            users.refresh();
            setRevision((v) => v + 1);
          }}
        />
      )}
    </Page>
  );
}
