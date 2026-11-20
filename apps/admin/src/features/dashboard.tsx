import { lazy, Suspense, useState, type ReactNode } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Button, Empty, Segmented, Skeleton, Spin, Tooltip } from 'antd';
import { ArrowRightIcon, ArrowClockwiseIcon } from '@phosphor-icons/react';
import {
  ModelAccessAdminEndpoints,
  RoleRequestAdminEndpoints,
  SupportAdminEndpoints,
} from '@weiban/contracts';
import type { EChartsOption } from 'echarts';
import { useAppearance } from '../app/appearance.js';
import { useTodos } from '../app/todos.js';
import { useRemote } from '../data/hooks.js';
import { useAsync } from '../data/use-async.js';
import {
  beijingDayKey,
  formatDateTime,
  formatInt,
  formatPercent,
  formatYuan,
  yuanOf,
} from '../ui/format.js';
import { StatusTag } from '../ui/page.js';
import { upstreamState } from './model/shared.js';
import { loadDashboard, type DashboardData } from './dashboard-data.js';

type Metric = 'chargedMicros' | 'calls' | 'costMicros';
type SortMetric = 'calls' | 'chargedMicros';
type Feed = 'issues' | 'tickets' | 'requests';

const DAY_MS = 86_400_000;
const METRIC_LABELS = { chargedMicros: '计费 ¥', calls: '调用量', costMicros: '成本 ¥' };
const MONEY_AXIS = new Intl.NumberFormat('zh-CN', { maximumFractionDigits: 4 });
const SHORT_NUMBER = new Intl.NumberFormat('zh-CN', {
  notation: 'compact',
  maximumFractionDigits: 1,
});
const BEIJING_TIME = new Intl.DateTimeFormat('sv-SE', {
  timeZone: 'Asia/Shanghai',
  year: 'numeric',
  month: '2-digit',
  day: '2-digit',
  hour: '2-digit',
  minute: '2-digit',
});

const WeibanChart = lazy(() =>
  import('../ui/weiban-chart.js').then((m) => ({ default: m.WeibanChart })),
);
const IssueDrawer = lazy(() =>
  import('./client-logs.js').then((m) => ({ default: m.IssueDrawer })),
);
const TicketDrawer = lazy(() => import('./support.js').then((m) => ({ default: m.TicketDrawer })));
const RequestDrawer = lazy(() =>
  import('./role-requests.js').then((m) => ({ default: m.RequestDrawer })),
);

const FEED_LINK = {
  issues: '/client-logs?status=open',
  tickets: '/support',
  requests: '/role-requests?status=completed',
};
const formatMetric = (metric: Metric, value: number) =>
  metric === 'calls' ? formatInt(value) : formatYuan(value);

function chartPalette(dark: boolean) {
  return {
    muted: dark ? '#9ca3af' : '#475569',
    faint: dark ? '#858e9d' : '#64748b',
    line: dark ? 'rgba(255,255,255,0.09)' : '#e2e8f0',
    green: dark ? '#34d399' : '#047857',
    tooltip: {
      textStyle: { color: dark ? '#f3f4f6' : '#0f172a' },
      borderColor: dark ? '#334155' : '#cbd5e1',
      backgroundColor: dark ? '#151b28' : '#ffffff',
      renderMode: 'richText' as const,
      confine: true,
    },
  };
}

function chartGradient(vertical = true) {
  return {
    type: 'linear' as const,
    x: 0,
    y: 0,
    x2: vertical ? 0 : 1,
    y2: vertical ? 1 : 0,
    colorStops: vertical
      ? [
          { offset: 0, color: 'rgba(16,185,129,0.34)' },
          { offset: 1, color: 'rgba(16,185,129,0.02)' },
        ]
      : [
          { offset: 0, color: '#10b981' },
          { offset: 1, color: '#22d3ee' },
        ],
  };
}
function ChartState({
  loading,
  failed,
  empty,
}: {
  loading: boolean;
  failed?: boolean;
  empty: string;
}) {
  return loading ? (
    <div className="os-chart-state">
      <Skeleton active paragraph={{ rows: 3 }} />
    </div>
  ) : (
    <div className="os-chart-state">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={failed ? '读取失败，请刷新' : empty}
      />
    </div>
  );
}

