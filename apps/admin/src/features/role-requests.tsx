/**
 * 制作申请：用户提交的角色需求。接单 → 填进度 → 完成（关联已上架角色）或拒绝。
 * 完成后默认把角色加到申请人通讯录；所有写操作服务器记审计并通知申请人。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
  Timeline,
} from 'antd';
import {
  CharacterAdminEndpoints,
  RoleRequestAdminEndpoints,
  type AdminRoleRequest,
  type RoleRequestStatus,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, Page, SectionCard, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';

const STATUS_LABELS: Record<string, string> = {
  pending: '待处理',
  in_progress: '制作中',
  completed: '已完成',
  rejected: '已拒绝',
  cancelled: '已撤回',
};

const BASIS_LABELS: Record<string, string> = {
  real_person: '真人',
  fictional: '虚构',
  original: '原创',
};

const CHANGED = 'weiban-admin:role-requests-changed';

export function RoleRequestsPage() {
  const [tab, setTab] = useState<'list' | 'config'>('list');
  return (
    <Page
      title="制作申请"
      desc="用户想要某个角色，提交需求后在这里处理。完成前请先在「角色库」建好并上架这个角色。"
    >
      <div className="page-tabs">
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'list' | 'config')}
          items={[
            { key: 'list', label: '申请列表' },
            { key: 'config', label: '价格与开关' },
          ]}
        />
        {tab === 'list' ? <RequestList /> : <ConfigPanel />}
      </div>
    </Page>
  );
}

function RequestList() {
  const [status, setStatus] = useState<'' | RoleRequestStatus>('pending');
  const [userId, setUserId] = useState('');
  const [applied, setApplied] = useState<{ status: '' | RoleRequestStatus; userId: string }>({
    status: 'pending',
    userId: '',
  });
  const [items, setItems] = useState<AdminRoleRequest[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [pendingCount, setPendingCount] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);

  async function load(after?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(RoleRequestAdminEndpoints.list, {
        query: {
          status: applied.status || undefined,
          userId: applied.userId.trim() || undefined,
          cursor: after,
        },
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
      setPendingCount(page.pendingCount);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [applied]);

  const columns: ProColumns<AdminRoleRequest>[] = [
    {
      title: '角色名',
      fixed: 'left',
      width: 180,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.roleName}</span>
          <span className="cell-sub">{row.sourceWork || '未填出处'}</span>
        </div>
      ),
    },
    { title: '申请人', width: 130, render: (_, row) => row.username ?? '已注销' },
    {
      title: '类型',
      width: 90,
      render: (_, row) => BASIS_LABELS[row.basis ?? ''] ?? '不确定',
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => (
        <StatusTag
          tone={
            row.status === 'pending'
              ? 'warning'
              : row.status === 'in_progress'
                ? 'processing'
                : row.status === 'completed'
                  ? 'success'
                  : row.status === 'rejected'
                    ? 'error'
                    : 'default'
          }
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </StatusTag>
      ),
    },
    {
      title: '最新留言',
      render: (_, row) => <span className="cell-sub">{row.adminMessage || '—'}</span>,
    },
    {
      title: '提交时间',
      width: 150,
      render: (_, row) => formatDateTime(row.createdAt),
    },
  ];

  return (
    <div className="tab-body">
      <DataTable<AdminRoleRequest>
        rowKey="requestId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onRowClick={(row) => setSelected(row.requestId)}
        filters={
          <>
            <Select
              style={{ width: 160 }}
              value={status}
              onChange={(value) => {
                setStatus(value);
                setApplied({ status: value, userId });
              }}
              options={[
                { value: '', label: '全部状态' },
                { value: 'pending', label: `待处理${pendingCount ? `（${pendingCount}）` : ''}` },
                { value: 'in_progress', label: '制作中' },
                { value: 'completed', label: '已完成' },
                { value: 'rejected', label: '已拒绝' },
                { value: 'cancelled', label: '已撤回' },
              ]}
            />
            <Input.Search
              allowClear
              placeholder="按用户 ID 查"
              style={{ width: 220 }}
              value={userId}
              onChange={(e) => setUserId(e.target.value)}
              onSearch={(value) => setApplied({ status, userId: value })}
            />
          </>
        }
        emptyTitle={applied.status === 'pending' ? '没有待处理的申请' : '没有符合条件的申请'}
        emptyHint="用户提交申请后会出现在这里；先看需求，再去「角色库」把人设做好。"
        footer={
          cursor ? (
            <div className="cursor-pager">
              <Button size="small" loading={loading} onClick={() => void load(cursor)}>
                加载更多
              </Button>
            </div>
          ) : undefined
        }
      />
      {selected && (
        <RequestDrawer
          requestId={selected}
          onClose={() => setSelected(null)}
          onChanged={(row) => {
            setItems((prev) => prev.map((x) => (x.requestId === row.requestId ? row : x)));
            window.dispatchEvent(new Event(CHANGED));
            void load();
          }}
        />
      )}
    </div>
  );
}

type Action = 'accept' | 'progress' | 'complete' | 'reject';

function RequestDrawer({
  requestId,
  onClose,
  onChanged,
}: {
  requestId: string;
  onClose: () => void;
  onChanged: (row: AdminRoleRequest) => void;
}) {
  const toast = useToast();
  const remote = useRemote(RoleRequestAdminEndpoints.get, { params: { requestId } });
  const characters = useRemote(CharacterAdminEndpoints.list);
  const [data, setData] = useState<AdminRoleRequest | null>(null);
  const [action, setAction] = useState<Action | null>(null);
  const [text, setText] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [addToContacts, setAddToContacts] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const row = data ?? remote.data ?? null;
  const open = row?.status === 'pending' || row?.status === 'in_progress';

  async function run() {
    if (!action) return;
    setSaving(true);
    setError('');
    const params = { requestId };
    const message = text.trim();
    try {
      const result =
        action === 'accept'
          ? await api.call(RoleRequestAdminEndpoints.accept, {
              params,
              body: message ? { message } : {},
            })
          : action === 'progress'
            ? await api.call(RoleRequestAdminEndpoints.progress, {
                params,
                body: { message },
              })
            : action === 'reject'
              ? await api.call(RoleRequestAdminEndpoints.reject, {
                  params,
                  body: { message },
                })
              : await api.call(RoleRequestAdminEndpoints.complete, {
                  params,
                  body: { characterId, addToContacts, ...(message ? { message } : {}) },
                });
      setData(result);
      onChanged(result);
      toast.success(
        { accept: '已接单', progress: '进度已更新', complete: '已完成', reject: '已拒绝' }[action],
      );
      setAction(null);
      setText('');
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.code === 'character_not_available'
          ? '这个角色不存在或还没上架，请先去「角色库」上架。'
          : errorText(e),
      );
    } finally {
      setSaving(false);
    }
  }

  const actionLabel: Record<Action, string> = {
    accept: '接单',
    progress: '更新进度',
    complete: '完成并关联角色',
    reject: '拒绝申请',
  };

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={row ? `「${row.roleName}」` : '制作申请'}
      subtitle={row ? `${row.username ?? '已注销'} · ${formatDateTime(row.createdAt)}` : undefined}
      width={720}
      loading={!row && remote.loading}
      footer={
        open ? (
          <div className="drawer-actions">
            <Space size={8}>
              <Button danger onClick={() => setAction('reject')}>
                拒绝
              </Button>
            </Space>
            <Space size={8}>
              {row?.status === 'pending' && (
                <Button onClick={() => setAction('accept')}>接单</Button>
              )}
              <Button onClick={() => setAction('progress')}>更新进度</Button>
              <Button type="primary" onClick={() => setAction('complete')}>
                完成并关联角色
              </Button>
            </Space>
          </div>
        ) : undefined
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      {remote.error && !row && <Alert type="error" showIcon message={remote.error} />}
      {row && (
        <>
          <div className="detail-grid">
            <div>
              <span className="detail-label">状态</span>
              <StatusTag
                tone={
                  row.status === 'pending'
                    ? 'warning'
                    : row.status === 'in_progress'
                      ? 'processing'
                      : row.status === 'completed'
                        ? 'success'
                        : row.status === 'rejected'
                          ? 'error'
                          : 'default'
                }
              >
                {STATUS_LABELS[row.status] ?? row.status}
              </StatusTag>
            </div>
            <div>
              <span className="detail-label">申请人</span>
              <span>
                {row.username ?? '已注销'}（{row.userId.slice(0, 8)}…）
              </span>
            </div>
            <div>
              <span className="detail-label">类型 / 分类</span>
              <span>
                {BASIS_LABELS[row.basis ?? ''] ?? '不确定'} / {row.categoryId ?? '未选'}
              </span>
            </div>
            <div>
              <span className="detail-label">出处</span>
              <span>{row.sourceWork || '—'}</span>
            </div>
            <div>
              <span className="detail-label">积分</span>
              <span>
                {row.pointsCost > 0
                  ? `价格 ${row.pointsCost} 积分（已扣 ${row.pointsCharged}）`
                  : '不收费'}
              </span>
            </div>
            {row.characterId && (
              <div>
                <span className="detail-label">关联角色</span>
                <span>
                  {row.characterId.slice(0, 8)}…
                  {row.addedToContacts ? '（已加通讯录）' : '（未自动添加）'}
                </span>
              </div>
            )}
          </div>
          <SectionCard title="需求内容">
            <div className="detail-grid">
              <div>
                <span className="detail-label">参考资料</span>
                <span className="pre-wrap">{row.referenceText || '—'}</span>
              </div>
              <div>
                <span className="detail-label">补充说明</span>
                <span className="pre-wrap">{row.note || '—'}</span>
              </div>
            </div>
            <div style={{ height: 10 }} />
            <div className="thumb-row">
              {row.referenceImages.length === 0
                ? '没有参考图'
                : row.referenceImages.map((image, index) =>
                    image.url ? (
                      <a key={image.mediaId} href={image.url} target="_blank" rel="noreferrer">
                        <img src={image.url} alt={`参考图 ${index + 1}`} width={72} height={72} />
                      </a>
                    ) : (
                      <span key={image.mediaId} className="detail-muted">
                        参考图已删除
                      </span>
                    ),
                  )}
            </div>
          </SectionCard>
          <SectionCard title="处理记录">
            {row.history.length === 0 ? (
              <div className="detail-muted">还没有处理记录。</div>
            ) : (
              <Timeline
                items={row.history.map((h, index) => ({
                  key: index,
                  color:
                    h.status === 'rejected' ? 'red' : h.status === 'completed' ? 'green' : 'blue',
                  children: (
                    <div>
                      <div>
                        {STATUS_LABELS[h.status] ?? h.status} · {formatDateTime(h.at)}
                      </div>
                      {h.message && <div className="detail-muted">{h.message}</div>}
                    </div>
                  ),
                }))}
              />
            )}
          </SectionCard>
        </>
      )}
      <Modal
        open={action !== null}
        title={action ? actionLabel[action] : ''}
        onCancel={() => setAction(null)}
        onOk={() => void run()}
        okText="确认"
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ danger: action === 'reject' }}
        destroyOnHidden
      >
        {action && (
          <Form layout="vertical">
            {action === 'complete' && (
              <>
                <Form.Item
                  label="关联哪个角色"
                  required
                  extra={<FieldHelp>只能选已经上架的官方角色。</FieldHelp>}
                >
                  <Select
                    showSearch
                    optionFilterProp="label"
                    value={characterId || undefined}
                    onChange={setCharacterId}
                    placeholder="选择已上架角色"
                    options={(characters.data?.items ?? [])
                      .filter((c) => c.status === 'published')
                      .map((c) => ({ value: c.characterId, label: c.name }))}
                  />
                </Form.Item>
                <Checkbox
                  checked={addToContacts}
                  onChange={(e) => setAddToContacts(e.target.checked)}
                >
                  自动加到申请人通讯录
                </Checkbox>
              </>
            )}
            <Form.Item
              label={action === 'reject' ? '拒绝原因（会发给用户）' : '留言（可选）'}
              required={action === 'progress' || action === 'reject'}
              style={{ marginTop: 12 }}
            >
              <Input.TextArea
                rows={3}
                maxLength={500}
                showCount
                value={text}
                onChange={(e) => setText(e.target.value)}
              />
            </Form.Item>
            <div className="detail-muted">此操作会记入审计记录，并通知申请人。</div>
          </Form>
        )}
      </Modal>
    </RecordDrawer>
  );
}

interface ConfigValues {
  enabled: boolean;
  maxOpenPerUser: number;
  pointsCost: number;
  lifetimeFreeCount: number;
  proPlusWeeklyFreeCount: number;
}

function ConfigPanel() {
  const toast = useToast();
  const remote = useRemote(RoleRequestAdminEndpoints.getConfig);
  const [form] = Form.useForm<ConfigValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(RoleRequestAdminEndpoints.updateConfig, {
        body: {
          enabled: values.enabled,
          pointsCost: values.pointsCost,
          maxOpenPerUser: values.maxOpenPerUser,
          lifetimeFreeCount: values.lifetimeFreeCount,
          proPlusWeeklyFreeCount: values.proPlusWeeklyFreeCount,
        },
      });
      toast.success('已保存');
      remote.refresh();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  if (remote.error) return <Alert type="error" showIcon message={remote.error} />;
  if (!remote.data) return <div className="detail-muted">正在读取…</div>;

  return (
    <SectionCard title="价格与开关" desc="控制用户能不能提交申请、每人能同时提几个">
      {error && <Alert type="error" showIcon message={error} style={{ marginBottom: 12 }} />}
      <Form<ConfigValues>
        form={form}
        layout="vertical"
        initialValues={{
          enabled: remote.data.enabled,
          maxOpenPerUser: remote.data.maxOpenPerUser,
          pointsCost: remote.data.pointsCost,
          lifetimeFreeCount: remote.data.lifetimeFreeCount,
          proPlusWeeklyFreeCount: remote.data.proPlusWeeklyFreeCount,
        }}
      >
        <FormSection title="开放申请" />
        <Form.Item
          name="enabled"
          label="允许用户提交制作申请"
          valuePropName="checked"
          extra={<FieldHelp>关闭后，用户端入口显示「暂未开放」。</FieldHelp>}
        >
          <Switch />
        </Form.Item>
        <Form.Item
          name="maxOpenPerUser"
          label="每人同时未完成的申请上限"
          extra={<FieldHelp>达到上限后用户不能再提交，直到旧的完成或撤回。</FieldHelp>}
        >
          <InputNumber min={1} max={50} style={{ width: 200 }} />
        </Form.Item>
        <FormSection title="免费次数与价格" />
        <Form.Item
          name="lifetimeFreeCount"
          label="每人终身免费次数"
          extra={<FieldHelp>免费用户和 PRO+ 都有。</FieldHelp>}
        >
          <InputNumber min={0} max={100} precision={0} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item
          name="proPlusWeeklyFreeCount"
          label="PRO+ 每周额外免费次数"
          extra={
            <FieldHelp>
              北京时间周一 0 点重置，不累积到下周；会员期间才有。先用每周的，再用终身的。
            </FieldHelp>
          }
        >
          <InputNumber min={0} max={100} precision={0} style={{ width: 200 }} />
        </Form.Item>
        <Form.Item
          name="pointsCost"
          label="免费次数用完后每次价格（积分）"
          extra={<FieldHelp>100 积分 = 1 元。提交时冻结、完成时扣除、拒绝或撤回退回。</FieldHelp>}
        >
          <InputNumber min={0} max={1_000_000} precision={0} style={{ width: 200 }} />
        </Form.Item>
        <div className="field-note">
          被拒绝或撤回的申请会退还免费次数。注意：PRO+
          每周免费次数是人工活，会员多了工作量会很大，请留意「制作申请」角标。
        </div>
        <Space>
          <Button type="primary" loading={saving} onClick={() => void save()}>
            保存
          </Button>
          <Button onClick={() => form.resetFields()}>还原</Button>
        </Space>
      </Form>
    </SectionCard>
  );
}
