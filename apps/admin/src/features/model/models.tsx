import { useEffect, useRef, useState, type Key } from 'react';
import dayjs from 'dayjs';
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Collapse,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  type FormInstance,
} from 'antd';
import {
  PlusOutlined,
  MinusCircleOutlined,
  ArrowUpOutlined,
  UploadOutlined,
} from '@ant-design/icons';
import { ApiFailure } from '@weiban/client-core';
import {
  ModelAccessAdminEndpoints,
  RouteBillingBounds,
  USAGE_MISSING_ALERT_STREAK,
  type AdminModel,
  type ModelScenario,
  type ModelRates,
  type ModelsDevMatch,
  type ModelRoute,
  type Upstream,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
import { useFormFeedback } from '../../data/form-feedback.js';
import type { IssuePath } from '../../data/issues.js';
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
  SCENARIO_LABELS,
  UNAVAILABLE_DETAIL_HINTS,
  UNAVAILABLE_DETAIL_LABELS,
  UPSTREAM_STATE_LABELS,
  VISION_REQUIRED_SCENARIOS,
  toWrite,
  upstreamState,
} from './shared.js';
import {
  BoundsFields,
  DEFAULT_CONTEXT_TOKENS,
  DEFAULT_MAX_OUTPUT_TOKENS,
  DEFAULT_VISION_IMAGES,
  boundsToForm,
  formToBounds,
  isTextOnlyBounds,
  type BoundsFormValues,
} from './billing-bounds.js';
import { autoModelKey } from './model-key.js';
import {
  ModelsDevBar,
  ModelsDevPanel,
  PLATFORM_MAX_OUTPUT,
  useModelsDevMatch,
} from './models-dev.js';
import { ImportModelsButton } from './import.js';
import { useDeleteModels } from './delete-models.js';

/** 3.22：按场景筛选（模型「可用于哪些场景」）。 */
type UseFilter = 'all' | ModelScenario;

function matchesUse(m: AdminModel, use: UseFilter): boolean {
  return use === 'all' || (m.scenarios ?? []).includes(use);
}

/** 3.22：限时折扣「5 折」写法。 */
function discountLabel(rate: number) {
  const tenth = Math.round(rate * 100) / 10;
  return `${Number.isInteger(tenth) ? tenth.toFixed(0) : tenth.toFixed(1)} 折`;
}


function ratesOf(
  input?: number | null,
  output?: number | null,
  cache?: number | null,
  cacheWrite5m?: number | null,
  cacheWrite1h?: number | null,
): ModelRates | null {
  if (input == null && output == null && cache == null) return null;
  return {
    input: input ?? 0,
    output: output ?? 0,
    cache: cache ?? 0,
    // 3.24：缓存写入价可不填（null = 按输入价计）
    cacheWrite5m: cacheWrite5m ?? null,
    cacheWrite1h: cacheWrite1h ?? null,
  };
}

/** 3.24：这些原因要去模型抽屉里改计费上限，状态标签可以点开直接定位。 */
const BOUNDS_DETAILS = ['billing_bounds_missing', 'billing_bounds_paused', 'output_limit_too_small'];

/** 3.26（G3-2）：连续多次没返回用量的线路（达到提示阈值才在后台显示，不停用）。 */
function usageMissingOf(m: AdminModel) {
  return (m.usageMissing ?? []).filter((r) => r.streak >= USAGE_MISSING_ALERT_STREAK);
}

/** 3.24：文本聊天 / 私密模式模型缺识图能力（用户发的图片会发不出去）。 */
function lacksVision(scenarios: readonly string[] | undefined, capabilities: readonly string[]) {
  return (
    (scenarios ?? []).some((s) => (VISION_REQUIRED_SCENARIOS as readonly string[]).includes(s)) &&
    !capabilities.includes('vision')
  );
}

