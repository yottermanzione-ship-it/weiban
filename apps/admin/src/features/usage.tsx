import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Button, Segmented, Select, Tabs, Tooltip } from 'antd';
import { ArrowRightOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  ModelKey,
  Id,
  type AdminModelLabel,
  type AdminUsageCacheReceipts,
  type AdminUsageFilter,
  type AdminUsageSummary,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { Page } from '../ui/page.js';
import { formatInt, formatPercent, formatYuan, pointsOf } from '../ui/format.js';
import { PURPOSE_LABELS, modelLabel, rangeOf, type RangeKey } from './model/shared.js';
import { ModelTasksTab } from './model/task-outcomes.js';
import { RecordsTab } from './model/records.js';
import { UserIdentity } from './users/identity.js';

type Group = 'model' | 'upstream' | 'user' | 'purpose' | 'character' | 'day';
const GROUPS: { value: Group; label: string; column: string }[] = [
  { value: 'model', label: '按模型', column: '模型' },
  { value: 'upstream', label: '按线路', column: '线路' },
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
const SCENES = [
  { value: 'all', label: '全部场景', filter: {} },
  {
    value: 'direct',
    label: '私聊回复',
    filter: { conversationKind: 'direct', purposes: ['chat_reply'] },
  },
  {
    value: 'proactive',
    label: '主动私聊',
    filter: { conversationKind: 'direct', purposes: ['proactive'] },
  },
  {
    value: 'group',
    label: '群聊消息',
    filter: { conversationKind: 'group', purposes: ['chat_reply', 'proactive'] },
  },
] satisfies { value: string; label: string; filter: Partial<AdminUsageFilter> }[];

export function UsagePage() {
  const [params, setParams] = useSearchParams();
  const range = RANGES.find((item) => item.value === params.get('range'))?.value ?? '7d';
  const group = GROUPS.find((item) => item.value === params.get('group'))?.value ?? 'model';
  const scene = SCENES.find((item) => item.value === params.get('scene')) ?? SCENES[0]!;
  const summaryModel = ModelKey.safeParse(params.get('model')).data;
  const view = ['records', 'tasks'].includes(params.get('view') ?? '')
    ? params.get('view')!
    : 'summary';
  const modelsRemote = useRemote(ModelAccessAdminEndpoints.modelLabels);
  const models = modelsRemote.data?.items ?? [];
  const upstreamsRemote = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const upstreams = upstreamsRemote.data?.items ?? [];
  const quality = params.get('quality');
  const lookupIssue = modelsRemote.error || upstreamsRemote.error;

  function changeParam(key: string, value?: string) {
    setParams((current) => {
      const next = new URLSearchParams(current);
      if (value === undefined) next.delete(key);
      else next.set(key, value);
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
                scene={scene}
                model={summaryModel}
                models={models}
                onRange={(next) => changeParam('range', next)}
                onGroup={(next) => changeParam('group', next)}
                onScene={(next) => changeParam('scene', next)}
                onModel={(next) => changeParam('model', next)}
                upstreamName={(id) => upstreams.find((item) => item.upstreamId === id)?.name ?? id}
              />
            ),
          },
          {
            key: 'tasks',
            label: '任务结果',
            children: (
              <ModelTasksTab
                key={params.toString()}
                range={range}
                usageRecordId={Id.safeParse(params.get('usage')).data}
                state={params.get('state')}
                rescued={params.get('rescued') === '1'}
                models={models}
                upstreams={upstreams}
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
                  status:
                    params.get('status') === 'failed'
                      ? 'failed'
                      : params.get('status') === 'succeeded'
                        ? 'succeeded'
                        : '',
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

function CacheReceiptsCell({ receipts }: { receipts?: AdminUsageCacheReceipts }) {
  if (!receipts) return '—';
  return (
    <Tooltip
      trigger={['hover', 'focus']}
      title={
        <>
          <div>
            有命中 {formatInt(receipts.hitCalls)} · 零命中 {formatInt(receipts.zeroCalls)}
          </div>
          <div>
            未上报 {formatInt(receipts.missingCalls)} · 异常 {formatInt(receipts.invalidCalls)}
          </div>
          <div>无回执记录 {formatInt(receipts.unrecordedCalls)}</div>
          {receipts.meanUncachedInputTokens !== null && (
            <div>每次成功调用平均未命中 {formatInt(receipts.meanUncachedInputTokens)} token</div>
          )}
        </>
      }
    >
      <span className="cell-main" tabIndex={0}>
        {formatPercent(receipts.hitRate)}
        {receipts.inputCoverage !== null && (
          <small className="cell-sub">覆盖 {formatPercent(receipts.inputCoverage)}</small>
        )}
      </span>
    </Tooltip>
  );
}

function UsageSummary({
  range,
  group,
  scene,
  model,
  models,
  onRange,
  onGroup,
  onScene,
  onModel,
  upstreamName,
}: {
  range: RangeKey;
  group: Group;
  scene: (typeof SCENES)[number];
  model?: string;
  models: readonly AdminModelLabel[];
  onRange: (value: RangeKey) => void;
  onGroup: (value: Group) => void;
  onScene: (value: string) => void;
  onModel: (key?: string) => void;
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
          filter: { ...rangeOf(range), ...scene.filter, ...(model ? { modelKeys: [model] } : {}) },
          groupBy: group === 'upstream' ? ['upstream', 'upstream_model'] : [group],
          sort: group === 'day' ? 'key_asc' : 'charged_desc',
          limit: 200,
          includeCacheReceipts: true,
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
  }, [range, group, scene, model, revision]);

  const totals = data?.totals;
  const recordPath = `/usage?view=records&range=${range}`;
  const selectedModel = model ? `&model=${encodeURIComponent(model)}` : '';
  const refresh = () => setRevision((value) => value + 1);
  const columns: ProColumns<AdminUsageSummary['rows'][number]>[] = [
    {
      title: GROUPS.find((item) => item.value === group)?.column,
      render: (_, row) => {
        const key = row.keys[0] ?? '';
        if (group === 'user') return <UserIdentity userId={key} label={data?.userLabels[key]} />;
        if (group === 'upstream')
          return (
            <Link
              className="cell-main"
              to={`${recordPath}${selectedModel}&upstream=${encodeURIComponent(key)}`}
            >
              {upstreamName(key)}
              <small className="cell-sub">{row.keys[1]}</small>
            </Link>
          );
        if (group === 'model')
          return ModelKey.safeParse(key).success ? (
            <Link to={`${recordPath}&model=${encodeURIComponent(key)}`}>
              {modelLabel(models, key)}
            </Link>
          ) : (
            modelLabel(models, key)
          );
        if (group === 'purpose') return PURPOSE_LABELS[key] ?? key;
        return key || '无关联角色';
      },
    },
    {
      title: '调用',
      width: 176,
      align: 'right',
      sorter: (a, b) => a.calls - b.calls,
      render: (_, r) => (
        <span className="cell-main">
          {formatInt(r.calls)}
          <small className="cell-sub">
            成功 {formatInt(r.calls - r.failedCalls)} · 失败 {formatInt(r.failedCalls)}
          </small>
        </span>
      ),
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
      title: '缓存命中率',
      width: 126,
      align: 'right',
      sorter: (a, b) => (a.cacheReceipts?.hitRate ?? -1) - (b.cacheReceipts?.hitRate ?? -1),
      render: (_, r) => <CacheReceiptsCell receipts={r.cacheReceipts} />,
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
        <Select
          className="usage-group"
          value={scene.value}
          onChange={onScene}
          options={SCENES}
          aria-label="调用场景"
        />
        <Select
          className="usage-group usage-model-filter"
          value={model}
          onChange={onModel}
          options={models.map((entry) => ({ value: entry.modelKey, label: entry.displayName }))}
          placeholder="全部模型"
          allowClear
          showSearch
          optionFilterProp="label"
          aria-label="筛选模型"
        />
        <Button icon={<ReloadOutlined />} loading={loading} onClick={refresh} aria-label="刷新汇总">
          刷新
        </Button>
      </div>
      {totals && (
        <div className="usage-metrics">
          <div className="usage-metric">
            <span>模型调用</span>
            <strong>
              {formatInt(totals.calls)} <small>次</small>
            </strong>
            <small>
              成功 {formatInt(totals.calls - totals.failedCalls)} · 失败{' '}
              {formatInt(totals.failedCalls)}
            </small>
          </div>
          <div className="usage-metric">
            <span>用户原扣费</span>
            <strong>
              {pointsOf(totals.chargedMicros).toFixed(2)} <small>积分</small>
            </strong>
            <small>折合 {formatYuan(totals.chargedMicros)}</small>
          </div>
          <div className="usage-metric">
            <span>已记上游成本</span>
            <strong>{formatYuan(totals.costMicros)}</strong>
            <small>含平台吸收 {formatYuan(totals.absorbedCostMicros)}</small>
          </div>
          <div className="usage-metric">
            <span>模型差额</span>
            <strong>{formatYuan(totals.chargedMicros - totals.costMicros)}</strong>
          </div>
        </div>
      )}
      {totals && (
        <div className="usage-quality" aria-label="用量质量">
          <Link to={`${recordPath}${selectedModel}&quality=estimated`}>
            本地计量或估算 <b>{totals.estimatedCalls ?? '—'}</b> <ArrowRightOutlined />
          </Link>
          <Link to={`${recordPath}${selectedModel}&quality=cost_pending`}>
            成本待核 <b>{totals.unknownCostCalls ?? '—'}</b> <ArrowRightOutlined />
          </Link>
        </div>
      )}
      <DataTable<AdminUsageSummary['rows'][number]>
        rowKey={(row) => JSON.stringify(row.keys)}
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