export function DashboardPage() {
  const dashboard = useAsync('dashboard', loadDashboard);
  const { refresh } = useTodos();
  return (
    <div className="page os-dashboard">
      <h1 className="os-visually-hidden">工作台</h1>
      <div className="os-dashboard-top">
        <TrendCard
          data={dashboard.data}
          loading={dashboard.loading}
          onRefresh={() => {
            refresh();
            dashboard.refresh();
          }}
        />
        <HealthCard data={dashboard.data} />
      </div>
      <DashboardKpis data={dashboard.data} />
      <div className="os-dashboard-bottom">
        <TopModels data={dashboard.data} loading={dashboard.loading} />
        <OperationsFeed />
      </div>
    </div>
  );
}

function TrendCard({
  data,
  loading,
  onRefresh,
}: {
  data?: DashboardData;
  loading: boolean;
  onRefresh: () => void;
}) {
  const [metric, setMetric] = useState<Metric>('chargedMicros');
  const { mode } = useAppearance();
  const palette = chartPalette(mode === 'dark');
  const dates = data
    ? Array.from({ length: 30 }, (_, i) =>
        beijingDayKey(new Date(Date.parse(data.from) + i * DAY_MS).toISOString()),
      )
    : [];
  const totals = data?.trend?.totals;
  const byDay = new Map(data?.trend?.rows.map((row) => [row.keys[0], row]));
  const values = dates.map((day) => byDay.get(day)?.[metric] ?? 0);
  const previous = values.at(-3) ?? 0;
  const latest = values.at(-2) ?? 0;
  const change = previous > 0 ? (latest - previous) / previous : undefined;
  const recordedMargin =
    totals?.chargedMicros && totals.unknownCostCalls === 0
      ? (totals.chargedMicros - totals.costMicros) / totals.chargedMicros
      : undefined;
  const plotValues = metric === 'calls' ? values : values.map(yuanOf);

  const option: EChartsOption = {
    animation: false,
    grid: { left: 45, right: 13, top: 12, bottom: 30 },
    tooltip: {
      ...palette.tooltip,
      trigger: 'axis',
      valueFormatter: (value) =>
        metric === 'calls' ? formatInt(Number(value)) : '¥' + MONEY_AXIS.format(Number(value)),
    },
    xAxis: {
      type: 'category',
      boundaryGap: false,
      data: dates.map((date, i) => date.slice(5) + (i === dates.length - 1 ? '*' : '')),
      axisLabel: {
        color: palette.faint,
        showMaxLabel: true,
        hideOverlap: true,
        fontFamily: 'JetBrains Mono Variable',
        fontSize: 10,
      },
      axisLine: { lineStyle: { color: palette.line } },
      axisTick: { show: false },
    },
    yAxis: {
      type: 'value',
      min: 0,
      minInterval: metric === 'calls' ? 1 : undefined,
      splitNumber: 4,
      axisLabel: {
        color: palette.faint,
        fontFamily: 'JetBrains Mono Variable',
        fontSize: 10,
        formatter: (value: number) =>
          metric === 'calls' ? SHORT_NUMBER.format(value) : '¥' + SHORT_NUMBER.format(value),
      },
      splitLine: { lineStyle: { color: palette.line, type: 'dashed' } },
    },
    series: [
      {
        name: METRIC_LABELS[metric],
        type: 'line',
        smooth: 0.26,
        symbol: 'none',
        lineStyle: {
          width: 2,
          color: palette.green,
          shadowColor: 'rgba(16,185,129,0.4)',
          shadowBlur: 8,
        },
        itemStyle: { color: palette.green },
        areaStyle: { color: chartGradient() },
        data: [...plotValues.slice(0, -1), null],
      },
      {
        name: '未完结',
        type: 'line',
        lineStyle: { width: 2, type: 'dashed', color: palette.faint },
        itemStyle: { color: palette.faint },
        symbol: 'circle',
        symbolSize: 5,
        data: plotValues.map((value, index) => (index >= plotValues.length - 2 ? value : null)),
      },
    ],
  };

  return (
    <section className="weiban-hero-card" aria-labelledby="dashboard-trend">
      <div className="os-trend-header">
        <div className="os-trend-meta">
          <i className="os-status-dot" aria-hidden />
          <h2 id="dashboard-trend">30 日计费与流量趋势</h2>
          {data && (
            <time className="mono" dateTime={data.to}>
              {BEIJING_TIME.format(new Date(data.to))} CST
            </time>
          )}
        </div>
        <Tooltip title="刷新驾驶舱">
          <Button
            type="text"
            size="small"
            aria-label="刷新"
            loading={loading}
            onClick={onRefresh}
            icon={<ArrowClockwiseIcon size={16} />}
          />
        </Tooltip>
      </div>
      <div className="os-trend-amount">
        <strong className="mono">{totals ? formatMetric(metric, totals[metric]) : '—'}</strong>
        {totals && change !== undefined && (
          <span className={'os-kpi-chip ' + (change < 0 ? 'os-chip-warn' : 'os-chip-ok')}>
            {dates.at(-2)?.slice(5)} {change >= 0 ? '+' : ''}
            {formatPercent(change)}
          </span>
        )}
        <span>
          毛利率 <b className="mono">{formatPercent(recordedMargin)}</b>（成本{' '}
          <b className="mono">{totals ? formatYuan(totals.costMicros) : '—'}</b>）
        </span>
      </div>
      <div className="os-trend-caption">
        <Segmented<Metric>
          className="os-density-switch"
          size="small"
          aria-label="趋势指标"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'chargedMicros', label: '计费 ¥' },
            { value: 'calls', label: '调用量' },
            { value: 'costMicros', label: '成本 ¥' },
          ]}
        />
        <span>今日 * 尚未结束 · 环比按完整自然日</span>
      </div>
      {data?.trend ? (
        <Suspense fallback={<div className="os-trend-chart" aria-busy="true" />}>
          <WeibanChart
            className="os-trend-chart"
            option={option}
            label={'近 30 日按日' + METRIC_LABELS[metric] + '趋势图'}
          />
        </Suspense>
      ) : (
        <ChartState loading={loading} failed empty="暂无计费记录" />
      )}
      {!!totals?.unknownCostCalls && (
        <Link className="os-trend-link" to="/usage?view=records&quality=cost_pending&range=30d">
          {formatInt(totals.unknownCostCalls)} 笔成本待核 <ArrowRightIcon />
        </Link>
      )}
    </section>
  );
}

