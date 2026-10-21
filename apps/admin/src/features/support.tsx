/**
 * 帮助与反馈：用户提交的反馈与投诉。回复会通知用户；标记解决会关闭工单。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Input, Select, Space, Timeline } from 'antd';
import { SupportAdminEndpoints, type AdminSupportTicket } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { RecordDrawer } from '../ui/drawer.js';
import { TicketRuntimeLogs } from './client-logs.js';
import { FieldHelp, Page, SectionCard, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';

const STATUS_LABELS: Record<string, string> = {
  open: '待处理',
  replied: '已回复',
  resolved: '已解决',
};

export function SupportAdminPage() {
  const toast = useToast();
  const [status, setStatus] = useState<'open' | 'replied' | 'resolved'>('open');
  const [kind, setKind] = useState('');
  const [items, setItems] = useState<AdminSupportTicket[]>([]);
  const [openCount, setOpenCount] = useState(0);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  async function load(after?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(SupportAdminEndpoints.list, {
        query: {
          status,
          kind: (kind || undefined) as 'feedback' | undefined,
          limit: 100,
          cursor: after,
        },
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
  }, [status, kind]);

  const columns: ProColumns<AdminSupportTicket>[] = [
    {
      title: '用户',
      width: 130,
      render: (_, row) => row.username ?? '已注销',
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
      render: (_, row) => <span className="cell-clamp">{row.text}</span>,
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
      render: (_, row) => formatDateTime(row.createdAt),
    },
  ];

  return (
    <Page
      title="帮助与反馈"
      desc="用户提交的反馈与投诉。点一行看详情并回复；回复会推送给用户。"
      extra={<Button onClick={() => void load()}>刷新</Button>}
    >
      <DataTable<AdminSupportTicket>
        rowKey="ticketId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onRowClick={(row) => setSelected(row.ticketId)}
        filters={
          <>
            <Select
              style={{ width: 130 }}
              value={status}
              onChange={setStatus}
              options={[
                { value: 'open', label: `待处理${openCount ? `（${openCount}）` : ''}` },
                { value: 'replied', label: '已回复' },
                { value: 'resolved', label: '已解决' },
              ]}
            />
            <Select
              allowClear
              style={{ width: 120 }}
              placeholder="全部类型"
              value={kind || undefined}
              onChange={(value) => setKind(value ?? '')}
              options={[
                { value: 'feedback', label: '反馈' },
                { value: 'complaint', label: '投诉' },
              ]}
            />
          </>
        }
        emptyTitle={status === 'open' ? '没有待处理的反馈' : '没有记录'}
        emptyHint="用户在网页端「设置 › 帮助与反馈」提交后会出现在这里。"
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

function TicketDrawer({
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
          ? `${ticket.kind === 'complaint' ? '投诉' : '反馈'} · ${ticket.username ?? '已注销'}`
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
