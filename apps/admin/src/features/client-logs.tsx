import { useEffect, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, DatePicker, Input, Select, Space, Table, Typography } from 'antd';
import {
  ClientLogAdminEndpoints as E,
  ClientLogKind,
  ClientLogListQuery,
  type ClientLogIssue,
  type ClientRuntimeEvent,
} from '@weiban/contracts';
import type { z } from 'zod';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { RecordDrawer } from '../ui/drawer.js';
import { Page, SectionCard } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';

const states = { open: '待处理', resolved: '已处理', ignored: '已忽略' };
const kinds: Record<string, string> = {
  js_error: '脚本报错',
  unhandled_rejection: '未处理异常',
  render_error: '页面崩溃',
  chunk_load_error: '页面文件加载失败',
  api_failure: '请求失败',
  realtime_issue: '实时连接异常',
  app_crash: '安卓崩溃',
  push_issue: '推送异常',
};
type List = z.output<typeof E.list.response>;
export function RuntimeLogEvents({ events }: { events: ClientRuntimeEvent[] }) {
  return events.length ? (
    <Table
      rowKey="clientEventId"
      rowSelection={{ preserveSelectedRowKeys: false }}
      size="small"
      pagination={{ pageSize: 10 }}
      dataSource={events}
      scroll={{ x: 650 }}
      columns={[
        {
          title: '时间',
          dataIndex: 'occurredAt',
          render: (value: string) => formatDateTime(value),
        },
        { title: '问题', render: (_, e: ClientRuntimeEvent) => `${kinds[e.kind]} · ${e.code}` },
        { title: '页面 / 接口', render: (_, e: ClientRuntimeEvent) => e.api?.route ?? e.page },
        {
          title: '版本 / 次数',
          render: (_, e: ClientRuntimeEvent) => `${e.version} (${e.build}) · ${e.count}`,
        },
      ]}
      expandable={{
        expandedRowRender: (e: ClientRuntimeEvent) => (
          <Space direction="vertical">
            <span>
              {e.environment.os} / {e.environment.browser} {e.environment.major} /{' '}
              {e.environment.screen} / {e.environment.language} / {e.environment.network}
            </span>
            {e.api && (
              <span>
                {e.api.method} · HTTP {e.api.status} · {e.api.durationMs} ms
              </span>
            )}
            {e.api?.requestId && <Typography.Text copyable>{e.api.requestId}</Typography.Text>}
            <pre>
              {e.frames.map((f) => `${f.file}:${f.line}:${f.column}`).join('\n') ||
                '没有可用代码坐标'}
            </pre>
          </Space>
        ),
      }}
    />
  ) : (
    <p>暂无运行记录（明细保留 30 天）</p>
  );
}
export function UserRuntimeLogs({ userId }: { userId: string }) {
  const remote = useRemote(E.user, { params: { userId }, networkOnly: true });
  return (
    <SectionCard title="最近的客户端报错（最多 50 条）">
      {remote.error && <Alert type="error" message={remote.error} />}
      <Button onClick={remote.refresh} loading={remote.loading}>
        刷新
      </Button>
      {!remote.loading && (
        <RuntimeLogEvents events={remote.data?.items.map((s) => s.event) ?? []} />
      )}
    </SectionCard>
  );
}
export function TicketRuntimeLogs({ ticketId }: { ticketId: string }) {
  const remote = useRemote(E.ticket, { params: { ticketId }, networkOnly: true });
  return (
    <SectionCard title="反馈附带的运行记录">
      {remote.error && <Alert type="error" message={remote.error} />}
      <Button onClick={remote.refresh} loading={remote.loading}>
        刷新
      </Button>
      {!remote.loading && <RuntimeLogEvents events={remote.data?.items ?? []} />}
    </SectionCard>
  );
}
export function ClientLogsPage() {
  const [filters, setFilters] = useState<z.input<typeof ClientLogListQuery>>({ limit: 30 });
  const [page, setPage] = useState<List>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string>();
  const revision = useRef(0);
  async function load(cursor?: string) {
    const generation = ++revision.current;
    setLoading(true);
    setError('');
    try {
      const result = await api.call(E.list, { query: { ...filters, cursor }, networkOnly: true });
      if (revision.current === generation)
        setPage((previous) => ({
          ...result,
          items: cursor ? [...(previous?.items ?? []), ...result.items] : result.items,
        }));
    } catch (e) {
      if (revision.current === generation) setError(errorText(e));
    } finally {
      if (revision.current === generation) setLoading(false);
    }
  }
  useEffect(() => {
    const requestRevision = revision;
    setPage(undefined);
    void load();
    return () => {
      requestRevision.current++;
    };
  }, [filters]); // eslint-disable-line react-hooks/exhaustive-deps
  const columns: ProColumns<ClientLogIssue>[] = [
    {
      title: '问题',
      render: (_, r) => (
        <Button type="link" onClick={() => setSelected(r.fingerprint)}>
          {r.title}
        </Button>
      ),
    },
    { title: '端', dataIndex: 'appKind', width: 90 },
    {
      title: '次数 / 近30天登录人数',
      render: (_, r) => `${r.totalCount} / ${r.affectedUsers}`,
      width: 170,
    },
    { title: '版本', render: (_, r) => `${r.firstVersion} → ${r.lastVersion}`, width: 160 },
    {
      title: '首次 / 最近',
      render: (_, r) => (
        <>
          {formatDateTime(r.firstSeenAt)}
          <br />
          {formatDateTime(r.lastSeenAt)}
        </>
      ),
      width: 180,
    },
    { title: '状态', render: (_, r) => states[r.status], width: 90 },
  ];
  return (
    <Page title="客户端报错" desc="仅技术信息；明细 30 天、问题 180 天；同类问题按指纹合并。">
      <Space wrap>
        <Select
          aria-label="端"
          placeholder="全部端"
          allowClear
          value={filters?.appKind}
          options={['web', 'pwa', 'android'].map((value) => ({ value, label: value }))}
          onChange={(appKind) => setFilters((f) => ({ ...f, appKind }))}
        />
        <Select
          aria-label="类型"
          placeholder="全部类型"
          allowClear
          style={{ width: 180 }}
          value={filters?.kind}
          options={ClientLogKind.options.map((value) => ({ value, label: kinds[value] }))}
          onChange={(kind) => setFilters((f) => ({ ...f, kind }))}
        />
        <Select
          aria-label="状态"
          placeholder="全部状态"
          allowClear
          value={filters?.status}
          options={Object.entries(states).map(([value, label]) => ({ value, label }))}
          onChange={(status) => setFilters((f) => ({ ...f, status }))}
        />
        <Select
          aria-label="版本"
          placeholder="全部版本"
          allowClear
          value={filters?.version}
          options={(page?.versions ?? []).map((v) => ({ value: v.version, label: v.version }))}
          onChange={(version) => setFilters((f) => ({ ...f, version }))}
        />
        <DatePicker.RangePicker
          aria-label="出现时间"
          showTime
          onChange={(range) =>
            setFilters((f) => ({
              ...f,
              since: range?.[0]?.toISOString(),
              until: range?.[1]?.toISOString(),
            }))
          }
        />
        <Button onClick={() => void load()} loading={loading}>
          刷新
        </Button>
      </Space>
      {error && <Alert type="error" showIcon message={error} />}
      <p>今天新增问题 {page?.todayIssues ?? 0} 个</p>
      <SectionCard title="今日已上报会话的受影响比例">
        <p>分母仅为成功上报的会话，离线或未上报会话不在统计内。</p>
        <Space wrap>
          {page?.versions.map((v) => (
            <span key={v.version}>
              {v.version}：{v.affectedSessions} / {v.sessions}（
              {v.sessions ? ((100 * v.affectedSessions) / v.sessions).toFixed(1) : '0'}%）
            </span>
          ))}
        </Space>
      </SectionCard>
      <DataTable
        rowKey="fingerprint"
        columns={columns}
        data={page?.items ?? []}
        loading={loading}
      />
      {page?.nextCursor && (
        <Button disabled={loading} onClick={() => void load(page.nextCursor!)}>
          加载更多
        </Button>
      )}
      {selected && (
        <IssueDrawer
          key={selected}
          fingerprint={selected}
          onClose={() => setSelected(undefined)}
          onChanged={() => void load()}
        />
      )}
    </Page>
  );
}
function IssueDrawer({
  fingerprint,
  onClose,
  onChanged,
}: {
  fingerprint: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const remote = useRemote(E.get, { params: { fingerprint }, networkOnly: true });
  const [status, setStatus] = useState<ClientLogIssue['status']>('open');
  const [note, setNote] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    if (remote.data) {
      setStatus(remote.data.issue.status);
      setNote(remote.data.issue.note);
    }
  }, [remote.data]);
  async function save() {
    setBusy(true);
    setError('');
    try {
      await api.call(E.update, { params: { fingerprint }, body: { status, note } });
      remote.refresh();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <RecordDrawer
      open
      width={900}
      onClose={onClose}
      title={remote.data?.issue.title ?? '客户端问题'}
      loading={remote.loading}
    >
      {(remote.error || error) && <Alert type="error" message={error || remote.error} />}
      {remote.data && (
        <>
          <Space>
            <Select
              value={status}
              disabled={busy}
              options={Object.entries(states).map(([value, label]) => ({ value, label }))}
              onChange={setStatus}
            />
            <Button
              type="primary"
              loading={busy}
              disabled={
                status === remote.data.issue.status && note.trim() === remote.data.issue.note
              }
              onClick={() => void save()}
            >
              保存
            </Button>
          </Space>
          <Input.TextArea
            aria-label="处理备注"
            disabled={busy}
            placeholder="处理备注"
            value={note}
            maxLength={1000}
            onChange={(e) => setNote(e.target.value)}
          />
          <SectionCard title="近 30 天次数">
            <Table
              rowKey="day"
              size="small"
              pagination={false}
              rowSelection={{ preserveSelectedRowKeys: false }}
              dataSource={remote.data.days}
              columns={[
                { title: '日期', dataIndex: 'day' },
                { title: '次数', dataIndex: 'count' },
                {
                  title: '趋势',
                  render: (_, day) => (
                    <meter
                      min={0}
                      max={Math.max(1, ...remote.data!.days.map((x) => x.count))}
                      value={day.count}
                    >
                      {day.count}
                    </meter>
                  ),
                },
              ]}
            />
          </SectionCard>
          <SectionCard title="最近 20 条样本">
            <RuntimeLogEvents events={remote.data.samples.map((s) => s.event)} />
          </SectionCard>
          <SectionCard title="受影响用户（最近 100 人）">
            <Space wrap>
              {remote.data.users.map((u) => (
                <Link key={u.userId} to={'/accounts?userId=' + u.userId + '&tab=runtime'}>
                  {u.userId}
                </Link>
              ))}
            </Space>
          </SectionCard>
        </>
      )}
    </RecordDrawer>
  );
}
