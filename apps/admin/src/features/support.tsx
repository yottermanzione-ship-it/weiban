/**
 * 帮助与反馈：用户提交的反馈与投诉。回复会通知用户；标记解决会关闭工单。
 */
import { useEffect, useRef, useState } from 'react';
import { Alert, Button, Checkbox, Input, Segmented, Space, Timeline } from 'antd';
import { SupportAdminEndpoints, type AdminSupportTicket } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { BulkTable, collectPages } from '../ui/bulk-table.js';
import { type ProColumns } from '../ui/table.js';
import { RecordDrawer } from '../ui/drawer.js';
import { TicketRuntimeLogs } from './client-logs.js';
import { FieldHelp, Page, SectionCard, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';
import { UserIdentity, shortUserId, userDisplayName } from './users/identity.js';
import { FacetFilter, FilterChips } from '../ui/grid-controls.js';
import { redactContact } from '../ui/csv.js';

const STATUS_LABELS: Record<string, string> = {
  open: '待处理',
  replied: '已回复',
  resolved: '已解决',
};

export function SupportAdminPage() {
  const toast = useToast();
  const [status, setStatus] = useState<'open' | 'replied' | 'resolved'>('open');
  const [kinds, setKinds] = useState<('feedback' | 'complaint')[]>([]);
  const kind = kinds.length === 1 ? kinds[0] : undefined;
  const [items, setItems] = useState<AdminSupportTicket[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  const latestRequest = useRef(0);
  async function load(after?: string) {
    const request = ++latestRequest.current;
    if (!after) {
      setItems([]);
      setCursor(null);
    }
    setLoading(true);
    setError('');
    try {
      const page = await api.call(SupportAdminEndpoints.list, {
        query: {
          status,
          kind,
          limit: 100,
          cursor: after,
        },
      });
      if (request !== latestRequest.current) return;
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setOpenCount(page.openCount);
      setCursor(page.nextCursor);
    } catch (e) {
      if (request === latestRequest.current) setError(errorText(e));
    } finally {
      if (request === latestRequest.current) setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    return () => {
      latestRequest.current += 1;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [status, kind]);

  const columns: ProColumns<AdminSupportTicket>[] = [
    {
      title: '用户',
      width: 150,
      render: (_, row) => (
        <UserIdentity
          userId={row.userId}
          label={{ nickname: row.nickname, username: row.username }}
          deleted={!row.username}
        />
      ),
    },
    {
      title: '类型',
      width: 90,
      render: (_, row) => (
        <StatusTag tone={row.kind === 'complaint' ? 'error' : 'default'}>
          {row.kind === 'complaint' ? '投诉' : '反馈'}
        </StatusTag>
      ),
    },
    {
      title: '内容',
      render: (_, row) => <span className="cell-clamp">{redactContact(row.text)}</span>,
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => (
        <StatusTag
          tone={
            row.status === 'open' ? 'warning' : row.status === 'resolved' ? 'success' : 'processing'
          }
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </StatusTag>
      ),
    },
    {
      title: '提交时间',
      width: 150,
      sorter: (a, b) => a.createdAt.localeCompare(b.createdAt),
      render: (_, row) => <code>{formatDateTime(row.createdAt)}</code>,
    },
  ];

  return (
    <Page
      title="工单"
      desc="用户提交的反馈与投诉。点一行看详情并回复；回复会推送给用户。"
      extra={<Button onClick={() => void load()}>刷新</Button>}
    >
      <BulkTable<AdminSupportTicket>
        scope={JSON.stringify([status, kinds])}
        nameOf={(r) => r.text.slice(0, 36)}
        afterBatch={() => void load()}
        allMatching={() =>
          collectPages(
            (cursor) =>
              api.call(SupportAdminEndpoints.list, {
                query: {
                  status,
                  kind,
                  limit: 100,
                  cursor,
                },
              }),
            (r) => r.ticketId,
          )
        }
        operations={[
          {
            label: status === 'resolved' ? '批量重新打开' : '批量标记解决',
            applies: () => true,
            run: (r) =>
              api.call(
                status === 'resolved'
                  ? SupportAdminEndpoints.reopen
                  : SupportAdminEndpoints.resolve,
                { params: { ticketId: r.ticketId } },
              ),
          },
        ]}
        rowKey="ticketId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onRowClick={(row) => setSelected(row.ticketId)}
        views={
          <Segmented<'open' | 'replied' | 'resolved'>
            className="os-view-tabs"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'open', label: '待处理 · ' + openCount },
              { value: 'replied', label: '已回复' },
              { value: 'resolved', label: '已解决' },
            ]}
          />
        }
        filters={
          <FacetFilter
            label="工单类型"
            value={kinds}
            onChange={setKinds}
            options={[
              { value: 'feedback', label: '反馈' },
              { value: 'complaint', label: '投诉' },
            ]}
          />
        }
        chips={
          <FilterChips
            chips={kinds.map((value) => ({
              key: value,
              label: value === 'feedback' ? '反馈' : '投诉',
              remove: () => setKinds(kinds.filter((item) => item !== value)),
            }))}
            onClear={() => setKinds([])}
          />
        }
        exportCsv={{
          filename: '微伴工单',
          fields: [
            { title: '用户编号', value: (row) => shortUserId(row.userId) },
            { title: '类型', value: (row) => (row.kind === 'complaint' ? '投诉' : '反馈') },
            { title: '状态', value: (row) => STATUS_LABELS[row.status] },
            { title: '提交时间', value: (row) => formatDateTime(row.createdAt) },
          ],
        }}
        emptyTitle={
          kinds.length ? '没有匹配工单' : status === 'open' ? '暂无待处理工单' : '暂无工单'
        }
        emptyHint={kinds.length ? undefined : '用户提交反馈或投诉后会出现在这里。'}
        emptyAction={kinds.length > 0 && <Button onClick={() => setKinds([])}>清空筛选</Button>}
        footer={
          cursor ? (
            <Button size="small" loading={loading} onClick={() => void load(cursor)}>
              加载更多
            </Button>
          ) : undefined
        }
      />
      {selected && (
        <TicketDrawer
          ticketId={selected}
          onClose={() => setSelected(null)}
          onChanged={() => {
            void load();
            toast.success('已保存');
          }}
        />
      )}
    </Page>
  );
}

export function TicketDrawer({
  ticketId,
  onClose,
  onChanged,
}: {
  ticketId: string;
  onClose: () => void;
  onChanged: () => void;
}) {
  const toast = useToast();
  const [ticket, setTicket] = useState<AdminSupportTicket | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [text, setText] = useState('');
  const [resolve, setResolve] = useState(false);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setTicket(await api.call(SupportAdminEndpoints.get, { params: { ticketId } }));
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ticketId]);

  async function act(action: 'reply' | 'resolve' | 'reopen') {
    setSaving(true);
    setError('');
    try {
      if (action === 'reply')
        await api.call(SupportAdminEndpoints.reply, {
          params: { ticketId },
          body: { text: text.trim(), resolve },
        });
      else
        await api.call(
          action === 'resolve' ? SupportAdminEndpoints.resolve : SupportAdminEndpoints.reopen,
          {
            params: { ticketId },
          },
        );
      setText('');
      setResolve(false);
      toast.success(
        action === 'reply' ? '已回复' : action === 'resolve' ? '已标记解决' : '已重新打开',
      );
      await load();
      onChanged();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={
        ticket
          ? `${ticket.kind === 'complaint' ? '投诉' : '反馈'} · ${userDisplayName(ticket.userId, { nickname: ticket.nickname, username: ticket.username }, !ticket.username)}`
          : '工单'
      }
      subtitle={ticket ? formatDateTime(ticket.createdAt) : undefined}
      width={720}
      loading={loading}
    >
      {error && <Alert type="error" showIcon message={error} />}
      {ticket && (
        <>
          <div className="detail-grid">
            <div>
              <span className="detail-label">状态</span>
              <StatusTag
                tone={
                  ticket.status === 'open'
                    ? 'warning'
                    : ticket.status === 'resolved'
                      ? 'success'
                      : 'processing'
                }
              >
                {STATUS_LABELS[ticket.status] ?? ticket.status}
              </StatusTag>
            </div>
            <div>
              <span className="detail-label">类型</span>
              <span>{ticket.kind === 'complaint' ? '投诉' : '反馈'}</span>
            </div>
            {ticket.target && (
              <div>
                <span className="detail-label">投诉对象</span>
                <span>
                  {ticket.target.type} · {ticket.target.id.slice(0, 8)}…
                </span>
              </div>
            )}
            {ticket.reason && (
              <div>
                <span className="detail-label">投诉原因</span>
                <span>{ticket.reason}</span>
              </div>
            )}
            {ticket.category && (
              <div>
                <span className="detail-label">反馈分类</span>
                <span>{ticket.category}</span>
              </div>
            )}
          </div>
          <SectionCard title="用户提交的内容">
            <TicketRuntimeLogs key={ticketId} ticketId={ticketId} />
            <div className="pre-wrap">{ticket.text}</div>
            {ticket.images.length > 0 && (
              <div className="thumb-row" style={{ marginTop: 8 }}>
                {ticket.images.map(
                  (image) =>
                    image.url && (
                      <a key={image.mediaId} href={image.url} target="_blank" rel="noreferrer">
                        <img src={image.url} alt="反馈截图" width={96} height={96} />
                      </a>
                    ),
                )}
              </div>
            )}
          </SectionCard>
          <SectionCard title="处理记录">
            {ticket.replies.length === 0 ? (
              <div className="detail-muted">还没有回复。</div>
            ) : (
              <Timeline
                items={ticket.replies.map((reply) => ({
                  key: reply.replyId,
                  color: reply.from === 'admin' ? 'green' : 'blue',
                  children: (
                    <div>
                      <div>
                        {reply.from === 'admin' ? '官方' : '用户'} ·{' '}
                        {formatDateTime(reply.createdAt)}
                      </div>
                      <div className="pre-wrap">{reply.text}</div>
                    </div>
                  ),
                }))}
              />
            )}
          </SectionCard>
          <SectionCard title="回复用户">
            <Input.TextArea
              rows={4}
              maxLength={2000}
              showCount
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="写清楚处理结果；会推送给用户"
            />
            <div style={{ marginTop: 10 }}>
              <Checkbox checked={resolve} onChange={(e) => setResolve(e.target.checked)}>
                同时标记为已解决
              </Checkbox>
            </div>
            <div style={{ marginTop: 12 }}>
              <Space>
                <Button
                  type="primary"
                  loading={saving}
                  disabled={!text.trim()}
                  onClick={() => void act('reply')}
                >
                  发送回复
                </Button>
                <Button
                  loading={saving}
                  onClick={() => void act(ticket.status === 'resolved' ? 'reopen' : 'resolve')}
                >
                  {ticket.status === 'resolved' ? '重新打开' : '标记解决'}
                </Button>
              </Space>
              <div className="field-help" style={{ marginTop: 8 }}>
                <FieldHelp>回复和状态变化会通知用户，并记入审计。</FieldHelp>
              </div>
            </div>
          </SectionCard>
        </>
      )}
    </RecordDrawer>
  );
}
