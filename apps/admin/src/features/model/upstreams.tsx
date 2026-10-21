import { useEffect, useState } from 'react';
import {
  Alert,
  App,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Typography,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import { ApiFailure } from '@weiban/client-core';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  type AdminModel,
  type AdminUsageOverview,
  type AdminUsageSummary,
  type GatewayLimits,
  type Upstream,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
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
import { formatInt, formatYuan, relativeTime } from '../../ui/format.js';
import { TrendBars } from '../../ui/chart.js';
import {
  ERROR_LABELS,
  KIND_LABELS,
  PROVIDERS,
  UPSTREAM_ERROR_LABELS,
  UPSTREAM_STATE_LABELS,
  providerName,
  rangeOf,
  upstreamReason,
  upstreamState,
  type UpstreamState,
} from './shared.js';

/** 3.24：测试结果的大白话（失败时写清楚是密钥、余额还是网络）。 */
function testResultText(u: Upstream, ms: number): string {
  if (u.status === 'active') return `连通正常，耗时 ${ms}ms`;
  const reason =
    u.status === 'invalid'
      ? '密钥无效'
      : u.status === 'quota_exhausted'
        ? '余额不足'
        : (UPSTREAM_ERROR_LABELS[u.lastError ?? ''] ?? '服务商返回错误');
  return `连接失败：${reason}`;
}
import { useFormFeedback } from '../../data/form-feedback.js';

export function UpstreamsTab({
  upstreams,
  models,
  refresh,
}: {
  upstreams: Upstream[];
  models: AdminModel[];
  refresh: () => void;
}) {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const { modal } = App.useApp();
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState<'all' | UpstreamState>('all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<React.Key[]>([]);
  const [testing, setTesting] = useState<string[]>([]);
  const [editing, setEditing] = useState<Upstream | 'new' | null>(null);
  const [detail, setDetail] = useState<Upstream | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [error, setError] = useState('');

  const list = upstreams.filter(
    (u) =>
      (!provider || (u.provider ?? u.kind) === provider) &&
      (status === 'all' || upstreamState(u) === status) &&
      (!query.trim() || u.name.includes(query.trim())),
  );

  async function test(ids: string[]) {
    if (!ids.length) return;
    setTesting(ids);
    setError('');
    const started = performance.now();
    try {
      if (ids.length === 1) {
        const result = await api.call(ModelAccessAdminEndpoints.testUpstream, {
          params: { upstreamId: ids[0]! },
        });
        const text = testResultText(result, Math.round(performance.now() - started));
        if (result.status === 'active') toast.success(text);
        else toast.error(text);
      } else {
        await api.call(ModelAccessAdminEndpoints.batchUpstreams, {
          body: { upstreamIds: ids, action: 'test' },
        });
        toast.success(`已测试 ${ids.length} 条线路`);
      }
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTesting([]);
      refresh();
    }
  }

  async function batch(action: 'enable' | 'disable', ids: string[]) {
    if (!ids.length) return;
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.batchUpstreams, {
        body: { upstreamIds: ids, action },
      });
      toast.success(action === 'enable' ? '已启用' : '已停用');
      setSelected([]);
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  /** 引用这条线路的模型（主上游或任一路由，含停用的模型）。 */
  const usersOf = (upstreamId: string) =>
    models.filter(
      (m) =>
        m.upstreamId === upstreamId || (m.routes ?? []).some((r) => r.upstreamId === upstreamId),
    );

  function blocked(u: Upstream, names: string[]) {
    modal.warning({
      title: `「${u.name}」还在被模型使用，暂时不能删除`,
      content: (
        <div>
          <p>
            下面这些模型的线路里还有它，请先在「模型」里把它们换到别的上游账号（或删除这些模型），再回来删除：
          </p>
          <ul style={{ paddingLeft: 18, margin: 0 }}>
            {names.map((n) => (
              <li key={n}>{n}</li>
            ))}
          </ul>
        </div>
      ),
      okText: '知道了',
      centered: true,
    });
  }

  function askDelete(u: Upstream) {
    const using = usersOf(u.upstreamId);
    if (using.length > 0) {
      blocked(
        u,
        using.map((m) => m.displayName),
      );
      return;
    }
    confirm({
      title: `删除「${u.name}」？`,
      content:
        '删除后密钥立即清除、不再分配调用，也不能恢复；历史调用记录仍保留，账号名显示为「已删除」。',
      okText: '删除',
      onOk: async () => {
        setError('');
        try {
          await api.call(ModelAccessAdminEndpoints.deleteUpstream, {
            params: { upstreamId: u.upstreamId },
          });
          toast.success('已删除');
          setSelected((keys) => keys.filter((k) => k !== u.upstreamId));
          refresh();
        } catch (e) {
          const names =
            e instanceof ApiFailure && e.code === 'conflict'
              ? (e.details as { modelNames?: unknown } | undefined)?.modelNames
              : undefined;
          if (Array.isArray(names) && names.length > 0) {
            blocked(u, names.map(String));
            refresh();
          } else setError(errorText(e));
        }
      },
    });
  }

  /**
   * 3.23：批量删除。还被模型（含已下架的；已删除的模型不算）使用的账号跳过并列出；
   * 其余逐个删除，最后汇总成功 / 失败。
   */
  function askBatchDelete(ids: string[]) {
    const targets = upstreams.filter((u) => ids.includes(u.upstreamId));
    if (!targets.length) return;
    const blockedList = targets
      .map((u) => ({ u, names: usersOf(u.upstreamId).map((m) => m.displayName) }))
      .filter((x) => x.names.length > 0);
    const deletable = targets.filter((u) => !blockedList.some((b) => b.u === u));
    const blockedView = (
      <ul style={{ paddingLeft: 18, margin: 0 }}>
        {blockedList.map(({ u, names }) => (
          <li key={u.upstreamId}>
            {u.name}：{names.join('、')}
          </li>
        ))}
      </ul>
    );
    if (!deletable.length) {
      modal.warning({
        title: '选中的上游账号都还在被模型使用，暂时不能删除',
        content: (
          <div>
            <p>请先在「模型」里把这些模型换到别的线路（或删除模型），再回来删除：</p>
            {blockedView}
          </div>
        ),
        okText: '知道了',
        centered: true,
      });
      return;
    }
    confirm({
      title: `删除 ${deletable.length} 个上游账号？`,
      content: (
        <div>
          <p>{deletable.map((u) => u.name).join('、')}</p>
          <p>
            删除后密钥立即清除、不再分配调用，也不能恢复；历史调用记录仍保留，账号名显示为「已删除」。
          </p>
          {blockedList.length > 0 && (
            <>
              <p>下面 {blockedList.length} 个还在被模型使用，这次会跳过：</p>
              {blockedView}
            </>
          )}
        </div>
      ),
      okText: `删除 ${deletable.length} 个`,
      onOk: async () => {
        setError('');
        const failed: Array<{ name: string; reason: string }> = [];
        for (const u of deletable) {
          try {
            await api.call(ModelAccessAdminEndpoints.deleteUpstream, {
              params: { upstreamId: u.upstreamId },
            });
          } catch (e) {
            const names =
              e instanceof ApiFailure && e.code === 'conflict'
                ? (e.details as { modelNames?: unknown } | undefined)?.modelNames
                : undefined;
            failed.push({
              name: u.name,
              reason: Array.isArray(names)
                ? `还在被使用：${names.map(String).join('、')}`
                : errorText(e),
            });
          }
        }
        const done = deletable.length - failed.length;
        if (done > 0) toast.success(`已删除 ${done} 个上游账号`);
        if (failed.length > 0)
          modal.warning({
            title: `${failed.length} 个没删掉`,
            content: (
              <ul style={{ paddingLeft: 18, margin: 0 }}>
                {failed.map((f) => (
                  <li key={f.name}>
                    {f.name}：{f.reason}
                  </li>
                ))}
              </ul>
            ),
            okText: '知道了',
            centered: true,
          });
        setSelected([]);
        refresh();
      },
    });
  }

  const columns: ProColumns<Upstream>[] = [
    {
      title: '名称',
      dataIndex: 'name',
      fixed: 'left',
      width: 220,
      render: (_, u) => (
        <div className="cell-main">
          <span className="cell-title">{u.name}</span>
          <span className="cell-sub mono">{u.maskedKey}</span>
        </div>
      ),
    },
    {
      title: '供应商 / 协议',
      width: 160,
      render: (_, u) => (
        <div className="cell-main">
          <span>{providerName(u.provider ?? u.kind)}</span>
          <span className="cell-sub">{KIND_LABELS[u.kind] ?? u.kind}</span>
        </div>
      ),
    },
    {
      title: (
        <span>
          状态
          <HelpTip text="异常时写出具体原因：密钥无效 / 余额不足 / 连接异常被健康检查暂停 / 连续失败短暂暂停。" />
        </span>
      ),
      width: 220,
      render: (_, u) => {
        const state = upstreamState(u);
        const reason = upstreamReason(u);
        return (
          <div className="cell-main">
            <span>
              <StatusTag
                tone={
                  state === 'normal'
                    ? 'success'
                    : state === 'disabled' || state === 'pending'
                      ? 'default'
                      : 'error'
                }
              >
                {testing.includes(u.upstreamId) ? '测试中' : UPSTREAM_STATE_LABELS[state]}
              </StatusTag>
            </span>
            {reason && state !== 'disabled' && <span className="cell-sub">{reason}</span>}
          </div>
        );
      },
    },
    {
      title: (
        <span>
          优先级 / 权重
          <HelpTip text="数字小的先用；同一优先级按权重比例分流" />
        </span>
      ),
      width: 130,
      render: (_, u) => `${u.priority ?? 1} / ${u.weight ?? 100}`,
    },
    {
      title: '进行中',
      width: 100,
      render: (_, u) => `${u.inFlight ?? 0}${u.maxConcurrency ? ` / ${u.maxConcurrency}` : ''}`,
    },
    {
      title: '今日调用',
      width: 100,
      sorter: (a, b) => (a.todayCalls ?? 0) - (b.todayCalls ?? 0),
      render: (_, u) => formatInt(u.todayCalls ?? 0),
    },
    {
      title: '今日成本',
      width: 110,
      sorter: (a, b) => (a.todayCostMicros ?? 0) - (b.todayCostMicros ?? 0),
      render: (_, u) => formatYuan(u.todayCostMicros ?? 0),
    },
    {
      title: '最近使用',
      width: 100,
      render: (_, u) => relativeTime(u.lastUsedAt),
    },
    {
      title: '操作',
      width: 200,
      fixed: 'right',
      render: (_, u) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => void test([u.upstreamId])}>
            测试
          </Button>
          <Button type="link" size="small" onClick={() => setEditing(u)}>
            编辑
          </Button>
          {u.enabled === false ? (
            <Button type="link" size="small" onClick={() => void batch('enable', [u.upstreamId])}>
              启用
            </Button>
          ) : (
            <Button
              type="link"
              size="small"
              danger
              onClick={() =>
                confirm({
                  title: `停用「${u.name}」？`,
                  content: '停用后不再给它分配调用，正在进行的调用不受影响。',
                  okText: '停用',
                  onOk: () => batch('disable', [u.upstreamId]),
                })
              }
            >
              停用
            </Button>
          )}
          <Button type="link" size="small" danger onClick={() => askDelete(u)}>
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <div className="tab-body">
      <div className="tab-head">
        <div className="tab-desc">
          <strong>上游账号</strong>
          <span>你填的 API 密钥线路。同一个模型可以配多条线路，一条出问题自动切下一条。</span>
        </div>
        <Space size={8}>
          <Button onClick={() => setLimitsOpen(true)}>调度设置</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            添加上游账号
          </Button>
        </Space>
      </div>
      <DataTable<Upstream>
        rowKey="upstreamId"
        columns={columns}
        data={list}
        error={error}
        onRefresh={refresh}
        onRowClick={(u) => setDetail(u)}
        selectedKeys={selected}
        onSelectionChange={(keys) => setSelected(keys)}
        batchActions={() => (
          <>
            <Button size="small" onClick={() => void test(selected.map(String))}>
              批量测试
            </Button>
            <Button size="small" onClick={() => void batch('enable', selected.map(String))}>
              批量启用
            </Button>
            <Button
              size="small"
              danger
              onClick={() =>
                confirm({
                  title: `停用选中的 ${selected.length} 条线路？`,
                  content: '停用后不再给它们分配调用，正在进行的调用不受影响。',
                  okText: '批量停用',
                  onOk: () => batch('disable', selected.map(String)),
                })
              }
            >
              批量停用
            </Button>
            <Button size="small" danger onClick={() => askBatchDelete(selected.map(String))}>
              批量删除
            </Button>
          </>
        )}
        filters={
          <>
            <Input.Search
              allowClear
              placeholder="搜索名称"
              style={{ width: 180 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              style={{ width: 150 }}
              value={provider}
              onChange={setProvider}
              options={[
                { value: '', label: '全部供应商' },
                ...PROVIDERS.map((p) => ({ value: p.id, label: p.name })),
              ]}
            />
            <Select
              style={{ width: 130 }}
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: '全部状态' },
                { value: 'normal', label: '正常' },
                { value: 'abnormal', label: '异常' },
                { value: 'disabled', label: '已停用' },
                { value: 'pending', label: '待配置' },
              ]}
            />
            <Button onClick={() => void test(list.map((u) => u.upstreamId))}>测试全部</Button>
          </>
        }
        emptyTitle="还没有上游账号"
        emptyHint="点右上角「添加上游账号」，填入服务商给的 API 密钥；系统会先测试连通，通了才保存。"
        emptyAction={
          <Button type="primary" onClick={() => setEditing('new')}>
            添加第一条
          </Button>
        }
      />
      {editing && (
        <UpstreamForm
          upstream={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            toast.success(text);
            refresh();
          }}
        />
      )}
      {detail && (
        <UpstreamDetail
          upstream={upstreams.find((u) => u.upstreamId === detail.upstreamId) ?? detail}
          models={models.filter(
            (m) =>
              (m.routes ?? []).some((r) => r.upstreamId === detail.upstreamId) ||
              m.upstreamId === detail.upstreamId,
          )}
          onClose={() => setDetail(null)}
        />
      )}
      {limitsOpen && <LimitsDrawer onClose={() => setLimitsOpen(false)} />}
    </div>
  );
}

