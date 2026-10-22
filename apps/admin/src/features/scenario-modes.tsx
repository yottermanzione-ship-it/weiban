/**
 * 情景模式：给角色一套「当前处境」的预设（例：同居、异地、同事）。
 * 内置模式不能删除，只能改预设提示词和启停；改了提示词要重新做人设稳定检查。
 *
 * 注意：这个接口还没有进 packages/contracts，沿用原有的原生 fetch；
 * token 从本地管理会话里取（data/client.ts 的 adminToken）。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, InputNumber, Select, Space, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { adminToken } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, Page, StatusTag, useDangerConfirm, useToast } from '../ui/page.js';
import { useFormFeedback } from '../data/form-feedback.js';

type ScenarioMode = {
  id: string;
  name: string;
  description: string;
  presetPrompt: string | null;
  appliesTo: 'all' | 'non_minor' | 'adult_eligible';
  hasRomanceContent: boolean;
  hasAdultContent: boolean;
  isBuiltin: boolean;
  enabled: boolean;
  sortOrder: number;
};

const APPLIES_LABELS: Record<string, string> = {
  all: '所有角色',
  non_minor: '非儿童角色',
  adult_eligible: '有成人模式资格的角色',
};

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const token = await adminToken();
  const response = await fetch(path, {
    ...init,
    signal: init.signal ?? AbortSignal.timeout(20_000),
    headers: {
      ...(init.body ? { 'Content-Type': 'application/json' } : {}),
      Authorization: `Bearer ${token}`,
      ...init.headers,
    },
  });
  if (!response.ok) {
    const body = (await response.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${response.status}`);
  }
  return (response.status === 204 ? null : await response.json()) as T;
}

async function fetchModes(): Promise<ScenarioMode[]> {
  const body = await request<{ items: ScenarioMode[] }>('/api/v1/admin/scenario-modes');
  return body.items;
}

async function saveMode(id: string | null, data: Partial<ScenarioMode>): Promise<ScenarioMode> {
  return request<ScenarioMode>(
    id ? `/api/v1/admin/scenario-modes/${id}` : '/api/v1/admin/scenario-modes',
    {
      method: id ? 'PATCH' : 'POST',
      body: JSON.stringify(data),
    },
  );
}

async function deleteMode(id: string): Promise<void> {
  await request(`/api/v1/admin/scenario-modes/${id}`, { method: 'DELETE' });
}

export function ScenarioModesPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [modes, setModes] = useState<ScenarioMode[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<ScenarioMode | 'new' | null>(null);

  async function load() {
    setLoading(true);
    setError('');
    try {
      setModes(await fetchModes());
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function remove(mode: ScenarioMode) {
    try {
      await deleteMode(mode.id);
      setModes((prev) => prev.filter((m) => m.id !== mode.id));
      toast.success('已删除');
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  const columns: ProColumns<ScenarioMode>[] = [
    {
      title: '情景模式',
      width: 260,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">
            {row.name}
            {row.isBuiltin && <StatusTag>内置</StatusTag>}
          </span>
          <span className="cell-sub">{row.description || '没有说明'}</span>
        </div>
      ),
    },
    {
      title: '适用角色',
      width: 160,
      render: (_, row) => APPLIES_LABELS[row.appliesTo] ?? row.appliesTo,
    },
    {
      title: '内容标记',
      width: 160,
      render: (_, row) => (
        <Space size={4}>
          {row.hasRomanceContent && <StatusTag tone="warning">恋爱</StatusTag>}
          {row.hasAdultContent && <StatusTag tone="error">成人</StatusTag>}
          {!row.hasRomanceContent && !row.hasAdultContent && <span className="cell-sub">—</span>}
        </Space>
      ),
    },
    {
      title: '排序',
      width: 80,
      render: (_, row) => row.sortOrder,
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) =>
        row.enabled ? <StatusTag tone="success">启用</StatusTag> : <StatusTag>停用</StatusTag>,
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditing(row)}>
            编辑
          </Button>
          {!row.isBuiltin && (
            <Button
              type="link"
              size="small"
              danger
              onClick={() =>
                confirm({
                  title: `删除「${row.name}」？`,
                  content: '删除后用户端不再显示这个情景；已经开启的用户会退回默认情景。',
                  okText: '删除',
                  onOk: () => remove(row),
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
      title="情景模式"
      desc="给角色一套「当前处境」的预设。内置模式不能删除，只能改提示词和启停。"
      extra={
        <Space>
          <Button onClick={() => void load()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            新增情景模式
          </Button>
        </Space>
      }
    >
      <DataTable<ScenarioMode>
        rowKey="id"
        columns={columns}
        data={modes}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onRowClick={(row) => setEditing(row)}
        emptyTitle="还没有情景模式"
        emptyHint="点右上角「新增情景模式」，写名称、说明和预设提示词。"
      />
      {editing && (
        <ModeDrawer
          mode={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            toast.success('已保存');
            setModes((prev) =>
              prev.some((m) => m.id === saved.id)
                ? prev.map((m) => (m.id === saved.id ? saved : m))
                : [...prev, saved],
            );
            setEditing(null);
          }}
        />
      )}
    </Page>
  );
}

interface ModeForm {
  name: string;
  description: string;
  presetPrompt?: string;
  appliesTo: 'all' | 'non_minor' | 'adult_eligible';
  hasRomanceContent: boolean;
  hasAdultContent: boolean;
  sortOrder: number;
  enabled: boolean;
}

function ModeDrawer({
  mode,
  onClose,
  onSaved,
}: {
  mode: ScenarioMode | null;
  onClose: () => void;
  onSaved: (mode: ScenarioMode) => void;
}) {
  const [form] = Form.useForm<ModeForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const originalPrompt = mode?.presetPrompt ?? '';

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    const data: Partial<ScenarioMode> = {
      name: values.name,
      description: values.description,
      presetPrompt: values.presetPrompt?.trim() || null,
      enabled: values.enabled,
      sortOrder: values.sortOrder,
      ...(mode?.isBuiltin
        ? {}
        : {
            appliesTo: values.appliesTo,
            hasRomanceContent: values.hasRomanceContent,
            hasAdultContent: values.hasAdultContent,
          }),
    };
    try {
      const saved = await saveMode(mode?.id ?? null, data);
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      form={form}
      draftKey={`scenario-mode:${mode?.id ?? 'new'}`}
      open
      onClose={onClose}
      title={mode ? `编辑情景模式 · ${mode.name}` : '新增情景模式'}
      width={640}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<ModeForm>
        form={form}
        layout="vertical"
        initialValues={{
          name: mode?.name ?? '',
          description: mode?.description ?? '',
          presetPrompt: mode?.presetPrompt ?? '',
          appliesTo: mode?.appliesTo ?? 'all',
          hasRomanceContent: mode?.hasRomanceContent ?? false,
          hasAdultContent: mode?.hasAdultContent ?? false,
          sortOrder: mode?.sortOrder ?? 0,
          enabled: mode?.enabled ?? true,
        }}
      >
        <FormSection title="基本信息" />
        <div className="form-two">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '填写名称' }]}
            extra={<FieldHelp>用户端看到的名字，例：同居日常。</FieldHelp>}
          >
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" extra={<FieldHelp>数字小的排前面。</FieldHelp>}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <Form.Item
          name="description"
          label="说明"
          extra={<FieldHelp>一句话说明这个情景是什么。</FieldHelp>}
        >
          <Input maxLength={60} />
        </Form.Item>
        <Form.Item
          name="presetPrompt"
          label="预设提示词"
          extra={
            <FieldHelp>
              会拼进角色的人设里。改动后需要重新运行人设稳定检查，相关角色才能继续发布。
            </FieldHelp>
          }
        >
          <Input.TextArea rows={5} maxLength={2000} showCount />
        </Form.Item>
        {!mode?.isBuiltin && (
          <>
            <FormSection title="适用范围" />
            <Form.Item name="appliesTo" label="适用角色">
              <Select
                options={Object.entries(APPLIES_LABELS).map(([value, label]) => ({ value, label }))}
              />
            </Form.Item>
            <Space size={24} wrap>
              <Form.Item name="hasRomanceContent" valuePropName="checked">
                <Checkbox>包含恋爱内容</Checkbox>
              </Form.Item>
              <Form.Item name="hasAdultContent" valuePropName="checked">
                <Checkbox>包含成人内容</Checkbox>
              </Form.Item>
            </Space>
          </>
        )}
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
        {mode && (
          <div className="detail-muted">
            {originalPrompt !== (form.getFieldValue('presetPrompt') ?? '')
              ? '提示词已修改，保存后请重新跑人设稳定检查。'
              : '提示词未修改。'}
          </div>
        )}
      </Form>
    </RecordDrawer>
  );
}
