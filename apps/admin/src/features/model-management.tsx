/**
 * 管理后台「模型管理」（docs/refactor/06-old-ui-spec.md 第 9 节；契约 3.3 / 3.4）。
 * 一个菜单四个标签：概览（用量看板）· 上游账号 · 模型 · 调用记录。标签记在 URL（?tab=）里。
 * 取代原「上游管理」「模型目录」两页；价目表留作「价目表版本」高级页。
 * 金额：上游成本按元（微元 ÷ 1,000,000）；用户扣除按积分（接口 *Points 字段），同时写折合元。
 */
import { useEffect, useMemo, useState, type FormEvent, type ReactNode } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  type AdminModel,
  type AdminUsageFilter,
  type AdminUsageOverview,
  type AdminUsageRecord,
  type AdminUsageSummary,
  type GatewayLimits,
  type ModelRates,
  type ModelRoute,
  type Upstream,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

// ---------- 格式 ----------

const nf = new Intl.NumberFormat('en-US');
const yuan = (micros: number, digits = 2) => `¥${(micros / 1_000_000).toFixed(digits)}`;
function pts(n: number | null | undefined) {
  if (n == null) return '—';
  if (n > 0 && n < 0.01) return '< 0.01';
  return new Intl.NumberFormat('en-US', { maximumFractionDigits: 2 }).format(n);
}
const pct = (n: number | null | undefined) => (n == null ? '—' : `${(n * 100).toFixed(1)}%`);
function shortNum(n: number) {
  if (n >= 1_000_000) return `${(n / 1_000_000).toFixed(1)}M`;
  if (n >= 10_000) return `${(n / 1_000).toFixed(1)}K`;
  return nf.format(n);
}
function bjTime(iso: string) {
  return new Date(iso).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai', hour12: false });
}
function ago(iso: string | null | undefined) {
  if (!iso) return '—';
  const min = Math.round((Date.now() - new Date(iso).getTime()) / 60_000);
  if (min < 1) return '刚刚';
  if (min < 60) return `${min} 分钟前`;
  if (min < 1440) return `${Math.round(min / 60)} 小时前`;
  return `${Math.round(min / 1440)} 天前`;
}
/** 北京时间某日 0 点。 */
function bjMidnight(offsetDays = 0) {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3_600_000);
  const day = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3_600_000;
  return new Date(day - offsetDays * 86_400_000);
}
type RangeKey = 'today' | '7d' | '30d' | 'month';
function rangeOf(key: RangeKey) {
  const to = new Date();
  if (key === 'today') return { from: bjMidnight(0).toISOString(), to: to.toISOString() };
  if (key === '7d') return { from: bjMidnight(6).toISOString(), to: to.toISOString() };
  if (key === '30d') return { from: bjMidnight(29).toISOString(), to: to.toISOString() };
  const bj = new Date(to.getTime() + 8 * 3_600_000);
  const first = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), 1) - 8 * 3_600_000;
  return { from: new Date(first).toISOString(), to: to.toISOString() };
}

const purposeLabels: Record<string, string> = {
  chat_reply: '聊天',
  safety_check: '安全检查',
  memory: '记忆',
  simulation: '推演',
  proactive: '主动消息',
  moments: '朋友圈',
  vision: '识图',
  voice: '语音',
  image_generation: '图片',
  web_search: '搜索',
  import_analysis: '导入',
  admin_distill: '管理员蒸馏',
  admin_persona_check: '人设检查',
  admin_public_update_search: '公开动态搜索',
  admin_eval: '评测',
  admin_upstream_test: '连通测试',
  safety_followup: '关怀跟进',
  behavior_planning: '行为规划',
};
const errorLabels: Record<string, string> = {
  invalid_key: '密钥失效',
  quota_exhausted: '余额不足',
  insufficient_balance: '余额不足',
  rate_limited: '被限流',
  timeout: '超时',
  network_error: '网络错误',
  provider_error: '上游错误',
};
// 接口地址不在前端预填：工程规范 R4 规定只有 model-access 模块可以出现模型服务商域名。
const providers: Array<{ id: string; name: string; baseUrl: string }> = [
  { id: 'xiaomi_mimo', name: '小米 MiMo', baseUrl: '' },
  { id: 'dashscope', name: '阿里云百炼', baseUrl: '' },
  { id: 'deepseek', name: 'DeepSeek', baseUrl: '' },
  { id: 'moonshot', name: '月之暗面', baseUrl: '' },
  { id: 'zhipu', name: '智谱', baseUrl: '' },
  { id: 'openrouter', name: 'OpenRouter', baseUrl: '' },
  { id: 'openai_compatible', name: 'OpenAI 兼容（自定义）', baseUrl: '' },
];
const providerName = (id: string | undefined) =>
  providers.find((p) => p.id === id)?.name ?? id ?? '—';
const defaultForLabels: Record<string, string> = {
  chat: '聊天默认',
  background: '后台默认',
  vision: '识图默认',
  planner: '行为规划',
  adult_check: '成人边界检查',
  speech_synthesis: '语音合成',
  speech_recognition: '语音识别',
  image_generation: '图片生成',
  web_search: '联网搜索',
};
const capabilityLabels: Record<string, string> = {
  vision: '识图',
  voice_input: '语音输入',
  voice_output: '语音输出',
  web_search: '搜索',
  image_generation: '图片',
  adult_content: '成人内容',
};
const lineColors = [
  'var(--wb-wx-blue)',
  'var(--wb-wx-green)',
  'var(--wb-wx-orange)',
  'var(--wb-wx-purple)',
  'var(--wb-wx-red)',
  'var(--wb-wx-cyan)',
  'var(--wb-wx-gold)',
  'var(--wb-wx-indigo)',
];

type UpstreamState = 'normal' | 'abnormal' | 'disabled';
function upstreamState(u: Upstream): UpstreamState {
  if (u.enabled === false) return 'disabled';
  if (u.status !== 'active') return 'abnormal';
  if (u.cooldownUntil && new Date(u.cooldownUntil).getTime() > Date.now()) return 'abnormal';
  return 'normal';
}
const stateLabels: Record<UpstreamState, string> = {
  normal: '正常',
  abnormal: '异常',
  disabled: '已停用',
};

function useToast() {
  const [text, setText] = useState('');
  useEffect(() => {
    if (!text) return;
    const timer = window.setTimeout(() => setText(''), 2400);
    return () => window.clearTimeout(timer);
  }, [text]);
  return {
    show: setText,
    node: text ? (
      <div className="mm-toast" role="status">
        {text}
      </div>
    ) : null,
  };
}