interface UpstreamFormValues {
  name: string;
  provider: string;
  /** 3.24：协议（OpenAI 兼容 / Anthropic 原生）。 */
  kind: Upstream['kind'];
  baseUrl: string;
  apiKey?: string;
  priority: number;
  weight: number;
  maxConcurrency?: number | null;
  rpmLimit?: number | null;
  note?: string;
  enabled: boolean;
  saveOnTestFailure?: boolean;
}

function UpstreamForm({
  upstream,
  onClose,
  onSaved,
}: {
  upstream: Upstream | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [form] = Form.useForm<UpstreamFormValues>();
  const feedback = useFormFeedback(form);
  const [rotating, setRotating] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');

  async function submit() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    setNote('');
    const common = {
      name: values.name,
      baseUrl: values.baseUrl,
      provider: values.provider,
      priority: values.priority,
      weight: values.weight,
      maxConcurrency: values.maxConcurrency ?? null,
      rpmLimit: values.rpmLimit ?? null,
      enabled: values.enabled,
      note: values.note?.trim() || null,
    };
    try {
      if (upstream) {
        await api.call(ModelAccessAdminEndpoints.updateUpstream, {
          params: { upstreamId: upstream.upstreamId },
          body: { ...common, ...(values.kind !== upstream.kind ? { kind: values.kind } : {}) },
        });
        if (rotating && values.apiKey)
          await api.call(ModelAccessAdminEndpoints.rotateUpstreamKey, {
            params: { upstreamId: upstream.upstreamId },
            body: { apiKey: values.apiKey },
          });
        onSaved('已保存');
      } else {
        const created = await api.call(ModelAccessAdminEndpoints.createUpstream, {
          body: {
            ...common,
            kind: values.kind,
            apiKey: values.apiKey ?? '',
            saveOnTestFailure: values.saveOnTestFailure === true,
          },
        });
        onSaved(
          created.status === 'active'
            ? '连通正常，已保存'
            : '已保存，但连通测试未通过（状态记为异常）',
        );
      }
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.code === 'upstream_test_failed'
          ? '连通测试没通过。请检查密钥和接口地址；如果仍要保存，勾选「测试不通过也保存」。'
          : feedback.report(e),
      );
    } finally {
      setSaving(false);
    }
  }

  async function testNow() {
    if (!upstream) return;
    setNote('测试中…');
    const started = performance.now();
    try {
      const r = await api.call(ModelAccessAdminEndpoints.testUpstream, {
        params: { upstreamId: upstream.upstreamId },
      });
      setNote(testResultText(r, Math.round(performance.now() - started)));
    } catch (e) {
      setNote(`连接失败：${errorText(e)}`);
    }
  }

  return (
    <RecordDrawer
      form={form}
      draftKey={`upstream:${upstream?.upstreamId ?? 'new'}`}
      open
      onClose={onClose}
      title={upstream ? `编辑上游账号 · ${upstream.name}` : '添加上游账号'}
      subtitle="密钥保存后只显示末 4 位，不能再查看原文"
      width={620}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void submit()}
          saving={saving}
          submitText={upstream ? '保存' : '测试并保存'}
          extra={upstream ? <Button onClick={() => void testNow()}>测试连接</Button> : undefined}
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      {note && <Alert type="info" showIcon message={note} />}
      <Form<UpstreamFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          name: upstream?.name ?? '',
          provider: upstream?.provider ?? 'openai_compatible',
          kind: upstream?.kind ?? 'openai_compatible',
          baseUrl: upstream?.baseUrl ?? '',
          priority: upstream?.priority ?? 1,
          weight: upstream?.weight ?? 100,
          maxConcurrency: upstream?.maxConcurrency ?? null,
          rpmLimit: upstream?.rpmLimit ?? null,
          note: upstream?.note ?? '',
          enabled: upstream?.enabled ?? true,
          saveOnTestFailure: false,
        }}
      >
        <FormSection title="基本信息" />
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '给这条线路起个名字' }]}
          extra={<FieldHelp>自己看得懂就行，例如「DeepSeek 官方」「OpenRouter 备用」。</FieldHelp>}
        >
          <Input maxLength={40} placeholder="例：DeepSeek 官方" />
        </Form.Item>
        <Form.Item
          name="provider"
          label="供应商"
          extra={<FieldHelp>只用于分组展示和统计，不影响调用。</FieldHelp>}
        >
          <Select options={PROVIDERS.map((p) => ({ value: p.id, label: p.name }))} />
        </Form.Item>
        <Form.Item
          name="kind"
          label="协议"
          extra={
            <FieldHelp>
              中转站一般两种地址都给：选「OpenAI 兼容」可以调所有模型（包括 Claude）；Claude
              选「Anthropic（Claude 原生）」能用上缓存断点、按「缓存读取 /
              缓存写入」准确计费，缓存命中更高。同一个中转站可以各建一个账号，Claude 模型的线路挂
              Anthropic 那个。改协议后请重新「测试连接」。
            </FieldHelp>
          }
        >
          <Select
            options={[
              { value: 'openai_compatible', label: 'OpenAI 兼容（/chat/completions）' },
              { value: 'anthropic', label: 'Anthropic · Claude 原生（/v1/messages）' },
              { value: 'deepseek_search', label: 'DeepSeek 搜索（/v1/tools/search）' },
              ...(upstream &&
              !['openai_compatible', 'anthropic', 'deepseek_search'].includes(upstream.kind)
                ? [{ value: upstream.kind, label: KIND_LABELS[upstream.kind] ?? upstream.kind }]
                : []),
            ]}
          />
        </Form.Item>
        <KindAwareBaseUrl form={form} />
        {upstream && !rotating ? (
          <Form.Item label="密钥" extra={<FieldHelp>为了安全，保存后不能查看原文。</FieldHelp>}>
            <Space>
              <Typography.Text code>{upstream.maskedKey}</Typography.Text>
              <Button size="small" onClick={() => setRotating(true)}>
                {upstream.maskedKey === '未配置' ? '配置密钥' : '更换密钥'}
              </Button>
            </Space>
          </Form.Item>
        ) : (
          <Form.Item
            name="apiKey"
            label={upstream ? '新密钥' : 'API 密钥'}
            rules={[
              { required: true, message: '填写 API 密钥' },
              { min: 8, message: '密钥至少 8 位' },
            ]}
            extra={<FieldHelp>服务商控制台里生成的那串 key，只用于本次提交。</FieldHelp>}
          >
            <Input.Password autoComplete="off" placeholder="sk-…" />
          </Form.Item>
        )}

        <FormSection title="调度（不填就是默认值）" desc="同一个模型有多条线路时按这里排序" />
        <div className="form-two">
          <Form.Item
            name="priority"
            label="优先级"
            extra={<FieldHelp>数字小的先用。一般主线路填 1，备用填 2。</FieldHelp>}
          >
            <InputNumber min={0} max={1000} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item
            name="weight"
            label="权重"
            extra={<FieldHelp>同一优先级里按比例分流，例如 100 和 50 就是 2:1。</FieldHelp>}
          >
            <InputNumber min={1} max={1000} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div className="form-two">
          <Form.Item
            name="maxConcurrency"
            label="并发上限"
            extra={<FieldHelp>同时最多几个请求，留空 = 不限。</FieldHelp>}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="不限" />
          </Form.Item>
          <Form.Item
            name="rpmLimit"
            label="每分钟请求上限"
            extra={<FieldHelp>服务商限流是多少就填多少，留空 = 不限。</FieldHelp>}
          >
            <InputNumber min={1} style={{ width: '100%' }} placeholder="不限" />
          </Form.Item>
        </div>
        <Form.Item
          name="note"
          label="备注"
          extra={<FieldHelp>给自己看的说明，用户看不到。</FieldHelp>}
        >
          <Input maxLength={200} placeholder="例：额度用完前先用这条" />
        </Form.Item>
        <Form.Item
          name="enabled"
          label="启用"
          valuePropName="checked"
          extra={<FieldHelp>关掉后不再分配调用，但配置保留。</FieldHelp>}
        >
          <Switch />
        </Form.Item>
        {!upstream && (
          <Form.Item
            name="saveOnTestFailure"
            valuePropName="checked"
            extra={
              <FieldHelp>正常情况测试不通过不会保存；勾上则强制保存，状态记为「异常」。</FieldHelp>
            }
          >
            <Checkbox>测试不通过也保存</Checkbox>
          </Form.Item>
        )}
      </Form>
    </RecordDrawer>
  );
}

