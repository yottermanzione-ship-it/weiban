import { useEffect, useState } from 'react';
import { Button, Col, Row, Segmented, Skeleton } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  ModelAccessAdminUsageEndpoints,
  type AdminUsageOverview,
  type AdminUsageSummary,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { settle } from '../../data/use-async.js';
import { SectionCard, StatusTag } from '../../ui/page.js';
import { TrendBars } from '../../ui/chart.js';
import { formatInt, formatPercent, formatYuan, pointsOf } from '../../ui/format.js';
import { ERROR_LABELS, rangeOf, type RangeKey } from './shared.js';
import { UserIdentity } from '../users/identity.js';

interface Data {
  overview?: AdminUsageOverview;
  days?: AdminUsageSummary;
  models?: AdminUsageSummary;
  users?: AdminUsageSummary;
}

export function OverviewTab({ onGo }: { onGo: (tab: 'upstreams' | 'models' | 'records') => void }) {
  const [range, setRange] = useState<RangeKey>('7d');
  const [revision, setRevision] = useState(0);
  const [data, setData] = useState<Data>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const { from, to } = rangeOf(range);
    void Promise.all([
      settle(api.call(ModelAccessAdminUsageEndpoints.usageOverview, { body: { from, to } })),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: { filter: { from, to }, groupBy: ['day'], sort: 'key_asc', limit: 400 },
        }),
      ),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: {
            filter: { from, to },
            groupBy: ['model'],
            sort: 'charged_desc',
            limit: 10,
          },
        }),
      ),
      settle(
        api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
          body: { filter: { from, to }, groupBy: ['user'], sort: 'charged_desc', limit: 10 },
        }),
      ),
    ])
      .then(([overview, days, models, users]) => {
        if (!active) return;
        if (!overview) setError('用量数据没加载出来，请稍后刷新');
        setData({ overview, days, models, users });
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [range, revision]);

  const totals = data?.overview?.totals;
  const previous = data?.overview?.previousTotals;
  const profit =
    (totals?.chargedMicros ?? 0) - (totals?.costMicros ?? 0) - (totals?.absorbedCostMicros ?? 0);

  const dayRows = data?.days?.rows ?? [];
  const labels = dayRows.map((r) => String(r.keys[0] ?? '').slice(5));
  const calls = dayRows.map((r) => r.calls);
  const costs = dayRows.map((r) => r.costMicros);

  return (
    <div className="tab-body">
      <div className="tab-head">
        <div className="tab-desc">
          <strong>概览</strong>
          <span>这段时间调用了多少、花了多少、赚了多少，以及哪些模型/用户用得最多。</span>
        </div>
        <div className="tab-actions">
          <Segmented<RangeKey>
            value={range}
            onChange={setRange}
            options={[
              { value: 'today', label: '今天' },
              { value: '7d', label: '近 7 天' },
              { value: '30d', label: '近 30 天' },
              { value: 'month', label: '本月' },
            ]}
          />
          <Button icon={<ReloadOutlined />} onClick={() => setRevision((v) => v + 1)}>
            刷新
          </Button>
        </div>
      </div>
      {error && <div className="dash-error">{error}</div>}
      {loading && !data ? (
        <SectionCard>
          <Skeleton active paragraph={{ rows: 6 }} />
        </SectionCard>
      ) : (
        <>
          <div className="mini-stats">
            <div className="mini-stat">
              <span>调用次数</span>
              <strong>{formatInt(totals?.calls ?? 0)}</strong>
              <em>失败 {formatInt(totals?.failedCalls ?? 0)} 次</em>
            </div>
            <div className="mini-stat">
              <span>用户扣除</span>
              <strong>{formatInt(pointsOf(totals?.chargedMicros ?? 0))} 积分</strong>
              <em>≈ {formatYuan(totals?.chargedMicros ?? 0)}</em>
            </div>
            <div className="mini-stat">
              <span>上游成本</span>
              <strong>{formatYuan(totals?.costMicros ?? 0)}</strong>
              <em>失败吸收 {formatYuan(totals?.absorbedCostMicros ?? 0)}</em>
            </div>
            <div className="mini-stat">
              <span>毛利</span>
              <strong>{formatYuan(profit)}</strong>
              <em>
                上期 {formatYuan((previous?.chargedMicros ?? 0) - (previous?.costMicros ?? 0))}
              </em>
            </div>
            <div className="mini-stat">
              <span>失败率</span>
              <strong>{formatPercent(totals?.failureRate)}</strong>
              <em>缓存命中 {formatPercent(totals?.cacheHitRate)}</em>
            </div>
            <div className="mini-stat">
              <span>线路</span>
              <strong>
                {data?.overview?.accounts.available ?? 0} / {data?.overview?.accounts.total ?? 0}{' '}
                正常
              </strong>
              <em>异常 {data?.overview?.accounts.abnormal ?? 0}</em>
            </div>
          </div>
          <Row gutter={14}>
            <Col span={12}>
              <SectionCard title="调用次数" desc="按天">
                <TrendBars labels={labels} values={calls} format={(v) => formatInt(v)} />
              </SectionCard>
            </Col>
            <Col span={12}>
              <SectionCard title="上游成本" desc="按天，元">
                <TrendBars
                  labels={labels}
                  values={costs}
                  format={(v) => formatYuan(v)}
                  color="#E8912D"
                />
              </SectionCard>
            </Col>
          </Row>
          <Row gutter={14}>
            <Col span={12}>
              <SectionCard
                title="花得最多的模型"
                desc="按用户扣除排序"
                extra={
                  <Button type="link" size="small" onClick={() => onGo('models')}>
                    去模型
                  </Button>
                }
              >
                <div className="rank-list">
                  {(data?.models?.rows ?? []).map((row) => (
                    <div className="rank-row" key={row.keys[0]}>
                      <span className="rank-name">{row.keys[0]}</span>
                      <span className="rank-meta">
                        {formatInt(row.calls)} 次 · {formatInt(pointsOf(row.chargedMicros))} 积分
                      </span>
                    </div>
                  ))}
                  {(data?.models?.rows ?? []).length === 0 && (
                    <div className="detail-muted">这段时间没有调用。</div>
                  )}
                </div>
              </SectionCard>
            </Col>
            <Col span={12}>
              <SectionCard
                title="用得最多的用户"
                desc="按用户扣除排序"
                extra={
                  <Button type="link" size="small" onClick={() => onGo('records')}>
                    看明细
                  </Button>
                }
              >
                <div className="rank-list">
                  {(data?.users?.rows ?? []).map((row) => {
                    const userId = String(row.keys[0] ?? '');
                    return (
                      <div className="rank-row" key={userId}>
                        <span className="rank-name">
                          <UserIdentity
                            compact
                            userId={userId}
                            label={data?.users?.userLabels?.[userId]}
                          />
                        </span>
                        <span className="rank-meta">
                          {formatInt(row.calls)} 次 · {formatInt(pointsOf(row.chargedMicros))} 积分
                        </span>
                      </div>
                    );
                  })}
                  {(data?.users?.rows ?? []).length === 0 && (
                    <div className="detail-muted">这段时间没有调用。</div>
                  )}
                </div>
              </SectionCard>
            </Col>
          </Row>
          <SectionCard
            title="最近 24 小时的错误"
            desc="按线路 + 模型 + 错误类型合并"
            extra={
              <Button type="link" size="small" onClick={() => onGo('upstreams')}>
                去上游账号
              </Button>
            }
          >
            {(data?.overview?.recentErrors ?? []).length === 0 ? (
              <div className="detail-muted">最近没有失败调用。</div>
            ) : (
              <div className="error-list">
                {data!.overview!.recentErrors.slice(0, 12).map((e) => (
                  <div key={`${e.upstreamId}|${e.modelKey}|${e.errorCode}`}>
                    <StatusTag tone="error">{ERROR_LABELS[e.errorCode] ?? e.errorCode}</StatusTag>
                    <span>{e.modelKey}</span>
                    <span>{e.count} 次</span>
                    <span>{new Date(e.lastAt).toLocaleString('zh-CN', { hour12: false })}</span>
                  </div>
                ))}
              </div>
            )}
          </SectionCard>
          <div className="dash-foot">
            统计口径：北京时间自然日；「用户扣除」按积分，「上游成本」按元。今天的数据统计到此刻。
          </div>
        </>
      )}
    </div>
  );
}