function HealthCard({ data }: { data?: DashboardData }) {
  const { counts, clientIssuesHasMore, partial } = useTodos();
  const totals = data?.trend?.totals;
  const successful = totals ? totals.calls - totals.failedCalls : undefined;
  const successRate = totals?.calls ? (successful ?? 0) / totals.calls : undefined;
  const issueCount = formatInt(counts.clientIssues) + (clientIssuesHasMore ? '+' : '');
  const upstreams = data?.upstreams;
  const up = upstreams?.filter((u) => upstreamState(u) === 'normal').length;
  const attention = Boolean(counts.clientIssues || counts.alerts);
  return (
    <section className="weiban-glass-card os-health-card" aria-labelledby="dashboard-health">
      <div>
        <div className="os-health-title">
          <h2 id="dashboard-health">系统健康与异常雷达</h2>
          {(attention || partial) && (
            <StatusTag tone="warning">{attention ? '需关注' : '部分读取失败'}</StatusTag>
          )}
        </div>
        <div className="os-health-summary">
          <div>
            <span>30 日模型尝试成功率</span>
            <strong className="mono">{formatPercent(successRate)}</strong>
          </div>
          <div className="os-health-totals mono">
            <span>成功 {formatInt(successful)}</span>
            <span>失败 {formatInt(totals?.failedCalls)}</span>
          </div>
        </div>
        <div className="os-health-meter" aria-hidden>
          {successRate !== undefined && <span style={{ width: successRate * 100 + '%' }} />}
          {successRate !== undefined && <span style={{ width: (1 - successRate) * 100 + '%' }} />}
        </div>
      </div>
      <div className="os-health-links">
        <Link to={FEED_LINK.issues} className={counts.clientIssues ? 'os-health-risk' : undefined}>
          <span>开放异常分组</span>
          <strong className="mono">{issueCount}</strong>
        </Link>
        <Link to="/model">
          <span>模型 / 启用</span>
          <strong className="mono">
            {formatInt(data?.models)} <small>/ {formatInt(data?.liveModels)}</small>
          </strong>
        </Link>
      </div>
      <div className="os-health-foot">
        <Link to="/usage?view=tasks&range=today">
          今日任务结果 <b className="mono">{formatInt(data?.tasks?.total)}</b>
        </Link>
        <Link to="/usage?view=tasks&range=today&rescued=1">
          备用救回 <b className="mono">{formatInt(data?.tasks?.rescued)}</b>
        </Link>
        <Link to="/usage?view=tasks&range=today&state=undelivered">
          未交付{' '}
          <b className="mono">
            {data?.tasks
              ? formatInt(data.tasks.states.find((s) => s.state === 'undelivered')?.count ?? 0)
              : '—'}
          </b>
        </Link>
        <Link to="/model?tab=upstreams">
          上游正常{' '}
          <b className="mono">
            {formatInt(up)} / {formatInt(upstreams?.length)}
          </b>
        </Link>
        <Link to="/support">
          待处理工单 <b className="mono">{formatInt(counts.support)}</b>
        </Link>
        <Link to="/reports">
          举报 <b className="mono">{formatInt(counts.reports)}</b>
        </Link>
      </div>
    </section>
  );
}