/** 3.24：接口地址的说明随协议变化（Anthropic 协议填中转给的 Claude 地址，带不带 /v1 都行）。 */
function KindAwareBaseUrl({
  form,
}: {
  form: ReturnType<typeof Form.useForm<UpstreamFormValues>>[0];
}) {
  const kind = Form.useWatch('kind', form);
  return (
    <Form.Item
      name="baseUrl"
      label="接口地址"
      rules={[
        { required: true, message: '填写服务商给的接口地址' },
        { type: 'url', message: '要以 http:// 或 https:// 开头' },
      ]}
      extra={
        <FieldHelp>
          {kind === 'anthropic'
            ? '中转站给的 Claude（Anthropic）地址，例 https://…/claude 或 https://…/v1，带不带 /v1 都可以，系统会请求 …/v1/messages。'
            : kind === 'deepseek_search'
              ? '使用预置的 DeepSeek 官方地址；搜索与抓取分别请求 /v1/tools/search 和 /v1/tools/fetch。'
              : '服务商文档里的 Base URL，一般以 /v1 结尾。'}
        </FieldHelp>
      }
    >
      <Input placeholder={kind === 'anthropic' ? 'https://…（Claude 地址）' : 'https://…/v1'} />
    </Form.Item>
  );
}

function UpstreamDetail({
  upstream,
  models,
  onClose,
}: {
  upstream: Upstream;
  models: AdminModel[];
  onClose: () => void;
}) {
  const [week, setWeek] = useState<AdminUsageSummary>();
  const [overview, setOverview] = useState<AdminUsageOverview>();
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    const { from, to } = rangeOf('7d');
    void Promise.all([
      api
        .call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: {
            filter: { from, to, upstreamIds: [upstream.upstreamId] },
            groupBy: ['day'],
            sort: 'key_asc',
            limit: 50,
          },
        })
        .then(setWeek)
        .catch(() => {}),
      api
        .call(ModelAccessAdminUsageEndpoints.usageOverview, {
          body: { from, to, upstreamIds: [upstream.upstreamId] },
        })
        .then(setOverview)
        .catch(() => {}),
    ]).finally(() => setLoading(false));
  }, [upstream.upstreamId]);

  const rows = week?.rows ?? [];
  const labels = rows.map((r) => String(r.keys[0] ?? '').slice(5));
  const values = rows.map((r) => r.calls);
  const state = upstreamState(upstream);

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={upstream.name}
      subtitle={providerName(upstream.provider ?? upstream.kind)}
      width={620}
    >
      <div className="detail-grid">
        <div>
          <span className="detail-label">状态</span>
          <span>
            <StatusTag
              tone={
                state === 'normal'
                  ? 'success'
                  : state === 'disabled' || state === 'pending'
                    ? 'default'
                    : 'error'
              }
            >
              {UPSTREAM_STATE_LABELS[state]}
            </StatusTag>
            {upstreamReason(upstream) ?? ''}
          </span>
        </div>
        <div>
          <span className="detail-label">协议</span>
          <span>{KIND_LABELS[upstream.kind] ?? upstream.kind}</span>
        </div>
        <div>
          <span className="detail-label">接口地址</span>
          <span className="mono">{upstream.baseUrl}</span>
        </div>
        <div>
          <span className="detail-label">密钥</span>
          <span className="mono">{upstream.maskedKey}</span>
        </div>
        <div>
          <span className="detail-label">连续失败</span>
          <span>{upstream.consecutiveFailures ?? 0} 次</span>
        </div>
        <div>
          <span className="detail-label">最近测试</span>
          <span>{upstream.lastTestedAt ? relativeTime(upstream.lastTestedAt) : '—'}</span>
        </div>
        <div>
          <span className="detail-label">调度</span>
          <span>
            优先级 {upstream.priority ?? 1} · 权重 {upstream.weight ?? 100} · 并发{' '}
            {upstream.maxConcurrency ?? '不限'} · 每分钟 {upstream.rpmLimit ?? '不限'}
          </span>
        </div>
        {upstream.note && (
          <div>
            <span className="detail-label">备注</span>
            <span>{upstream.note}</span>
          </div>
        )}
      </div>
      <div className="detail-section">近 7 天调用</div>
      {loading ? (
        <div className="detail-muted">正在读取…</div>
      ) : rows.length === 0 ? (
        <div className="detail-muted">近 7 天没有调用。</div>
      ) : (
        <TrendBars labels={labels} values={values} format={(v) => `${formatInt(v)} 次`} />
      )}
      <div className="detail-section">用这条线路的模型</div>
      {models.length === 0 ? (
        <div className="detail-muted">还没有模型路由到这个账号。</div>
      ) : (
        <div className="chip-list">
          {models.map((m) => (
            <span className="chip" key={m.modelKey}>
              {m.displayName}
              <span className="chip-sub mono">
                {(m.routes ?? []).find((r) => r.upstreamId === upstream.upstreamId)
                  ?.upstreamModelId ?? m.upstreamModelId}
              </span>
            </span>
          ))}
        </div>
      )}
      <div className="detail-section">最近错误（24 小时）</div>
      {(overview?.recentErrors ?? []).length === 0 ? (
        <div className="detail-muted">最近没有失败调用。</div>
      ) : (
        <div className="error-list">
          {overview!.recentErrors.slice(0, 20).map((e) => (
            <div key={`${e.modelKey}|${e.errorCode}`}>
              <span className="error-code">{ERROR_LABELS[e.errorCode] ?? e.errorCode}</span>
              <span>{e.modelKey}</span>
              <span>{e.count} 次</span>
              <span>{relativeTime(e.lastAt)}</span>
            </div>
          ))}
        </div>
      )}
    </RecordDrawer>
  );
}

