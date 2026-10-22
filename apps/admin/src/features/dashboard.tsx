import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Col, Row, Skeleton, Tooltip } from 'antd';
import { ReloadOutlined, RightOutlined } from '@ant-design/icons';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  type AdminUsageOverview,
  type AdminUsageSummary,
  type Upstream,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { settle } from '../data/use-async.js';
import { errorText } from '../data/hooks.js';
import { HelpTip, Page, SectionCard, StatusTag, type StatusTone } from '../ui/page.js';
import { TrendBars } from '../ui/chart.js';
import {
  beijingDayKey,
  formatInt,
  formatPercent,
  formatYuan,
  pointsOf,
  startOfBeijingDay,
} from '../ui/format.js';
import { useTodos, type TodoCounts } from '../app/todos.js';

interface DashboardData {
  overview?: AdminUsageOverview;
  usersToday?: AdminUsageSummary;
  usersYesterday?: AdminUsageSummary;
  trend?: AdminUsageSummary;
  purposesToday?: AdminUsageSummary;
  purposesYesterday?: AdminUsageSummary;
  upstreams: Upstream[];
}

async function loadDashboard(): Promise<DashboardData> {
  const today = startOfBeijingDay(0);
  const weekAgo = startOfBeijingDay(-6);
  const now = new Date().toISOString();
  // 「昨天」取与今天等长的时段（今天 0 点到现在），否则半天比一天没有意义。
  const elapsed = Date.now() - new Date(today).getTime();
  const yesterdayFrom = new Date(new Date(today).getTime() - 86_400_000).toISOString();
  const yesterdayTo = new Date(new Date(today).getTime() - 86_400_000 + elapsed).toISOString();
  const [overview, usersToday, usersYesterday, trend, purposesToday, purposesYesterday, upstreams] =
    await Promise.all([
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageOverview, {
          body: { from: today, to: now },
        }),
      ),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: {
            filter: { from: today, to: now },
            groupBy: ['user'],
            sort: 'charged_desc',
            limit: 1000,
          },
        }),
      ),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: {
            filter: { from: yesterdayFrom, to: yesterdayTo },
            groupBy: ['user'],
            sort: 'charged_desc',
            limit: 1000,
          },
        }),
      ),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: {
            filter: { from: weekAgo, to: now },
            groupBy: ['day'],
            sort: 'key_asc',
            limit: 100,
          },
        }),
      ),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: {
            filter: { from: today, to: now },
            groupBy: ['purpose'],
            sort: 'charged_desc',
            limit: 100,
          },
        }),
      ),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: {
            filter: { from: yesterdayFrom, to: yesterdayTo },
            groupBy: ['purpose'],
            sort: 'charged_desc',
            limit: 100,
          },
        }),
      ),
      settle(api.call(ModelAccessAdminEndpoints.listUpstreams)),
    ]);
  return {
    overview,
    usersToday,
    usersYesterday,
    trend,
    purposesToday,
    purposesYesterday,
    upstreams: (upstreams?.items ?? []).filter((u) => !u.deletedAt),
  };
}

function chatCalls(summary: AdminUsageSummary | undefined): number {
  if (!summary) return 0;
  return summary.rows
    .filter((row) => row.keys[0] === 'chat_reply')
    .reduce((sum, row) => sum + row.calls, 0);
}

function deltaText(today: number, yesterday: number): { text: string; up: boolean; flat: boolean } {
  if (!yesterday) {
    if (!today) return { text: '昨天没有数据', up: false, flat: true };
    return { text: '昨天没有数据', up: false, flat: true };
  }
  const rate = (today - yesterday) / Math.abs(yesterday);
  if (Math.abs(rate) < 0.005) return { text: '与昨天基本持平', up: false, flat: true };
  return {
    text: `较昨天${rate > 0 ? '多' : '少'} ${Math.abs(rate * 100).toFixed(1)}%`,
    up: rate > 0,
    flat: false,
  };
}

function pointsDeltaText(
  today: number,
  yesterday: number,
): { text: string; up: boolean; flat: boolean } {
  const diff = today - yesterday;
  if (!today && !yesterday) return { text: '昨天没有数据', up: false, flat: true };
  if (Math.abs(diff) < 0.0005) return { text: '与昨天持平', up: false, flat: true };
  return {
    text: `较昨天${diff > 0 ? '高' : '低'} ${Math.abs(diff * 100).toFixed(1)} 个百分点`,
    up: diff > 0,
    flat: false,
  };
}

