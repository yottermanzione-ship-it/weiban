import { useEffect, useMemo, useState } from 'react';
import { Alert, Button, DatePicker, Input, Select, Space, Tag } from 'antd';
import { DownloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  ModelAccessAdminUsageEndpoints,
  type AdminModel,
  type AdminUsageFilter,
  type AdminUsageRecord,
  type Upstream,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText } from '../../data/hooks.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import { RecordDrawer } from '../../ui/drawer.js';
import { StatusTag, useToast } from '../../ui/page.js';
import { formatDateTime, formatInt, formatYuan, pointsOf } from '../../ui/format.js';
import {
  ERROR_LABELS,
  PURPOSE_LABELS,
  fromLocalInput,
  modelLabel,
  rangeOf,
  toLocalInput,
} from './shared.js';

const PAGE_SIZE = 50;

export function RecordsTab({
  upstreams,
  models,
  initial,
}: {
  upstreams: Upstream[];
  models: AdminModel[];
  initial: { upstreamId: string; modelKey: string; status: '' | 'failed' };
}) {
  const toast = useToast();
  const start = rangeOf('7d');
  const [range, setRange] = useState<[Dayjs, Dayjs]>([
    dayjs(toLocalInput(start.from)),
    dayjs(toLocalInput(start.to)),
  ]);
  const [userId, setUserId] = useState('');
  const [characterId, setCharacterId] = useState('');
  const [modelKey, setModelKey] = useState(initial.modelKey);
  const [upstreamId, setUpstreamId] = useState(initial.upstreamId);
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState<'' | 'succeeded' | 'failed'>(initial.status);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<{ items: AdminUsageRecord[]; nextCursor: string | null }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AdminUsageRecord | null>(null);

  const filter = useMemo<AdminUsageFilter>(
    () => ({
      from: fromLocalInput(range[0].format('YYYY-MM-DDTHH:mm')),
      to: fromLocalInput(range[1].format('YYYY-MM-DDTHH:mm')),
      ...(userId.trim() ? { userIds: userId.split(/[,，\s]+/).filter(Boolean) } : {}),
      ...(characterId.trim()
        ? { characterIds: characterId.split(/[,，\s]+/).filter(Boolean) }
        : {}),
      ...(modelKey ? { modelKeys: [modelKey] } : {}),
      ...(upstreamId ? { upstreamIds: [upstreamId] } : {}),
      ...(purpose ? { purposes: [purpose as never] } : {}),
      ...(status ? { status } : {}),
    }),
    [range, userId, characterId, modelKey, upstreamId, purpose, status],
  );

  const cursor = cursors.at(-1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .call(ModelAccessAdminUsageEndpoints.listUsageRecords, {
        body: { filter, limit: PAGE_SIZE, ...(cursor ? { cursor } : {}) },
      })
      .then((r) => active && setPage(r))
      .catch((e: unknown) => active && setError(errorText(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [filter, cursor]);

  const upstreamName = (id: string) => {
    const u = upstreams.find((x) => x.upstreamId === id);
    return u ? (u.deletedAt ? `${u.name}（已删除）` : u.name) : '未知账号';
  };
  const modelName = (key: string) => modelLabel(models, key);

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
        '缓存写入5分钟token',
        '缓存写入1小时token',
        '输出token',
        '耗时ms',
        '上游成本(元)',
        '用户扣除(积分)',
        '状态',
        '错误类型',
      ];
      const lines = r.items.map((x) =>
        [
          formatDateTime(x.createdAt),
          x.userId,
          x.characterId ?? '',
          PURPOSE_LABELS[x.purpose] ?? x.purpose,
          x.modelKey,
          upstreamName(x.upstreamId),
          x.upstreamModelId ?? '',
          x.inputTokens,
          x.cachedInputTokens,
          x.cacheWrite5mTokens ?? 0,
          x.cacheWrite1hTokens ?? 0,
          x.outputTokens,
          x.latencyMs,
          (x.costMicros / 1_000_000).toFixed(4),
          pointsOf(x.chargedMicros).toFixed(2),
          x.status === 'succeeded' ? '成功' : '失败',
          x.errorCode ?? '',
        ]
          .map((v) => `"${String(v).replace(/"/g, '""')}"`)
          .join(','),
      );
      const blob = new Blob(['\ufeff' + [header.join(','), ...lines].join('\n')], {
        type: 'text/csv;charset=utf-8',
      });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `调用记录-${new Date().toISOString().slice(0, 10)}.csv`;
      a.click();
      window.setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      if (r.truncated) toast.warning('结果太多，只导出了前 5 万行，请缩小时间范围');
      else toast.success(`已导出 ${r.items.length} 行`);
    } catch (e) {
      setError(errorText(e));
    }
  }

  const columns: ProColumns<AdminUsageRecord>[] = [
    {
      title: '时间',
      width: 150,
      render: (_, r) => formatDateTime(r.createdAt),
    },
    {
      title: '用途',
      width: 100,
      render: (_, r) => PURPOSE_LABELS[r.purpose] ?? r.purpose,
    },
    {
      title: '模型',
      width: 150,
      render: (_, r) => (
        <div className="cell-main">
          <span>{modelName(r.modelKey)}</span>
          <span className="cell-sub">{upstreamName(r.upstreamId)}</span>
        </div>
      ),
    },
    {
      title: '用户',
      width: 120,
      render: (_, r) => <span className="mono cell-sub">{r.userId.slice(0, 10)}…</span>,
    },
    {
      title: '输入 / 输出 token',
      width: 150,
      // 3.26：上游没返回用量、按本地估算计费的调用标「估算」
      render: (_, r) => (
        <span>
          {formatInt(r.inputTokens)} / {formatInt(r.outputTokens)}
          {r.estimated && (
            <Tag
              bordered={false}
              color="orange"
              style={{ marginLeft: 4 }}
              title="上游没返回用量，按本地分词估算计费"
            >
              估算
            </Tag>
          )}
        </span>
      ),
    },
    {
      title: '耗时',
      width: 90,
      sorter: (a, b) => a.latencyMs - b.latencyMs,
      render: (_, r) => `${formatInt(r.latencyMs)} ms`,
    },
    {
      title: '上游成本',
      width: 110,
      render: (_, r) => (
        <span className="cell-main">
          <span>{formatYuan(r.costMicros, 4)}</span>
          {r.costKnown !== true && <span className="cell-sub">待核</span>}
        </span>
      ),
    },
    {
      title: '用户扣除',
      width: 110,
      render: (_, r) => `${pointsOf(r.chargedMicros).toFixed(2)} 积分`,
    },
    {
      title: '状态',
      width: 110,
      render: (_, r) =>
        r.status === 'succeeded' ? (
          <StatusTag tone="success">成功</StatusTag>
        ) : (
          <StatusTag tone="error">
            {ERROR_LABELS[r.errorCode ?? ''] ?? r.errorCode ?? '失败'}
          </StatusTag>
        ),
    },
  ];

  return (
    <div className="tab-body">
      <div className="tab-head">
        <div className="tab-desc">
          <strong>调用记录</strong>
          <span>每一次模型调用的明细；不显示消息内容，只看花了多少、快不快、有没有失败。</span>
        </div>
        <Space size={8}>
          <Button icon={<DownloadOutlined />} onClick={() => void exportCsv()}>
            导出 CSV
          </Button>
        </Space>
      </div>
      <div className="filter-panel">
        <DatePicker.RangePicker
          showTime={{ format: 'HH:mm' }}
          format="YYYY-MM-DD HH:mm"
          value={range}
          onChange={(v) => {
            if (v?.[0] && v[1]) {
              setRange([v[0], v[1]]);
              setCursors([undefined]);
            }
          }}
          allowClear={false}
        />
        <Input
          style={{ width: 160 }}
          placeholder="用户 ID（可多个）"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Input
          style={{ width: 160 }}
          placeholder="角色 ID（可多个）"
          value={characterId}
          onChange={(e) => setCharacterId(e.target.value)}
        />
        <Select
          style={{ width: 170 }}
          value={modelKey}
          onChange={setModelKey}
          options={[
            { value: '', label: '全部模型' },
            ...[...new Set(models.map((m) => m.modelKey))].map((key) => ({
              value: key,
              label: modelName(key),
            })),
          ]}
        />
        <Select
          style={{ width: 150 }}
          value={upstreamId}
          onChange={setUpstreamId}
          options={[
            { value: '', label: '全部上游账号' },
            ...upstreams.map((u) => ({ value: u.upstreamId, label: upstreamName(u.upstreamId) })),
          ]}
        />
        <Select
          style={{ width: 130 }}
          value={purpose}
          onChange={setPurpose}
          options={[
            { value: '', label: '全部用途' },
            ...Object.entries(PURPOSE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          style={{ width: 110 }}
          value={status}
          onChange={setStatus}
          options={[
            { value: '', label: '全部状态' },
            { value: 'succeeded', label: '成功' },
            { value: 'failed', label: '失败' },
          ]}
        />
        <Button type="primary" onClick={() => setCursors([undefined])}>
          查询
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <DataTable<AdminUsageRecord>
        rowKey="usageRecordId"
        columns={columns}
        data={page?.items ?? []}
        loading={loading}
        pagination={false}
        onRowClick={(r) => setDetail(r)}
        emptyTitle="这段时间没有调用"
        emptyHint="换一个时间范围，或者把筛选条件放宽试试。"
        footer={
          <div className="cursor-pager">
            <Button
              size="small"
              disabled={cursors.length <= 1 || loading}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              上一页
            </Button>
            <span>
              第 {cursors.length} 页 · 每页 {PAGE_SIZE} 条
            </span>
            <Button
              size="small"
              disabled={!page?.nextCursor || loading}
              onClick={() => setCursors((c) => [...c, page!.nextCursor!])}
            >
              下一页
            </Button>
          </div>
        }
      />
      {detail && (
        <RecordDrawer
          open
          onClose={() => setDetail(null)}
          title="调用详情"
          subtitle={formatDateTime(detail.createdAt)}
          width={620}
        >
          <div className="detail-grid">
            <div>
              <span className="detail-label">用途</span>
              <span>{PURPOSE_LABELS[detail.purpose] ?? detail.purpose}</span>
            </div>
            <div>
              <span className="detail-label">谁付费</span>
              <span>{detail.billingOwner === 'platform' ? '平台' : '用户'}</span>
            </div>
            <div>
              <span className="detail-label">模型 / 线路</span>
              <span>
                {modelName(detail.modelKey)} · {upstreamName(detail.upstreamId)}
              </span>
            </div>
            <div>
              <span className="detail-label">实际模型名</span>
              <span className="mono">{detail.upstreamModelId ?? '—'}</span>
            </div>
            <div>
              <span className="detail-label">用户 / 角色</span>
              <span className="mono">
                {detail.userId.slice(0, 12)}… /{' '}
                {detail.characterId ? `${detail.characterId.slice(0, 8)}…` : '—'}
              </span>
            </div>
            <div>
              <span className="detail-label">会话</span>
              <span>
                {detail.conversationKind === 'group'
                  ? '群聊'
                  : detail.conversationKind === 'direct'
                    ? '私聊'
                    : '—'}
              </span>
            </div>
            <div>
              <span className="detail-label">token</span>
              <span>
                输入 {formatInt(detail.inputTokens)}（缓存读取 {formatInt(detail.cachedInputTokens)}
                {(detail.cacheWrite5mTokens ?? 0) + (detail.cacheWrite1hTokens ?? 0) > 0
                  ? ` · 缓存写入 ${formatInt(detail.cacheWrite5mTokens ?? 0)}${
                      detail.cacheWrite1hTokens
                        ? ` + 1 小时 ${formatInt(detail.cacheWrite1hTokens)}`
                        : ''
                    }`
                  : ''}
                ）· 输出 {formatInt(detail.outputTokens)}
                {detail.estimated ? '（估算）' : ''}
              </span>
            </div>
            <div>
              <span className="detail-label">耗时</span>
              <span>
                {formatInt(detail.latencyMs)} ms
                {detail.ttftMs != null ? ` · 首字 ${formatInt(detail.ttftMs)} ms` : ''} · 重试{' '}
                {detail.retryCount} 次
              </span>
            </div>
            <div>
              <span className="detail-label">上游成本</span>
              <span>
                {formatYuan(detail.costMicros, 4)}
                {detail.costKnown !== true ? '（仅已核部分，仍待核）' : ''}
              </span>
            </div>
            <div>
              <span className="detail-label">用户扣除</span>
              <span>
                {pointsOf(detail.chargedMicros).toFixed(2)} 积分
                {detail.absorbedCostMicros
                  ? ` · 平台吸收 ${formatYuan(detail.absorbedCostMicros, 4)}`
                  : ''}
                {detail.safetyOverdraft ? ' · 动用安全透支' : ''}
              </span>
            </div>
            <div>
              <span className="detail-label">状态</span>
              {detail.status === 'succeeded' ? (
                <StatusTag tone="success">成功</StatusTag>
              ) : (
                <Tag color="red">
                  {ERROR_LABELS[detail.errorCode ?? ''] ?? detail.errorCode ?? '失败'}
                </Tag>
              )}
            </div>
            <div>
              <span className="detail-label">调用 ID</span>
              <span className="mono">{detail.usageRecordId}</span>
            </div>
          </div>
          <div className="detail-muted">为保护隐私，这里不显示消息原文。</div>
        </RecordDrawer>
      )}
    </div>
  );
}