function DashboardKpis({ data }: { data?: DashboardData }) {
  const users = data?.users;
  const totals = data?.trend?.totals;
  return (
    <div className="os-dashboard-kpis">
      <Kpi
        to="/accounts"
        title="注册用户 / PRO+"
        badge={
          users && (
            <span className="os-kpi-chip os-chip-ok">
              PRO+ {formatPercent(users.totalUsers ? users.proPlusUsers / users.totalUsers : 0)}
            </span>
          )
        }
        value={
          <>
            {formatInt(users?.totalUsers)} <small>/ {formatInt(users?.proPlusUsers)}</small>
          </>
        }
        detail={
          <>7 天内会员到期 {formatInt(users?.expiringSoonCount ?? users?.expiringSoon.length)}</>
        }
      />
      <Kpi
        to="/usage?range=30d"
        title="30 日模型调用"
        value={formatInt(totals?.calls)}
        detail={
          <>
            {formatInt(totals?.failedCalls)} 次失败 · {formatInt(totals?.totalTokens)} tokens
          </>
        }
      />
      <Kpi
        to="/billing"
        title="30 日已记上游成本"
        value={totals ? formatYuan(totals.costMicros) : '—'}
        detail={<>其中平台吸收 {totals ? formatYuan(totals.absorbedCostMicros) : '—'}</>}
      />
      <Kpi
        to="/characters"
        title="内容与语音资产"
        value={
          <>
            {formatInt(data?.roles)} <small>预设角色</small>
          </>
        }
        detail={<>启用音色 {formatInt(data?.voices)}</>}
      />
    </div>
  );
}

function Kpi({
  to,
  title,
  badge,
  value,
  detail,
}: {
  to: string;
  title: string;
  badge?: ReactNode;
  value: ReactNode;
  detail: ReactNode;
}) {
  return (
    <Link className="weiban-glass-card os-kpi" to={to}>
      <span>
        {title}
        {badge}
      </span>
      <strong className="mono">{value}</strong>
      <small>{detail}</small>
    </Link>
  );
}