function StatCard({
  label,
  value,
  hint,
  delta,
  betterWhen = 'up',
}: {
  label: string;
  value: string;
  hint?: string;
  delta?: { text: string; up: boolean; flat: boolean };
  betterWhen?: 'up' | 'down' | 'none';
}) {
  let deltaClass = 'stat-delta';
  if (delta && !delta.flat && betterWhen !== 'none') {
    const good = betterWhen === 'up' ? delta.up : !delta.up;
    deltaClass += good ? ' is-good' : ' is-bad';
  }
  return (
    <div className="stat-card">
      <div className="stat-label">
        {label}
        {hint && <HelpTip text={hint} />}
      </div>
      <div className="stat-value">{value}</div>
      <div className={deltaClass}>{delta?.text ?? '—'}</div>
    </div>
  );
}

const TODO_ITEMS: { key: keyof TodoCounts; label: string; path: string; hint: string }[] = [
  {
    key: 'roleRequests',
    label: '制作申请',
    path: '/role-requests',
    hint: '用户提交的角色制作需求',
  },
  { key: 'support', label: '帮助与反馈', path: '/support', hint: '用户反馈与投诉' },
  { key: 'reports', label: '举报处理', path: '/reports', hint: '广场作品与评论的举报' },
  {
    key: 'deletions',
    label: '注销未完成',
    path: '/account-deletions',
    hint: '注销流程还没跑完的账号',
  },
  { key: 'alerts', label: '运行提醒', path: '/admin/alerts', hint: '系统自动报出的异常' },
];

function upstreamTone(upstream: Upstream): { tone: StatusTone; label: string } {
  if (upstream.enabled === false) return { tone: 'default', label: '已停用' };
  if (upstream.cooldownUntil && new Date(upstream.cooldownUntil).getTime() > Date.now())
    return { tone: 'warning', label: '自动暂停中' };
  switch (upstream.status) {
    case 'active':
      return { tone: 'success', label: '正常' };
    case 'quota_exhausted':
      return { tone: 'warning', label: '额度用完' };
    case 'invalid':
      return { tone: 'error', label: '密钥失效' };
    default:
      return { tone: 'error', label: '不可用' };
  }
}

