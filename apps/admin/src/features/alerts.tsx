/**
 * 运行提醒：系统自动报出的异常（预算、对账、上游线路）。
 * 点「已处理」后从待处理里消失；同类问题重复发生时会在原提醒上累加次数。
 */
import { useEffect, useState } from 'react';
import { Button, Select, Space } from 'antd';
import { PushAdminEndpoints, type AdminAlert } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { Page, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime, relativeTime } from '../ui/format.js';

const KIND_LABELS: Record<string, string> = {
  platform_budget_warning: '平台预算',
  reconciliation_flagged: '对账异常',
  upstream_usage_missing: '连续缺用量（已按估算计费）',
  upstream_quota_exhausted: '上游余额',
  upstream_invalid: '上游密钥',
  upstream_unavailable: '上游故障',
  upstream_recovered: '上游恢复',
  client_error_spike: '客户端报错激增',
};

const SEVERITY: Record<string, { tone: 'error' | 'warning' | 'default'; label: string }> = {
  critical: { tone: 'error', label: '严重' },
  warning: { tone: 'warning', label: '警告' },
  info: { tone: 'default', label: '提示' },
};

export function AlertsPage() {
  const toast = useToast();
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [items, setItems] = useState<AdminAlert[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);

  async function load(after?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(PushAdminEndpoints.listAdminAlerts, {
        query: { status, limit: 50, cursor: after },
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setOpenCount(page.openCount);
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status]);

  async function acknowledge(alert: AdminAlert) {
    setBusy(alert.alertId);
    setError('');
    try {
      await api.call(PushAdminEndpoints.acknowledgeAdminAlert, {
        params: { alertId: alert.alertId },
      });
      toast.success('已标记为已处理');
      window.dispatchEvent(new Event('weiban-admin:alerts-changed'));
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: ProColumns<AdminAlert>[] = [
    {
      title: '级别',
      width: 90,
      render: (_, row) => {
        const severity = SEVERITY[row.severity] ?? SEVERITY.info!;
        return <StatusTag tone={severity.tone}>{severity.label}</StatusTag>;
      },
    },
    {
      title: '类型',
      width: 110,
      render: (_, row) => KIND_LABELS[row.kind] ?? row.kind,
    },
    {
      title: '说明',
      render: (_, row) => (
        <div className="cell-main">
          <span>{row.summary}</span>
          <span className="cell-sub">
            发生 {row.occurrences} 次 · 最近 {relativeTime(row.lastRaisedAt)}
          </span>
        </div>
      ),
    },
    {
      title: '最近发生',
      width: 150,
      render: (_, row) => formatDateTime(row.lastRaisedAt),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) =>
        row.acknowledgedAt ? (
          <StatusTag tone="default">已处理</StatusTag>
        ) : (
          <StatusTag tone="warning">待处理</StatusTag>
        ),
    },
    {
      title: '操作',
      width: 110,
      fixed: 'right',
      render: (_, row) =>
        row.acknowledgedAt ? (
          <span className="cell-sub">{formatDateTime(row.acknowledgedAt)}</span>
        ) : (
          <Button
            type="link"
            size="small"
            loading={busy === row.alertId}
            onClick={() => void acknowledge(row)}
          >
            标记已处理
          </Button>
        ),
    },
  ];

  return (
    <Page
      title="运行提醒"
      desc="系统自动报出的异常。处理完真实问题后再点「标记已处理」，否则同类问题会继续累加。"
      extra={
        <Space>
          <Select
            style={{ width: 130 }}
            value={status}
            onChange={setStatus}
            options={[
              { value: 'open', label: `待处理${openCount ? `（${openCount}）` : ''}` },
              { value: 'all', label: '全部（90 天）' },
            ]}
          />
          <Button onClick={() => void load()}>刷新</Button>
        </Space>
      }
    >
      <DataTable<AdminAlert>
        rowKey="alertId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        emptyTitle={status === 'open' ? '没有待处理的提醒' : '没有提醒记录'}
        emptyHint="系统发现预算、对账或线路异常时会自动出现在这里；一切正常时这里是空的。"
        footer={
          cursor ? (
            <Button size="small" loading={loading} onClick={() => void load(cursor)}>
              加载更多
            </Button>
          ) : undefined
        }
      />
    </Page>
  );
}
