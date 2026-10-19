import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Collapse,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Tag,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined, ArrowUpOutlined } from '@ant-design/icons';
import { ApiFailure } from '@weiban/client-core';
import {
  ModelAccessAdminEndpoints,
  RouteBillingBounds,
  type AdminModel,
  type ModelRates,
  type ModelRoute,
  type Upstream,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText } from '../../data/hooks.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import { DrawerActions, RecordDrawer } from '../../ui/drawer.js';
import {
  FieldHelp,
  FormSection,
  HelpTip,
  StatusTag,
  useDangerConfirm,
  useToast,
} from '../../ui/page.js';
import { formatPoints } from '../../ui/format.js';
import {
  CAPABILITY_LABELS,
  DEFAULT_FOR_LABELS,
  PROVIDERS,
  UPSTREAM_STATE_LABELS,
  upstreamState,
} from './shared.js';

type UseFilter = 'all' | 'chat' | 'background' | 'adult' | 'vision' | 'voice';

function matchesUse(m: AdminModel, use: UseFilter): boolean {
  switch (use) {
    case 'all':
      return true;
    case 'chat':
      return (
        m.defaultFor.includes('chat') ||
        (!m.capabilities.includes('adult_content') &&
          !m.defaultFor.some((d) => d.startsWith('speech')))
      );
    case 'background':
      return m.defaultFor.includes('background') || m.defaultFor.includes('planner');
    case 'adult':
      return m.capabilities.includes('adult_content') || m.defaultFor.includes('adult_check');
    case 'vision':
      return m.capabilities.includes('vision') || m.defaultFor.includes('vision');
    case 'voice':
      return (
        m.capabilities.includes('voice_input') ||
        m.capabilities.includes('voice_output') ||
        m.defaultFor.includes('speech_synthesis') ||
        m.defaultFor.includes('speech_recognition')
      );
  }
}

function toWrite(m: AdminModel) {
  return {
    modelKey: m.modelKey,
    displayName: m.displayName,
    vendorName: m.vendorName,
    upstreamId: m.upstreamId,
    upstreamModelId: m.upstreamModelId,
    capabilities: m.capabilities,
    tags: m.tags,
    leaderboardRank: m.leaderboardRank,
    sortOrder: m.sortOrder,
    defaultFor: m.defaultFor,
    enabled: m.enabled,
    billingBounds: m.billingBounds ?? null,
    rates: m.rates,
    costRates: m.costRates,
    ...(m.routes?.length ? { routes: m.routes } : {}),
  };
}

function ratesOf(input?: number | null, output?: number | null, cache?: number | null): ModelRates | null {
  if (input == null && output == null && cache == null) return null;
  return { input: input ?? 0, output: output ?? 0, cache: cache ?? 0 };
}