function Drawer({
  title,
  onClose,
  children,
  footer,
}: {
  title: string;
  onClose(): void;
  children: ReactNode;
  footer?: ReactNode;
}) {
  useEffect(() => {
    const key = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [onClose]);
  return (
    <div className="mm-scrim" onClick={onClose}>
      <aside
        className="mm-drawer"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-label={title}
      >
        <header>
          <h2>{title}</h2>
          <button type="button" className="plain-btn" onClick={onClose} aria-label="关闭">
            ✕
          </button>
        </header>
        <div className="mm-drawer-body">{children}</div>
        {footer && <footer>{footer}</footer>}
      </aside>
    </div>
  );
}

function Confirm({
  text,
  confirmLabel,
  danger,
  onConfirm,
  onClose,
}: {
  text: string;
  confirmLabel: string;
  danger?: boolean;
  onConfirm(): void;
  onClose(): void;
}) {
  return (
    <div className="mm-scrim center" onClick={onClose}>
      <div className="mm-confirm" onClick={(e) => e.stopPropagation()} role="dialog">
        <p>{text}</p>
        <div>
          <button type="button" onClick={onClose}>
            取消
          </button>
          <button
            type="button"
            className={danger ? 'danger-text' : 'link-text'}
            onClick={() => {
              onClose();
              onConfirm();
            }}
          >
            {confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}

function Segmented<T extends string>({
  items,
  value,
  onChange,
}: {
  items: Array<[T, string]>;
  value: T;
  onChange(v: T): void;
}) {
  return (
    <span className="mm-seg" role="group">
      {items.map(([k, label]) => (
        <button
          key={k}
          type="button"
          aria-pressed={k === value}
          className={k === value ? 'on' : ''}
          onClick={() => onChange(k)}
        >
          {label}
        </button>
      ))}
    </span>
  );
}

// ---------- 页面框架 ----------

type Tab = 'overview' | 'upstreams' | 'models' | 'records';
const tabs: Array<[Tab, string]> = [
  ['overview', '概览'],
  ['upstreams', '上游账号'],
  ['models', '模型'],
  ['records', '调用记录'],
];

export function ModelManagementPage() {
  const [params, setParams] = useSearchParams();
  const tab = (tabs.find(([k]) => k === params.get('tab'))?.[0] ?? 'overview') as Tab;
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const models = useRemote(ModelAccessAdminEndpoints.listModels);
  const go = (next: Tab, extra: Record<string, string> = {}) => setParams({ tab: next, ...extra });
  return (
    <div className="model-mgmt">
      <h1>模型管理</h1>
      <nav className="mm-tabs" role="tablist">
        {tabs.map(([key, label]) => (
          <button
            key={key}
            type="button"
            role="tab"
            aria-selected={tab === key}
            onClick={() => go(key)}
          >
            {label}
          </button>
        ))}
      </nav>
      <Feedback error={upstreams.error || models.error} />
      {tab === 'overview' && (
        <OverviewTab
          upstreams={upstreams.data?.items ?? []}
          models={models.data?.items ?? []}
          onGo={go}
        />
      )}
      {tab === 'upstreams' && (
        <UpstreamsTab
          upstreams={upstreams.data?.items ?? []}
          models={models.data?.items ?? []}
          initialStatus={(params.get('status') as UpstreamState | null) ?? undefined}
          refresh={upstreams.refresh}
        />
      )}
      {tab === 'models' && (
        <ModelsTab
          models={models.data?.items ?? []}
          upstreams={upstreams.data?.items ?? []}
          refresh={models.refresh}
        />
      )}
      {tab === 'records' && (
        <RecordsTab
          upstreams={upstreams.data?.items ?? []}
          models={models.data?.items ?? []}
          initial={{
            upstreamId: params.get('upstream') ?? '',
            modelKey: params.get('model') ?? '',
            status: params.get('status') === 'failed' ? 'failed' : '',
          }}
        />
      )}
    </div>
  );
}

// ---------- 概览（9.3） ----------

function Stat({
  title,
  value,
  sub,
  danger,
  onClick,
}: {
  title: string;
  value: ReactNode;
  sub?: ReactNode;
  danger?: boolean;
  onClick?: () => void;
}) {
  const body = (
    <>
      <span className="mm-stat-title">{title}</span>
      <strong>{value}</strong>
      <span className={`mm-stat-sub ${danger ? 'danger-text' : ''}`}>{sub ?? ' '}</span>
    </>
  );
  return onClick ? (
    <button type="button" className="mm-stat clickable" onClick={onClick}>
      {body}
    </button>
  ) : (
    <div className="mm-stat">{body}</div>
  );
}

function change(now: number, before: number) {
  if (!before) return now ? '较上一时段 新增' : '较上一时段 持平';
  const v = ((now - before) / before) * 100;
  return `较上一时段 ${v >= 0 ? '+' : ''}${v.toFixed(0)}%`;
}

type Metric = 'calls' | 'tokens' | 'cost';

function TrendChart({
  summary,
  upstreams,
  metric,
}: {
  summary: AdminUsageSummary | undefined;
  upstreams: Upstream[];
  metric: Metric;
}) {
  const rows = summary?.rows ?? [];
  const times = [...new Set(rows.map((r) => r.keys[0]!))].sort();
  const valueOf = (r: (typeof rows)[number]) =>
    metric === 'calls' ? r.calls : metric === 'tokens' ? r.totalTokens : r.costMicros / 1_000_000;
  const byUpstream = new Map<string, Map<string, number>>();
  for (const r of rows) {
    const id = r.keys[1] ?? '';
    const m = byUpstream.get(id) ?? new Map<string, number>();
    m.set(r.keys[0]!, (m.get(r.keys[0]!) ?? 0) + valueOf(r));
    byUpstream.set(id, m);
  }
  // 最多 8 条线，其余合并为「其他」。
  const ranked = [...byUpstream.entries()].sort(
    (a, b) =>
      [...b[1].values()].reduce((s, v) => s + v, 0) - [...a[1].values()].reduce((s, v) => s + v, 0),
  );
  const lines = ranked.slice(0, 7);
  if (ranked.length > 7) {
    const other = new Map<string, number>();
    for (const [, m] of ranked.slice(7))
      for (const [t, v] of m) other.set(t, (other.get(t) ?? 0) + v);
    lines.push(['__other__', other]);
  }
  const max = Math.max(1e-9, ...lines.flatMap(([, m]) => [...m.values()]));
  const W = 640;
  const H = 200;
  const x = (i: number) => (times.length <= 1 ? W / 2 : (i / (times.length - 1)) * (W - 40) + 30);
  const y = (v: number) => H - 20 - (v / max) * (H - 40);
  if (!times.length) return <p className="mm-empty">这段时间没有调用</p>;
  return (
    <div>
      <svg viewBox={`0 0 ${W} ${H}`} className="mm-chart" role="img" aria-label="趋势图">
        <line x1={30} y1={H - 20} x2={W - 10} y2={H - 20} className="mm-axis" />
        {lines.map(([id, m], index) => (
          <polyline
            key={id}
            fill="none"
            stroke={lineColors[index % lineColors.length]}
            strokeWidth={2}
            points={times.map((t, i) => `${x(i)},${y(m.get(t) ?? 0)}`).join(' ')}
          />
        ))}
        <text x={30} y={14} className="mm-axis-text">
          {metric === 'cost' ? `¥${max.toFixed(2)}` : shortNum(max)}
        </text>
        <text x={30} y={H - 4} className="mm-axis-text">
          {times[0]}
        </text>
        <text x={W - 10} y={H - 4} textAnchor="end" className="mm-axis-text">
          {times.at(-1)}
        </text>
      </svg>
      <div className="mm-legend">
        {lines.map(([id], index) => (
          <span key={id}>
            <i style={{ background: lineColors[index % lineColors.length] }} />
            {id === '__other__'
              ? '其他'
              : (upstreams.find((u) => u.upstreamId === id)?.name ?? '未知账号')}
          </span>
        ))}
      </div>
    </div>
  );
}

function OverviewTab({
  upstreams,
  models,
  onGo,
}: {
  upstreams: Upstream[];
  models: AdminModel[];
  onGo(tab: Tab, extra?: Record<string, string>): void;
}) {
  const [range, setRange] = useState<RangeKey>('today');
  const [upstreamId, setUpstreamId] = useState('');
  const [modelKey, setModelKey] = useState('');
  const [metric, setMetric] = useState<Metric>('calls');
  const [overview, setOverview] = useState<AdminUsageOverview>();
  const [trend, setTrend] = useState<AdminUsageSummary>();
  const [byModel, setByModel] = useState<AdminUsageSummary>();
  const [byUpstream, setByUpstream] = useState<AdminUsageSummary>();
  const [byUser, setByUser] = useState<AdminUsageSummary>();
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    const { from, to } = rangeOf(range);
    const filter: AdminUsageFilter = {
      from,
      to,
      ...(upstreamId ? { upstreamIds: [upstreamId] } : {}),
      ...(modelKey ? { modelKeys: [modelKey] } : {}),
    };
    const summary = (
      groupBy: AdminUsageSummary['rows'][number]['keys'][number][],
      sort: 'key_asc' | 'charged_desc',
      limit: number,
    ) =>
      api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: { filter, groupBy: groupBy as never, sort, limit },
      });
    setError('');
    void Promise.all([
      api.call(ModelAccessAdminUsageEndpoints.usageOverview, {
        body: {
          from,
          to,
          ...(upstreamId ? { upstreamIds: [upstreamId] } : {}),
          ...(modelKey ? { modelKeys: [modelKey] } : {}),
        },
      }),
      summary([range === 'today' ? 'hour' : 'day', 'upstream'], 'key_asc', 1000),
      summary(['model'], 'charged_desc', 50),
      summary(['upstream'], 'charged_desc', 50),
      summary(['user'], 'charged_desc', 10),
    ])
      .then(([o, t, m, u, users]) => {
        if (!active) return;
        setOverview(o);
        setTrend(t);
        setByModel(m);
        setByUpstream(u);
        setByUser(users);
      })
      .catch((e) => active && setError(errorText(e)));
    return () => {
      active = false;
    };
  }, [range, upstreamId, modelKey]);
  const t = overview?.totals;
  const p = overview?.previousTotals;
  const upstreamName = (id: string) =>
    upstreams.find((u) => u.upstreamId === id)?.name ?? '未知账号';
  const modelName = (key: string) => models.find((m) => m.modelKey === key)?.displayName ?? key;
  const modelTotal = Math.max(
    1,
    (byModel?.rows ?? []).reduce((s, r) => s + r.calls, 0),
  );
  return (
    <section className="mm-section">
      <div className="mm-filter">
        <span>时间</span>
        <Segmented<RangeKey>
          items={[
            ['today', '今天'],
            ['7d', '近7天'],
            ['30d', '近30天'],
            ['month', '本月'],
          ]}
          value={range}
          onChange={setRange}
        />
        <label className="mm-inline">
          上游
          <select value={upstreamId} onChange={(e) => setUpstreamId(e.target.value)}>
            <option value="">全部</option>
            {upstreams.map((u) => (
              <option key={u.upstreamId} value={u.upstreamId}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label className="mm-inline">
          模型
          <select value={modelKey} onChange={(e) => setModelKey(e.target.value)}>
            <option value="">全部</option>
            {models.map((m) => (
              <option key={m.modelKey} value={m.modelKey}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <span className="hint">北京时间</span>
      </div>
      <Feedback error={error} />
      <div className="mm-stats">
        <Stat
          title="调用次数"
          value={t ? nf.format(t.calls) : '—'}
          sub={t && p ? change(t.calls, p.calls) : undefined}
        />
        <Stat
          title="成功率"
          value={t ? pct(1 - (t.failureRate ?? (t.calls ? t.failedCalls / t.calls : 0))) : '—'}
          sub={t ? `失败 ${nf.format(t.failedCalls)}` : undefined}
        />
        <Stat
          title="合计 token"
          value={t ? shortNum(t.totalTokens) : '—'}
          sub={t ? `输入 ${shortNum(t.inputTokens)} · 输出 ${shortNum(t.outputTokens)}` : undefined}
        />
        <Stat
          title="上游已核成本"
          value={t ? yuan(t.costMicros) : '—'}
          sub={
            t
              ? `${t.unknownCostCalls ?? '未知'} 笔待核 · 风险上限 ${yuan(t.uncertainCostMicros ?? 0)}（不计实际成本）`
              : undefined
          }
        />
        <Stat
          title="用户扣除"
          value={t ? `${pts(t.chargedPoints)} 积分` : '—'}
          sub={t ? `≈ ${yuan(t.chargedMicros)}` : undefined}
        />
        <Stat
          title="可用账号"
          value={overview ? `${overview.accounts.available} / ${overview.accounts.total}` : '—'}
          sub={
            overview && overview.accounts.abnormal > 0
              ? `${overview.accounts.abnormal} 个异常 ›`
              : overview
                ? `已停用 ${overview.accounts.disabled}`
                : undefined
          }
          danger={!!overview && overview.accounts.abnormal > 0}
          onClick={
            overview && overview.accounts.abnormal > 0
              ? () => onGo('upstreams', { status: 'abnormal' })
              : undefined
          }
        />
        <Stat
          title="平均耗时"
          value={t?.avgLatencyMs != null ? `${Math.round(t.avgLatencyMs)} ms` : '—'}
        />
        <Stat title="缓存命中率" value={pct(t?.cacheHitRate)} />
      </div>
      <div className="mm-grid-2">
        <div className="mm-card">
          <header>
            <h2>趋势（{range === 'today' ? '按小时' : '按天'}）</h2>
            <Segmented<Metric>
              items={[
                ['calls', '调用'],
                ['tokens', 'token'],
                ['cost', '成本'],
              ]}
              value={metric}
              onChange={setMetric}
            />
          </header>
          <TrendChart summary={trend} upstreams={upstreams} metric={metric} />
        </div>
        <div className="mm-card">
          <header>
            <h2>模型分布</h2>
          </header>
          {(byModel?.rows ?? []).length === 0 && <p className="mm-empty">这段时间没有调用</p>}
          <div className="mm-bars">
            {(byModel?.rows ?? []).slice(0, 10).map((r) => (
              <div key={r.keys[0]} className="mm-bar-row">
                <span className="ellipsis">{modelName(r.keys[0]!)}</span>
                <span className="mm-bar">
                  <i style={{ transform: `scaleX(${r.calls / modelTotal})` }} />
                </span>
                <span>{pct(r.calls / modelTotal)}</span>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="mm-grid-2">
        <div className="mm-card">
          <header>
            <h2>上游账号排行</h2>
          </header>
          <table>
            <thead>
              <tr>
                <th>账号</th>
                <th>调用</th>
                <th>成本</th>
                <th>失败率</th>
              </tr>
            </thead>
            <tbody>
              {(byUpstream?.rows ?? []).map((r) => (
                <tr key={r.keys[0]}>
                  <td>{upstreamName(r.keys[0]!)}</td>
                  <td>{nf.format(r.calls)}</td>
                  <td>
                    {yuan(r.costMicros)}（已核）；{r.unknownCostCalls ?? '未知'} 笔待核 / 风险{' '}
                    {yuan(r.uncertainCostMicros ?? 0)}
                  </td>
                  <td className={(r.failureRate ?? 0) > 0.05 ? 'danger-text' : ''}>
                    {pct(r.failureRate ?? (r.calls ? r.failedCalls / r.calls : 0))}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="mm-card">
          <header>
            <h2>最近错误（24 小时）</h2>
          </header>
          {(overview?.recentErrors ?? []).length === 0 ? (
            <p className="mm-empty">最近 24 小时没有失败调用</p>
          ) : (
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>账号</th>
                  <th>模型</th>
                  <th>错误类型</th>
                  <th>次数</th>
                </tr>
              </thead>
              <tbody>
                {overview!.recentErrors.map((e) => (
                  <tr
                    key={`${e.upstreamId}|${e.modelKey}|${e.errorCode}`}
                    className="clickable-row"
                    onClick={() =>
                      onGo('records', {
                        upstream: e.upstreamId,
                        model: e.modelKey,
                        status: 'failed',
                      })
                    }
                  >
                    <td>{ago(e.lastAt)}</td>
                    <td>{upstreamName(e.upstreamId)}</td>
                    <td>{modelName(e.modelKey)}</td>
                    <td>{errorLabels[e.errorCode] ?? e.errorCode}</td>
                    <td>{e.count}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
        </div>
      </div>
      <div className="mm-card">
        <header>
          <h2>用户用量排行（前 10）</h2>
          <Link to="/accounts" className="link-text">
            用户与积分 ›
          </Link>
        </header>
        {(byUser?.rows ?? []).length === 0 ? (
          <p className="mm-empty">这段时间没有调用</p>
        ) : (
          <table>
            <thead>
              <tr>
                <th>用户 ID</th>
                <th>调用</th>
                <th>token</th>
                <th>用户扣除</th>
                <th>上游成本</th>
              </tr>
            </thead>
            <tbody>
              {byUser!.rows.map((r) => (
                <tr key={r.keys[0]}>
                  <td className="mono">{r.keys[0]}</td>
                  <td>{nf.format(r.calls)}</td>
                  <td>{shortNum(r.totalTokens)}</td>
                  <td>
                    {pts(r.chargedPoints)} 积分{' '}
                    <span className="hint">≈ {yuan(r.chargedMicros)}</span>
                  </td>
                  <td>
                    {yuan(r.costMicros)}（已核）；{r.unknownCostCalls ?? '未知'} 笔待核 / 风险{' '}
                    {yuan(r.uncertainCostMicros ?? 0)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>
    </section>
  );
}

// ---------- 上游账号（9.4） ----------

function StatusCell({ u, testing }: { u: Upstream; testing: boolean }) {
  if (testing)
    return (
      <span className="mm-status pending">
        <i />
        测试中
      </span>
    );
  const state = upstreamState(u);
  const paused = u.cooldownUntil && new Date(u.cooldownUntil).getTime() > Date.now();
  return (
    <span className={`mm-status ${state}`}>
      <i />
      {stateLabels[state]}
      {state === 'abnormal' && (
        <small>
          {errorLabels[u.lastError ?? ''] ??
            u.lastError ??
            (u.status === 'invalid'
              ? '密钥失效'
              : u.status === 'quota_exhausted'
                ? '余额不足'
                : '不可用')}
          {paused &&
            ` · ${Math.max(1, Math.ceil((new Date(u.cooldownUntil!).getTime() - Date.now()) / 60_000))} 分钟后自动重试`}
        </small>
      )}
    </span>
  );
}

function UpstreamsTab({
  upstreams,
  models,
  initialStatus,
  refresh,
}: {
  upstreams: Upstream[];
  models: AdminModel[];
  initialStatus?: UpstreamState;
  refresh(): void;
}) {
  const [provider, setProvider] = useState('');
  const [status, setStatus] = useState<'all' | UpstreamState>(initialStatus ?? 'all');
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [testing, setTesting] = useState<Set<string>>(new Set());
  const [editing, setEditing] = useState<Upstream | 'new' | null>(null);
  const [detail, setDetail] = useState<Upstream | null>(null);
  const [disabling, setDisabling] = useState<string[] | null>(null);
  const [limitsOpen, setLimitsOpen] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  const list = upstreams.filter(
    (u) =>
      (!provider || (u.provider ?? u.kind) === provider) &&
      (status === 'all' || upstreamState(u) === status) &&
      (!query.trim() || u.name.includes(query.trim())),
  );
  async function test(id: string) {
    setTesting((s) => new Set(s).add(id));
    const started = performance.now();
    try {
      const result = await api.call(ModelAccessAdminEndpoints.testUpstream, {
        params: { upstreamId: id },
      });
      toast.show(
        result.status === 'active'
          ? `连通正常，耗时 ${Math.round(performance.now() - started)}ms`
          : `连接失败：${errorLabels[result.lastError ?? ''] ?? result.status}`,
      );
    } catch (e) {
      toast.show(`连接失败：${errorText(e)}`);
    } finally {
      setTesting((s) => {
        const n = new Set(s);
        n.delete(id);
        return n;
      });
      refresh();
    }
  }
  async function batch(action: 'test' | 'enable' | 'disable', ids = [...selected]) {
    if (!ids.length) return;
    setError('');
    if (action === 'test') setTesting(new Set(ids));
    try {
      await api.call(ModelAccessAdminEndpoints.batchUpstreams, {
        body: { upstreamIds: ids, action },
      });
      toast.show(action === 'test' ? '批量测试完成' : action === 'enable' ? '已启用' : '已停用');
      setSelected(new Set());
      refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setTesting(new Set());
    }
  }
  const routedModels = (id: string) =>
    models.filter((m) => (m.routes ?? []).some((r) => r.upstreamId === id) || m.upstreamId === id);
  return (
    <section className="mm-section">
      <div className="mm-toolbar">
        <button type="button" className="primary" onClick={() => setEditing('new')}>
          + 添加上游账号
        </button>
        <label className="mm-inline">
          供应商
          <select value={provider} onChange={(e) => setProvider(e.target.value)}>
            <option value="">全部</option>
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <span className="mm-inline">
          状态
          <Segmented<'all' | UpstreamState>
            items={[
              ['all', '全部'],
              ['normal', '正常'],
              ['abnormal', '异常'],
              ['disabled', '已停用'],
            ]}
            value={status}
            onChange={setStatus}
          />
        </span>
        <input
          className="mm-search"
          placeholder="搜索名称"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <span className="mm-spacer" />
        {selected.size > 0 ? (
          <>
            <button type="button" onClick={() => void batch('test')}>
              批量测试
            </button>
            <button type="button" onClick={() => void batch('enable')}>
              批量启用
            </button>
            <button type="button" className="danger" onClick={() => setDisabling([...selected])}>
              批量停用
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() =>
              void batch(
                'test',
                list.map((u) => u.upstreamId),
              )
            }
          >
            批量测试
          </button>
        )}
        <button type="button" onClick={() => setLimitsOpen(true)}>
          调度设置
        </button>
      </div>
      <Feedback error={error} />
      <p className="hint">
        同一模型有多个账号时：先用优先级数字小的；同优先级按权重比例分流；同一会话尽量留在同一账号；某账号连续失败会自动暂停一段时间再试（数值见「调度设置」）。
      </p>
      <table className="mm-table">
        <thead>
          <tr>
            <th>
              <input
                type="checkbox"
                aria-label="全选"
                checked={list.length > 0 && list.every((u) => selected.has(u.upstreamId))}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(list.map((u) => u.upstreamId)) : new Set())
                }
              />
            </th>
            <th>名称</th>
            <th>供应商</th>
            <th>状态</th>
            <th>优先级</th>
            <th>权重</th>
            <th>进行中</th>
            <th>今日调用</th>
            <th>今日成本</th>
            <th>最近使用</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((u) => (
            <tr key={u.upstreamId} className="clickable-row" onClick={() => setDetail(u)}>
              <td onClick={(e) => e.stopPropagation()}>
                <input
                  type="checkbox"
                  aria-label={`选择 ${u.name}`}
                  checked={selected.has(u.upstreamId)}
                  onChange={(e) =>
                    setSelected((s) => {
                      const n = new Set(s);
                      if (e.target.checked) n.add(u.upstreamId);
                      else n.delete(u.upstreamId);
                      return n;
                    })
                  }
                />
              </td>
              <td>
                {u.name}
                <div className="hint mono">{u.maskedKey}</div>
              </td>
              <td>{providerName(u.provider ?? u.kind)}</td>
              <td>
                <StatusCell u={u} testing={testing.has(u.upstreamId)} />
              </td>
              <td>{u.priority ?? 1}</td>
              <td>{u.weight ?? 100}</td>
              <td>
                {u.inFlight ?? 0}
                {u.maxConcurrency ? ` / ${u.maxConcurrency}` : ''}
              </td>
              <td>{nf.format(u.todayCalls ?? 0)}</td>
              <td>{yuan(u.todayCostMicros ?? 0)}</td>
              <td>{ago(u.lastUsedAt)}</td>
              <td className="mm-actions" onClick={(e) => e.stopPropagation()}>
                <button type="button" className="link-text" onClick={() => void test(u.upstreamId)}>
                  测试
                </button>
                <button type="button" className="link-text" onClick={() => setEditing(u)}>
                  编辑
                </button>
                {u.enabled === false ? (
                  <button
                    type="button"
                    className="link-text"
                    onClick={() => void batch('enable', [u.upstreamId])}
                  >
                    启用
                  </button>
                ) : (
                  <button
                    type="button"
                    className="danger-text"
                    onClick={() => setDisabling([u.upstreamId])}
                  >
                    停用
                  </button>
                )}
              </td>
            </tr>
          ))}
          {list.length === 0 && (
            <tr>
              <td colSpan={11} className="mm-empty">
                没有符合条件的上游账号
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editing && (
        <UpstreamForm
          upstream={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            setEditing(null);
            toast.show(text);
            refresh();
          }}
        />
      )}
      {detail && (
        <UpstreamDetail
          upstream={upstreams.find((u) => u.upstreamId === detail.upstreamId) ?? detail}
          models={routedModels(detail.upstreamId)}
          onClose={() => setDetail(null)}
        />
      )}
      {disabling && (
        <Confirm
          text="停用后不再给它分配调用，正在进行的调用不受影响"
          confirmLabel="停用"
          danger
          onClose={() => setDisabling(null)}
          onConfirm={() => void batch('disable', disabling)}
        />
      )}
      {limitsOpen && <LimitsDrawer onClose={() => setLimitsOpen(false)} />}
      {toast.node}
    </section>
  );
}

function numOrNull(value: FormDataEntryValue | null) {
  const text = String(value ?? '').trim();
  return text === '' ? null : Number(text);
}

function UpstreamForm({
  upstream,
  onClose,
  onSaved,
}: {
  upstream: Upstream | null;
  onClose(): void;
  onSaved(text: string): void;
}) {
  const [provider, setProvider] = useState(upstream?.provider ?? 'openai_compatible');
  const [baseUrl, setBaseUrl] = useState(upstream?.baseUrl ?? '');
  const [rotating, setRotating] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [note, setNote] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const keyField = event.currentTarget.elements.namedItem('apiKey');
    const apiKey = String(form.get('apiKey') ?? '');
    if (keyField instanceof HTMLInputElement) keyField.value = '';
    const common = {
      name: String(form.get('name')),
      baseUrl,
      provider,
      priority: Number(form.get('priority') || 1),
      weight: Number(form.get('weight') || 100),
      maxConcurrency: numOrNull(form.get('maxConcurrency')),
      rpmLimit: numOrNull(form.get('rpmLimit')),
      enabled: form.get('enabled') === 'on',
      note: String(form.get('note') ?? '').trim() || null,
    };
    setPending(true);
    setError('');
    try {
      if (upstream) {
        await api.call(ModelAccessAdminEndpoints.updateUpstream, {
          params: { upstreamId: upstream.upstreamId },
          body: common,
        });
        if (rotating && apiKey)
          await api.call(ModelAccessAdminEndpoints.rotateUpstreamKey, {
            params: { upstreamId: upstream.upstreamId },
            body: { apiKey },
          });
        onSaved('已保存');
      } else {
        const created = await api.call(ModelAccessAdminEndpoints.createUpstream, {
          body: {
            ...common,
            kind: 'openai_compatible',
            apiKey,
            saveOnTestFailure: form.get('saveOnTestFailure') === 'on',
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
          ? '连通测试未通过；如仍要保存，请勾选「测试不通过也保存」'
          : errorText(e),
      );
    } finally {
      setPending(false);
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
      setNote(
        r.status === 'active'
          ? `连通正常，耗时 ${Math.round(performance.now() - started)}ms`
          : `连接失败：${errorLabels[r.lastError ?? ''] ?? r.status}`,
      );
    } catch (e) {
      setNote(`连接失败：${errorText(e)}`);
    }
  }
  return (
    <Drawer
      title={upstream ? `编辑上游账号 · ${upstream.name}` : '添加上游账号'}
      onClose={onClose}
      footer={
        <>
          {upstream && (
            <button type="button" onClick={() => void testNow()}>
              测试连接
            </button>
          )}
          <button type="submit" form="upstream-form" className="primary" disabled={pending}>
            {upstream ? '保存' : '测试并保存'}
          </button>
        </>
      }
    >
      <form id="upstream-form" className="mm-form" onSubmit={(e) => void submit(e)}>
        <label>
          名称
          <input name="name" required maxLength={40} defaultValue={upstream?.name ?? ''} />
        </label>
        <label>
          供应商
          <select
            value={provider}
            onChange={(e) => {
              setProvider(e.target.value);
              const preset = providers.find((p) => p.id === e.target.value);
              if (preset?.baseUrl) setBaseUrl(preset.baseUrl);
            }}
          >
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          接口地址
          <input
            type="url"
            required
            value={baseUrl}
            placeholder="https://…/v1"
            onChange={(e) => setBaseUrl(e.target.value)}
          />
        </label>
        {upstream && !rotating ? (
          <div className="mm-field">
            <span>密钥</span>
            <div className="mm-inline">
              <span className="mono">{upstream.maskedKey}</span>
              <button type="button" onClick={() => setRotating(true)}>
                更换密钥
              </button>
            </div>
          </div>
        ) : (
          <label>
            {upstream ? '新密钥' : '密钥'}
            <input
              name="apiKey"
              type="password"
              autoComplete="off"
              spellCheck={false}
              required
              minLength={8}
              maxLength={512}
            />
          </label>
        )}
        <div className="mm-two">
          <label>
            优先级
            <input
              name="priority"
              type="number"
              min={0}
              max={1000}
              defaultValue={upstream?.priority ?? 1}
            />
          </label>
          <label>
            权重
            <input
              name="weight"
              type="number"
              min={1}
              max={1000}
              defaultValue={upstream?.weight ?? 100}
            />
          </label>
        </div>
        <div className="mm-two">
          <label>
            并发上限
            <input
              name="maxConcurrency"
              type="number"
              min={1}
              placeholder="不限"
              defaultValue={upstream?.maxConcurrency ?? ''}
            />
          </label>
          <label>
            每分钟请求上限
            <input
              name="rpmLimit"
              type="number"
              min={1}
              placeholder="不限"
              defaultValue={upstream?.rpmLimit ?? ''}
            />
          </label>
        </div>
        <label>
          备注
          <input name="note" maxLength={200} defaultValue={upstream?.note ?? ''} />
        </label>
        <label className="check">
          <input name="enabled" type="checkbox" defaultChecked={upstream?.enabled ?? true} />
          启用
        </label>
        {!upstream && (
          <label className="check">
            <input name="saveOnTestFailure" type="checkbox" />
            测试不通过也保存（状态记为「异常」）
          </label>
        )}
        <p className="hint">密钥只用于本次提交，保存后只显示末 4 位，不能再查看原文。</p>
        {note && <p role="status">{note}</p>}
        <Feedback error={error} />
      </form>
    </Drawer>
  );
}

function UpstreamDetail({
  upstream,
  models,
  onClose,
}: {
  upstream: Upstream;
  models: AdminModel[];
  onClose(): void;
}) {
  const [week, setWeek] = useState<AdminUsageSummary>();
  const [overview, setOverview] = useState<AdminUsageOverview>();
  useEffect(() => {
    const { from, to } = rangeOf('7d');
    void api
      .call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: {
          filter: { from, to, upstreamIds: [upstream.upstreamId] },
          groupBy: ['day'],
          sort: 'key_asc',
          limit: 50,
        },
      })
      .then(setWeek)
      .catch(() => {});
    void api
      .call(ModelAccessAdminUsageEndpoints.usageOverview, {
        body: { from, to, upstreamIds: [upstream.upstreamId] },
      })
      .then(setOverview)
      .catch(() => {});
  }, [upstream.upstreamId]);
  const max = Math.max(1, ...(week?.rows ?? []).map((r) => r.calls));
  return (
    <Drawer title={upstream.name} onClose={onClose}>
      <dl className="mm-dl">
        <dt>供应商</dt>
        <dd>{providerName(upstream.provider ?? upstream.kind)}</dd>
        <dt>接口地址</dt>
        <dd className="mono">{upstream.baseUrl}</dd>
        <dt>密钥</dt>
        <dd className="mono">{upstream.maskedKey}</dd>
        <dt>状态</dt>
        <dd>
          <StatusCell u={upstream} testing={false} />
        </dd>
        <dt>连续失败</dt>
        <dd>{upstream.consecutiveFailures ?? 0} 次</dd>
        <dt>最近测试</dt>
        <dd>{upstream.lastTestedAt ? bjTime(upstream.lastTestedAt) : '—'}</dd>
        <dt>调度</dt>
        <dd>
          优先级 {upstream.priority ?? 1} · 权重 {upstream.weight ?? 100} · 并发{' '}
          {upstream.maxConcurrency ?? '不限'} · 每分钟 {upstream.rpmLimit ?? '不限'}
        </dd>
        {upstream.note && (
          <>
            <dt>备注</dt>
            <dd>{upstream.note}</dd>
          </>
        )}
      </dl>
      <h3>近 7 天调用</h3>
      <div className="mm-mini-bars">
        {(week?.rows ?? []).map((r) => (
          <span key={r.keys[0]} title={`${r.keys[0]}：${r.calls} 次`}>
            <i style={{ transform: `scaleY(${r.calls / max})` }} />
          </span>
        ))}
        {(week?.rows ?? []).length === 0 && <p className="mm-empty">近 7 天没有调用</p>}
      </div>
      <h3>可用的模型</h3>
      {models.length === 0 ? (
        <p className="hint">还没有模型路由到这个账号</p>
      ) : (
        <ul className="mm-list">
          {models.map((m) => (
            <li key={m.modelKey}>
              {m.displayName}
              <span className="hint mono">
                {' '}
                {(m.routes ?? []).find((r) => r.upstreamId === upstream.upstreamId)
                  ?.upstreamModelId ?? m.upstreamModelId}
              </span>
            </li>
          ))}
        </ul>
      )}
      <h3>最近错误</h3>
      {(overview?.recentErrors ?? []).length === 0 ? (
        <p className="hint">最近没有失败调用</p>
      ) : (
        <ul className="mm-list">
          {overview!.recentErrors.slice(0, 20).map((e) => (
            <li key={`${e.modelKey}|${e.errorCode}`}>
              {errorLabels[e.errorCode] ?? e.errorCode} · {e.modelKey} · {e.count} 次 ·{' '}
              {ago(e.lastAt)}
            </li>
          ))}
        </ul>
      )}
    </Drawer>
  );
}

function LimitsDrawer({ onClose }: { onClose(): void }) {
  const limits = useRemote(ModelAccessAdminEndpoints.getGatewayLimits);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body: GatewayLimits = {
      perUserConcurrency: numOrNull(form.get('perUserConcurrency')),
      perUserRpm: numOrNull(form.get('perUserRpm')),
      failureThreshold: Number(form.get('failureThreshold')),
      cooldownSeconds: Number(form.get('cooldownSeconds')),
    };
    setPending(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.updateGatewayLimits, { body });
      setMessage('已保存');
      limits.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Drawer
      title="调度设置"
      onClose={onClose}
      footer={
        <button
          type="submit"
          form="limits-form"
          className="primary"
          disabled={pending || !limits.data}
        >
          保存
        </button>
      }
    >
      {limits.data && (
        <form
          id="limits-form"
          key={JSON.stringify(limits.data)}
          className="mm-form"
          onSubmit={(e) => void submit(e)}
        >
          <h3>每用户限额</h3>
          <label>
            每个用户同时进行中的调用上限
            <input
              name="perUserConcurrency"
              type="number"
              min={1}
              placeholder="不限"
              defaultValue={limits.data.perUserConcurrency ?? ''}
            />
          </label>
          <label>
            每个用户每分钟调用上限
            <input
              name="perUserRpm"
              type="number"
              min={1}
              placeholder="不限"
              defaultValue={limits.data.perUserRpm ?? ''}
            />
          </label>
          <p className="hint">超出时这次调用按「模型暂时不可用」返回给用户。</p>
          <h3>账号健康</h3>
          <label>
            连续失败几次后自动暂停
            <input
              name="failureThreshold"
              type="number"
              min={1}
              max={100}
              required
              defaultValue={limits.data.failureThreshold}
            />
          </label>
          <label>
            暂停多少秒后再试
            <input
              name="cooldownSeconds"
              type="number"
              min={10}
              max={86400}
              required
              defaultValue={limits.data.cooldownSeconds}
            />
          </label>
        </form>
      )}
      <Feedback message={message} error={error || limits.error} />
    </Drawer>
  );
}

// ---------- 模型（9.5） ----------

type UseFilter = 'all' | 'chat' | 'background' | 'adult' | 'vision' | 'voice';
function matchesUse(m: AdminModel, use: UseFilter) {
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
    rates: m.rates,
    costRates: m.costRates,
    ...(m.routes?.length ? { routes: m.routes } : {}),
  };
}

export function LeaderboardSourceEditor() {
  const remote = useRemote(ModelAccessAdminEndpoints.getLeaderboardSource);
  const [form, setForm] = useState({
    label: '',
    url: 'https://arena.ai/leaderboard/chat/text',
    asOf: '',
  });
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const toast = useToast();
  useEffect(() => {
    if (remote.data) setForm({ ...remote.data, asOf: remote.data.asOf ?? '' });
  }, [remote.data]);
  async function save(event: FormEvent) {
    event.preventDefault();
    setPending(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.updateLeaderboardSource, {
        body: { ...form, asOf: form.asOf || null },
      });
      remote.refresh();
      toast.show('榜单来源已保存');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <form className="mm-panel" onSubmit={(e) => void save(e)}>
      <h3>用户模型榜单来源</h3>
      <p className="hint">
        名次使用下方模型的排行榜名次；来源仅支持Arena官方HTTPS链接，不自动抓取榜单。热门人数由真实全局聊天选择统计。
      </p>
      <label>
        来源名称
        <input
          required
          maxLength={80}
          value={form.label}
          onChange={(e) => setForm({ ...form, label: e.target.value })}
        />
      </label>
      <label>
        官方链接
        <input
          required
          type="url"
          value={form.url}
          onChange={(e) => setForm({ ...form, url: e.target.value })}
        />
      </label>
      <label>
        参考日期
        <input
          type="date"
          value={form.asOf}
          onChange={(e) => setForm({ ...form, asOf: e.target.value })}
        />
      </label>
      <Feedback error={error || remote.error} />
      {toast.node}
      <button type="submit" disabled={pending || remote.loading}>
        保存榜单来源
      </button>
      <button
        type="button"
        disabled={pending}
        onClick={() => {
          setForm(
            remote.data
              ? { ...remote.data, asOf: remote.data.asOf ?? '' }
              : { label: '', url: 'https://arena.ai/leaderboard/chat/text', asOf: '' },
          );
          setError('');
        }}
      >
        取消修改
      </button>
    </form>
  );
}

function ModelsTab({
  models,
  upstreams,
  refresh,
}: {
  models: AdminModel[];
  upstreams: Upstream[];
  refresh(): void;
}) {
  const [use, setUse] = useState<UseFilter>('all');
  const [status, setStatus] = useState<'all' | 'on' | 'off'>('all');
  const [editing, setEditing] = useState<AdminModel | 'new' | null>(null);
  const [offline, setOffline] = useState<AdminModel | null>(null);
  const [error, setError] = useState('');
  const toast = useToast();
  const list = models
    .filter((m) => matchesUse(m, use))
    .filter((m) => status === 'all' || (status === 'on' ? m.enabled : !m.enabled))
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const upstreamName = (id: string) =>
    upstreams.find((u) => u.upstreamId === id)?.name ?? '未知账号';
  async function setEnabled(m: AdminModel, enabled: boolean) {
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.upsertModel, {
        params: { modelKey: encodeURIComponent(m.modelKey) },
        body: { ...toWrite(m), enabled },
      });
      toast.show(enabled ? '已上架' : '已下架');
      refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }
  return (
    <section className="mm-section">
      <LeaderboardSourceEditor />
      <div className="mm-toolbar">
        <button type="button" className="primary" onClick={() => setEditing('new')}>
          + 添加模型
        </button>
        <span className="mm-inline">
          用途
          <Segmented<UseFilter>
            items={[
              ['all', '全部'],
              ['chat', '聊天'],
              ['background', '后台'],
              ['adult', '成人模式'],
              ['vision', '识图'],
              ['voice', '语音'],
            ]}
            value={use}
            onChange={setUse}
          />
        </span>
        <span className="mm-inline">
          状态
          <Segmented<'all' | 'on' | 'off'>
            items={[
              ['all', '全部'],
              ['on', '上架'],
              ['off', '下架'],
            ]}
            value={status}
            onChange={setStatus}
          />
        </span>
        <span className="mm-spacer" />
        <Link className="link-text" to="/prices">
          价目表版本 ›
        </Link>
      </div>
      <Feedback error={error} />
      <table className="mm-table">
        <thead>
          <tr>
            <th>显示名</th>
            <th>上游账号（按优先级）</th>
            <th>能力</th>
            <th>默认给谁用</th>
            <th>售价（元/百万 token）</th>
            <th>约每条</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.map((m) => {
            const routes = [...(m.routes ?? [])].sort((a, b) => a.priority - b.priority);
            return (
              <tr key={m.modelKey}>
                <td>
                  {m.displayName}
                  <div className="hint mono">{m.modelKey}</div>
                </td>
                <td>
                  {(routes.length ? routes.map((r) => r.upstreamId) : [m.upstreamId])
                    .map(upstreamName)
                    .join(' → ')}
                </td>
                <td>
                  {['文字', ...m.capabilities.map((c) => capabilityLabels[c] ?? c)].join(' ')}
                </td>
                <td>{m.defaultFor.map((d) => defaultForLabels[d] ?? d).join('、') || '—'}</td>
                <td>
                  {m.rates
                    ? `入 ${m.rates.input.toFixed(2)} / 出 ${m.rates.output.toFixed(2)} / 缓存 ${m.rates.cache.toFixed(2)}`
                    : '非 token 计价'}
                  {m.hasTimeBands && <span className="tag warning"> 分时价</span>}
                </td>
                <td>{m.pointsPerReply == null ? '—' : `${pts(m.pointsPerReply)} 积分`}</td>
                <td>
                  <span className={`tag ${m.enabled ? 'success' : ''}`}>
                    {m.enabled ? '上架' : '下架'}
                  </span>
                </td>
                <td className="mm-actions">
                  <button type="button" className="link-text" onClick={() => setEditing(m)}>
                    编辑
                  </button>
                  {m.enabled ? (
                    <button type="button" className="danger-text" onClick={() => setOffline(m)}>
                      下架
                    </button>
                  ) : (
                    <button
                      type="button"
                      className="link-text"
                      onClick={() => void setEnabled(m, true)}
                    >
                      上架
                    </button>
                  )}
                </td>
              </tr>
            );
          })}
          {list.length === 0 && (
            <tr>
              <td colSpan={8} className="mm-empty">
                没有符合条件的模型
              </td>
            </tr>
          )}
        </tbody>
      </table>
      {editing && (
        <ModelWizard
          model={editing === 'new' ? null : editing}
          upstreams={upstreams}
          onClose={() => setEditing(null)}
          onSaved={() => {
            setEditing(null);
            toast.show('已保存，价目表已自动更新');
            refresh();
          }}
        />
      )}
      {offline && (
        <Confirm
          text="下架后，正在用这个模型的角色会改用默认模型"
          confirmLabel="下架"
          danger
          onClose={() => setOffline(null)}
          onConfirm={() => void setEnabled(offline, false)}
        />
      )}
      {toast.node}
    </section>
  );
}

function ratesFrom(form: FormData, prefix: string): ModelRates | null {
  const input = String(form.get(`${prefix}input`) ?? '').trim();
  const output = String(form.get(`${prefix}output`) ?? '').trim();
  const cache = String(form.get(`${prefix}cache`) ?? '').trim();
  if (!input && !output && !cache) return null;
  return { input: Number(input || 0), output: Number(output || 0), cache: Number(cache || 0) };
}

function ModelWizard({
  model,
  upstreams,
  onClose,
  onSaved,
}: {
  model: AdminModel | null;
  upstreams: Upstream[];
  onClose(): void;
  onSaved(): void;
}) {
  const initialRoutes: ModelRoute[] = model?.routes?.length
    ? [...model.routes].sort((a, b) => a.priority - b.priority)
    : model
      ? [
          {
            upstreamId: model.upstreamId,
            upstreamModelId: model.upstreamModelId,
            priority: 1,
            weight: 100,
            enabled: true,
          },
        ]
      : [
          {
            upstreamId: upstreams[0]?.upstreamId ?? '',
            upstreamModelId: '',
            priority: 1,
            weight: 100,
            enabled: true,
          },
        ];
  const [routes, setRoutes] = useState<ModelRoute[]>(initialRoutes);
  const [remote, setRemote] = useState<{ id: string; items: string[] | null; error: string }>({
    id: '',
    items: null,
    error: '',
  });
  const [modelKey, setModelKey] = useState(model?.modelKey ?? '');
  const [capabilities, setCapabilities] = useState<string[]>(model?.capabilities ?? []);
  const [defaultFor, setDefaultFor] = useState<string[]>(model?.defaultFor ?? []);
  const [showCost, setShowCost] = useState(false);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [confirmBands, setConfirmBands] = useState<FormData | null>(null);
  const first = routes[0];
  useEffect(() => {
    const id = first?.upstreamId;
    if (!id || remote.id === id) return;
    let active = true;
    setRemote({ id, items: null, error: '' });
    void api
      .call(ModelAccessAdminEndpoints.listUpstreamModels, { params: { upstreamId: id } })
      .then((r) => active && setRemote({ id, items: r.items.map((i) => i.id), error: '' }))
      .catch(
        (e) =>
          active &&
          setRemote({
            id,
            items: [],
            error:
              e instanceof ApiFailure && e.code === 'upstream_test_failed'
                ? '拉不到这个账号的模型列表，请手填模型名'
                : errorText(e),
          }),
      );
    return () => {
      active = false;
    };
  }, [first?.upstreamId, remote.id]);
  const patchRoute = (index: number, patch: Partial<ModelRoute>) =>
    setRoutes((list) => list.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const move = (index: number, delta: number) =>
    setRoutes((list) => {
      const next = [...list];
      const [item] = next.splice(index, 1);
      next.splice(Math.max(0, Math.min(next.length, index + delta)), 0, item!);
      return next.map((r, i) => ({ ...r, priority: i + 1 }));
    });
  async function save(form: FormData) {
    const ordered = routes.map((r, i) => ({ ...r, priority: r.priority || i + 1 }));
    const primary = ordered[0]!;
    const rates = ratesFrom(form, 'r_');
    const cost = showCost ? ratesFrom(form, 'c_') : null;
    const key = (model?.modelKey ?? modelKey).trim();
    setPending(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.upsertModel, {
        params: { modelKey: encodeURIComponent(key) },
        body: {
          modelKey: key,
          displayName: String(form.get('displayName')),
          vendorName: String(form.get('vendorName')),
          upstreamId: primary.upstreamId,
          upstreamModelId: primary.upstreamModelId,
          capabilities: capabilities as AdminModel['capabilities'],
          tags: String(form.get('tags') ?? '')
            .split(/[,，、\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 10),
          leaderboardRank: model?.leaderboardRank ?? null,
          sortOrder: Number(form.get('sortOrder') || model?.sortOrder || 0),
          defaultFor: defaultFor as AdminModel['defaultFor'],
          enabled: model ? model.enabled : true,
          rates,
          ...(cost ? { costRates: cost } : {}),
          routes: ordered,
        },
      });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  const toggle = (list: string[], set: (v: string[]) => void, value: string) =>
    set(list.includes(value) ? list.filter((v) => v !== value) : [...list, value]);
  return (
    <Drawer
      title={model ? `编辑模型 · ${model.displayName}` : '添加模型'}
      onClose={onClose}
      footer={
        <button type="submit" form="model-form" className="primary" disabled={pending}>
          {model ? '保存' : '保存并上架'}
        </button>
      }
    >
      <form
        id="model-form"
        className="mm-form"
        onSubmit={(event) => {
          event.preventDefault();
          const form = new FormData(event.currentTarget);
          if (model?.hasTimeBands && ratesFrom(form, 'r_')) setConfirmBands(form);
          else void save(form);
        }}
      >
        <h3>① 上游账号（按顺序切换）</h3>
        {routes.map((r, index) => (
          <div key={index} className="mm-route">
            <select
              value={r.upstreamId}
              aria-label="上游账号"
              onChange={(e) => patchRoute(index, { upstreamId: e.target.value })}
            >
              {upstreams.map((u) => (
                <option key={u.upstreamId} value={u.upstreamId}>
                  {u.name}
                  {upstreamState(u) !== 'normal' ? `（${stateLabels[upstreamState(u)]}）` : ''}
                </option>
              ))}
            </select>
            {index > 0 && (
              <input
                aria-label="该账号的模型名"
                placeholder="该账号的模型名"
                value={r.upstreamModelId}
                onChange={(e) => patchRoute(index, { upstreamModelId: e.target.value })}
              />
            )}
            <input
              type="number"
              aria-label="权重"
              title="权重"
              min={1}
              max={1000}
              value={r.weight}
              onChange={(e) => patchRoute(index, { weight: Number(e.target.value) || 1 })}
            />
            <label className="check">
              <input
                type="checkbox"
                checked={r.enabled}
                onChange={(e) => patchRoute(index, { enabled: e.target.checked })}
              />
              启用
            </label>
            <button
              type="button"
              onClick={() => move(index, -1)}
              disabled={index === 0}
              aria-label="上移"
            >
              ↑
            </button>
            <button
              type="button"
              onClick={() => setRoutes((list) => list.filter((_, i) => i !== index))}
              disabled={routes.length === 1}
              aria-label="移除"
            >
              ✕
            </button>
          </div>
        ))}
        <button
          type="button"
          onClick={() =>
            setRoutes((list) => [
              ...list,
              {
                upstreamId:
                  upstreams.find((u) => !list.some((r) => r.upstreamId === u.upstreamId))
                    ?.upstreamId ??
                  upstreams[0]?.upstreamId ??
                  '',
                upstreamModelId: list[0]?.upstreamModelId ?? '',
                priority: list.length + 1,
                weight: 100,
                enabled: true,
              },
            ])
          }
        >
          + 再加一个备用账号
        </button>
        <h3>② 模型</h3>
        {remote.items && remote.items.length > 0 ? (
          <label>
            从第一个账号拉取的模型
            <select
              value={first?.upstreamModelId ?? ''}
              onChange={(e) => {
                patchRoute(0, { upstreamModelId: e.target.value });
                if (!model && !modelKey) setModelKey(e.target.value);
              }}
            >
              <option value="">请选择</option>
              {remote.items.map((id) => (
                <option key={id} value={id}>
                  {id}
                </option>
              ))}
            </select>
          </label>
        ) : (
          <label>
            模型名（上游那边的叫法）
            <input
              required
              value={first?.upstreamModelId ?? ''}
              onChange={(e) => patchRoute(0, { upstreamModelId: e.target.value })}
            />
          </label>
        )}
        {remote.error && <p className="hint">{remote.error}</p>}
        {!remote.items && first?.upstreamId && <p className="hint">正在拉取模型列表…</p>}
        <h3>③ 显示与用途</h3>
        {!model && (
          <label>
            模型键（内部唯一，保存后不可改）
            <input
              required
              value={modelKey}
              maxLength={80}
              placeholder="例：mimo/mimo-pro"
              onChange={(e) => setModelKey(e.target.value)}
            />
          </label>
        )}
        <div className="mm-two">
          <label>
            显示名
            <input
              name="displayName"
              required
              maxLength={60}
              defaultValue={model?.displayName ?? ''}
            />
          </label>
          <label>
            出品方
            <input
              name="vendorName"
              required
              maxLength={40}
              defaultValue={model?.vendorName ?? ''}
            />
          </label>
        </div>
        <div className="mm-field">
          <span>能力</span>
          <div className="mm-checks">
            {Object.entries(capabilityLabels).map(([value, label]) => (
              <label key={value} className="check">
                <input
                  type="checkbox"
                  checked={capabilities.includes(value)}
                  onChange={() => toggle(capabilities, setCapabilities, value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="mm-field">
          <span>默认给谁用（可都不选）</span>
          <div className="mm-checks">
            {Object.entries(defaultForLabels).map(([value, label]) => (
              <label key={value} className="check">
                <input
                  type="checkbox"
                  checked={defaultFor.includes(value)}
                  onChange={() => toggle(defaultFor, setDefaultFor, value)}
                />
                {label}
              </label>
            ))}
          </div>
        </div>
        <div className="mm-two">
          <label>
            标签（逗号分隔）
            <input name="tags" defaultValue={model?.tags.join('，') ?? ''} />
          </label>
          <label>
            排序
            <input name="sortOrder" type="number" defaultValue={model?.sortOrder ?? 0} />
          </label>
        </div>
        <h3>④ 售价（元 / 百万 token，1 元 = 100 积分）</h3>
        <div className="mm-three">
          <label>
            输入
            <input
              name="r_input"
              type="number"
              step="0.0001"
              min={0}
              defaultValue={model?.rates?.input ?? ''}
            />
          </label>
          <label>
            输出
            <input
              name="r_output"
              type="number"
              step="0.0001"
              min={0}
              defaultValue={model?.rates?.output ?? ''}
            />
          </label>
          <label>
            缓存命中输入
            <input
              name="r_cache"
              type="number"
              step="0.0001"
              min={0}
              defaultValue={model?.rates?.cache ?? ''}
            />
          </label>
        </div>
        <p className="hint">
          {model?.pointsPerReply != null
            ? `当前约每条 ${pts(model.pointsPerReply)} 积分；保存后按新售价自动重算。`
            : '保存后按「标准回复」自动算出约每条积分。'}
          三项都不填 = 不改价目表（语音、图片等非 token 计价模型在「价目表版本」里维护）。
        </p>
        <button type="button" className="link-text" onClick={() => setShowCost((v) => !v)}>
          {showCost ? '收起成本价' : '展开成本价（不填 = 同售价）'}
        </button>
        {showCost && (
          <div className="mm-three">
            <label>
              成本 · 输入
              <input
                name="c_input"
                type="number"
                step="0.0001"
                min={0}
                defaultValue={model?.costRates?.input ?? ''}
              />
            </label>
            <label>
              成本 · 输出
              <input
                name="c_output"
                type="number"
                step="0.0001"
                min={0}
                defaultValue={model?.costRates?.output ?? ''}
              />
            </label>
            <label>
              成本 · 缓存
              <input
                name="c_cache"
                type="number"
                step="0.0001"
                min={0}
                defaultValue={model?.costRates?.cache ?? ''}
              />
            </label>
          </div>
        )}
        <Feedback error={error} />
      </form>
      {confirmBands && (
        <Confirm
          text="这个模型现在有分时价，按倍率保存后会变成全天统一价。继续保存？"
          confirmLabel="保存"
          onClose={() => setConfirmBands(null)}
          onConfirm={() => void save(confirmBands)}
        />
      )}
    </Drawer>
  );
}

// ---------- 调用记录（9.6） ----------

function toLocalInput(iso: string) {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}
function fromLocalInput(value: string) {
  return new Date(`${value}:00+08:00`).toISOString();
}

function RecordsTab({
  upstreams,
  models,
  initial,
}: {
  upstreams: Upstream[];
  models: AdminModel[];
  initial: { upstreamId: string; modelKey: string; status: '' | 'failed' };
}) {
  const start = rangeOf('7d');
  const [form, setForm] = useState({
    from: toLocalInput(start.from),
    to: toLocalInput(start.to),
    userId: '',
    characterId: '',
    modelKey: initial.modelKey,
    upstreamId: initial.upstreamId,
    purpose: '',
    status: initial.status as '' | 'succeeded' | 'failed',
  });
  const [applied, setApplied] = useState(form);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<{ items: AdminUsageRecord[]; nextCursor: string | null }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AdminUsageRecord | null>(null);
  const filter = useMemo<AdminUsageFilter>(
    () => ({
      from: fromLocalInput(applied.from),
      to: fromLocalInput(applied.to),
      ...(applied.userId.trim()
        ? { userIds: applied.userId.split(/[,，\s]+/).filter(Boolean) }
        : {}),
      ...(applied.characterId.trim()
        ? { characterIds: applied.characterId.split(/[,，\s]+/).filter(Boolean) }
        : {}),
      ...(applied.modelKey ? { modelKeys: [applied.modelKey] } : {}),
      ...(applied.upstreamId ? { upstreamIds: [applied.upstreamId] } : {}),
      ...(applied.purpose ? { purposes: [applied.purpose as never] } : {}),
      ...(applied.status ? { status: applied.status } : {}),
    }),
    [applied],
  );
  const cursor = cursors.at(-1);
  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .call(ModelAccessAdminUsageEndpoints.listUsageRecords, {
        body: { filter, limit: 50, ...(cursor ? { cursor } : {}) },
      })
      .then((r) => active && setPage(r))
      .catch((e) => active && setError(errorText(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [filter, cursor]);
  const upstreamName = (id: string) =>
    upstreams.find((u) => u.upstreamId === id)?.name ?? '未知账号';
  const modelName = (key: string) => models.find((m) => m.modelKey === key)?.displayName ?? key;
  async function exportCsv() {
    setError('');
    try {
      const r = await api.call(ModelAccessAdminUsageEndpoints.exportUsageRecords, {
        body: { filter },
      });
      const header = [
        '时间(北京)',
        '用户',
        '角色',
        '用途',
        '模型',
        '上游账号',
        '实际上游模型',
        '输入token',
        '缓存token',
        '输出token',
        '耗时ms',
        '上游成本(元)',
        '用户扣除(积分)',
        '状态',
        '错误类型',
      ];
      const lines = r.items.map((x) =>
        [
          bjTime(x.createdAt),
          x.userId,
          x.characterId ?? '',
          purposeLabels[x.purpose] ?? x.purpose,
          x.modelKey,
          upstreamName(x.upstreamId),
          x.upstreamModelId ?? '',
          x.inputTokens,
          x.cachedInputTokens,
          x.outputTokens,
          x.latencyMs,
          (x.costMicros / 1_000_000).toFixed(4),
          (x.chargedPoints ?? x.chargedMicros / 10_000).toFixed(2),
          x.status === 'succeeded' ? '成功' : '失败',
          x.errorCode ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
      const blob = new Blob(['﻿' + [header.join(','), ...lines].join('\n')], {
        type: 'text/csv;charset=utf-8',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `调用记录-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      if (r.truncated) setError('结果太多，只导出了前 50,000 行，请缩小筛选范围');
    } catch (e) {
      setError(errorText(e));
    }
  }
  const set = (key: keyof typeof form) => (e: { target: { value: string } }) =>
    setForm((f) => ({ ...f, [key]: e.target.value }));
  return (
    <section className="mm-section">
      <form
        className="mm-filter-panel"
        onSubmit={(e) => {
          e.preventDefault();
          setApplied(form);
          setCursors([undefined]);
        }}
      >
        <label>
          开始（北京时间）
          <input type="datetime-local" value={form.from} onChange={set('from')} required />
        </label>
        <label>
          结束
          <input type="datetime-local" value={form.to} onChange={set('to')} required />
        </label>
        <label>
          用户 ID
          <input value={form.userId} onChange={set('userId')} placeholder="可多个，逗号分隔" />
        </label>
        <label>
          角色 ID
          <input value={form.characterId} onChange={set('characterId')} placeholder="可多个" />
        </label>
        <label>
          模型
          <select value={form.modelKey} onChange={set('modelKey')}>
            <option value="">全部</option>
            {models.map((m) => (
              <option key={m.modelKey} value={m.modelKey}>
                {m.displayName}
              </option>
            ))}
          </select>
        </label>
        <label>
          上游账号
          <select value={form.upstreamId} onChange={set('upstreamId')}>
            <option value="">全部</option>
            {upstreams.map((u) => (
              <option key={u.upstreamId} value={u.upstreamId}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          用途
          <select value={form.purpose} onChange={set('purpose')}>
            <option value="">全部</option>
            {Object.entries(purposeLabels).map(([k, v]) => (
              <option key={k} value={k}>
                {v}
              </option>
            ))}
          </select>
        </label>
        <label>
          状态
          <select value={form.status} onChange={set('status')}>
            <option value="">全部</option>
            <option value="succeeded">成功</option>
            <option value="failed">失败</option>
          </select>
        </label>
        <div className="mm-filter-actions">
          <button className="primary">查询</button>
          <button type="button" onClick={() => void exportCsv()}>
            导出 CSV
          </button>
        </div>
      </form>
      <Feedback error={error} />
      <div className="scroll">
        <table className="mm-table records">
          <thead>
            <tr>
              <th>时间</th>
              <th>用户</th>
              <th>角色</th>
              <th>用途</th>
              <th>模型</th>
              <th>上游账号</th>
              <th>实际上游模型</th>
              <th>输入 token</th>
              <th>输出 token</th>
              <th>耗时</th>
              <th>上游成本</th>
              <th>用户扣除</th>
              <th>状态</th>
            </tr>
          </thead>
          <tbody>
            {page?.items.map((x) => (
              <tr
                key={x.usageRecordId}
                className={`clickable-row ${x.status === 'failed' ? 'failed-row' : ''}`}
                onClick={() => setDetail(x)}
              >
                <td>{bjTime(x.createdAt)}</td>
                <td className="mono ellipsis">{x.userId}</td>
                <td className="mono ellipsis">{x.characterId ?? '—'}</td>
                <td>{purposeLabels[x.purpose] ?? x.purpose}</td>
                <td>{modelName(x.modelKey)}</td>
                <td>{upstreamName(x.upstreamId)}</td>
                <td className="mono">{x.upstreamModelId ?? '—'}</td>
                <td>{nf.format(x.inputTokens)}</td>
                <td>{nf.format(x.outputTokens)}</td>
                <td>{nf.format(x.latencyMs)} ms</td>
                <td>
                  {yuan(x.costMicros, 4)}（已核部分）{x.costKnown !== true ? ' · 待核' : ''}
                </td>
                <td>{(x.chargedPoints ?? 0).toFixed(2)} 积分</td>
                <td>
                  {x.status === 'succeeded'
                    ? '成功'
                    : (errorLabels[x.errorCode ?? ''] ?? x.errorCode ?? '失败')}
                </td>
              </tr>
            ))}
            {!loading && page?.items.length === 0 && (
              <tr>
                <td colSpan={13} className="mm-empty">
                  这段时间没有调用
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
      <div className="mm-pager">
        <button
          type="button"
          disabled={cursors.length <= 1 || loading}
          onClick={() => setCursors((c) => c.slice(0, -1))}
        >
          上一页
        </button>
        <span className="hint">第 {cursors.length} 页 · 每页 50 条</span>
        <button
          type="button"
          disabled={!page?.nextCursor || loading}
          onClick={() => setCursors((c) => [...c, page!.nextCursor!])}
        >
          下一页
        </button>
      </div>
      {detail && (
        <Drawer title="调用详情" onClose={() => setDetail(null)}>
          <dl className="mm-dl">
            <dt>时间</dt>
            <dd>{bjTime(detail.createdAt)}</dd>
            <dt>调用 ID</dt>
            <dd className="mono">{detail.usageRecordId}</dd>
            <dt>用户</dt>
            <dd className="mono">{detail.userId}</dd>
            <dt>角色</dt>
            <dd className="mono">{detail.characterId ?? '—'}</dd>
            <dt>会话类型</dt>
            <dd>
              {detail.conversationKind === 'group'
                ? '群聊'
                : detail.conversationKind === 'direct'
                  ? '私聊'
                  : '—'}
            </dd>
            <dt>用途</dt>
            <dd>{purposeLabels[detail.purpose] ?? detail.purpose}</dd>
            <dt>谁付费</dt>
            <dd>{detail.billingOwner === 'platform' ? '平台' : '用户'}</dd>
            <dt>模型 / 上游</dt>
            <dd>
              {modelName(detail.modelKey)} · {upstreamName(detail.upstreamId)} ·{' '}
              <span className="mono">{detail.upstreamModelId ?? '—'}</span>
            </dd>
            <dt>token</dt>
            <dd>
              输入 {nf.format(detail.inputTokens)}（缓存 {nf.format(detail.cachedInputTokens)}）·
              输出 {nf.format(detail.outputTokens)}
              {detail.estimated ? '（估算）' : ''}
            </dd>
            <dt>耗时</dt>
            <dd>
              {detail.latencyMs} ms{detail.ttftMs != null ? ` · 首字 ${detail.ttftMs} ms` : ''} ·
              重试 {detail.retryCount} 次
            </dd>
            <dt>上游已核成本</dt>
            <dd>
              {yuan(detail.costMicros, 4)}
              {detail.costKnown !== true ? '（仅已核部分，仍待核）' : ''}
            </dd>
            <dt>待核风险上限（不计实际成本）</dt>
            <dd>{yuan(detail.uncertainCostMicros ?? 0, 4)}</dd>
            <dt>用户扣除</dt>
            <dd>
              {(detail.chargedPoints ?? 0).toFixed(2)} 积分（≈ {yuan(detail.chargedMicros, 4)}）
              {detail.absorbedCostMicros ? ` · 平台吸收 ${yuan(detail.absorbedCostMicros, 4)}` : ''}
              {detail.safetyOverdraft ? ' · 动用安全透支' : ''}
            </dd>
            <dt>状态</dt>
            <dd className={detail.status === 'failed' ? 'danger-text' : ''}>
              {detail.status === 'succeeded'
                ? '成功'
                : `失败 · ${errorLabels[detail.errorCode ?? ''] ?? detail.errorCode ?? ''}`}
            </dd>
          </dl>
          <p className="hint">为保护隐私，这里不显示消息原文。</p>
        </Drawer>
      )}
    </section>
  );
}