export function DashboardPage() {
  const navigate = useNavigate();
  const { counts, refresh: refreshTodos } = useTodos();
  const [data, setData] = useState<DashboardData>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void loadDashboard()
      .then((result) => {
        if (active) setData(result);
      })
      .catch((e: unknown) => {
        if (active) setError(errorText(e));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, []);

  const totals = data?.overview?.totals;
  const previous = data?.overview?.previousTotals;
  const chargedPoints = totals?.chargedPoints ?? pointsOf(totals?.chargedMicros ?? 0);
  const previousChargedPoints = previous?.chargedPoints ?? pointsOf(previous?.chargedMicros ?? 0);
  const profit =
    (totals?.chargedMicros ?? 0) - (totals?.costMicros ?? 0) - (totals?.absorbedCostMicros ?? 0);
  const previousProfit =
    (previous?.chargedMicros ?? 0) -
    (previous?.costMicros ?? 0) -
    (previous?.absorbedCostMicros ?? 0);

  const days = Array.from({ length: 7 }, (_, index) => beijingDayKey(startOfBeijingDay(index - 6)));
  const trendRows = data?.trend?.rows ?? [];
  const pick = (day: string) => trendRows.find((row) => row.keys[0] === day);
  const labels = days.map((day) => `${Number(day.slice(5, 7))}/${Number(day.slice(8, 10))}`);
  const callValues = days.map((day) => pick(day)?.calls ?? 0);
  const pointValues = days.map(
    (day) => pick(day)?.chargedPoints ?? pointsOf(pick(day)?.chargedMicros ?? 0),
  );
  const costValues = days.map((day) => pick(day)?.costMicros ?? 0);

  const upstreams = [...(data?.upstreams ?? [])].sort((a, b) => {
    const rank = (u: Upstream) => (u.enabled === false ? 3 : u.status === 'active' ? 0 : 1);
    return rank(a) - rank(b);
  });
  const healthy = upstreams.filter((u) => u.status === 'active' && u.enabled !== false).length;

  return (
    <Page
      title="工作台"
      desc="今天的整体情况、需要处理的事、模型线路是否正常"
      extra={
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            refreshTodos();
            setLoading(true);
            setError('');
            void loadDashboard()
              .then(setData)
              .catch((e: unknown) => setError(errorText(e)))
              .finally(() => setLoading(false));
          }}
        >
          刷新数据
        </Button>
      }
    >
      {error && <div className="dash-error">数据没加载出来：{error}</div>}
      {loading && !data ? (
        <SectionCard>
          <Skeleton active paragraph={{ rows: 6 }} />
        </SectionCard>
      ) : (
        <>
          <div className="dash-stats">
            <StatCard
              label="活跃用户"
              value={formatInt(data?.usersToday?.rows.length ?? 0)}
              hint="今天调用过 AI 的用户数"
              delta={deltaText(
                data?.usersToday?.rows.length ?? 0,
                data?.usersYesterday?.rows.length ?? 0,
              )}
            />
            <StatCard
              label="消息数"
              value={formatInt(chatCalls(data?.purposesToday))}
              hint="今天 AI 回复的条数（按聊天回复的模型调用统计）"
              delta={deltaText(chatCalls(data?.purposesToday), chatCalls(data?.purposesYesterday))}
            />
            <StatCard
              label="积分消耗"
              value={`${formatInt(chargedPoints)} 积分`}
              hint="今天用户被扣掉的积分，1 元 = 100 积分"
              delta={deltaText(chargedPoints, previousChargedPoints)}
              betterWhen="none"
            />
            <StatCard
              label="上游成本"
              value={formatYuan(totals?.costMicros ?? 0)}
              hint="今天付给模型服务商的钱（成本价）"
              delta={deltaText(totals?.costMicros ?? 0, previous?.costMicros ?? 0)}
              betterWhen="down"
            />
            <StatCard
              label="毛利"
              value={formatYuan(profit)}
              hint="用户扣费 − 上游成本 − 失败调用平台吸收的成本"
              delta={deltaText(profit, previousProfit)}
            />
            <StatCard
              label="失败率"
              value={formatPercent(totals?.failureRate)}
              hint="今天调用失败的比例"
              delta={pointsDeltaText(totals?.failureRate ?? 0, previous?.failureRate ?? 0)}
              betterWhen="down"
            />
            <StatCard
              label="缓存命中率"
              value={formatPercent(totals?.cacheHitRate)}
              hint="输入内容命中缓存的比例，越高越省钱"
              delta={pointsDeltaText(totals?.cacheHitRate ?? 0, previous?.cacheHitRate ?? 0)}
            />
          </div>

          <Row gutter={14}>
            <Col span={8}>
              <SectionCard title="近 7 天消息数" desc="按 AI 调用次数">
                <TrendBars labels={labels} values={callValues} format={(v) => formatInt(v)} />
              </SectionCard>
            </Col>
            <Col span={8}>
              <SectionCard title="近 7 天积分消耗" desc="用户被扣的积分">
                <TrendBars
                  labels={labels}
                  values={pointValues}
                  format={(v) => formatInt(v)}
                  color="#0B7A45"
                />
              </SectionCard>
            </Col>
            <Col span={8}>
              <SectionCard title="近 7 天上游成本" desc="付给模型服务商的钱">
                <TrendBars
                  labels={labels}
                  values={costValues}
                  format={(v) => formatYuan(v)}
                  color="#E8912D"
                />
              </SectionCard>
            </Col>
          </Row>

          <Row gutter={14}>
            <Col span={9}>
              <SectionCard
                title="待办"
                desc="点一条直接去处理"
                extra={
                  <span className="dash-total">
                    共 {Object.values(counts).reduce((a, b) => a + b, 0)} 件
                  </span>
                }
              >
                <div className="todo-list">
                  {TODO_ITEMS.map((item) => (
                    <button
                      type="button"
                      key={item.key}
                      className="todo-row"
                      onClick={() => navigate(item.path)}
                    >
                      <span className="todo-label">
                        {item.label}
                        <Tooltip title={item.hint}>
                          <span className="todo-hint">{item.hint}</span>
                        </Tooltip>
                      </span>
                      <span
                        className={counts[item.key] > 0 ? 'todo-count is-active' : 'todo-count'}
                      >
                        {counts[item.key]}
                      </span>
                      <RightOutlined className="todo-arrow" />
                    </button>
                  ))}
                </div>
              </SectionCard>
            </Col>
            <Col span={15}>
              <SectionCard
                title="上游线路健康"
                desc={`共 ${upstreams.length} 条线路，正常 ${healthy} 条`}
                extra={
                  <Button type="link" size="small" onClick={() => navigate('/model')}>
                    去模型管理
                  </Button>
                }
              >
                {upstreams.length === 0 ? (
                  <div className="health-empty">
                    还没有添加上游账号。去「模型管理 › 上游账号」添加第一条，填入 API
                    密钥后系统会自动测试连通。
                  </div>
                ) : (
                  <div className="health-list">
                    {upstreams.map((upstream) => {
                      const status = upstreamTone(upstream);
                      return (
                        <div key={upstream.upstreamId} className="health-row">
                          <div className="health-name">
                            <span>{upstream.name}</span>
                            <StatusTag tone={status.tone}>{status.label}</StatusTag>
                          </div>
                          <div className="health-meta">
                            <span>今天 {formatInt(upstream.todayCalls ?? 0)} 次</span>
                            <span>{formatYuan(upstream.todayCostMicros ?? 0)}</span>
                            {upstream.lastError && (
                              <span className="health-error">最近错误：{upstream.lastError}</span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </SectionCard>
            </Col>
          </Row>
          <div className="dash-foot">
            数据来自「模型与计费 › 用量与花费」的用量监控，统计到今天此刻；对比对象是昨天同一时段。
          </div>
        </>
      )}
    </Page>
  );
}