export function ModelsTab({
  models,
  upstreams,
  refresh,
}: {
  models: AdminModel[];
  upstreams: Upstream[];
  refresh: () => void;
}) {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [use, setUse] = useState<UseFilter>('all');
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminModel | 'new' | null>(null);
  const [error, setError] = useState('');

  const upstreamName = (id: string) =>
    upstreams.find((u) => u.upstreamId === id)?.name ?? '未知账号';

  const list = models
    .filter((m) => matchesUse(m, use))
    .filter((m) => status === 'all' || (status === 'on' ? m.enabled : !m.enabled))
    .filter(
      (m) =>
        !query.trim() ||
        m.displayName.includes(query.trim()) ||
        m.modelKey.includes(query.trim()),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);

  async function setEnabled(m: AdminModel, enabled: boolean) {
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.upsertModel, {
        params: { modelKey: encodeURIComponent(m.modelKey) },
        body: { ...toWrite(m), enabled },
      });
      toast.success(enabled ? '已上架' : '已下架');
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const columns: ProColumns<AdminModel>[] = [
    {
      title: '模型',
      fixed: 'left',
      width: 210,
      render: (_, m) => (
        <div className="cell-main">
          <span className="cell-title">{m.displayName}</span>
          <span className="cell-sub">
            {m.vendorName} · <span className="mono">{m.modelKey}</span>
          </span>
        </div>
      ),
    },
    {
      title: '上游线路（按顺序切换）',
      width: 160,
      render: (_, m) => {
        const routes = [...(m.routes ?? [])].sort((a, b) => a.priority - b.priority);
        return (routes.length ? routes.map((r) => r.upstreamId) : [m.upstreamId])
          .map(upstreamName)
          .join(' → ');
      },
    },
    {
      title: '能力',
      width: 140,
      render: (_, m) =>
        ['文字', ...m.capabilities.map((c) => CAPABILITY_LABELS[c] ?? c)].join(' · '),
    },
    {
      title: '默认给谁用',
      width: 140,
      render: (_, m) =>
        m.defaultFor.map((d) => DEFAULT_FOR_LABELS[d] ?? d).join('、') || '—',
    },
    {
      title: (
        <span>
          售价（元/百万 token）
          <HelpTip text="每百万 token 的人民币价格；1 元 = 100 积分。输入 / 输出 / 缓存命中输入。" />
        </span>
      ),
      width: 170,
      render: (_, m) =>
        m.rates ? (
          <span className="cell-main">
            <span>
              入 {m.rates.input.toFixed(2)} · 出 {m.rates.output.toFixed(2)}
            </span>
            <span className="cell-sub">
              缓存 {m.rates.cache.toFixed(2)}
              {m.hasTimeBands ? ' · 有分时价' : ''}
            </span>
          </span>
        ) : (
          <span className="cell-sub">非 token 计价</span>
        ),
    },
    {
      title: '约每条回复',
      width: 100,
      sorter: (a, b) => (a.pointsPerReply ?? 0) - (b.pointsPerReply ?? 0),
      render: (_, m) =>
        m.pointsPerReply == null ? '—' : `${formatPoints(m.pointsPerReply * 10_000)} 积分`,
    },
    {
      title: '状态',
      width: 110,
      render: (_, m) => (
        <Space size={4} wrap>
          <StatusTag tone={m.enabled ? 'success' : 'default'}>{m.enabled ? '已上架' : '已下架'}</StatusTag>
          {!(m.routes?.length
            ? m.routes.some(
                (route) => route.enabled && route.billingBounds && !route.billingBounds.pauseReason,
              )
            : m.billingBounds && !m.billingBounds.pauseReason) && (
            <StatusTag tone="warning">需配置计费上限</StatusTag>
          )}
        </Space>
      ),
    },
    {
      title: '操作',
      width: 96,
      fixed: 'right',
      render: (_, m) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditing(m)}>
            编辑
          </Button>
          {m.enabled ? (
            <Button
              type="link"
              size="small"
              danger
              onClick={() =>
                confirm({
                  title: `下架「${m.displayName}」？`,
                  content: '下架后，正在使用这个模型的角色会改用默认模型。',
                  okText: '下架',
                  onOk: () => setEnabled(m, false),
                })
              }
            >
              下架
            </Button>
          ) : (
            <Button type="link" size="small" onClick={() => void setEnabled(m, true)}>
              上架
            </Button>
          )}
        </Space>
      ),
    },
  ];

  return (
    <div className="tab-body">
      <div className="tab-head">
        <div className="tab-desc">
          <strong>模型</strong>
          <span>每个模型可以挂多条上游线路；价格按「每百万 token 的人民币价格」填写。</span>
        </div>
        <Space size={8}>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            添加模型
          </Button>
        </Space>
      </div>
      <DataTable<AdminModel>
        rowKey="modelKey"
        columns={columns}
        data={list}
        error={error}
        onRefresh={refresh}
        onRowClick={(m) => setEditing(m)}
        filters={
          <>
            <Input.Search
              allowClear
              placeholder="搜索模型名"
              style={{ width: 200 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              style={{ width: 130 }}
              value={use}
              onChange={setUse}
              options={[
                { value: 'all', label: '全部用途' },
                { value: 'chat', label: '聊天' },
                { value: 'background', label: '后台' },
                { value: 'adult', label: '成人模式' },
                { value: 'vision', label: '识图' },
                { value: 'voice', label: '语音' },
              ]}
            />
            <Select
              style={{ width: 120 }}
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'on', label: '已上架' },
                { value: 'off', label: '已下架' },
              ]}
            />
          </>
        }
        emptyTitle="还没有模型"
        emptyHint="先在「上游账号」里添加一条线路，再点「添加模型」，填上模型名和每百万 token 的价格。"
        emptyAction={
          <Button type="primary" onClick={() => setEditing('new')}>
            添加第一个模型
          </Button>
        }
      />
      {editing && (
        <ModelWizard
          model={editing === 'new' ? null : editing}
          upstreams={upstreams}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.success('已保存，价目表已自动更新');
            refresh();
          }}
        />
      )}
    </div>
  );
}

interface RouteDraft {
  upstreamId: string;
  upstreamModelId: string;
  weight: number;
  enabled: boolean;
  billingBoundsDraft: string;
}

