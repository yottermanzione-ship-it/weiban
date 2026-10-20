/**
 * 用量与花费：按用户 / 模型 / 用途 / 角色看这段时间调用了多少、扣了多少积分、花了多少成本。
 * 明细在「模型管理 › 调用记录」，这里只看汇总。
 */
import { useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Button, Segmented, Select, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import {
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  type AdminUsageSummary,
  type AdminUsageDimension,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { settle } from '../data/use-async.js';
import { useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { Page, useToast } from '../ui/page.js';
import {
  Money,
  formatInt,
  formatPercent,
  formatYuan,
  pointsOf,
} from '../ui/format.js';
import { PURPOSE_LABELS, modelLabel, rangeOf, type RangeKey } from './model/shared.js';

type GroupKey = 'user' | 'model' | 'purpose' | 'character';

const GROUP_LABELS: Record<GroupKey, string> = {
  user: '按用户',
  model: '按模型',
  purpose: '按用途',
  character: '按角色',
};

export function UsagePage() {
  const navigate = useNavigate();
  const toast = useToast();
  const [range, setRange] = useState<RangeKey>('7d');
  const [group, setGroup] = useState<GroupKey>('user');
  const [data, setData] = useState<AdminUsageSummary>();
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  const models = useRemote(ModelAccessAdminEndpoints.listModels);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    const { from, to } = rangeOf(range);
    void settle(
      api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: {
          filter: { from, to },
          groupBy: [group as AdminUsageDimension],
          sort: 'charged_desc',
          limit: 200,
        },
      }),
    )
      .then((result) => {
        if (!active) return;
        if (!result) setError('用量数据没加载出来，请稍后重试');
        setData(result);
      })
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [range, group, revision]);

  const modelName = (key: string) => modelLabel(models.data?.items ?? [], key);

  function labelOf(key: string): string {
    if (group === 'model') return modelName(key);
    if (group === 'purpose') return PURPOSE_LABELS[key] ?? key;
    if (group === 'character') return key || '（无角色）';
    return key ? `${key.slice(0, 12)}…` : '—';
  }

  const rows = data?.rows ?? [];
  const totals = data?.totals;

  const columns: ProColumns<AdminUsageSummary['rows'][number]>[] = [
    {
      title: GROUP_LABELS[group].replace('按', ''),
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{labelOf(String(row.keys[0] ?? ''))}</span>
          {group === 'user' && <span className="cell-sub mono">{row.keys[0]}</span>}
        </div>
      ),
    },
    {
      title: '调用次数',
      width: 100,
      sorter: (a, b) => a.calls - b.calls,
      render: (_, row) => formatInt(row.calls),
    },
    {
      title: '失败',
      width: 90,
      sorter: (a, b) => a.failedCalls - b.failedCalls,
      render: (_, row) =>
        row.failedCalls > 0 ? (
          <span className="warn-text">
            {formatInt(row.failedCalls)}（{formatPercent(row.failureRate)}）
          </span>
        ) : (
          '0'
        ),
    },
    {
      title: '输入 / 输出 token',
      width: 160,
      render: (_, row) => `${formatInt(row.inputTokens)} / ${formatInt(row.outputTokens)}`,
    },
    {
      title: '用户扣除',
      width: 150,
      sorter: (a, b) => a.chargedMicros - b.chargedMicros,
      render: (_, row) => <Money micros={row.chargedMicros} />,
    },
    {
      title: '上游成本',
      width: 110,
      sorter: (a, b) => a.costMicros - b.costMicros,
      render: (_, row) => formatYuan(row.costMicros),
    },
    {
      title: '毛利',
      width: 110,
      sorter: (a, b) =>
        a.chargedMicros - a.costMicros - (b.chargedMicros - b.costMicros),
      render: (_, row) => (
        <span className={row.chargedMicros - row.costMicros < 0 ? 'warn-text' : ''}>
          {formatYuan(row.chargedMicros - row.costMicros - row.absorbedCostMicros)}
        </span>
      ),
    },
    {
      title: '缓存命中率',
      width: 110,
      render: (_, row) => formatPercent(row.cacheHitRate),
    },
  ];

  return (
    <Page
      title="用量与花费"
      desc="这段时间谁在用、用了多少、扣了多少积分、平台赚了多少。看单次调用请去「模型管理 › 调用记录」。"
      extra={
        <Space size={8}>
          <Button
            icon={<ReloadOutlined />}
            onClick={() => {
              setRevision((v) => v + 1);
              toast.success('已刷新');
            }}
          >
            刷新
          </Button>
          <Button type="primary" onClick={() => navigate('/model?tab=records')}>
            看调用记录
          </Button>
        </Space>
      }
    >
      <div className="filter-panel">
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
        <Select
          style={{ width: 140 }}
          value={group}
          onChange={setGroup}
          options={[
            { value: 'user', label: '按用户' },
            { value: 'model', label: '按模型' },
            { value: 'purpose', label: '按用途' },
            { value: 'character', label: '按角色' },
          ]}
        />
        {totals && (
          <span className="filter-summary">
            合计：{formatInt(totals.calls)} 次调用 · {formatInt(pointsOf(totals.chargedMicros))} 积分 ·
            成本 {formatYuan(totals.costMicros)} · 失败率 {formatPercent(totals.failureRate)}
          </span>
        )}
      </div>
      <DataTable<AdminUsageSummary['rows'][number]>
        rowKey={(row) => String(row.keys[0] ?? '')}
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRefresh={() => setRevision((v) => v + 1)}
        emptyTitle="这段时间没有调用"
        emptyHint="换一个时间范围试试；如果刚上线还没有用户聊天，这里就是空的。"
        footer={
          data?.truncated
            ? '结果太多，只显示前 200 组。缩小时间范围可以看到全部。'
            : undefined
        }
      />
    </Page>
  );
}
