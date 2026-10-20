/**
 * 公告、更新说明、版本策略。
 * 公告：用户打开应用或回到前台时拉取；弹窗公告对未读用户自动弹一次。
 * 更新说明：按平台与版本号展示给用户。版本策略：提示更新 / 强制更新。
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  AnnouncementAdminEndpoints,
  ReleaseAdminEndpoints,
  type AdminAnnouncement,
  type AdminReleaseNote,
  type AppVersionPolicy,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import {
  FieldHelp,
  FormSection,
  Page,
  SectionCard,
  StatusTag,
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';

type Platform = 'web' | 'android';
const PLATFORM_LABELS: Record<string, string> = { web: '网页', android: '安卓' };
const ANNOUNCEMENT_STATUS: Record<string, string> = {
  draft: '草稿',
  published: '已发布',
  withdrawn: '已撤回',
};

export function AnnouncementsPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const list = useRemote(AnnouncementAdminEndpoints.listAnnouncements);
  const [editing, setEditing] = useState<AdminAnnouncement | 'new' | null>(null);
  const [error, setError] = useState('');

  async function run(work: () => Promise<unknown>, done: string) {
    setError('');
    try {
      await work();
      toast.success(done);
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const columns: ProColumns<AdminAnnouncement>[] = [
    {
      title: '标题',
      width: 260,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.title}</span>
          <span className="cell-sub cell-clamp">{row.body}</span>
        </div>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => (
        <StatusTag
          tone={row.status === 'published' ? 'success' : row.status === 'draft' ? 'default' : 'warning'}
        >
          {ANNOUNCEMENT_STATUS[row.status] ?? row.status}
        </StatusTag>
      ),
    },
    {
      title: '平台',
      width: 100,
      render: (_, row) =>
        row.platforms.length === 0 ? '全部' : row.platforms.map((p) => PLATFORM_LABELS[p]).join('、'),
    },
    {
      title: '生效期',
      width: 230,
      render: (_, row) => (
        <div className="cell-main">
          <span>{formatDateTime(row.startsAt ?? row.publishedAt)} 起</span>
          <span className="cell-sub">{row.endsAt ? `${formatDateTime(row.endsAt)} 止` : '不限结束'}</span>
        </div>
      ),
    },
    {
      title: '弹窗 / 置顶',
      width: 110,
      render: (_, row) =>
        [row.popup ? '弹窗' : '', row.pinned ? '置顶' : ''].filter(Boolean).join(' / ') || '—',
    },
    { title: '已读', width: 80, render: (_, row) => row.readCount },
    {
      title: '操作',
      width: 190,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          {row.status !== 'withdrawn' && (
            <Button type="link" size="small" onClick={() => setEditing(row)}>
              编辑
            </Button>
          )}
          {row.status !== 'published' && (
            <Button
              type="link"
              size="small"
              onClick={() =>
                void run(
                  () =>
                    api.call(AnnouncementAdminEndpoints.publishAnnouncement, {
                      params: { announcementId: row.announcementId },
                    }),
                  '已发布',
                )
              }
            >
              发布
            </Button>
          )}
          {row.status === 'published' && (
            <Button
              type="link"
              size="small"
              onClick={() =>
                confirm({
                  title: '撤回这条公告？',
                  content: '撤回后用户端立即看不到；已读记录保留。',
                  okText: '撤回',
                  onOk: () =>
                    run(
                      () =>
                        api.call(AnnouncementAdminEndpoints.withdrawAnnouncement, {
                          params: { announcementId: row.announcementId },
                        }),
                      '已撤回',
                    ),
                })
              }
            >
              撤回
            </Button>
          )}
          {row.status !== 'published' && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() =>
                confirm({
                  title: '删除这条公告？',
                  content: '删除后无法恢复。',
                  okText: '删除',
                  onOk: () =>
                    run(
                      () =>
                        api.call(AnnouncementAdminEndpoints.deleteAnnouncement, {
                          params: { announcementId: row.announcementId },
                        }),
                      '已删除',
                    ),
                })
              }
            >
              删除
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="公告"
      desc="用户打开应用或回到前台时拉取。勾「弹窗」的公告会对未读用户自动弹一次；已发布的公告要先撤回才能删除。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          新建公告
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <DataTable<AdminAnnouncement>
        rowKey="announcementId"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        onRowClick={(row) => row.status !== 'withdrawn' && setEditing(row)}
        emptyTitle="还没有公告"
        emptyHint="点右上角「新建公告」，写标题和正文；可以只存草稿，确认后再发布。"
        emptyAction={
          <Button type="primary" onClick={() => setEditing('new')}>
            新建第一条
          </Button>
        }
      />
      {editing && (
        <AnnouncementDrawer
          value={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            toast.success(text);
            setEditing(null);
            list.refresh();
          }}
        />
      )}
    </Page>
  );
}

interface AnnouncementForm {
  title: string;
  body: string;
  platforms: Platform[];
  range?: [dayjs.Dayjs, dayjs.Dayjs];
  popup: boolean;
  pinned: boolean;
  resetReads: boolean;
}

function AnnouncementDrawer({
  value,
  onClose,
  onSaved,
}: {
  value: AdminAnnouncement | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [form] = Form.useForm<AnnouncementForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit(mode: 'draft' | 'publish' | 'save') {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    const body = {
      title: values.title,
      body: values.body,
      platforms: (values.platforms ?? []).length === 2 ? [] : (values.platforms ?? []),
      startsAt: values.range?.[0]?.toISOString() ?? null,
      endsAt: values.range?.[1]?.toISOString() ?? null,
      popup: values.popup,
      pinned: values.pinned,
    };
    try {
      if (value)
        await api.call(AnnouncementAdminEndpoints.updateAnnouncement, {
          params: { announcementId: value.announcementId },
          body: { ...body, resetReads: values.resetReads === true },
        });
      else
        await api.call(AnnouncementAdminEndpoints.createAnnouncement, {
          body: { ...body, publish: mode === 'publish' },
        });
      onSaved(mode === 'publish' ? '已发布' : '已保存');
      onClose();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={value ? '编辑公告' : '新建公告'}
      width={680}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void submit(value ? 'save' : 'publish')}
          saving={saving}
          submitText={value ? '保存' : '保存并发布'}
          extra={
            !value ? (
              <Button onClick={() => void submit('draft')} disabled={saving}>
                存为草稿
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<AnnouncementForm>
        form={form}
        layout="vertical"
        initialValues={{
          title: value?.title ?? '',
          body: value?.body ?? '',
          platforms:
            !value || value.platforms.length === 0
              ? (['web', 'android'] as Platform[])
              : (value.platforms as Platform[]),
          range:
            value?.startsAt || value?.endsAt
              ? [
                  value?.startsAt ? dayjs(value.startsAt) : dayjs(),
                  value?.endsAt ? dayjs(value.endsAt) : dayjs().add(30, 'day'),
                ]
              : undefined,
          popup: value?.popup ?? false,
          pinned: value?.pinned ?? false,
          resetReads: false,
        }}
      >
        <FormSection title="内容" />
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: '填写标题' }]}
          extra={<FieldHelp>最多 60 字，用户端列表里显示这一行。</FieldHelp>}
        >
          <Input maxLength={60} showCount />
        </Form.Item>
        <Form.Item
          name="body"
          label="正文"
          rules={[{ required: true, message: '填写正文' }]}
          extra={<FieldHelp>纯文本，换行会保留。</FieldHelp>}
        >
          <Input.TextArea rows={6} maxLength={4000} showCount />
        </Form.Item>
        <FormSection title="投放" />
        <Form.Item
          name="platforms"
          label="目标平台"
          extra={<FieldHelp>两个都勾 = 全部平台。</FieldHelp>}
        >
          <Checkbox.Group
            options={[
              { value: 'web', label: '网页' },
              { value: 'android', label: '安卓' },
            ]}
          />
        </Form.Item>
        <Form.Item
          label="生效期"
          extra={<FieldHelp>留空 = 发布即生效、一直有效直到撤回。</FieldHelp>}
        >
          <Form.Item name="range" noStyle>
            <DatePicker.RangePicker showTime style={{ width: '100%' }} allowEmpty={[true, true]} />
          </Form.Item>
        </Form.Item>
        <Space size={24} wrap>
          <Form.Item name="popup" valuePropName="checked" extra={<FieldHelp>未读用户打开应用时弹一次。</FieldHelp>}>
            <Switch checkedChildren="弹窗" unCheckedChildren="不弹窗" />
          </Form.Item>
          <Form.Item name="pinned" valuePropName="checked" extra={<FieldHelp>置顶显示在列表最上面。</FieldHelp>}>
            <Switch checkedChildren="置顶" unCheckedChildren="不置顶" />
          </Form.Item>
          {value?.status === 'published' && (
            <Form.Item
              name="resetReads"
              valuePropName="checked"
              extra={<FieldHelp>清空已读，弹窗公告会再弹一次。</FieldHelp>}
            >
              <Checkbox>重新提醒所有人</Checkbox>
            </Form.Item>
          )}
        </Space>
      </Form>
    </RecordDrawer>
  );
}

export function ReleaseNotesPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [platform, setPlatform] = useState<'' | Platform>('');
  const list = useRemote(ReleaseAdminEndpoints.listReleaseNotes, {
    query: { platform: platform || undefined },
  });
  const [editing, setEditing] = useState<AdminReleaseNote | 'new' | null>(null);

  const columns: ProColumns<AdminReleaseNote>[] = [
    {
      title: '版本',
      width: 150,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.version}</span>
          <span className="cell-sub">build {row.versionCode}</span>
        </div>
      ),
    },
    {
      title: '平台',
      width: 90,
      render: (_, row) => PLATFORM_LABELS[row.platform] ?? row.platform,
    },
    { title: '标题', width: 220, render: (_, row) => row.title || '—' },
    {
      title: '内容',
      render: (_, row) => <span className="cell-clamp">{row.body}</span>,
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) =>
        row.published ? (
          <StatusTag tone="success">已发布</StatusTag>
        ) : (
          <StatusTag tone="default">草稿</StatusTag>
        ),
    },
    {
      title: '发布时间',
      width: 150,
      render: (_, row) => formatDateTime(row.publishedAt),
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditing(row)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger
            onClick={() =>
              confirm({
                title: `删除 ${row.version} 的更新说明？`,
                content: '删除后用户端「更新说明」里不再显示这个版本。',
                okText: '删除',
                onOk: async () => {
                  try {
                    await api.call(ReleaseAdminEndpoints.deleteReleaseNote, {
                      params: { releaseNoteId: row.releaseNoteId },
                    });
                    toast.success('已删除');
                    list.refresh();
                  } catch (e) {
                    toast.error(errorText(e));
                  }
                },
              })
            }
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="更新说明"
      desc="用户端「设置 › 更新说明」按版本展示。草稿不会返回给用户。"
      extra={
        <Space>
          <Select
            allowClear
            style={{ width: 120 }}
            placeholder="全部平台"
            value={platform || undefined}
            onChange={(value) => setPlatform((value as Platform) ?? '')}
            options={[
              { value: 'web', label: '网页' },
              { value: 'android', label: '安卓' },
            ]}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            新增版本说明
          </Button>
        </Space>
      }
    >
      <DataTable<AdminReleaseNote>
        rowKey="releaseNoteId"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        onRowClick={(row) => setEditing(row)}
        emptyTitle="还没有更新说明"
        emptyHint="每次发版后在这里写一条：版本号、build 号和新内容。"
      />
      {editing && (
        <ReleaseNoteDrawer
          value={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('已保存');
            setEditing(null);
            list.refresh();
          }}
        />
      )}
    </Page>
  );
}

interface ReleaseNoteForm {
  platform: Platform;
  version: string;
  versionCode: number;
  title: string;
  body: string;
  published: boolean;
}

function ReleaseNoteDrawer({
  value,
  onClose,
  onSaved,
}: {
  value: AdminReleaseNote | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<ReleaseNoteForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    const body = {
      platform: values.platform,
      version: values.version,
      versionCode: values.versionCode,
      title: values.title ?? '',
      body: values.body,
      published: values.published,
    };
    try {
      if (value)
        await api.call(ReleaseAdminEndpoints.updateReleaseNote, {
          params: { releaseNoteId: value.releaseNoteId },
          body,
        });
      else await api.call(ReleaseAdminEndpoints.createReleaseNote, { body });
      onSaved();
      onClose();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={value ? `编辑 ${value.version}` : '新增版本说明'}
      width={620}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void submit()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<ReleaseNoteForm>
        form={form}
        layout="vertical"
        initialValues={{
          platform: value?.platform ?? 'web',
          version: value?.version ?? '',
          versionCode: value?.versionCode ?? 1,
          title: value?.title ?? '',
          body: value?.body ?? '',
          published: value?.published ?? false,
        }}
      >
        <FormSection title="版本" />
        <div className="form-three">
          <Form.Item name="platform" label="平台">
            <Select
              options={[
                { value: 'web', label: '网页' },
                { value: 'android', label: '安卓' },
              ]}
            />
          </Form.Item>
          <Form.Item
            name="version"
            label="版本名"
            rules={[{ required: true, message: '填写版本名' }]}
            extra={<FieldHelp>例 1.4.0。</FieldHelp>}
          >
            <Input maxLength={32} />
          </Form.Item>
          <Form.Item
            name="versionCode"
            label="build 号"
            rules={[{ required: true, message: '填写 build 号' }]}
            extra={<FieldHelp>必须比上一版大。</FieldHelp>}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item name="title" label="标题" extra={<FieldHelp>例：聊天更顺了。</FieldHelp>}>
          <Input maxLength={60} />
        </Form.Item>
        <Form.Item
          name="body"
          label="更新内容"
          rules={[{ required: true, message: '填写更新内容' }]}
          extra={<FieldHelp>纯文本，换行保留；一条一行更清楚。</FieldHelp>}
        >
          <Input.TextArea rows={6} maxLength={4000} showCount />
        </Form.Item>
        <Form.Item
          name="published"
          label="立即发布"
          valuePropName="checked"
          extra={<FieldHelp>不发布就是草稿，用户看不到。</FieldHelp>}
        >
          <Switch />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

export function VersionPoliciesPage() {
  const toast = useToast();
  const list = useRemote(ReleaseAdminEndpoints.listVersionPolicies);
  const [editing, setEditing] = useState<AppVersionPolicy | null>(null);

  const columns: ProColumns<AppVersionPolicy>[] = [
    {
      title: '平台',
      width: 120,
      render: (_, row) => PLATFORM_LABELS[row.platform] ?? row.platform,
    },
    {
      title: '最新版本',
      width: 180,
      render: (_, row) =>
        row.latestVersion ? `${row.latestVersion}（build ${row.latestVersionCode}）` : '未设置',
    },
    {
      title: '最低可用版本',
      width: 150,
      render: (_, row) =>
        row.minSupportedVersionCode ? `build ${row.minSupportedVersionCode}` : '不限制',
    },
    {
      title: '下载地址',
      render: (_, row) => <span className="cell-sub mono">{row.downloadUrl ?? '—'}</span>,
    },
    {
      title: '强制更新说明',
      width: 200,
      render: (_, row) => row.forceUpdateMessage ?? '用默认文案',
    },
    {
      title: '更新时间',
      width: 150,
      render: (_, row) => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      width: 90,
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setEditing(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Page title="版本策略" desc="控制用户端是否提示更新、是否必须更新。每个平台一行。">
      <DataTable<AppVersionPolicy>
        rowKey="platform"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        onRowClick={(row) => setEditing(row)}
        pagination={false}
        emptyTitle="还没有版本策略"
        emptyHint="至少为网页设置一行；不设置时客户端不会提示更新。"
      />
      {editing && (
        <PolicyDrawer
          value={editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('已保存');
            setEditing(null);
            list.refresh();
          }}
        />
      )}
    </Page>
  );
}

interface PolicyForm {
  latestVersion?: string;
  latestVersionCode?: number | null;
  downloadUrl?: string;
  minSupportedVersionCode?: number | null;
  forceUpdateMessage?: string;
}

function PolicyDrawer({
  value,
  onClose,
  onSaved,
}: {
  value: AppVersionPolicy;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<PolicyForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function submit() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(ReleaseAdminEndpoints.updateVersionPolicy, {
        params: { platform: value.platform },
        body: {
          latestVersion: values.latestVersion?.trim() || null,
          latestVersionCode: values.latestVersionCode ?? null,
          downloadUrl: values.downloadUrl?.trim() || null,
          minSupportedVersionCode: values.minSupportedVersionCode ?? null,
          forceUpdateMessage: values.forceUpdateMessage?.trim() || null,
        },
      });
      onSaved();
      onClose();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={`版本策略 · ${PLATFORM_LABELS[value.platform] ?? value.platform}`}
      width={560}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void submit()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <SectionCard title="更新提示">
        <Form<PolicyForm>
          form={form}
          layout="vertical"
          initialValues={{
            latestVersion: value.latestVersion ?? '',
            latestVersionCode: value.latestVersionCode,
            downloadUrl: value.downloadUrl ?? '',
            minSupportedVersionCode: value.minSupportedVersionCode,
            forceUpdateMessage: value.forceUpdateMessage ?? '',
          }}
        >
          <div className="form-two">
            <Form.Item
              name="latestVersion"
              label="最新版本名"
              extra={<FieldHelp>留空 = 不提示更新。</FieldHelp>}
            >
              <Input maxLength={32} placeholder="例：1.4.0" />
            </Form.Item>
            <Form.Item name="latestVersionCode" label="最新 build 号">
              <InputNumber min={1} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <Form.Item
            name="downloadUrl"
            label="安装包地址（安卓）"
            extra={<FieldHelp>网页留空，「更新」就是刷新页面。</FieldHelp>}
          >
            <Input placeholder="https://…" />
          </Form.Item>
          <Form.Item
            name="minSupportedVersionCode"
            label="最低可用 build 号"
            extra={<FieldHelp>低于这个版本的客户端必须更新才能继续用；留空 = 不限制。</FieldHelp>}
          >
            <InputNumber min={1} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="forceUpdateMessage"
            label="强制更新说明"
            extra={<FieldHelp>留空用客户端默认文案。</FieldHelp>}
          >
            <Input.TextArea rows={2} maxLength={200} showCount />
          </Form.Item>
        </Form>
      </SectionCard>
    </RecordDrawer>
  );
}
