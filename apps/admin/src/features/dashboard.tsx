import { useEffect, useState } from 'react';
import { Link } from 'react-router-dom';
import { Alert, Button, Segmented, Skeleton } from 'antd';
import {
  AlertOutlined,
  ArrowRightOutlined,
  CustomerServiceOutlined,
  FileProtectOutlined,
  ReloadOutlined,
  SkinOutlined,
  UserDeleteOutlined,
} from '@ant-design/icons';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  type AdminUsageOverview,
  type AdminUsageSummary,
  type Upstream,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { settle } from '../data/use-async.js';
import { Page, SectionCard, StatusTag } from '../ui/page.js';
import { TrendBars } from '../ui/chart.js';
import { beijingDayKey, formatInt, formatYuan, pointsOf, startOfBeijingDay } from '../ui/format.js';
import { useTodos, type TodoCounts } from '../app/todos.js';
import {
  ERROR_LABELS,
  upstreamReason,
  upstreamState,
  UPSTREAM_STATE_LABELS,
} from './model/shared.js';

interface DashboardData {
  overview?: AdminUsageOverview;
  yesterday?: AdminUsageSummary;
  trend?: AdminUsageSummary;
  upstreams?: Upstream[];
}

async function loadDashboard(): Promise<DashboardData> {
  const to = new Date().toISOString();
  const [overview, trend, upstreams, yesterday] = await Promise.all([
    settle(
      api.call(ModelAccessAdminUsageEndpoints.usageOverview, {
        body: { from: startOfBeijingDay(0), to },
      }),
    ),
    settle(
      api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: { filter: { from: startOfBeijingDay(-6), to }, groupBy: ['day'], limit: 7 },
      }),
    ),
    settle(api.call(ModelAccessAdminEndpoints.listUpstreams)),
    settle(
      api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: {
          filter: {
            from: startOfBeijingDay(-1),
            to: new Date(Date.parse(to) - 86_400_000).toISOString(),
          },
          groupBy: ['day'],
          limit: 1,
        },
      }),
    ),
  ]);
  return {
    overview,
    trend,
    yesterday,
    upstreams: upstreams?.items.filter((item) => !item.deletedAt),
  };
}

const TODO_ITEMS = [
  { key: 'alerts', label: '运行异常', path: '/admin/alerts', icon: AlertOutlined },
  { key: 'support', label: '帮助与反馈', path: '/support', icon: CustomerServiceOutlined },
  { key: 'roleRequests', label: '制作申请', path: '/role-requests', icon: SkinOutlined },
  { key: 'reports', label: '举报处理', path: '/reports', icon: FileProtectOutlined },
  { key: 'deletions', label: '注销未完成', path: '/account-deletions', icon: UserDeleteOutlined },
] satisfies Array<{
  key: keyof TodoCounts;
  label: string;
  path: string;
  icon: typeof AlertOutlined;
}>;

function changeFromYesterday(current: number, previous: number): string {
  if (!previous) return '昨天同期暂无数据';
  const change = (current - previous) / previous;
  if (Math.abs(change) < 0.005) return '与昨天同期持平';
  return `较昨天同期 ${change > 0 ? '+' : '−'}${Math.abs(change * 100).toFixed(1)}%`;
}