function TopModels({ data, loading }: { data?: DashboardData; loading: boolean }) {
  const [metric, setMetric] = useState<SortMetric>('calls');
  const { mode } = useAppearance();
  const navigate = useNavigate();
  const palette = chartPalette(mode === 'dark');
  const labels = useRemote(ModelAccessAdminEndpoints.modelLabels);
  const names = new Map(
    labels.data?.items.filter((m) => !m.deletedAt).map((m) => [m.modelKey, m.displayName]),
  );
  const top = [...(data?.rank?.rows ?? [])]
    .filter((row) => row[metric] > 0)
    .sort((a, b) => b[metric] - a[metric])
    .slice(0, 8);
  const paths = top.map(
    (row) => '/usage?view=records&range=30d&model=' + encodeURIComponent(row.keys[0] ?? ''),
  );
  const modelName = (key: string) => names.get(key) ?? key;
  const chart: EChartsOption = {
    animation: false,
    grid: { left: 130, right: 62, top: 6, bottom: 23 },
    tooltip: {
      ...palette.tooltip,
      trigger: 'item',
      valueFormatter: (value) =>
        formatMetric(metric, metric === 'calls' ? Number(value) : Number(value) * 1_000_000),
    },
    xAxis: {
      type: 'value',
      splitNumber: 4,
      axisLabel: { color: palette.faint, formatter: (value) => SHORT_NUMBER.format(value) },
      splitLine: { lineStyle: { color: palette.line, type: 'dashed' } },
    },
    yAxis: {
      type: 'category',
      inverse: true,
      data: top.map((row) => modelName(row.keys[0] ?? '')),
      axisLine: { show: false },
      axisTick: { show: false },
      axisLabel: { color: palette.muted, overflow: 'truncate', width: 118 },
    },
    series: [
      {
        type: 'bar',
        name: METRIC_LABELS[metric],
        barMaxWidth: 18,
        label: {
          show: true,
          position: 'right',
          fontFamily: 'JetBrains Mono Variable',
          fontSize: 11,
          color: palette.muted,
          formatter: ({ dataIndex }) => formatMetric(metric, top[dataIndex]?.[metric] ?? 0),
        },
        data: top.map((row, index) => ({
          value: metric === 'calls' ? row[metric] : yuanOf(row[metric]),
          itemStyle: {
            color: index === 0 ? chartGradient(false) : 'rgba(16,185,129,0.42)',
            borderRadius: [0, 5, 5, 0],
          },
        })),
      },
    ],
  };
  return (
    <section className="weiban-glass-card os-model-chart-card" aria-labelledby="dashboard-models">
      <div className="os-model-chart-head">
        <div>
          <h2 id="dashboard-models">30 日 Top 8 模型</h2>
          <span>
            {data?.rank?.truncated ? '结果有截断，以已返回模型排名' : '点击模型查看调用明细'}
          </span>
        </div>
        <Segmented<SortMetric>
          aria-label="模型排行口径"
          size="small"
          value={metric}
          onChange={setMetric}
          options={[
            { value: 'calls', label: '按调用量' },
            { value: 'chargedMicros', label: '按计费 ¥' },
          ]}
        />
      </div>
      {top.length ? (
        <>
          <Suspense fallback={<div className="os-top-model-chart" aria-busy="true" />}>
            <WeibanChart
              className="os-top-model-chart"
              option={chart}
              label="近 30 日模型横向排行图"
              onItemClick={(index) => {
                if (paths[index]) navigate(paths[index]);
              }}
            />
          </Suspense>
          <ul className="os-chart-links">
            {top.map((row, index) => (
              <li key={row.keys[0]}>
                <Link to={paths[index]!}>
                  {modelName(row.keys[0]!)} · {formatMetric(metric, row[metric])}
                </Link>
              </li>
            ))}
          </ul>
        </>
      ) : (
        <ChartState loading={loading} failed={!data?.rank} empty="暂无模型用量" />
      )}
    </section>
  );
}

