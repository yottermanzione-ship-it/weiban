/**
 * 公开动态：真人角色的作品/活动/获奖信息。自动搜索到的候选先进入「待审核」，通过后角色才会知道。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  Modal,
  Select,
  Space,
  Switch,
  Tabs,
} from 'antd';
import { PlusOutlined, SearchOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  CharacterAdminEndpoints,
  PublicUpdateAdminEndpoints,
  type PublicUpdate,
  type PublicUpdateKind,
  type PublicUpdateSource,
  type PublicUpdateStatus,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
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
  useToast,
} from '../ui/page.js';
import { formatDate } from '../ui/format.js';

const STATUS_LABELS: Record<PublicUpdateStatus, string> = {
  draft: '草稿',
  pending: '待审核',
  effective: '已生效',
  rejected: '已驳回',
  withdrawn: '已撤回',
};

const KIND_LABELS: Record<PublicUpdateKind, string> = {
  new_work: '新作品',
  event: '活动行程',
  award: '获奖',
  other: '其他',
};

function bjToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function displayStatus(item: PublicUpdate): string {
  if (item.status === 'effective' && item.effectiveDate > bjToday()) return '待生效';
  return STATUS_LABELS[item.status];
}

function toneOf(item: PublicUpdate) {
  if (item.status === 'effective') return item.effectiveDate > bjToday() ? 'warning' : 'success';
  if (item.status === 'pending') return 'warning';
  if (item.status === 'rejected' || item.status === 'withdrawn') return 'error';
  return 'default';
}

interface Draft {
  characterId: string;
  kind: PublicUpdateKind;
  content: string;
  startDate: string;
  endDate: string;
  effectiveDate: string;
  sourceUrl: string;
}

function blank(): Draft {
  return {
    characterId: '',
    kind: 'other',
    content: '',
    startDate: bjToday(),
    endDate: '',
    effectiveDate: bjToday(),
    sourceUrl: '',
  };
}

export function PublicUpdatesPage() {
  const toast = useToast();
  const [tab, setTab] = useState<'pending' | 'all'>('pending');
  const [status, setStatus] = useState<PublicUpdateStatus | ''>('');
  const [source, setSource] = useState<PublicUpdateSource | ''>('');
  const [characterId, setCharacterId] = useState('');
  const characters = useRemote(CharacterAdminEndpoints.list);
  const settings = useRemote(PublicUpdateAdminEndpoints.getSettings);
  const list = useRemote(PublicUpdateAdminEndpoints.list, {
    query:
      tab === 'pending'
        ? { status: 'pending', source: 'auto_search', limit: 100 }
        : {
            status: status || undefined,
            source: source || undefined,
            characterId: characterId || undefined,
            limit: 50,
          },
  });
  const [editing, setEditing] = useState<{ item: PublicUpdate | null; draft: Draft } | null>(null);
  const [noting, setNoting] = useState<{ item: PublicUpdate; action: 'reject' | 'withdraw' } | null>(
    null,
  );
  const [note, setNote] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [searchTarget, setSearchTarget] = useState('');
  const [searching, setSearching] = useState(false);

  const realPeople = (characters.data?.items ?? []).filter(
    (c) => c.classification.basis === 'real_person' && c.status === 'published',
  );

  const rows =
    tab === 'pending'
      ? [...(list.data?.items ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt))
      : (list.data?.items ?? []);

  useEffect(() => {
    void list.refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tab, status, source, characterId]);

  async function run(operation: () => Promise<unknown>, done: string) {
    setSaving(true);
    setError('');
    try {
      await operation();
      toast.success(done);
      list.refresh();
      return true;
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.status === 409
          ? '这条动态的状态已变化，请刷新后再试。'
          : errorText(e),
      );
      return false;
    } finally {
      setSaving(false);
    }
  }

  async function search() {
    if (!searchTarget) return;
    setSearching(true);
    setError('');
    try {
      const result = await api.call(PublicUpdateAdminEndpoints.triggerSearch, {
        params: { characterId: searchTarget },
      });
      toast.success(
        result.outcome === 'ok'
          ? `新增 ${result.created.length} 条候选${result.duplicates ? `，${result.duplicates} 条重复已跳过` : ''}`
          : result.outcome === 'disabled'
            ? '自动候选搜索已关闭'
            : result.outcome === 'not_eligible'
              ? '这个角色不是已上架的真人角色'
              : '搜索服务暂时不可用，可以手动录入',
      );
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSearching(false);
    }
  }

  const columns: ProColumns<PublicUpdate>[] = [
    {
      title: '角色',
      width: 130,
      render: (_, row) => row.characterName,
    },
    {
      title: '类型',
      width: 100,
      render: (_, row) => KIND_LABELS[row.kind] ?? row.kind,
    },
    {
      title: '内容',
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-clamp">{row.content}</span>
          {row.reviewNote && <span className="cell-sub">备注：{row.reviewNote}</span>}
        </div>
      ),
    },
    {
      title: '日期',
      width: 170,
      render: (_, row) =>
        `${formatDate(row.startDate)}${row.endDate ? ` ~ ${formatDate(row.endDate)}` : ''}`,
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => <StatusTag tone={toneOf(row)}>{displayStatus(row)}</StatusTag>,
    },
    {
      title: '来源',
      width: 100,
      render: (_, row) => (row.source === 'auto_search' ? '自动搜索' : '手动录入'),
    },
    {
      title: '操作',
      width: 150,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          {row.status === 'pending' && (
            <>
              <Button
                type="link"
                size="small"
                onClick={() => setEditing({ item: row, draft: draftOf(row) })}
              >
                审核
              </Button>
              <Button
                type="link"
                size="small"
                danger
                onClick={() => {
                  setNoting({ item: row, action: 'reject' });
                  setNote('');
                }}
              >
                驳回
              </Button>
            </>
          )}
          {row.status === 'effective' && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() => {
                setNoting({ item: row, action: 'withdraw' });
                setNote('');
              }}
            >
              撤回
            </Button>
          )}
          {(row.status === 'draft' || row.status === 'rejected') && (
            <Button
              type="link"
              size="small"
              onClick={() => setEditing({ item: row, draft: draftOf(row) })}
            >
              编辑
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="公开动态"
      desc="真人角色的新作品、活动、获奖。自动搜索到的候选要人工审核，通过后角色才会「知道」这件事。"
      extra={
        <Space>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 200 }}
            placeholder="选择真人角色"
            value={searchTarget || undefined}
            onChange={(value) => setSearchTarget(value ?? '')}
            options={realPeople.map((c) => ({ value: c.characterId, label: c.name }))}
          />
          <Button
            icon={<SearchOutlined />}
            loading={searching}
            disabled={!searchTarget || settings.data?.autoSearchEnabled === false}
            onClick={() => void search()}
          >
            搜索候选
          </Button>
          <Button
            type="primary"
            icon={<PlusOutlined />}
            onClick={() => setEditing({ item: null, draft: blank() })}
          >
            手动录入
          </Button>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <div className="page-tabs">
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'pending' | 'all')}
          items={[
            { key: 'pending', label: '待审核' },
            { key: 'all', label: '全部动态' },
          ]}
        />
      </div>
      <DataTable<PublicUpdate>
        rowKey="updateId"
        columns={columns}
        data={rows}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        pagination={false}
        filters={
          tab === 'all' ? (
            <>
              <Select
                allowClear
                style={{ width: 140 }}
                placeholder="全部状态"
                value={status || undefined}
                onChange={(value) => setStatus((value as PublicUpdateStatus) ?? '')}
                options={Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label }))}
              />
              <Select
                allowClear
                style={{ width: 140 }}
                placeholder="全部来源"
                value={source || undefined}
                onChange={(value) => setSource((value as PublicUpdateSource) ?? '')}
                options={[
                  { value: 'auto_search', label: '自动搜索' },
                  { value: 'manual', label: '手动录入' },
                ]}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                style={{ width: 180 }}
                placeholder="按角色筛选"
                value={characterId || undefined}
                onChange={(value) => setCharacterId(value ?? '')}
                options={(characters.data?.items ?? []).map((c) => ({
                  value: c.characterId,
                  label: c.name,
                }))}
              />
            </>
          ) : undefined
        }
        emptyTitle={tab === 'pending' ? '没有待审核的动态' : '还没有公开动态'}
        emptyHint={
          tab === 'pending'
            ? '自动搜索到候选后会出现在这里；也可以点右上角「手动录入」自己添加。'
            : '点右上角「手动录入」，选角色、写内容、填来源链接。'
        }
      />

      <SectionCard title="自动搜索" desc="开启后系统会定期为真人角色搜索公开信息">
        <Space align="center">
          <Switch
            checked={settings.data?.autoSearchEnabled ?? false}
            loading={settings.loading}
            onChange={(checked) =>
              void run(
                () =>
                  api.call(PublicUpdateAdminEndpoints.updateSettings, {
                    body: { autoSearchEnabled: checked },
                  }),
                checked ? '已开启自动搜索' : '已关闭自动搜索',
              )
            }
          />
          <span className="detail-muted">
            关闭后只能手动录入；已搜到的候选不受影响。
          </span>
        </Space>
      </SectionCard>

      {editing && (
        <UpdateDrawer
          item={editing.item}
          draft={editing.draft}
          characters={(characters.data?.items ?? []).map((c) => ({
            value: c.characterId,
            label: `${c.name}${c.classification.basis === 'real_person' ? '（真人）' : ''}`,
          }))}
          saving={saving}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(mode) => {
            const { item, draft } = editing;
            void run(
              async () => {
                const fields = {
                  kind: draft.kind,
                  content: draft.content,
                  startDate: draft.startDate,
                  endDate: draft.endDate || null,
                  effectiveDate: draft.effectiveDate,
                  sourceUrl: draft.sourceUrl,
                };
                if (!item)
                  await api.call(PublicUpdateAdminEndpoints.create, {
                    body: { characterId: draft.characterId, ...fields, status: mode },
                  });
                else if (item.status === 'pending' && mode === 'effective')
                  await api.call(PublicUpdateAdminEndpoints.approve, {
                    params: { updateId: item.updateId },
                    body: fields,
                  });
                else {
                  await api.call(PublicUpdateAdminEndpoints.update, {
                    params: { updateId: item.updateId },
                    body: fields,
                  });
                  if (item.status === 'draft' && mode !== 'draft')
                    await api.call(PublicUpdateAdminEndpoints.submit, {
                      params: { updateId: item.updateId },
                    });
                }
              },
              mode === 'effective' ? '已通过' : '已保存',
            ).then((ok) => {
              if (ok) setEditing(null);
            });
          }}
        />
      )}

      <Modal
        open={noting !== null}
        title={noting?.action === 'reject' ? '驳回这条动态？' : '撤回这条动态？'}
        onCancel={() => setNoting(null)}
        onOk={() => {
          if (!noting) return;
          void run(
            () =>
              noting.action === 'reject'
                ? api.call(PublicUpdateAdminEndpoints.reject, {
                    params: { updateId: noting.item.updateId },
                    body: { note: note.trim() },
                  })
                : api.call(PublicUpdateAdminEndpoints.withdraw, {
                    params: { updateId: noting.item.updateId },
                    body: { note: note.trim() },
                  }),
            noting.action === 'reject' ? '已驳回' : '已撤回',
          ).then((ok) => {
            if (ok) setNoting(null);
          });
        }}
        okText={noting?.action === 'reject' ? '驳回' : '撤回'}
        cancelText="取消"
        confirmLoading={saving}
        okButtonProps={{ danger: true, disabled: !note.trim() }}
        destroyOnHidden
      >
        <Form layout="vertical">
          <Form.Item label={noting?.action === 'reject' ? '驳回理由' : '撤回理由'} required>
            <Input.TextArea
              rows={3}
              maxLength={500}
              value={note}
              onChange={(e) => setNote(e.target.value)}
            />
          </Form.Item>
        </Form>
      </Modal>
    </Page>
  );
}

function draftOf(item: PublicUpdate): Draft {
  return {
    characterId: item.characterId,
    kind: item.kind,
    content: item.content,
    startDate: item.startDate,
    endDate: item.endDate ?? '',
    effectiveDate: item.effectiveDate,
    sourceUrl: item.sourceUrl,
  };
}

function UpdateDrawer({
  item,
  draft,
  characters,
  saving,
  error,
  onClose,
  onSave,
}: {
  item: PublicUpdate | null;
  draft: Draft;
  characters: Array<{ value: string; label: string }>;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (mode: 'draft' | 'pending' | 'effective') => void;
}) {
  const [values, setValues] = useState<Draft>(draft);
  const patch = (value: Partial<Draft>) => setValues((current) => ({ ...current, ...value }));
  const canApprove = item?.status === 'pending';

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={item ? '审核公开动态' : '手动录入公开动态'}
      subtitle="角色只会说这里写明的内容，不会自行补充细节"
      width={680}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => onSave(canApprove ? 'effective' : 'pending')}
          saving={saving}
          submitText={canApprove ? '通过并生效' : '保存并提交审核'}
          extra={
            !item ? (
              <Button onClick={() => onSave('draft')} disabled={saving}>
                存为草稿
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form layout="vertical">
        <FormSection title="基本信息" />
        <div className="form-two">
          <Form.Item label="角色" required extra={<FieldHelp>只有真人角色才有公开动态。</FieldHelp>}>
            <Select
              showSearch
              optionFilterProp="label"
              disabled={!!item}
              value={values.characterId || undefined}
              onChange={(value) => patch({ characterId: value })}
              options={characters}
              placeholder="选择角色"
            />
          </Form.Item>
          <Form.Item label="类型">
            <Select
              value={values.kind}
              onChange={(value) => patch({ kind: value })}
              options={Object.entries(KIND_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
        </div>
        <Form.Item
          label="内容"
          required
          extra={<FieldHelp>只写事实：什么作品、什么活动、什么时候。不要写评价和猜测。</FieldHelp>}
        >
          <Input.TextArea
            rows={4}
            maxLength={500}
            showCount
            value={values.content}
            onChange={(e) => patch({ content: e.target.value })}
          />
        </Form.Item>
        <div className="form-three">
          <Form.Item label="开始日期">
            <DatePicker
              style={{ width: '100%' }}
              value={values.startDate ? dayjs(values.startDate) : null}
              onChange={(value) => patch({ startDate: value ? value.format('YYYY-MM-DD') : '' })}
            />
          </Form.Item>
          <Form.Item label="结束日期" extra={<FieldHelp>单日事件留空。</FieldHelp>}>
            <DatePicker
              style={{ width: '100%' }}
              value={values.endDate ? dayjs(values.endDate) : null}
              onChange={(value) => patch({ endDate: value ? value.format('YYYY-MM-DD') : '' })}
            />
          </Form.Item>
          <Form.Item label="生效日期" extra={<FieldHelp>从这天起角色才知道这件事。</FieldHelp>}>
            <DatePicker
              style={{ width: '100%' }}
              value={values.effectiveDate ? dayjs(values.effectiveDate) : null}
              onChange={(value) =>
                patch({ effectiveDate: value ? value.format('YYYY-MM-DD') : '' })
              }
            />
          </Form.Item>
        </div>
        <Form.Item
          label="来源链接"
          required
          extra={<FieldHelp>必须是公开可查的 https 链接，审核时会核对。</FieldHelp>}
        >
          <Input
            value={values.sourceUrl}
            onChange={(e) => patch({ sourceUrl: e.target.value })}
            placeholder="https://…"
          />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}
