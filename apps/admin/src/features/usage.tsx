import { useEffect, useMemo, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Segmented, Select, Tabs } from 'antd';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  ModelKey,
  type AdminUsageSummary,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { Page } from '../ui/page.js';
import { formatInt, formatPercent, formatYuan, pointsOf } from '../ui/format.js';
import { PURPOSE_LABELS, modelLabel, rangeOf, type RangeKey } from './model/shared.js';
import { listAllModels, parseAdminModels } from './model/list-parse.js';
import { RecordsTab } from './model/records.js';
import { UserIdentity } from './users/identity.js';

type Group = 'model' | 'upstream' | 'user' | 'purpose' | 'character' | 'day';
const GROUPS: { value: Group; label: string; column: string }[] = [
  { value: 'model', label: '按模型', column: '模型' },
  { value: 'upstream', label: '按上游账号', column: '上游账号' },
  { value: 'purpose', label: '按用途', column: '用途' },
  { value: 'user', label: '按用户', column: '用户' },
  { value: 'character', label: '按角色', column: '角色' },
  { value: 'day', label: '按日期', column: '日期' },
];
const RANGES: { value: RangeKey; label: string }[] = [
  { value: 'today', label: '今天' },
  { value: '7d', label: '近 7 天' },
  { value: '30d', label: '近 30 天' },
  { value: 'month', label: '本月' },
];

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const range = RANGES.find((item) => item.value === params.get('range'))?.value ?? '7d';
  const group = GROUPS.find((item) => item.value === params.get('group'))?.value ?? 'model';
  const view = params.get('view') === 'records' ? 'records' : 'summary';
  const modelsRemote = useRemote(listAllModels);
  const { models, issues } = useMemo(
    () => parseAdminModels(modelsRemote.data?.items),
    [modelsRemote.data],
  );
  const upstreamsRemote = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const upstreams = upstreamsRemote.data?.items ?? [];
  const quality = params.get('quality');
  const lookupIssue =
    modelsRemote.error ||
    upstreamsRemote.error ||
    (issues.length > 0 ? `${issues.length} 条目录项格式有误。可在模型管理查看详情。` : '');

  function changeParam(key: string, value: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      next.set(key, value);
      if (key === 'view' && value === 'summary') {
        for (const filter of ['model', 'upstream', 'status', 'quality']) next.delete(filter);
      }
      return next;
    });
  }

  return (
    <Page title="用量与成本" desc="北京时间 · 可按模型、线路或用户追查每笔调用">
      {lookupIssue && (
        <p className="usage-directory-note" role="status">
          目录读取提示 · {lookupIssue}
        </p>
      )}
      <Tabs
        className="admin-page-tabs"
        activeKey={view}
        onChange={(key) => changeParam('view', key)}
        destroyOnHidden
        items={[
          {
            key: 'summary',
            label: '用量汇总',
            children: (
              <UsageSummary
                range={range}
                group={group}
                onRange={(next) => changeParam('range', next)}
                onGroup={(next) => changeParam('group', next)}
                modelName={(key) => modelLabel(models, key)}
                upstreamName={(id) => upstreams.find((item) => item.upstreamId === id)?.name ?? id}
              />
            ),
          },
          {
            key: 'records',
            label: '调用明细',
            children: (
              <RecordsTab
                key={params.toString()}
                models={models}
                upstreams={upstreams}
                initial={{
                  range,
                  upstreamId: params.get('upstream') ?? '',
                  modelKey: params.get('model') ?? '',
                  status: params.get('status') === 'failed' ? 'failed' : '',
                  quality: quality === 'estimated' || quality === 'cost_pending' ? quality : '',
                }}
              />
            ),
          },
        ]}
      />
    </Page>
  );
}

