/**
 * 会员订阅记录（10-20 批 E2）：只列会员开通 / 续期（订单）与手动调整 / 取消，可按时间、档位、是否首次筛选。
 * 点一行从右侧抽屉看详情；点用户名打开用户详情抽屉。
 */
import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Input, Select, Space } from 'antd';
import type { Dayjs } from 'dayjs';
import {
  MembershipChangeAdminEndpoints,
  MembershipOrderAdminEndpoints,
  type MembershipChange,
  type MembershipOrder,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText } from '../../data/hooks.js';
import { Page } from '../../ui/page.js';
import { DataTable } from '../../ui/table.js';
import { displayName, mergeSubRecords, useUserRows, type SubRecord } from './shared.js';
import { SubRecordDrawer, subColumns } from './sub-records.js';
import { UserDetailDrawer } from './detail.js';

type PlanFilter = 'all' | 'month' | 'quarter' | 'year' | 'adjust';

interface Loaded {
  orders: MembershipOrder[];
  changes: MembershipChange[];
  /** undefined = 这一类没查（被筛选排除）；null = 没有更多。 */
  orderCursor: string | null | undefined;
  changeCursor: string | null | undefined;
}

const PAGE = 100;

export function MembershipRecordsPage() {
  const users = useUserRows();
  const [range, setRange] = useState<[Dayjs, Dayjs] | null>(null);
  const [plan, setPlan] = useState<PlanFilter>('all');
  const [first, setFirst] = useState<'all' | 'true' | 'false'>('all');
  const [query, setQuery] = useState('');
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const [selected, setSelected] = useState<SubRecord | null>(null);
  const [openUserId, setOpenUserId] = useState<string | null>(null);

  const time = useMemo(
    () =>
      range
        ? {
            from: range[0].startOf('day').toISOString(),
            to: range[1].add(1, 'day').startOf('day').toISOString(),
          }
        : {},
    [range],
  );
  const wantOrders = plan !== 'adjust';
  // 档位 / 首次价只对订单有意义：选了这两项就不列手动调整。
  const wantChanges = (plan === 'all' && first === 'all') || plan === 'adjust';

  async function fetchPage(prev: Loaded | null): Promise<Loaded> {
    const [orders, changes] = await Promise.all([
      wantOrders && (prev === null || prev.orderCursor)
        ? api.call(MembershipOrderAdminEndpoints.listOrders, {
            query: {
              limit: PAGE,
              ...time,
              ...(plan !== 'all' ? { planId: plan } : {}),
              ...(first !== 'all' ? { firstPurchase: first } : {}),
              ...(prev?.orderCursor ? { cursor: prev.orderCursor } : {}),
            },
          })
        : null,
      wantChanges && (prev === null || prev.changeCursor)
        ? api.call(MembershipChangeAdminEndpoints.listChanges, {
            query: {
              limit: PAGE,
              ...time,
              ...(prev?.changeCursor ? { cursor: prev.changeCursor } : {}),
            },
          })
        : null,
    ]);
    return {
      orders: [...(prev?.orders ?? []), ...(orders?.items ?? [])],
      changes: [...(prev?.changes ?? []), ...(changes?.items ?? [])],
      orderCursor: orders
        ? orders.nextCursor
        : wantOrders
          ? (prev?.orderCursor ?? null)
          : undefined,
      changeCursor: changes
        ? changes.nextCursor
        : wantChanges
          ? (prev?.changeCursor ?? null)
          : undefined,
    };
  }

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    fetchPage(null)
      .then((r) => {
        if (active) setLoaded(r);
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [time, plan, first, revision]);

  async function loadMore() {
    if (!loaded) return;
    setLoading(true);
    try {
      setLoaded(await fetchPage(loaded));
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

  const q = query.trim().toLowerCase();
  const records = mergeSubRecords(loaded?.orders ?? [], loaded?.changes ?? []).filter((r) => {
    if (!q) return true;
    const u = users.byId.get(r.userId)?.user;
    return (
      r.userId.includes(q) ||
      !!u?.username.toLowerCase().includes(q) ||
      !!u?.nickname?.toLowerCase().includes(q)
    );
  });
  const hasMore = !!loaded?.orderCursor || !!loaded?.changeCursor;
  const openUser = openUserId ? users.byId.get(openUserId) : undefined;

  return (
    <Page
      title="会员订阅记录"
      desc="会员开通、续期，以及管理员手动调整到期日 / 取消会员的记录。积分充值见「充值记录」。"
    >
      <DataTable<SubRecord>
        rowKey="key"
        columns={subColumns(nameOf, { showUser: true, onUser: setOpenUserId })}
        data={records}
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
            <Select<PlanFilter>
              value={plan}
              onChange={setPlan}
              style={{ width: 150 }}
              options={[
                { value: 'all', label: '全部类型' },
                { value: 'month', label: '月卡' },
                { value: 'quarter', label: '季卡' },
                { value: 'year', label: '年卡' },
                { value: 'adjust', label: '手动调整 / 取消' },
              ]}
            />
            <Select<'all' | 'true' | 'false'>
              value={first}
              onChange={setFirst}
              style={{ width: 130 }}
              disabled={plan === 'adjust'}
              options={[
                { value: 'all', label: '首次价：不限' },
                { value: 'true', label: '只看首次价' },
                { value: 'false', label: '只看原价' },
              ]}
            />
            <Input.Search
              allowClear
              placeholder="账号 / 昵称 / 用户 ID"
              style={{ width: 220 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
          </Space>
        }
        footer={
          hasMore ? (
            <div style={{ textAlign: 'center' }}>
              <Button loading={loading} onClick={() => void loadMore()}>
                加载更早的记录
              </Button>
            </div>
          ) : undefined
        }
        emptyTitle="没有符合条件的订阅记录"
        emptyHint="在「用户列表」点开一个用户，在「会员」里开通后，这里会出现记录。"
      />
      {selected && (
        <SubRecordDrawer record={selected} nameOf={nameOf} onClose={() => setSelected(null)} />
      )}
      {openUser && (
        <UserDetailDrawer
          row={openUser}
          nameOf={nameOf}
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