function OperationsFeed() {
  const todos = useTodos();
  const [tab, setTab] = useState<Feed>('issues');
  const [open, setOpen] = useState<{ tab: Feed; id: string }>();
  const tickets = useRemote(SupportAdminEndpoints.list, { query: { limit: 5 } }, tab === 'tickets');
  const requests = useRemote(
    RoleRequestAdminEndpoints.list,
    { query: { status: 'completed', limit: 5 } },
    tab === 'requests',
  );
  const issues = [...(todos.clientIssues ?? [])]
    .sort((a, b) => b.totalCount - a.totalCount)
    .slice(0, 5);
  const rows =
    tab === 'issues'
      ? issues.map((item) => ({
          id: item.fingerprint,
          title: item.title,
          detail: item.appKind + ' · ' + formatDateTime(item.lastSeenAt),
          value: formatInt(item.totalCount) + ' 次',
        }))
      : tab === 'tickets'
        ? tickets.data?.items.map((item) => ({
            id: item.ticketId,
            title: item.kind === 'complaint' ? '投诉工单' : '反馈工单',
            detail: formatDateTime(item.createdAt),
            value:
              item.status === 'open' ? '待处理' : item.status === 'replied' ? '已回复' : '已解决',
          }))
        : requests.data?.items.map((item) => ({
            id: item.requestId,
            title: item.roleName,
            detail: formatDateTime(item.updatedAt),
            value: '已完成',
          }));
  const loading =
    tab === 'issues' ? todos.loading : tab === 'tickets' ? tickets.loading : requests.loading;
  const failed =
    tab === 'issues' ? !todos.clientIssues : tab === 'tickets' ? !!tickets.error : !!requests.error;
  const close = () => setOpen(undefined);
  const refresh = () => {
    if (tab === 'issues') todos.refresh();
    if (tab === 'tickets') tickets.refresh();
    if (tab === 'requests') requests.refresh();
  };
  return (
    <section className="weiban-glass-card os-operations-feed" aria-label="运营分流">
      <div className="os-feed-head">
        <Segmented<Feed>
          aria-label="运营动态"
          size="small"
          value={tab}
          onChange={setTab}
          options={[
            { value: 'issues', label: '高频异常' },
            { value: 'tickets', label: '近期工单' },
            { value: 'requests', label: '已完成申请' },
          ]}
        />
        <Link to={FEED_LINK[tab]}>
          全部 <ArrowRightIcon size={13} />
        </Link>
      </div>
      {loading ? (
        <Skeleton active className="os-feed-skeleton" paragraph={{ rows: 3 }} />
      ) : rows?.length ? (
        <div className="os-feed-rows">
          {rows.map((row) => (
            <button type="button" key={row.id} onClick={() => setOpen({ tab, id: row.id })}>
              <span>
                <strong>{row.title}</strong>
                <small>{row.detail}</small>
              </span>
              <b className="mono">{row.value}</b>
            </button>
          ))}
        </div>
      ) : (
        <Empty
          image={Empty.PRESENTED_IMAGE_SIMPLE}
          description={
            failed
              ? '读取失败'
              : tab === 'issues'
                ? '暂无开放异常'
                : tab === 'tickets'
                  ? '暂无工单'
                  : '暂无已完成申请'
          }
        >
          {failed && <Button onClick={refresh}>重试</Button>}
        </Empty>
      )}
      {open && (
        <Suspense
          fallback={
            <div className="os-feed-spinner">
              <Spin />
            </div>
          }
        >
          {open.tab === 'issues' && (
            <IssueDrawer fingerprint={open.id} onClose={close} onChanged={todos.refresh} />
          )}
          {open.tab === 'tickets' && (
            <TicketDrawer
              ticketId={open.id}
              onClose={close}
              onChanged={() => {
                tickets.refresh();
                todos.refresh();
              }}
            />
          )}
          {open.tab === 'requests' && (
            <RequestDrawer
              requestId={open.id}
              onClose={close}
              onChanged={() => {
                requests.refresh();
                todos.refresh();
              }}
            />
          )}
        </Suspense>
      )}
    </section>
  );
}