function UsageSummary({
  range,
  group,
  onRange,
  onGroup,
  modelName,
  upstreamName,
}: {
  range: RangeKey;
  group: Group;
  onRange: (value: RangeKey) => void;
  onGroup: (value: Group) => void;
  modelName: (key: string) => string;
  upstreamName: (id: string) => string;
}) {
  const [data, setData] = useState<AdminUsageSummary>();
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const [error, setError] = useState('');

  useEffect(() => {
    let active = true;
    setLoading(true);
    setData(undefined);
    setError('');
    void api
      .call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: {
          filter: rangeOf(range),
          groupBy: [group],
          sort: group === 'day' ? 'key_asc' : 'charged_desc',
          limit: 200,
        },
      })
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
  }, [range, group, revision]);

  const totals = data?.totals;
  const recordPath = `/usage?view=records&range=${range}`;
  const refresh = () => setRevision((value) => value + 1);
  const columns: ProColumns<AdminUsageSummary['rows'][number]>[] = [
    {
      title: GROUPS.find((item) => item.value === group)?.column,
      render: (_, row) => {
        const key = row.keys[0] ?? '';
        if (group === 'user') return <UserIdentity userId={key} label={data?.userLabels[key]} />;
        if (group === 'upstream')
          return (
            <Link to={`${recordPath}&upstream=${encodeURIComponent(key)}`}>
              {upstreamName(key)}
            </Link>
          );
        if (group === 'model')
          return ModelKey.safeParse(key).success ? (
            <Link to={`${recordPath}&model=${encodeURIComponent(key)}`}>{modelName(key)}</Link>
          ) : (
            modelName(key)
          );
        if (group === 'purpose') return PURPOSE_LABELS[key] ?? key;
        return key || '无关联角色';
      },
    },
    {
      title: '调用',
      width: 88,
      align: 'right',
      sorter: (a, b) => a.calls - b.calls,
      render: (_, r) => formatInt(r.calls),
    },
    {
      title: '失败',
      width: 95,
      align: 'right',
      sorter: (a, b) => a.failedCalls - b.failedCalls,
      render: (_, r) => formatInt(r.failedCalls),
    },
    {
      title: '本地计量或估算',
      width: 132,
      align: 'right',
      sorter: (a, b) => (a.estimatedCalls ?? 0) - (b.estimatedCalls ?? 0),
      render: (_, r) => (r.estimatedCalls === undefined ? '—' : formatInt(r.estimatedCalls)),
    },
    {
      title: '用户扣除（积分）',
      width: 134,
      align: 'right',
      sorter: (a, b) => a.chargedMicros - b.chargedMicros,
      render: (_, r) => pointsOf(r.chargedMicros).toFixed(2),
    },
    {
      title: '已记上游成本',
      width: 128,
      align: 'right',
      sorter: (a, b) => a.costMicros - b.costMicros,
      render: (_, r) => formatYuan(r.costMicros, 4),
    },
    {
      title: '成本待核',
      width: 100,
      align: 'right',
      sorter: (a, b) => (a.unknownCostCalls ?? 0) - (b.unknownCostCalls ?? 0),
      render: (_, r) => (r.unknownCostCalls === undefined ? '—' : formatInt(r.unknownCostCalls)),
    },
    {
      title: '缓存命中',
      width: 97,
      align: 'right',
      render: (_, r) =>
        r.inputTokens || r.cachedInputTokens ? formatPercent(r.cacheHitRate) : '—',
    },
  ];

  return (
    <div className="admin-stack">
      <div className="filter-panel usage-filters">
        <Segmented<RangeKey>
          value={range}
          onChange={onRange}
          options={RANGES}
          aria-label="统计范围"
        />
        <Select<Group>
          className="usage-group"
          value={group}
          onChange={onGroup}
          options={GROUPS}
          aria-label="汇总维度"
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} aria-label="刷新汇总">
          刷新
        </Button>
      </div>
      {totals && (
        <div className="workbench-metrics usage-metrics">
          <div className="workbench-metric">
            <span>模型调用</span>
            <strong>
              {formatInt(totals.calls)} <small>次</small>
            </strong>
            <small>
              {formatInt(totals.failedCalls)} 次失败 · {formatPercent(totals.failureRate)}
            </small>
          </div>
          <div className="workbench-metric">
            <span>用户原扣费</span>
            <strong>
              {pointsOf(totals.chargedMicros).toFixed(2)} <small>积分</small>
            </strong>
            <small>折合 {formatYuan(totals.chargedMicros)}</small>
          </div>
          <div className="workbench-metric">
            <span>已记上游成本</span>
            <strong>{formatYuan(totals.costMicros)}</strong>
            <small>含平台吸收 {formatYuan(totals.absorbedCostMicros)}</small>
          </div>
          <div className="workbench-metric">
            <span>模型差额</span>
            <strong>{formatYuan(totals.chargedMicros - totals.costMicros)}</strong>
            <small>原扣费减去已记上游成本</small>
          </div>
        </div>
      )}
      {totals && (
        <div className="usage-quality" aria-label="用量质量">
          <Link to={`${recordPath}&quality=estimated`}>
            本地计量或估算 <b>{totals.estimatedCalls ?? '—'}</b> <ArrowRightOutlined />
          </Link>
          <Link to={`${recordPath}&quality=cost_pending`}>
            成本待核 <b>{totals.unknownCostCalls ?? '—'}</b> <ArrowRightOutlined />
          </Link>
        </div>
      )}
      <DataTable<AdminUsageSummary['rows'][number]>
        rowKey={(row) => String(row.keys[0] ?? '')}
        columns={columns}
        data={data?.rows ?? []}
        showTools={false}
        loading={loading}
        error={error}
        onRefresh={error ? refresh : undefined}
        emptyTitle="这段时间没有调用"
        emptyHint="可扩大统计范围。"
        footer={data?.truncated ? '仅显示前 200 组。可缩小时间范围查看其余记录。' : undefined}
      />
    </div>
  );
}
