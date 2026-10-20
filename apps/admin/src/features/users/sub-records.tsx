/**
 * 会员订阅记录的公共部分：表格列、详情抽屉、按用户读取（用户详情 › 会员 与「会员订阅记录」页共用）。
 */
import { Button, Space } from 'antd';
import { MembershipChangeAdminEndpoints, MembershipOrderAdminEndpoints } from '@weiban/contracts';
import { api } from '../../data/client.js';
import { RecordDrawer } from '../../ui/drawer.js';
import { StatusTag } from '../../ui/page.js';
import type { ProColumns } from '../../ui/table.js';
import { formatDate, formatDateTime } from '../../ui/format.js';
import { PLAN_NAME, SubKindTag, mergeSubRecords, yuanFen, type SubRecord } from './shared.js';

/** 订阅记录的「内容」一列：档位 + 价格，或到期日变化。 */
export function subSummary(r: SubRecord): string {
  if (r.order) {
    return `${PLAN_NAME[r.order.planId] ?? r.order.planId} · 收 ${yuanFen(r.order.priceFen)} · 送 ${r.order.bonusPoints} 积分`;
  }
  const c = r.change!;
  return c.expiresAt
    ? `到期日 ${formatDate(c.previousExpiresAt)} → ${formatDate(c.expiresAt)}`
    : `原到期 ${formatDate(c.previousExpiresAt)}，立即失效`;
}

export function subColumns(
  nameOf: (userId: string | null) => string,
  options: { showUser?: boolean; onUser?: (userId: string) => void; compact?: boolean } = {},
): ProColumns<SubRecord>[] {
  const cols: ProColumns<SubRecord>[] = [
    { title: '时间', width: 150, render: (_, r) => formatDateTime(r.createdAt) },
    { title: '类型', width: 110, render: (_, r) => <SubKindTag kind={r.kind} /> },
  ];
  if (options.showUser) {
    cols.push({
      title: '用户',
      width: 200,
      render: (_, r) => (
        <Button
          type="link"
          size="small"
          style={{ padding: 0 }}
          onClick={() => options.onUser?.(r.userId)}
        >
          {nameOf(r.userId)}
        </Button>
      ),
    });
  }
  cols.push(
    {
      title: '内容',
      render: (_, r) => (
        <span>
          {subSummary(r)} {r.order?.firstPurchase && <StatusTag tone="success">首次价</StatusTag>}
        </span>
      ),
    },
    {
      title: '会员期',
      width: options.compact ? 120 : 200,
      render: (_, r) =>
        r.order
          ? options.compact
            ? `至 ${formatDate(r.order.endsAt)}`
            : `${formatDate(r.order.startsAt)} → ${formatDate(r.order.endsAt)}`
          : r.change?.expiresAt
            ? `至 ${formatDate(r.change.expiresAt)}`
            : '—',
    },
  );
  // 抽屉里（compact）放不下：操作人在详情里看。
  if (!options.compact)
    cols.push({ title: '操作人', width: 120, render: (_, r) => nameOf(r.operatorUserId) });
  return cols;
}

/** 一条订阅记录的详情抽屉（只读）。 */
export function SubRecordDrawer({
  record,
  nameOf,
  onClose,
}: {
  record: SubRecord;
  nameOf: (userId: string | null) => string;
  onClose: () => void;
}) {
  const o = record.order;
  const c = record.change;
  return (
    <RecordDrawer
      open
      onClose={onClose}
      width={520}
      title={
        <Space>
          <SubKindTag kind={record.kind} />
          <span>{nameOf(record.userId)}</span>
        </Space>
      }
      subtitle={formatDateTime(record.createdAt)}
    >
      <div className="detail-grid">
        {o && (
          <>
            <div>
              <span className="detail-label">档位</span>
              <span>{PLAN_NAME[o.planId] ?? o.planId}</span>
            </div>
            <div>
              <span className="detail-label">实收</span>
              <span>
                {yuanFen(o.priceFen)}（原价 {yuanFen(o.listPriceFen)}）{' '}
                {o.firstPurchase && <StatusTag tone="success">首次价</StatusTag>}
              </span>
            </div>
            <div>
              <span className="detail-label">赠送积分</span>
              <span>{o.bonusPoints}（开通即到账，计入赠送积分）</span>
            </div>
            <div>
              <span className="detail-label">会员期</span>
              <span>
                {formatDateTime(o.startsAt)} → {formatDateTime(o.endsAt)}
              </span>
            </div>
            <div>
              <span className="detail-label">备注</span>
              <span>{o.note || '—'}</span>
            </div>
            <div>
              <span className="detail-label">订单编号</span>
              <span className="mono">{o.orderId}</span>
            </div>
          </>
        )}
        {c && (
          <>
            <div>
              <span className="detail-label">调整前到期</span>
              <span>{formatDateTime(c.previousExpiresAt)}</span>
            </div>
            <div>
              <span className="detail-label">调整后到期</span>
              <span>{c.expiresAt ? formatDateTime(c.expiresAt) : '已取消（立即失效）'}</span>
            </div>
            <div>
              <span className="detail-label">原因</span>
              <span>{c.reason || '—'}</span>
            </div>
            <div>
              <span className="detail-label">说明</span>
              <span>手动调整不记订单、不发积分</span>
            </div>
          </>
        )}
        <div>
          <span className="detail-label">操作人</span>
          <span>{nameOf(record.operatorUserId)}</span>
        </div>
        <div>
          <span className="detail-label">用户 ID</span>
          <span className="mono">{record.userId}</span>
        </div>
      </div>
    </RecordDrawer>
  );
}

/** 某个用户的订阅记录（用户详情 › 会员 下方用）。 */
export async function loadUserSubRecords(userId: string): Promise<SubRecord[]> {
  const [orders, changes] = await Promise.all([
    api.call(MembershipOrderAdminEndpoints.listOrders, { query: { userId, limit: 100 } }),
    api.call(MembershipChangeAdminEndpoints.listChanges, { query: { userId, limit: 100 } }),
  ]);
  return mergeSubRecords(orders.items, changes.items);
}
