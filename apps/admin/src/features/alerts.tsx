import { BulkTable, collectPages } from '../ui/bulk-table.js';
import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Segmented, Select } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ModelAccessAdminEndpoints, PushAdminEndpoints, type AdminAlert } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { type ProColumns } from '../ui/table.js';
import { Page, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime, formatInt } from '../ui/format.js';

const KIND_LABELS: Record<string, string> = {
  platform_budget_warning: '平台预算',
  reconciliation_flagged: '供应商对账',
  upstream_usage_missing: '供应商用量缺失',
  upstream_quota_exhausted: '上游余额',
  upstream_invalid: '上游密钥',
  upstream_unavailable: '上游故障',
  upstream_recovered: '上游恢复',
  client_error_spike: '客户端报错激增',
  host_disk_high: '磁盘空间不足',
  backup_failed: '备份失败',
  upstream_auth_rejected: '上游权限拒绝',
};

export function AlertsPage() {
  const toast = useToast();
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const [params, setParams] = useSearchParams();
  const view = params.get('view') === 'info' ? 'info' : 'actionable';
  const [status, setStatus] = useState<'open' | 'all'>('open');
  const [items, setItems] = useState<AdminAlert[]>([]);
  const [openCount, setOpenCount] = useState<number>();
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [next, setNext] = useState<string | null>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState<string | null>(null);
  const cursor = cursors.at(-1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    setNext(undefined);
    void api
      .call(PushAdminEndpoints.listAdminAlerts, {
        query: { status, view, limit: 50, ...(cursor ? { cursor } : {}) },
      })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setOpenCount(page.openCount);
        setNext(page.nextCursor);
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
  }, [status, view, cursor, revision]);

  function reset() {
    setItems([]);
    upstreams.refresh();
    setCursors([undefined]);
    setRevision((n) => n + 1);
  }

  async function acknowledge(alert: AdminAlert) {
    setBusy(alert.alertId);
    setError('');
    try {
      await api.call(PushAdminEndpoints.acknowledgeAdminAlert, {
        params: { alertId: alert.alertId },
      });
      toast.success(alert.severity === 'info' ? '已标记为已读' : '已标记为已处理');
      window.dispatchEvent(new Event('weiban-admin:alerts-changed'));
      reset();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(null);
    }
  }

  const columns: ProColumns<AdminAlert>[] = [
    {
      title: '级别',
      width: 86,
      render: (_, row) => (
        <StatusTag
          tone={
            row.severity === 'critical'
              ? 'error'
              : row.severity === 'warning'
                ? 'warning'
                : 'processing'
          }
        >
          {row.severity === 'critical' ? '严重' : row.severity === 'warning' ? '警告' : '信息'}
        </StatusTag>
      ),
    },
    {
      title: '提醒',
      render: (_, row) => (
        <div className="cell-main">
          <strong>{KIND_LABELS[row.kind] ?? row.kind}</strong>
          {row.refs?.upstreamId && (
            <span>
              上游账号 ·{' '}
              {upstreams.data?.items.find((u) => u.upstreamId === row.refs?.upstreamId)?.name ??
                (upstreams.loading ? '读取中…' : '名称不可用')}
            </span>
          )}
          <span>{row.summary}</span>
          {row.kind === 'upstream_usage_missing' && !row.refs?.modelKey && (
            <span className="cell-sub">历史提醒的估算可能包含网络中断，详见调用记录。</span>
          )}
        </div>
      ),
    },
    {
      title: '最近发生',
      width: 162,
      render: (_, row) => (
        <div className="cell-main">
          <span>{formatDateTime(row.lastRaisedAt)}</span>
          <span className="cell-sub">{formatInt(row.occurrences)} 次</span>
        </div>
      ),
    },
    {
      title: '操作',
      width: 174,
      render: (_, row) => {
        let auditPath: string | null = null;
        if (row.refs?.upstreamId) {
          const filters = new URLSearchParams({ view: 'records', upstream: row.refs.upstreamId });
          if (row.refs.modelKey) filters.set('model', row.refs.modelKey);
          if (row.kind === 'upstream_usage_missing') {
            filters.set('quality', 'estimated');
            if (row.refs.modelKey) filters.set('status', 'succeeded');
          } else filters.set('status', 'failed');
          auditPath = '/usage?' + filters.toString();
        } else if (row.kind === 'reconciliation_flagged') {
          auditPath = row.refs?.day ? '/billing?day=' + row.refs.day : '/billing';
        }
        return (
          <div className="alert-actions">
            {auditPath && (
              <Link to={auditPath}>
                {row.kind === 'reconciliation_flagged' ? '去对账' : '查看明细'}
              </Link>
            )}
            {row.acknowledgedAt ? (
              <StatusTag>{row.severity === 'info' ? '已读' : '已处理'}</StatusTag>
            ) : (
              <Button
                type="link"
                size="small"
                loading={busy === row.alertId}
                onClick={() => void acknowledge(row)}
              >
                {row.severity === 'info' ? '标记已读' : '标记已处理'}
              </Button>
            )}
          </div>
        );
      },
    },
  ];

  return (
    <Page
      title="运行提醒"
      desc="警告与严重异常进入待处理，运行恢复和用量回执情况可在信息提示里查阅。"
    >
      <div className="filter-panel usage-filters">
        <Segmented<'actionable' | 'info'>
          value={view}
          aria-label="提醒分组"
          options={[
            { value: 'actionable', label: '待处理异常' },
            { value: 'info', label: '信息提示' },
          ]}
          onChange={(nextView) => {
            setParams({ view: nextView });
            setOpenCount(undefined);
            reset();
          }}
        />
        <Select
          value={status}
          aria-label="提醒处理状态"
          style={{ minWidth: 140 }}
          onChange={(value) => {
            setStatus(value);
            reset();
          }}
          options={[
            { value: 'open', label: view === 'info' ? '未读' : '待处理' },
            { value: 'all', label: '近 90 天全部' },
          ]}
        />
        {openCount !== undefined && (
          <span className="filter-summary">
            {formatInt(openCount)} 条{view === 'info' ? '未读' : '待处理'}
          </span>
        )}
        <Button icon={<ReloadOutlined />} loading={loading} onClick={reset}>
          刷新
        </Button>
      </div>
      <BulkTable<AdminAlert>
        scope={JSON.stringify([status, view])}
        nameOf={(row) => row.summary}
        afterBatch={() => {
          window.dispatchEvent(new Event('weiban-admin:alerts-changed'));
          reset();
        }}
        allMatching={() =>
          collectPages<AdminAlert>(
            (cursor) =>
              api.call(PushAdminEndpoints.listAdminAlerts, {
                query: { status, view, limit: 200, cursor },
              }),
            (r) => r.alertId,
          )
        }
        operations={[
          {
            label: view === 'info' ? '批量已读' : '批量标记已处理',
            applies: (r) => !r.acknowledgedAt,
            run: (r) =>
              api.call(PushAdminEndpoints.acknowledgeAdminAlert, {
                params: { alertId: r.alertId },
              }),
          },
        ]}
        rowKey="alertId"
        columns={columns}
        data={items}
        showTools={false}
        loading={loading}
        error={error}
        onRefresh={error ? reset : undefined}
        pagination={false}
        emptyTitle={view === 'info' ? '没有信息提示' : '没有异常提醒'}
        footer={
          (cursors.length > 1 || next) && (
            <div className="cursor-pager">
              <Button
                size="small"
                disabled={loading || cursors.length <= 1}
                onClick={() => setCursors((pages) => pages.slice(0, -1))}
              >
                上一页
              </Button>
              <span>第 {cursors.length} 页</span>
              <Button
                size="small"
                disabled={loading || !next}
                onClick={() => {
                  if (next) setCursors((pages) => [...pages, next]);
                }}
              >
                下一页
              </Button>
            </div>
          )
        }
      />
    </Page>
  );
}