export function DashboardPage() {
  const { counts, loading: todosLoading, refresh: refreshTodos } = useTodos();
  const [data, setData] = useState<DashboardData>();
  const [revision, setRevision] = useState(0);
  const [loading, setLoading] = useState(true);
  const [metric, setMetric] = useState<'calls' | 'costMicros' | 'chargedMicros'>('calls');

  useEffect(() => {
    let alive = true;
    setLoading(true);
    void loadDashboard().then((result) => {
      if (!alive) return;
      setData(result);
      setLoading(false);
    });
    return () => {
      alive = false;
    };
  }, [revision]);

  const totals = data?.overview?.totals;
  const previous = data?.yesterday?.totals;
  const upstreams = data?.upstreams;
  const recentErrors = data?.overview?.recentErrors.slice(0, 6) ?? [];
  const normal = upstreams?.filter((u) => upstreamState(u) === 'normal').length ?? 0;
  const days = Array.from({ length: 7 }, (_, i) => beijingDayKey(startOfBeijingDay(i - 6)));
  const chartValues = days.map(
    (day) => data?.trend?.rows.find((row) => row.keys[0] === day)?.[metric] ?? 0,
  );
  const formatMetric = (value: number) =>
    metric === 'costMicros'
      ? formatYuan(value)
      : formatInt(metric === 'chargedMicros' ? pointsOf(value) : value);
  const date = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    month: 'long',
    day: 'numeric',
    weekday: 'long',
  }).format(new Date());

  return (
    <Page
      title="工作台"
      desc={`${date} · 北京时间`}
      extra={
        <Button
          icon={<ReloadOutlined />}
          loading={loading}
          onClick={() => {
            refreshTodos();
            setRevision((value) => value + 1);
          }}
        >
          刷新
        </Button>
      }
    >
      <SectionCard title="待处理">
        <div className="workbench-inbox">
          {TODO_ITEMS.map(({ key, label, path, icon: Icon }) => (
            <Link to={path} className="workbench-inbox-item" key={key}>
              <Icon aria-hidden />
              <span>{label}</span>
              <strong className={counts[key] > 0 ? 'has-todos' : undefined}>
                {todosLoading ? '—' : formatInt(counts[key])}
              </strong>
            </Link>
          ))}
        </div>
      </SectionCard>

      <section aria-label="今日模型数据">
        <div className="workbench-section-head">
          <h2>今日模型数据</h2>
          <Link to="/usage?range=today">
            用量分析 <ArrowRightOutlined />
          </Link>
        </div>
        {loading && !data ? (
          <SectionCard>
            <Skeleton active paragraph={{ rows: 1 }} />
          </SectionCard>
        ) : totals ? (
          <div className="workbench-metrics">
            <div className="workbench-metric">
              <span>模型调用</span>
              <strong>
                {formatInt(totals.calls)} <small>次</small>
              </strong>
              <small>{formatInt(totals.failedCalls)} 次失败</small>
            </div>
            <div className="workbench-metric">
              <span>用户扣除</span>
              <strong>
                {formatInt(pointsOf(totals.chargedMicros))} <small>积分</small>
              </strong>
              <small>
                {changeFromYesterday(totals.chargedMicros, previous?.chargedMicros ?? 0)}
              </small>
            </div>
            <div className="workbench-metric">
              <span>已记上游成本</span>
              <strong>{formatYuan(totals.costMicros)}</strong>
              <small>含平台吸收 {formatYuan(totals.absorbedCostMicros)}</small>
            </div>
            <div className="workbench-metric">
              <span>成本待核</span>
              <strong>
                {totals.unknownCostCalls === undefined ? '—' : formatInt(totals.unknownCostCalls)}{' '}
                <small>笔</small>
              </strong>
              <Link to="/usage?view=records&quality=cost_pending&range=today">
                查看待核记录 <ArrowRightOutlined />
              </Link>
            </div>
          </div>
        ) : (
          <Alert type="error" message="今日用量加载失败" showIcon />
        )}
      </section>

      <div className="workbench-detail">
        <SectionCard
          title="近 7 天趋势"
          extra={
            <Segmented
              value={metric}
              onChange={setMetric}
              aria-label="趋势指标"
              options={[
                { value: 'calls', label: '调用' },
                { value: 'chargedMicros', label: '积分' },
                { value: 'costMicros', label: '成本' },
              ]}
            />
          }
        >
          {data?.trend ? (
            <TrendBars
              labels={days.map((d) => d.slice(5).replace('-', '/'))}
              values={chartValues}
              format={formatMetric}
              color="#14765e"
              height={145}
            />
          ) : loading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : (
            <span className="detail-muted">趋势数据加载失败。</span>
          )}
        </SectionCard>
        <SectionCard
          title="上游线路"
          extra={
            <Link to="/model?tab=upstreams">
              {upstreams ? `${normal}/${upstreams.length} 正常` : '查看线路'} <ArrowRightOutlined />
            </Link>
          }
        >
          {upstreams?.length ? (
            <div className="workbench-upstreams">
              {[...upstreams]
                .sort(
                  (a, b) =>
                    Number(upstreamState(a) === 'normal') - Number(upstreamState(b) === 'normal'),
                )
                .slice(0, 5)
                .map((u) => {
                  const state = upstreamState(u);
                  const error = upstreamReason(u);
                  return (
                    <Link
                      to={`/usage?view=records&upstream=${u.upstreamId}`}
                      className="workbench-upstream"
                      key={u.upstreamId}
                    >
                      <div>
                        <strong>{u.name}</strong>
                        <small>{error ?? `今日 ${formatInt(u.todayCalls ?? 0)} 次调用`}</small>
                      </div>
                      <StatusTag
                        tone={
                          state === 'normal'
                            ? 'success'
                            : state === 'abnormal'
                              ? 'warning'
                              : 'default'
                        }
                      >
                        {UPSTREAM_STATE_LABELS[state]}
                      </StatusTag>
                    </Link>
                  );
                })}
            </div>
          ) : loading ? (
            <Skeleton active paragraph={{ rows: 3 }} />
          ) : (
            <span className="detail-muted">
              {upstreams ? '暂无上游线路。' : '线路数据加载失败。'}
            </span>
          )}
        </SectionCard>
      </div>
      {recentErrors.length > 0 && (
        <SectionCard
          title="近 24 小时主要失败"
          extra={
            <Link to="/usage?view=records&status=failed">
              查看失败调用 <ArrowRightOutlined />
            </Link>
          }
        >
          <div className="workbench-errors">
            {recentErrors.map((item) => (
              <Link
                className="workbench-error"
                to={`/usage?view=records&status=failed&upstream=${item.upstreamId}&model=${encodeURIComponent(item.modelKey)}`}
                key={`${item.upstreamId}:${item.modelKey}:${item.errorCode}`}
              >
                <span>{ERROR_LABELS[item.errorCode] ?? item.errorCode}</span>
                <span>{item.modelKey}</span>
                <span>{formatInt(item.count)} 次</span>
              </Link>
            ))}
          </div>
        </SectionCard>
      )}
    </Page>
  );
}