interface LimitsValues {
  perUserConcurrency?: number | null;
  perUserRpm?: number | null;
  failureThreshold: number;
  cooldownSeconds: number;
  searchCandidatesPerUserDay: number;
  searchCandidatesGlobalDay: number;
}

function LimitsDrawer({ onClose }: { onClose: () => void }) {
  const remote = useRemote(ModelAccessAdminEndpoints.getGatewayLimits);
  const [form] = Form.useForm<LimitsValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();

  async function submit() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    const body: GatewayLimits = {
      perUserConcurrency: values.perUserConcurrency ?? null,
      perUserRpm: values.perUserRpm ?? null,
      failureThreshold: values.failureThreshold,
      cooldownSeconds: values.cooldownSeconds,
      searchCandidatesPerUserDay: values.searchCandidatesPerUserDay,
      searchCandidatesGlobalDay: values.searchCandidatesGlobalDay,
    };
    try {
      await api.call(ModelAccessAdminEndpoints.updateGatewayLimits, { body });
      toast.success('已保存');
      remote.refresh();
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
      draftKey={'gateway-limits'}
      open
      onClose={onClose}
      title="调度设置"
      subtitle="每用户限流，以及线路出问题后自动暂停的规则"
      width={560}
      loading={remote.loading}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void submit()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      {remote.data && (
        <Form<LimitsValues>
          form={form}
          layout="vertical"
          initialValues={{
            perUserConcurrency: remote.data.perUserConcurrency ?? null,
            perUserRpm: remote.data.perUserRpm ?? null,
            failureThreshold: remote.data.failureThreshold,
            cooldownSeconds: remote.data.cooldownSeconds,
            searchCandidatesPerUserDay: remote.data.searchCandidatesPerUserDay ?? 20,
            searchCandidatesGlobalDay: remote.data.searchCandidatesGlobalDay ?? 5000,
          }}
        >
          <FormSection title="每个用户的限额" desc="防止一个人把额度用光" />
          <div className="form-two">
            <Form.Item
              name="perUserConcurrency"
              label="同时进行中的调用"
              extra={<FieldHelp>留空 = 不限。超出时这次调用按「模型暂时不可用」返回。</FieldHelp>}
            >
              <InputNumber min={1} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
            <Form.Item
              name="perUserRpm"
              label="每分钟调用次数"
              extra={<FieldHelp>留空 = 不限。</FieldHelp>}
            >
              <InputNumber min={1} style={{ width: '100%' }} placeholder="不限" />
            </Form.Item>
          </div>
          <FormSection
            title="联网找角色"
            desc="平台承担搜索费用；按北京时间每天重置，缓存命中也计入查找次数"
          />
          <div className="form-two">
            <Form.Item
              name="searchCandidatesPerUserDay"
              label="每人每天最多查找"
              rules={[{ required: true, message: '必填' }]}
            >
              <InputNumber min={1} max={1000} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="searchCandidatesGlobalDay"
              label="全站每天最多查找"
              rules={[{ required: true, message: '必填' }]}
            >
              <InputNumber min={1} max={100000} style={{ width: '100%' }} />
            </Form.Item>
          </div>
          <FormSection title="线路健康" desc="连续失败后自动暂停，过一会再试" />
          <div className="form-two">
            <Form.Item
              name="failureThreshold"
              label="连续失败几次后暂停"
              rules={[{ required: true, message: '必填' }]}
              extra={<FieldHelp>达到这个次数就自动停用它。</FieldHelp>}
            >
              <InputNumber min={1} max={100} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="cooldownSeconds"
              label="暂停多少秒"
              rules={[{ required: true, message: '必填' }]}
              extra={<FieldHelp>暂停结束后自动恢复尝试。</FieldHelp>}
            >
              <InputNumber min={10} max={86400} style={{ width: '100%' }} />
            </Form.Item>
          </div>
        </Form>
      )}
      {remote.error && <Alert type="error" showIcon message={remote.error} />}
    </RecordDrawer>
  );
}