export function ModelsTab({
  models,
  upstreams,
  refresh,
  onDeleted,
}: {
  /** 只传未删除的模型（已删除的只给调用记录显示名字用）。 */
  models: AdminModel[];
  upstreams: Upstream[];
  refresh: () => void;
  /** 3.23：删除模型后通知外层（场景推荐 / 平台内部模型卡片重新读取）。 */
  onDeleted?: () => void;
}) {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [use, setUse] = useState<UseFilter>('all');
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all');
  const [query, setQuery] = useState('');
  const [editing, setEditing] = useState<AdminModel | 'new' | null>(null);
  const [focusBounds, setFocusBounds] = useState(false);
  const openEditor = (target: AdminModel | 'new', bounds = false) => {
    setFocusBounds(bounds);
    setEditing(target);
  };
  const [error, setError] = useState('');
  // 3.23：勾选批量删除；删除后让展示倍率基准卡片重新读取（基准模型可能被清空）
  const [selected, setSelected] = useState<Key[]>([]);
  const [deleteVersion, setDeleteVersion] = useState(0);
  const askDelete = useDeleteModels((keys) => {
    setSelected((cur) => cur.filter((k) => !keys.includes(String(k))));
    setDeleteVersion((v) => v + 1);
    onDeleted?.();
    refresh();
  });

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
        params: { modelKey: m.modelKey },
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
      title: (
        <span>
          状态
          <HelpTip text="上架的模型对用户「暂时无法使用」时，这里写出具体原因（与用户端看到的一致），悬停看怎么处理。" />
        </span>
      ),
      width: 190,
      render: (_, m) => {
        // 3.24：具体原因来自服务器（availability）；旧服务器不带时按线路计费上限判断
        const detail =
          m.availability?.detail ??
          (m.availability
            ? null
            : !(m.routes?.length
                  ? m.routes.some(
                      (route) =>
                        route.enabled && route.billingBounds && !route.billingBounds.pauseReason,
                    )
                  : m.billingBounds && !m.billingBounds.pauseReason)
              ? 'billing_bounds_missing'
              : null);
        const showDetail = m.enabled && detail && detail !== 'model_removed';
        return (
          <div className="cell-main model-status">
            <span>
              <StatusTag tone={m.enabled ? (showDetail ? 'warning' : 'success') : 'default'}>
                {m.enabled ? (showDetail ? '暂时无法使用' : '已上架') : '已下架'}
              </StatusTag>
            </span>
            {showDetail &&
              (BOUNDS_DETAILS.includes(detail) ? (
                <span
                  role="button"
                  tabIndex={0}
                  className="tag-link status-reason"
                  title={`${UNAVAILABLE_DETAIL_HINTS[detail] ?? ''}（点击直接填写）`}
                  onClick={(e) => {
                    e.stopPropagation();
                    openEditor(m, true);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') openEditor(m, true);
                  }}
                >
                  {UNAVAILABLE_DETAIL_LABELS[detail] ?? detail} ›
                </span>
              ) : (
                <span className="status-reason" title={UNAVAILABLE_DETAIL_HINTS[detail] ?? ''}>
                  {UNAVAILABLE_DETAIL_LABELS[detail] ?? detail}
                </span>
              ))}
            {m.enabled && lacksVision(m.scenarios, m.capabilities) && (
              <span
                className="status-reason warn"
                title="勾了文本聊天 / 私密模式但没有识图能力：用户发的图片会发不出去"
              >
                缺识图能力
              </span>
            )}
            {usageMissingOf(m).map((r) => (
              <span
                key={`${r.upstreamId}:${r.upstreamModelId}`}
                className="status-reason warn"
                title={`线路「${upstreamName(r.upstreamId)} · ${r.upstreamModelId}」${
                  r.since ? `从 ${dayjs(r.since).format('MM-DD HH:mm')} 起` : ''
                }连续 ${r.streak} 次没有返回用量，系统按本地估算计费（标记「估算」），线路照常使用。可检查上游 / 中转是否返回 usage，或在「调用记录」里看估算的调用。`}
              >
                连续 {r.streak} 次没返回用量 · 按估算计费
              </span>
            ))}
          </div>
        );
      },
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
      title: (
        <span>
          可用场景
          <HelpTip text="用户在「模型配置」里，每个场景只能选勾选了该场景的模型。" />
        </span>
      ),
      width: 160,
      render: (_, m) =>
        (m.scenarios ?? []).map((s) => SCENARIO_LABELS[s] ?? s).join('、') || (
          <span className="cell-sub">未勾选（用户选不到）</span>
        ),
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
              {m.rates.cacheWrite5m != null || m.rates.cacheWrite1h != null
                ? ` · 写 ${m.rates.cacheWrite5m?.toFixed(2) ?? '同输入'}${
                    m.rates.cacheWrite1h != null ? ` / 1h ${m.rates.cacheWrite1h.toFixed(2)}` : ''
                  }`
                : ''}
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
      title: (
        <span>
          限时折扣
          <HelpTip text="生效期间按「售价 × 折扣」扣费，成本不变；到期自动恢复原价。" />
        </span>
      ),
      width: 130,
      render: (_, m) =>
        m.discount ? (
          <span className="cell-main">
            <span>
              <Tag color={m.discountActive ? 'red' : 'default'}>
                {discountLabel(m.discount.rate)}
                {m.discountActive
                  ? ' · 进行中'
                  : Date.parse(m.discount.endsAt) <= Date.now()
                    ? ' · 已结束'
                    : ' · 未开始'}
              </Tag>
            </span>
            <span className="cell-sub">至 {dayjs(m.discount.endsAt).format('MM-DD HH:mm')}</span>
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: (
        <span>
          展示倍率
          <HelpTip text="用户选模型时看到的「×倍率」，只展示不参与扣费。手填优先；不填按 (0.8×输入售价+0.2×输出售价) ÷ 基准模型同算式自动算。" />
        </span>
      ),
      width: 100,
      sorter: (a, b) => (a.displayMultiplier ?? 0) - (b.displayMultiplier ?? 0),
      render: (_, m) =>
        m.displayMultiplier == null ? (
          '—'
        ) : (
          <span className="cell-main">
            <span>×{m.displayMultiplier.toFixed(2)}</span>
            <span className="cell-sub">{m.displayMultiplierManual != null ? '手填' : '自动'}</span>
          </span>
        ),
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, m) => (
        <Space size={4}>
          <Button
            type="link"
            size="small"
            onClick={(e) => {
              e.stopPropagation();
              openEditor(m);
            }}
          >
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
                  content:
                    '下架后，选了这个模型的场景会显示「暂不可用」，用户需要重新选择（不会自动换成别的模型）。',
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
          <Button type="link" size="small" danger onClick={() => void askDelete([m])}>
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
          <strong>模型</strong>
          <span>每个模型可以挂多条上游线路；价格按「每百万 token 的人民币价格」填写。</span>
        </div>
        <Space size={8}>
          <ImportModelsButton
            models={models}
            upstreams={upstreams}
            onDone={refresh}
            icon={<UploadOutlined />}
          />
          <Button type="primary" icon={<PlusOutlined />} onClick={() => openEditor('new')}>
            添加模型
          </Button>
        </Space>
      </div>
      <ModelsDevBar />
      <MultiplierBase key={deleteVersion} models={models} onSaved={refresh} />
      <DataTable<AdminModel>
        rowKey="modelKey"
        columns={columns}
        data={list}
        error={error}
        onRefresh={refresh}
        onRowClick={(m) => openEditor(m)}
        selectedKeys={selected}
        onSelectionChange={(keys) => setSelected(keys)}
        batchActions={(rows) => (
          <Button
            size="small"
            danger
            onClick={() => {
              // 勾选会跨筛选 / 翻页保留：按键从全部模型里取
              const keys = new Set(selected.map(String));
              const picked = models.filter((m) => keys.has(m.modelKey));
              void askDelete(picked.length ? picked : rows);
            }}
          >
            批量删除
          </Button>
        )}
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
                { value: 'all', label: '全部场景' },
                ...Object.entries(SCENARIO_LABELS).map(([value, label]) => ({
                  value: value as ModelScenario,
                  label,
                })),
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
          <Button type="primary" onClick={() => openEditor('new')}>
            添加第一个模型
          </Button>
        }
      />
      {editing && (
        <ModelWizard
          model={editing === 'new' ? null : editing}
          existingKeys={models.map((m) => m.modelKey)}
          upstreams={upstreams}
          focusBounds={focusBounds}
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

/** 3.17：展示倍率的基准模型（倍率 = 1.00 的那个，16 号文档建议 GPT-6 Sol）。 */
function MultiplierBase({ models, onSaved }: { models: AdminModel[]; onSaved: () => void }) {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getDisplayMultiplierSettings);
  const [value, setValue] = useState<string | null | undefined>(undefined);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const current = value === undefined ? (remote.data?.baseModelKey ?? null) : value;
  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.updateDisplayMultiplierSettings, {
        body: { baseModelKey: current },
      });
      toast.success('已保存基准模型');
      remote.refresh();
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  return (
    <div className="filter-bar" style={{ marginBottom: 12 }}>
      <Space wrap>
        <span>
          倍率基准模型
          <HelpTip text="选一个模型作为 ×1.00，其他模型没手填倍率时按它自动换算。只影响用户看到的倍率，不影响扣费。" />
        </span>
        <Select
          allowClear
          showSearch
          style={{ width: 280 }}
          placeholder="未设置（自动倍率不显示）"
          value={current ?? undefined}
          onChange={(v?: string) => setValue(v ?? null)}
          options={models
            .filter((m) => m.rates)
            .map((m) => ({ value: m.modelKey, label: `${m.displayName}（${m.modelKey}）` }))}
        />
        <Button loading={saving} disabled={value === undefined} onClick={() => void save()}>
          保存
        </Button>
        {(error || remote.error) && <Alert type="error" showIcon message={error || remote.error} />}
      </Space>
    </div>
  );
}

interface RouteDraft {
  upstreamId: string;
  upstreamModelId: string;
  weight: number;
  enabled: boolean;
  /** form = 用结构化表单填计费上限；json = 高级模式，直接编辑 JSON（语音、图片等特殊模型）。 */
  boundsMode: 'form' | 'json';
  bounds: BoundsFormValues;
  billingBoundsDraft: string;
  /** 打开抽屉时这条线路已有的计费上限（不是表单字段，只用于保留暂停标记和精确核对时间）。 */
  origin?: RouteBillingBounds | null;
}

interface ModelFormValues {
  modelKey?: string;
  displayName: string;
  vendorName: string;
  tags?: string;
  sortOrder?: number;
  leaderboardRank?: number | null;
  capabilities: string[];
  scenarios: ModelScenario[];
  routes: RouteDraft[];
  discountOn?: boolean;
  discountRate?: number | null;
  discountRange?: [dayjs.Dayjs, dayjs.Dayjs] | null;
  priceInput?: number | null;
  priceOutput?: number | null;
  priceCache?: number | null;
  costInput?: number | null;
  costOutput?: number | null;
  costCache?: number | null;
  displayMultiplierManual?: number | null;
  arenaModelName?: string | null;
  priceCacheWrite5m?: number | null;
  priceCacheWrite1h?: number | null;
  costCacheWrite5m?: number | null;
  costCacheWrite1h?: number | null;
}

function routeDraftOf(
  route: {
    upstreamId: string;
    upstreamModelId: string;
    weight: number;
    enabled: boolean;
    billingBounds?: RouteBillingBounds | null;
  },
  ctx: { vision: boolean },
): RouteDraft {
  const bounds = route.billingBounds ?? null;
  const json = bounds != null && !isTextOnlyBounds(bounds);
  return {
    upstreamId: route.upstreamId,
    upstreamModelId: route.upstreamModelId,
    weight: route.weight,
    enabled: route.enabled,
    boundsMode: json ? 'json' : 'form',
    bounds: boundsToForm(bounds, { vision: ctx.vision }),
    billingBoundsDraft: json ? JSON.stringify(bounds, null, 2) : '',
    origin: bounds,
  };
}

function needsBounds(route: RouteDraft): boolean {
  return !route.origin || Boolean(route.origin.pauseReason);
}

const capitalize = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
type AdminModelDiscount = NonNullable<AdminModel['discount']>;

function ModelWizard({
  model,
  existingKeys,
  upstreams,
  focusBounds,
  onClose,
  onSaved,
}: {
  model: AdminModel | null;
  /** 3.26：现有模型的键（新建时自动生成的模型键避开它们，免得覆盖已有模型）。 */
  existingKeys: string[];
  upstreams: Upstream[];
  /** 打开后直接定位到计费上限（从列表里点「需配置计费上限」进来）。 */
  focusBounds?: boolean;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<ModelFormValues>();
  const feedback = useFormFeedback(form, {
    mapPath: (path) => {
      const routes = (form.getFieldValue('routes') as RouteDraft[] | undefined) ?? [];
      const boundsPath = (index: number, rest: IssuePath): IssuePath => {
        if (routes[index]?.boundsMode === 'json') return ['routes', index, 'billingBoundsDraft'];
        const [a, b] = rest;
        if (a === 'text' && typeof b === 'string') return ['routes', index, 'bounds', b];
        return ['routes', index, 'bounds', 'contextTokens'];
      };
      const [head, second, third] = path;
      if (head === 'routes' && typeof second === 'number')
        return third === 'billingBounds' ? boundsPath(second, path.slice(3)) : path;
      if (head === 'billingBounds') return boundsPath(0, path.slice(1));
      if (head === 'upstreamId' || head === 'upstreamModelId') return ['routes', 0, head];
      if (head === 'rates' && typeof second === 'string') return [`price${capitalize(second)}`];
      if (head === 'costRates' && typeof second === 'string') return [`cost${capitalize(second)}`];
      return path;
    },
  });
  const [saving, setSaving] = useState(false);
  // 3.24：文本聊天 / 私密模式模型缺识图能力时先提示一次
  const [confirmVision, setConfirmVision] = useState(false);
  const [upstreamModels, setUpstreamModels] = useState<{ id: string; items: string[] | null; error: string }>({
    id: '',
    items: null,
    error: '',
  });
  const [confirmBands, setConfirmBands] = useState(false);
  // 3.26：models.dev 自动预填过的值（字段路径 → 值）；当前值还等于它时，换了模型名可以再次覆盖
  const lastAuto = useRef(new Map<string, unknown>());
  const [autoApplied, setAutoApplied] = useState('');

  const vision = model?.capabilities.includes('vision') ?? false;
  const [initialRoutes] = useState<RouteDraft[]>(() => {
    const ctx = { vision };
    return model?.routes?.length
      ? [...model.routes].sort((a, b) => a.priority - b.priority).map((r) => routeDraftOf(r, ctx))
      : [
          routeDraftOf(
            {
              upstreamId: model?.upstreamId ?? upstreams[0]?.upstreamId ?? '',
              upstreamModelId: model?.upstreamModelId ?? '',
              weight: 100,
              enabled: true,
              billingBounds: model?.billingBounds ?? null,
            },
            ctx,
          ),
        ];
  });

  useEffect(() => {
    if (!focusBounds) return;
    // 等抽屉滑出动画结束再滚动。
    const timer = window.setTimeout(() => {
      const routes = (form.getFieldValue('routes') as RouteDraft[] | undefined) ?? [];
      const index = Math.max(0, routes.findIndex(needsBounds));
      const target =
        routes[index]?.boundsMode === 'json'
          ? ['routes', index, 'billingBoundsDraft']
          : ['routes', index, 'bounds', 'contextTokens'];
      form.scrollToField(target, { behavior: 'smooth', block: 'center', focus: true });
    }, 400);
    return () => window.clearTimeout(timer);
  }, [focusBounds, form]);

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

  async function save(force = false, visionOk = false) {
    const checked = await feedback.validate();
    if (!checked) return;
    // getFieldsValue(true) 带上不是表单字段的 origin。
    const values = form.getFieldsValue(true) as ModelFormValues;
    if (!visionOk && lacksVision(values.scenarios, values.capabilities)) {
      setConfirmVision(true);
      return;
    }
    setConfirmVision(false);
    if (model?.hasTimeBands && !force && values.priceInput != null) {
      setConfirmBands(true);
      return;
    }
    const routes: ModelRoute[] = [];
    for (const [index, route] of values.routes.entries()) {
      let billingBounds: ModelRoute['billingBounds'] = null;
      if (route.boundsMode === 'json') {
        const text = (route.billingBoundsDraft ?? '').trim();
        if (text) {
          try {
            billingBounds = JSON.parse(text) as RouteBillingBounds;
          } catch {
            feedback.reportField(
              ['routes', index, 'billingBoundsDraft'],
              'JSON 写得不对：检查引号、逗号、括号是否成对',
              `第 ${index + 1} 条线路的计费上限 JSON 写得不对`,
            );
            return;
          }
        }
      } else {
        billingBounds = formToBounds(route.bounds, route.origin);
      }
      routes.push({
        upstreamId: route.upstreamId,
        upstreamModelId: (route.upstreamModelId ?? '').trim(),
        priority: index + 1,
        weight: route.weight,
        enabled: route.enabled,
        billingBounds,
      });
    }
    const primary = routes[0];
    if (!primary) {
      feedback.setError('至少要有一条上游线路');
      return;
    }
    // 3.26（G3-3）：模型键不让管理员填，新建时按「出品方 / 上游模型名」自动生成
    const key =
      model?.modelKey ??
      (values.modelKey?.trim() ||
        autoModelKey(values.vendorName, primary.upstreamModelId, new Set(existingKeys)));
    // 3.22：限时折扣。开关关掉且原来有折扣 → 取消；没动过 → 不传（不改）。
    let discount: AdminModelDiscount | null | undefined;
    if (values.discountOn) {
      const [start, end] = values.discountRange ?? [];
      if (!values.discountRate || !start || !end) {
        feedback.reportField(['discountRange'], '填写折扣和起止时间', '限时折扣没填完整');
        return;
      }
      discount = {
        rate: values.discountRate,
        startsAt: start.toISOString(),
        endsAt: end.toISOString(),
      };
    } else if (model?.discount) discount = null;
    setSaving(true);
    feedback.clear();
    try {
      await api.call(ModelAccessAdminEndpoints.upsertModel, {
        params: { modelKey: key },
        body: {
          modelKey: key,
          displayName: values.displayName.trim(),
          vendorName: values.vendorName.trim(),
          upstreamId: primary.upstreamId,
          upstreamModelId: primary.upstreamModelId,
          billingBounds: primary.billingBounds ?? null,
          capabilities: values.capabilities as AdminModel['capabilities'],
          tags: (values.tags ?? '')
            .split(/[,，、\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10),
          leaderboardRank: values.leaderboardRank ?? null,
          arenaModelName: values.arenaModelName?.trim() || null,
          sortOrder: values.sortOrder ?? model?.sortOrder ?? 0,
          defaultFor: [],
          scenarios: values.scenarios,
          enabled: model ? model.enabled : true,
          ...(discount !== undefined ? { discount } : {}),
          rates: ratesOf(
            values.priceInput,
            values.priceOutput,
            values.priceCache,
            values.priceCacheWrite5m,
            values.priceCacheWrite1h,
          ),
          costRates:
            ratesOf(
              values.costInput,
              values.costOutput,
              values.costCache,
              values.costCacheWrite5m,
              values.costCacheWrite1h,
            ) ?? undefined,
          displayMultiplierManual: values.displayMultiplierManual ?? null,
          routes,
        },
      });
      onSaved();
    } catch (e) {
      feedback.report(e);
    } finally {
      setSaving(false);
      setConfirmBands(false);
    }
  }

  /** 厂商 / 模型名 / 能力变化时，顺手预填模型键、最多图片数。 */
  function onValuesChange(changed: Partial<ModelFormValues>) {
    const routes = (form.getFieldValue('routes') as RouteDraft[] | undefined) ?? [];
    const vendor = (form.getFieldValue('vendorName') as string | undefined) ?? '';
    const changedRoutes = (changed.routes ?? []) as Array<Partial<RouteDraft> | undefined>;
    if (changedRoutes[0]?.upstreamId) void loadUpstreamModels(changedRoutes[0].upstreamId);

    if (!model && ('vendorName' in changed || changedRoutes[0]?.upstreamModelId !== undefined)) {
      form.setFieldValue(
        'modelKey',
        autoModelKey(vendor, routes[0]?.upstreamModelId, new Set(existingKeys)),
      );
    }

    routes.forEach((route, index) => {
      if (route.boundsMode !== 'form') return;
      if ('capabilities' in changed && !route.origin) {
        const hasVision = (changed.capabilities ?? []).includes('vision');
        form.setFieldValue(['routes', index, 'bounds', 'maxImages'], hasVision ? DEFAULT_VISION_IMAGES : 0);
      }
    });
  }

  const firstUpstream = Form.useWatch(['routes', 0, 'upstreamId'], form);
  const firstModelName = Form.useWatch(['routes', 0, 'upstreamModelId'], form) as string | undefined;
  const vendorWatch = Form.useWatch('vendorName', form) as string | undefined;
  const keyWatch = Form.useWatch('modelKey', form) as string | undefined;
  const devMatch = useModelsDevMatch(firstModelName, vendorWatch);

  /**
   * 3.26（G3-1）：把 models.dev 的官方数据填进表单。
   * auto（新建时匹配到自动填）：只填空着的、或还是默认值 / 上次自动填的格子，不覆盖管理员手改的；
   * manual（点「用这些数据填入」）：有数据的项全部覆盖。
   */
  function applyMatch(match: ModelsDevMatch, mode: 'auto' | 'manual') {
    // 字段路径是动态拼的（线路下标），用不带字段类型的表单实例
    const loose = form as unknown as FormInstance;
    const updates: Array<{ name: (string | number)[]; value: unknown }> = [];
    const set = (name: (string | number)[], value: unknown, defaults: unknown[] = []) => {
      if (value == null) return;
      const key = name.join('.');
      const current: unknown = loose.getFieldValue(name);
      const untouched =
        current == null ||
        current === '' ||
        defaults.includes(current) ||
        (lastAuto.current.has(key) && lastAuto.current.get(key) === current);
      if (mode === 'manual' || untouched) {
        updates.push({ name, value });
        lastAuto.current.set(key, value);
      }
    };
    set(['priceInput'], match.priceCny.input);
    set(['priceOutput'], match.priceCny.output);
    set(['priceCache'], match.priceCny.cacheRead);
    set(['priceCacheWrite5m'], match.priceCny.cacheWrite);
    if (!(form.getFieldValue('displayName') as string | undefined)?.trim())
      updates.push({ name: ['displayName'], value: match.name.slice(0, 60) });
    const capabilities = (form.getFieldValue('capabilities') as string[] | undefined) ?? [];
    let vision = capabilities.includes('vision');
    if (match.supportsImage != null && (mode === 'manual' || (!model && match.supportsImage))) {
      vision = match.supportsImage;
      const next = vision
        ? [...new Set([...capabilities, 'vision'])]
        : capabilities.filter((c) => c !== 'vision');
      updates.push({ name: ['capabilities'], value: next });
    }
    const routes = (form.getFieldValue('routes') as RouteDraft[] | undefined) ?? [];
    routes.forEach((route, index) => {
      if (route.boundsMode !== 'form') return;
      if (mode === 'auto' && route.origin) return;
      set(['routes', index, 'bounds', 'contextTokens'], match.contextTokens, [DEFAULT_CONTEXT_TOKENS]);
      set(
        ['routes', index, 'bounds', 'maxOutputTokens'],
        match.maxOutputTokens == null ? null : Math.min(PLATFORM_MAX_OUTPUT, match.maxOutputTokens),
        [DEFAULT_MAX_OUTPUT_TOKENS],
      );
      if (match.supportsImage != null)
        set(['routes', index, 'bounds', 'maxImages'], vision ? DEFAULT_VISION_IMAGES : 0, [
          0,
          DEFAULT_VISION_IMAGES,
        ]);
    });
    loose.setFields(updates.map((u) => ({ ...u, errors: [] })));
    setAutoApplied(match.providerId + '/' + match.modelId);
  }

  // 新建模型：匹配到就自动预填（编辑已有模型不自动改，点按钮才填）
  useEffect(() => {
    if (model || devMatch.kind !== 'found') return;
    applyMatch(devMatch.match, 'auto');
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [devMatch]);
  const devApplied =
    devMatch.kind === 'found' &&
    autoApplied === devMatch.match.providerId + '/' + devMatch.match.modelId;

  return (
    <RecordDrawer
      form={form}
      draftKey={`model:${model?.modelKey ?? 'new'}`}
      open
      onClose={onClose}
      title={model ? `编辑模型 · ${model.displayName}` : '添加模型'}
      subtitle="价格改完保存后，系统会自动生成并发布新的价目表版本"
      width={760}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void save()}
          saving={saving}
          submitText={model ? '保存' : '保存并上架'}
          error={feedback.error}
        />
      }
    >
      {feedback.error && <Alert type="error" showIcon message={feedback.error} />}
      <Form<ModelFormValues>
        form={form}
        layout="vertical"
        initialValues={{
          modelKey: model?.modelKey ?? '',
          displayName: model?.displayName ?? '',
          vendorName: model?.vendorName ?? '',
          tags: model?.tags.join('，') ?? '',
          sortOrder: model?.sortOrder ?? 0,
          leaderboardRank: model?.leaderboardRank ?? null,
          capabilities: model?.capabilities ?? [],
          scenarios: model?.scenarios ?? ['chat', 'voice_call', 'private'],
          routes: initialRoutes,
          discountOn: !!model?.discount,
          discountRate: model?.discount?.rate ?? 0.5,
          discountRange: model?.discount
            ? [dayjs(model.discount.startsAt), dayjs(model.discount.endsAt)]
            : null,
          priceInput: model?.rates?.input ?? null,
          priceOutput: model?.rates?.output ?? null,
          priceCache: model?.rates?.cache ?? null,
          costInput: model?.costRates?.input ?? null,
          costOutput: model?.costRates?.output ?? null,
          costCache: model?.costRates?.cache ?? null,
          priceCacheWrite5m: model?.rates?.cacheWrite5m ?? null,
          priceCacheWrite1h: model?.rates?.cacheWrite1h ?? null,
          costCacheWrite5m: model?.costRates?.cacheWrite5m ?? null,
          costCacheWrite1h: model?.costRates?.cacheWrite1h ?? null,
          displayMultiplierManual: model?.displayMultiplierManual ?? null,
          arenaModelName: model?.arenaModelName ?? null,
        }}
        onValuesChange={onValuesChange}
      >
        <FormSection title="① 上游线路" desc="按顺序切换：第一条不通就用第二条；每条线路都要有计费上限才能用" />
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
                      label="上游账号"
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
                      label="上游模型名"
                      rules={[
                        { required: true, whitespace: true, message: '填写这个账号那边的模型名' },
                        { max: 128, message: '模型名最多 128 个字符' },
                      ]}
                      style={{ marginBottom: 8 }}
                    >
                      <AutoComplete
                        allowClear
                        placeholder="这个账号那边的模型名，例 gemini-3.8-flash"
                        options={(index === 0 ? upstreamModels.items ?? [] : []).map((id) => ({
                          value: id,
                          label: id,
                        }))}
                        onFocus={() => {
                          if (index === 0 && !upstreamModels.items && firstUpstream)
                            void loadUpstreamModels(firstUpstream);
                        }}
                        notFoundContent={
                          index === 0 && upstreamModels.error ? upstreamModels.error : null
                        }
                        filterOption={(input, option) =>
                          String(option?.value ?? '').toLowerCase().includes(input.toLowerCase())
                        }
                      />
                    </Form.Item>
                    <Form.Item name={[field.name, 'weight']} label="权重" style={{ marginBottom: 8 }}>
                      <InputNumber min={1} max={1000} precision={0} style={{ width: '100%' }} />
                    </Form.Item>
                    <Form.Item
                      name={[field.name, 'enabled']}
                      label="状态"
                      valuePropName="checked"
                      style={{ marginBottom: 8 }}
                    >
                      <Checkbox>启用这条线路</Checkbox>
                    </Form.Item>
                  </div>
                  <RouteBoundsEditor form={form} name={field.name} index={index} />
                </div>
              ))}
              <Button
                type="dashed"
                block
                onClick={() => {
                  const routes = (form.getFieldValue('routes') as RouteDraft[] | undefined) ?? [];
                  const capabilities = (form.getFieldValue('capabilities') as string[] | undefined) ?? [];
                  add(
                    routeDraftOf(
                      {
                        upstreamId:
                          upstreams.find((u) => !routes.some((r) => r.upstreamId === u.upstreamId))
                            ?.upstreamId ??
                          upstreams[0]?.upstreamId ??
                          '',
                        upstreamModelId: routes[0]?.upstreamModelId ?? '',
                        weight: 100,
                        enabled: true,
                        billingBounds: null,
                      },
                      { vision: capabilities.includes('vision') },
                    ),
                  );
                }}
              >
                再加一条备用线路
              </Button>
            </div>
          )}
        </Form.List>

        <ModelsDevPanel
          state={devMatch}
          autoApplied={devApplied}
          onApply={(match) => applyMatch(match, 'manual')}
        />
        <FormSection title="② 显示与用途" />
        <div className="form-two">
          <Form.Item
            name="displayName"
            label="显示名"
            rules={[
              { required: true, whitespace: true, message: '填写显示名' },
              { max: 60, message: '显示名最多 60 个字' },
            ]}
            extra={<FieldHelp>用户看到的模型名字。</FieldHelp>}
          >
            <Input maxLength={60} placeholder="例：Gemini 3.8 Flash" />
          </Form.Item>
          <Form.Item
            name="vendorName"
            label="出品方（厂商）"
            rules={[
              { required: true, whitespace: true, message: '填写出品方' },
              { max: 40, message: '出品方最多 40 个字' },
            ]}
            extra={<FieldHelp>例：Google、深度求索。用来自动生成模型键。</FieldHelp>}
          >
            <Input maxLength={40} placeholder="例：Google" />
          </Form.Item>
        </div>
        <Form.Item name="modelKey" hidden>
          <Input />
        </Form.Item>
        <Form.Item name="capabilities" label="能力" extra={<FieldHelp>决定用户端哪些功能可以选它。</FieldHelp>}>
          <Checkbox.Group
            options={Object.entries(CAPABILITY_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item
          name="scenarios"
          label="可用于哪些场景"
          extra={
            <FieldHelp>
              用户在「模型配置」里每个场景只能选勾选了它的模型。文字模型一般勾文本聊天、语音通话、私密模式；语音、图片模型勾对应场景。用户发的图片随「文本聊天」（私密模式下随「私密模式」）的模型发送，所以这两类模型要勾「能力 › 识图」。平台默认已改为页面顶部的「场景推荐模型 / 平台内部模型」。
            </FieldHelp>
          }
        >
          <Checkbox.Group
            options={Object.entries(SCENARIO_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <VisionWarning form={form} />
        <div className="form-two">
          <Form.Item
            name="tags"
            label="标签"
            rules={[
              {
                validator: (_, value: string | undefined) => {
                  const tags = (value ?? '').split(/[,，、\s]+/).filter(Boolean);
                  if (tags.length > 10) return Promise.reject(new Error('标签最多 10 个'));
                  if (tags.some((t) => t.length > 16))
                    return Promise.reject(new Error('每个标签最多 16 个字'));
                  return Promise.resolve();
                },
              },
            ]}
            extra={<FieldHelp>用逗号分隔，用户端展示用；最多 10 个，每个不超过 16 个字。</FieldHelp>}
          >
            <Input placeholder="例：便宜，快" />
          </Form.Item>
          <Form.Item name="sortOrder" label="排序" extra={<FieldHelp>数字小的排前面。</FieldHelp>}>
            <InputNumber precision={0} style={{ width: '100%' }} />
          </Form.Item>
        </div>
        <div className="form-two">
          <Form.Item
            name="arenaModelName"
            label="榜单对应名称"
            rules={[{ max: 120, message: '最多 120 个字符' }]}
            extra={
              <FieldHelp>
                榜单上这个模型叫什么（例 claude-opus-4-8），自动获取榜单时按它匹配名次（不区分大小写）。
                {model?.arenaModelName
                  ? model.arenaRank != null
                    ? ` 当前匹配到原榜第 ${model.arenaRank} 名。`
                    : ' 当前榜单里没找到这个名字。'
                  : ''}
              </FieldHelp>
            }
          >
            <Input maxLength={120} placeholder="例：claude-opus-4-8" />
          </Form.Item>
          <Form.Item
            name="leaderboardRank"
            label="手填榜单名次（可不填）"
            extra={
              <FieldHelp>
                自动获取的榜单匹配不到时才用它（原榜名次）。用户端只显示相对顺序 1、2、3…，不显示原始名次；都没有 = 不上榜。
              </FieldHelp>
            }
          >
            <InputNumber min={1} max={9999} precision={0} style={{ width: '100%' }} placeholder="不上榜" />
          </Form.Item>
        </div>

        <FormSection title="③ 价格" desc="每百万 token 的人民币价格，1 元 = 100 积分" />
        <div className="form-three">
          <Form.Item name="priceInput" label="输入（元）" extra={<FieldHelp>没命中缓存时，每百万 token 收多少。</FieldHelp>}>
            <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="priceOutput" label="输出（元）" extra={<FieldHelp>模型写出来的内容，每百万 token 收多少。</FieldHelp>}>
            <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
          <Form.Item name="priceCache" label="缓存命中（元）" extra={<FieldHelp>命中缓存时便宜很多，一般填输入价的 1/10。</FieldHelp>}>
            <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} placeholder="0" />
          </Form.Item>
        </div>
        <div className="form-two">
          <Form.Item
            name="priceCacheWrite5m"
            label="缓存写入 · 5 分钟（元，可不填）"
            extra={
              <FieldHelp>
                上游报告「缓存写入」时按它收（Claude 一般是输入价的 1.25 倍）；不填 = 按输入价。只有 Anthropic 协议的线路会报告缓存写入。
              </FieldHelp>
            }
          >
            <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} placeholder="同输入价" />
          </Form.Item>
          <Form.Item
            name="priceCacheWrite1h"
            label="缓存写入 · 1 小时（元，可不填）"
            extra={<FieldHelp>1 小时缓存的写入价（Claude 一般是输入价的 2 倍）；不填 = 按输入价。</FieldHelp>}
          >
            <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} placeholder="同输入价" />
          </Form.Item>
        </div>
        <Form.Item
          name="displayMultiplierManual"
          label="展示倍率（可不填）"
          extra={
            <FieldHelp>
              用户看到的「×倍率」，只展示、不参与扣费。不填 = 按基准模型自动算
              {model?.displayMultiplier != null ? `（当前 ×${model.displayMultiplier.toFixed(2)}）` : ''}。
            </FieldHelp>
          }
        >
          <InputNumber min={0} max={1000} step={0.01} precision={2} style={{ width: 160 }} placeholder="自动" />
        </Form.Item>
        <FormSection
          title="④ 限时折扣（可不设）"
          desc="生效期间按「售价 × 折扣」扣费，成本不变；到期自动恢复原价。用户端显示「消耗倍率 ×1.0（划掉）×0.5 · 限时 5 折」"
        />
        <div className="form-three">
          <Form.Item name="discountOn" label="开启折扣" valuePropName="checked">
            <Switch />
          </Form.Item>
          <Form.Item
            name="discountRate"
            label="折扣"
            extra={<FieldHelp>0.5 = 5 折，可填 0.01～0.99。</FieldHelp>}
          >
            <InputNumber min={0.01} max={0.99} step={0.05} precision={2} style={{ width: '100%' }} />
          </Form.Item>
          <Form.Item name="discountRange" label="起止时间">
            <DatePicker.RangePicker
              showTime={{ format: 'HH:mm' }}
              format="YYYY-MM-DD HH:mm"
              placeholder={['开始', '结束']}
              style={{ width: '100%' }}
            />
          </Form.Item>
        </div>
        <div className="field-note">
          {model?.pointsPerReply != null
            ? `用户端显示约每条 ${formatPoints(model.pointsPerReply * 10_000)} 积分（有最近 7 天数据时按平均实扣，否则按约 1 万 token 输入、八成命中缓存、200 token 输出估算）；扣费按实际用量。`
            : '保存后系统会算一个「每条回复约多少积分」的参考值。'}
        </div>
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'cost',
              label: '成本价（对账用，不填 = 和售价相同）',
              forceRender: true,
              children: (
                <div className="form-three">
                  <Form.Item name="costInput" label="成本 · 输入">
                    <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="costOutput" label="成本 · 输出">
                    <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="costCache" label="成本 · 缓存">
                    <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} />
                  </Form.Item>
                  <Form.Item name="costCacheWrite5m" label="成本 · 缓存写入 5 分钟">
                    <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} placeholder="同售价" />
                  </Form.Item>
                  <Form.Item name="costCacheWrite1h" label="成本 · 缓存写入 1 小时">
                    <InputNumber min={0} max={100_000} step={0.01} style={{ width: '100%' }} placeholder="同售价" />
                  </Form.Item>
                </div>
              ),
            },
          ]}
        />
        <Collapse
          ghost
          size="small"
          items={[
            {
              key: 'advanced',
              label: '高级',
              children: (
                <div className="readonly-field">
                  <span className="field-label">
                    模型键
                    <HelpTip text="系统内部的唯一标识，按「出品方 / 上游模型名」自动生成，保存后不能改。调用记录、价目表、用户的模型配置都用它对应这个模型。" />
                  </span>
                  <span className="mono">
                    {model?.modelKey ?? (keyWatch || '（填好出品方和上游模型名后自动生成）')}
                  </span>
                </div>
              ),
            },
          ]}
        />
        <Tag className="hidden-tag" color="default">
          非 token 计价模型（语音、图片）请在「AI 模型价格」里维护
        </Tag>
      </Form>
      {confirmVision && (
        <Alert
          type="warning"
          showIcon
          message="这个模型勾了文本聊天 / 私密模式，但没有识图能力"
          description="用户发的图片随这两个场景的模型发送，选了它的用户发图会失败。建议在「能力」里勾上识图（模型确实能看图时）。"
          action={
            <Space>
              <Button size="small" onClick={() => setConfirmVision(false)}>
                回去修改
              </Button>
              <Button size="small" type="primary" onClick={() => void save(false, true)}>
                仍然保存
              </Button>
            </Space>
          }
        />
      )}
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
              <Button size="small" type="primary" onClick={() => void save(true, true)}>
                继续保存
              </Button>
            </Space>
          }
        />
      )}
    </RecordDrawer>
  );
}