interface ModelFormValues {
  modelKey?: string;
  displayName: string;
  vendorName: string;
  tags?: string;
  sortOrder?: number;
  capabilities: string[];
  defaultFor: string[];
  routes: RouteDraft[];
  priceInput?: number | null;
  priceOutput?: number | null;
  priceCache?: number | null;
  costInput?: number | null;
  costOutput?: number | null;
  costCache?: number | null;
}

function ModelWizard({
  model,
  upstreams,
  onClose,
  onSaved,
}: {
  model: AdminModel | null;
  upstreams: Upstream[];
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<ModelFormValues>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [upstreamModels, setUpstreamModels] = useState<{ id: string; items: string[] | null; error: string }>({
    id: '',
    items: null,
    error: '',
  });
  const [confirmBands, setConfirmBands] = useState(false);

  const initialRoutes: RouteDraft[] = model?.routes?.length
    ? [...model.routes]
        .sort((a, b) => a.priority - b.priority)
        .map((r) => ({
          upstreamId: r.upstreamId,
          upstreamModelId: r.upstreamModelId,
          weight: r.weight,
          enabled: r.enabled,
          billingBoundsDraft: r.billingBounds ? JSON.stringify(r.billingBounds, null, 2) : '',
        }))
    : [
        {
          upstreamId: model?.upstreamId ?? upstreams[0]?.upstreamId ?? '',
          upstreamModelId: model?.upstreamModelId ?? '',
          weight: 100,
          enabled: true,
          billingBoundsDraft: model?.billingBounds
            ? JSON.stringify(model.billingBounds, null, 2)
            : '',
        },
      ];

  async function loadUpstreamModels(upstreamId: string) {
    if (!upstreamId) return;
    setUpstreamModels({ id: upstreamId, items: null, error: '' });
    try {
      const r = await api.call(ModelAccessAdminEndpoints.listUpstreamModels, {
        params: { upstreamId },
      });
      setUpstreamModels({ id: upstreamId, items: r.items.map((i) => i.id), error: '' });
    } catch (e) {
      setUpstreamModels({
        id: upstreamId,
        items: [],
        error:
          e instanceof ApiFailure && e.code === 'upstream_test_failed'
            ? '拉不到这个账号的模型列表，请手动填写模型名'
            : errorText(e),
      });
    }
  }

  async function save(force = false) {
    const values = await form.validateFields();
    if (model?.hasTimeBands && !force && values.priceInput != null) {
      setConfirmBands(true);
      return;
    }
    let routes: ModelRoute[];
    try {
      routes = values.routes.map((route, index) => {
        let billingBounds: ModelRoute['billingBounds'] = null;
        if (route.billingBoundsDraft.trim()) {
          const parsed = RouteBillingBounds.safeParse(JSON.parse(route.billingBoundsDraft));
          if (!parsed.success)
            throw new Error(
              `第 ${index + 1} 条线路的计费上限格式不正确：${parsed.error.issues
                .map((issue) => `${issue.path.join('.')} ${issue.message}`)
                .join('；')}`,
            );
          billingBounds = parsed.data;
        }
        return {
          upstreamId: route.upstreamId,
          upstreamModelId: route.upstreamModelId,
          priority: index + 1,
          weight: route.weight,
          enabled: route.enabled,
          billingBounds,
        };
      });
    } catch (failure) {
      setError(failure instanceof Error ? failure.message : '计费上限格式不正确');
      return;
    }
    const primary = routes[0];
    if (!primary) {
      setError('至少要有一条上游线路');
      return;
    }
    const key = (model?.modelKey ?? values.modelKey ?? '').trim();
    setSaving(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.upsertModel, {
        params: { modelKey: encodeURIComponent(key) },
        body: {
          modelKey: key,
          displayName: values.displayName,
          vendorName: values.vendorName,
          upstreamId: primary.upstreamId,
          upstreamModelId: primary.upstreamModelId,
          billingBounds: primary.billingBounds ?? null,
          capabilities: values.capabilities as AdminModel['capabilities'],
          tags: (values.tags ?? '')
            .split(/[,，、\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10),
          leaderboardRank: model?.leaderboardRank ?? null,
          sortOrder: values.sortOrder ?? model?.sortOrder ?? 0,
          defaultFor: values.defaultFor as AdminModel['defaultFor'],
          enabled: model ? model.enabled : true,
          rates: ratesOf(values.priceInput, values.priceOutput, values.priceCache),
          costRates: ratesOf(values.costInput, values.costOutput, values.costCache) ?? undefined,
          routes,
        },
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
      setConfirmBands(false);
    }
  }

  const firstUpstream = Form.useWatch(['routes', 0, 'upstreamId'], form);

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={model ? `编辑模型 · ${model.displayName}` : '添加模型'}
      subtitle="价格改完保存后，系统会自动生成并发布新的价目表版本"
      width={720}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void save()}
          saving={saving}
          submitText={model ? '保存' : '保存并上架'}
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<ModelFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          modelKey: model?.modelKey ?? '',
          displayName: model?.displayName ?? '',
          vendorName: model?.vendorName ?? '',
          tags: model?.tags.join('，') ?? '',
          sortOrder: model?.sortOrder ?? 0,
          capabilities: model?.capabilities ?? [],
          defaultFor: model?.defaultFor ?? [],
          routes: initialRoutes,
          priceInput: model?.rates?.input ?? null,
          priceOutput: model?.rates?.output ?? null,
          priceCache: model?.rates?.cache ?? null,
          costInput: model?.costRates?.input ?? null,
          costOutput: model?.costRates?.output ?? null,
          costCache: model?.costRates?.cache ?? null,
        }}
        onValuesChange={(changed) => {
          if (changed.routes?.[0]?.upstreamId) void loadUpstreamModels(changed.routes[0].upstreamId);
        }}
      >
        <FormSection title="① 上游线路" desc="按顺序切换：第一条不通就用第二条" />
        <Form.List name="routes">
          {(fields, { add, remove, move }) => (
            <div className="route-list">
              {fields.map((field, index) => (
                <div className="route-row" key={field.key}>
                  <div className="route-head">
                    <span className="route-index">线路 {index + 1}</span>
                    <Space size={4}>
                      <Button
                        size="small"
                        type="text"
                        icon={<ArrowUpOutlined />}
                        disabled={index === 0}
                        onClick={() => move(index, index - 1)}
                      />
                      <Button
                        size="small"
                        type="text"
                        danger
                        icon={<MinusCircleOutlined />}
                        disabled={fields.length === 1}
                        onClick={() => remove(field.name)}
                      />
                    </Space>
                  </div>
                  <div className="route-fields">
                    <Form.Item
                      name={[field.name, 'upstreamId']}
                      rules={[{ required: true, message: '选择上游账号' }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Select
                        placeholder="上游账号"
                        options={upstreams.map((u) => ({
                          value: u.upstreamId,
                          label: `${u.name}${
                            upstreamState(u) === 'normal'
                              ? ''
                              : `（${UPSTREAM_STATE_LABELS[upstreamState(u)]}）`
                          }`,
                        }))}
                      />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'upstreamModelId']}
                      rules={[{ required: true, message: '填写模型名' }]}
                      style={{ marginBottom: 8 }}
                    >
                      <Select
                        showSearch
                        allowClear
                        placeholder="这个账号那边的模型名"
                        options={(index === 0 ? upstreamModels.items ?? [] : []).map((id) => ({
                          value: id,
                          label: id,
                        }))}
                        onFocus={() => {
                          if (index === 0 && !upstreamModels.items && firstUpstream)
                            void loadUpstreamModels(firstUpstream);
                        }}
                        notFoundContent={
                          index === 0 && upstreamModels.error
                            ? upstreamModels.error
                            : '可以直接输入模型名'
                        }
                        filterOption={(input, option) =>
                          String(option?.value ?? '').includes(input)
                        }
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'weight']} style={{ marginBottom: 8 }}>
                      <InputNumber min={1} max={1000} addonBefore="权重" style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item name={[field.name, 'enabled']} valuePropName="checked" style={{ marginBottom: 8 }}>
                      <Checkbox>启用这条线路</Checkbox>
                    </Form.Item>
                  </div>
                  <Collapse
                    ghost
                    size="small"
                    items={[
                      {
                        key: 'bounds',
                        label: '计费上限（高级，通常不用填）',
                        children: (
                          <Form.Item
                            name={[field.name, 'billingBoundsDraft']}
                            extra={
                              <FieldHelp>
                                只在已核实供应商官方计费资料时填写。留空表示这条线路不能调用；换上游或模型名会清空旧内容。
                              </FieldHelp>
                            }
                          >
                            <Input.TextArea rows={6} placeholder='{"format":"billing-bounds-v1", …}' />
                          </Form.Item>
                        ),
                      },
                    ]}
                  />
                </div>
              ))}
              <Button
                type="dashed"
                block
                onClick={() =>
                  add({
                    upstreamId:
                      upstreams.find(
                        (u) =>
                          !(form.getFieldValue('routes') as RouteDraft[] | undefined)?.some(
                            (r) => r.upstreamId === u.upstreamId,
                          ),
                      )
                        ?.upstreamId ??
                      upstreams[0]?.upstreamId ??
                      '',
                    upstreamModelId:
                      (form.getFieldValue('routes') as RouteDraft[] | undefined)?.[0]
                        ?.upstreamModelId ?? '',
                    weight: 100,
                    enabled: true,
                    billingBoundsDraft: '',
                  })
                }
              >
                再加一条备用线路
              </Button>
            </div>
          )}
        </Form.List>

        <FormSection title="② 显示与用途" />
        {!model && (
          <Form.Item
            name="modelKey"
            label="模型键"
            rules={[{ required: true, message: '填写模型键' }]}
            extra={<FieldHelp>内部唯一标识，保存后不能改。一般和上游模型名一致，例如 deepseek-chat。</FieldHelp>}
          >
            <Input maxLength={80} placeholder="例：deepseek-chat" />
          </Form.Item>
        )}
        <div className="form-two">
          <Form.Item
            name="displayName"
            label="显示名"
            rules={[{ required: true, message: '填写显示名' }]}
            extra={<FieldHelp>用户看到的模型名字。</FieldHelp>}
          >
            <Input maxLength={60} placeholder="例：DeepSeek V3" />
          </Form.Item>
          <Form.Item
            name="vendorName"
            label="出品方"
            rules={[{ required: true, message: '填写出品方' }]}
            extra={<FieldHelp>例：深度求索。</FieldHelp>}
          >
            <Input maxLength={40} />
          </Form.Item>
        </div>
        <Form.Item name="capabilities" label="能力" extra={<FieldHelp>决定用户端哪些功能可以选它。</FieldHelp>}>
          <Checkbox.Group
            options={Object.entries(CAPABILITY_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item
          name="defaultFor"
          label="默认给谁用"
          extra={<FieldHelp>不选也可以；选了之后，对应场景默认用这个模型。</FieldHelp>}
        >
          <Checkbox.Group
            options={Object.entries(DEFAULT_FOR_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <div className="form-two">
          <Form.Item name="tags" label="标签" extra={<FieldHelp>用逗号分隔，用户端展示用。</FieldHelp>}>
            <Input placeholder="例：便宜，快" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" extra={<FieldHelp>数字小的排前面。</FieldHelp>}>
            <InputNumber style={{ width: '100%' }} />
          </Form.Item>
        </div>

        <FormSection title="③ 价格" desc="每百万 token 的人民币价格，1 元 = 100 积分" />
        <div className="form-three">
          <Form.Item name="priceInput" label="输入（元）" extra={<FieldHelp>没命中缓存时，每百万 token 收多少。</FieldHelp>}>
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="priceOutput" label="输出（元）" extra={<FieldHelp>模型写出来的内容，每百万 token 收多少。</FieldHelp>}>
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="priceCache" label="缓存命中（元）" extra={<FieldHelp>命中缓存时便宜很多，一般填输入价的 1/10。</FieldHelp>}>
            <InputNumber min={0} step={0.01} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
        </div>
        <div className="field-note">
          {model?.pointsPerReply != null
            ? `按标准用量估算，每条回复约 ${formatPoints(model.pointsPerReply * 10_000)} 积分；不是预留额，也不承诺每条花费。`
            : '保存后系统会按标准用量算一个「每条回复约多少积分」的参考值。'}
        </div>
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'cost',
              label: '成本价（对账用，不填 = 和售价相同）',
              children: (
                <div className="form-three">
                  <Form.Item name="costInput" label="成本 · 输入">
                    <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="costOutput" label="成本 · 输出">
                    <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="costCache" label="成本 · 缓存">
                    <InputNumber min={0} step={0.01} style={{ width: '100%' }} />
                  </Form.Item>
                </div>
              ),
            },
          ]}
        />
        {PROVIDERS.length > 0 && (
          <Tag className="hidden-tag" color="default">
            非 token 计价模型（语音、图片）请在「AI 模型价格」里维护
          </Tag>
        )}
      </Form>
      {confirmBands && (
        <Alert
          type="warning"
          showIcon
          message="这个模型现在有分时价"
          description="按倍率保存后会变成全天统一价。"
          action={
            <Space>
              <Button size="small" onClick={() => setConfirmBands(false)}>
                取消
              </Button>
              <Button size="small" type="primary" onClick={() => void save(true)}>
                继续保存
              </Button>
            </Space>
          }
        />
      )}
    </RecordDrawer>
  );
}