/** 3.24：文本聊天 / 私密模式模型缺识图能力的即时提示。 */
function VisionWarning({ form }: { form: FormInstance<ModelFormValues> }) {
  const scenarios = Form.useWatch('scenarios', form) as string[] | undefined;
  const capabilities = (Form.useWatch('capabilities', form) as string[] | undefined) ?? [];
  if (!lacksVision(scenarios, capabilities)) return null;
  return (
    <Alert
      type="warning"
      showIcon
      style={{ marginBottom: 16 }}
      message="文本聊天 / 私密模式的模型需要识图能力"
      description="不再有单独的「图片识别」场景：用户发的图片直接发给文本聊天（私密模式下发给私密模式）的模型。这个模型没勾识图，选了它的用户发图会失败。"
    />
  );
}

/** 一条线路的计费上限：默认结构化表单；折叠项里可以改用 JSON。 */
function RouteBoundsEditor({
  form,
  name,
  index,
}: {
  form: FormInstance<ModelFormValues>;
  name: number;
  index: number;
}) {
  const mode = (Form.useWatch(['routes', name, 'boundsMode'], form) as RouteDraft['boundsMode'] | undefined) ?? 'form';
  const bounds = Form.useWatch(['routes', name, 'bounds'], form) as BoundsFormValues | undefined;
  const origin = (form.getFieldValue(['routes', name]) as RouteDraft | undefined)?.origin ?? null;
  const preview = mode === 'form' && bounds ? JSON.stringify(formToBounds(bounds, origin), null, 2) : '';
  const [openKeys, setOpenKeys] = useState<string[]>(mode === 'json' ? ['json'] : []);

  function switchMode(json: boolean) {
    const route = form.getFieldValue(['routes', name]) as RouteDraft;
    if (json) {
      if (!route.billingBoundsDraft?.trim())
        form.setFieldValue(
          ['routes', name, 'billingBoundsDraft'],
          JSON.stringify(formToBounds(route.bounds, route.origin), null, 2),
        );
      form.setFieldValue(['routes', name, 'boundsMode'], 'json');
      setOpenKeys(['json']);
      return;
    }
    // 切回表单：JSON 是普通文字模型的格式时，把数字带回表单。
    try {
      const parsed = RouteBillingBounds.safeParse(JSON.parse(route.billingBoundsDraft || 'null'));
      if (parsed.success && isTextOnlyBounds(parsed.data))
        form.setFieldValue(
          ['routes', name, 'bounds'],
          boundsToForm(parsed.data, { vision: false }),
        );
    } catch {
      /* JSON 写坏了就保留表单里原来的数字 */
    }
    form.setFieldValue(['routes', name, 'boundsMode'], 'form');
  }

  return (
    <div className="route-bounds" id={`route-bounds-${index}`}>
      <div className="route-bounds-head">
        <span>计费上限</span>
        <HelpTip text="系统按这里的「上下文长度 / 最大输出」先预扣积分，回复完按实际用量多退少补。没有计费上限的线路，调用前会被拒绝（角色不回消息）。" />
      </div>
      {!origin && (
        <Alert
          type="info"
          showIcon
          style={{ marginBottom: 12 }}
          message="这条线路还没有计费上限，没有它角色不会回消息。下面已按常见值预填，核对数字后保存即可。"
        />
      )}
      {origin?.pauseReason && (
        <Alert
          type="warning"
          showIcon
          style={{ marginBottom: 12 }}
          message="这条线路以前因为「没法确认实际用量」被系统暂停了。"
          description="现在上游没报用量时系统按估算计费、不再暂停线路（升级时会自动恢复）。如果还看到这条，勾选「已重新核对」和上面的「启用这条线路」后保存即可恢复。"
        />
      )}
      <Form.Item name={[name, 'boundsMode']} hidden>
        <Input />
      </Form.Item>
      {mode === 'form' ? (
        <BoundsFields name={name} paused={Boolean(origin?.pauseReason)} />
      ) : (
        <div className="field-note" style={{ marginBottom: 12 }}>
          这条线路正在使用下方「高级」里的 JSON 作为计费上限。
        </div>
      )}
      <Collapse
        ghost
        size="small"
        activeKey={openKeys}
        onChange={(keys) => setOpenKeys(Array.isArray(keys) ? keys : [keys])}
        items={[
          {
            key: 'json',
            label: '高级：直接编辑 JSON（语音、图片等特殊模型才需要）',
            forceRender: true,
            children: (
              <>
                <Space style={{ marginBottom: 8 }}>
                  <Switch size="small" checked={mode === 'json'} onChange={switchMode} />
                  <span>{mode === 'json' ? '正在使用 JSON（关掉回到表单）' : '改用 JSON 填写'}</span>
                </Space>
                {mode === 'json' ? (
                  <Form.Item
                    name={[name, 'billingBoundsDraft']}
                    extra={
                      <FieldHelp>
                        格式见契约 billing-bounds-v1。留空 = 这条线路没有计费上限（不能调用）。
                      </FieldHelp>
                    }
                  >
                    <Input.TextArea rows={10} className="mono" placeholder='{"format":"billing-bounds-v1", …}' />
                  </Form.Item>
                ) : (
                  <>
                    <Form.Item name={[name, 'billingBoundsDraft']} hidden>
                      <Input />
                    </Form.Item>
                    <div className="field-help" style={{ marginBottom: 4 }}>
                      按上面表单生成、保存时会提交的内容：
                    </div>
                    <pre className="json-preview">{preview}</pre>
                  </>
                )}
              </>
            ),
          },
        ]}
      />
    </div>
  );
}
