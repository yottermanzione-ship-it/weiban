import { downloadCsvRows } from '../../ui/csv.js';
import { useEffect, useMemo, useState } from 'react';
import { Button, DatePicker, Input, Select, Space, Tag, Typography } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import {
  ModelAccessAdminUsageEndpoints,
  Id,
  ModelKey,
  type AdminModelLabel,
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
import { UserIdentity, shortUserId, userDisplayName, UserPicker } from '../users/identity.js';
import {
  ERROR_LABELS,
  PURPOSE_LABELS,
  fromLocalInput,
  modelLabel,
  rangeOf,
  stripDeletedSuffix,
  toLocalInput,
  type RangeKey,
} from './shared.js';

const PAGE_SIZE = 50;
export type RecordQuality = '' | 'estimated' | 'cost_pending';

function usageSource(record: AdminUsageRecord) {
  if (record.estimated) {
    if (record.ttsChars !== undefined) return '按字数计量';
    return '本地估算';
  }
  return record.status === 'failed' && !record.inputTokens && !record.outputTokens
    ? '未记录'
    : '已计量';
}

export function RecordsTab({
  upstreams,
  models,
  initial,
}: {
  upstreams: Upstream[];
  models: AdminModelLabel[];
  initial: {
    upstreamId: string;
    modelKey: string;
    status: '' | 'succeeded' | 'failed';
    quality: RecordQuality;
    range: RangeKey;
  };
}) {
  const toast = useToast();
  const [period, setPeriod] = useState(() => rangeOf(initial.range));
  const range: [Dayjs, Dayjs] = [dayjs(toLocalInput(period.from)), dayjs(toLocalInput(period.to))];
  const [userIds, setUserIds] = useState<string[]>([]);
  const [characterInput, setCharacterInput] = useState('');
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [modelKey, setModelKey] = useState(() => ModelKey.safeParse(initial.modelKey).data ?? '');
  const [upstreamId, setUpstreamId] = useState(() => Id.safeParse(initial.upstreamId).data ?? '');
  const [purpose, setPurpose] = useState('');
  const [status, setStatus] = useState<'' | 'succeeded' | 'failed'>(initial.status);
  const [quality, setQuality] = useState(initial.quality);
  const [revision, setRevision] = useState(0);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [page, setPage] = useState<{ items: AdminUsageRecord[]; nextCursor: string | null }>();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<AdminUsageRecord | null>(null);

  const filter = useMemo<AdminUsageFilter>(
    () => ({
      ...period,
      ...(userIds.length ? { userIds } : {}),
      ...(characterIds.length ? { characterIds } : {}),
      ...(modelKey ? { modelKeys: [modelKey] } : {}),
      ...(upstreamId ? { upstreamIds: [upstreamId] } : {}),
      ...(purpose ? { purposes: [purpose as never] } : {}),
      ...(status ? { status } : {}),
      ...(quality === 'estimated' ? { estimated: true } : {}),
      ...(quality === 'cost_pending' ? { costKnown: false } : {}),
    }),
    [period, userIds, characterIds, modelKey, upstreamId, purpose, status, quality],
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
  }, [filter, cursor, revision]);

  function applyCharacterFilter() {
    const ids = [
      ...new Set(
        characterInput
          .trim()
          .split(/[,，\s]+/)
          .filter(Boolean),
      ),
    ];
    if (ids.length > 50 || ids.some((id) => !Id.safeParse(id).success)) {
      toast.warning('请输入有效的角色 ID，最多 50 个。');
      return;
    }
    setCharacterIds(ids);
    setCursors([undefined]);
    setRevision((value) => value + 1);
  }

  const upstreamName = (id: string) => {
    const u = upstreams.find((x) => x.upstreamId === id);
    return u ? (u.deletedAt ? `${u.name}（已删除）` : u.name) : '未知账号';
  };
  /**
   * 3.27：历史调用记录的模型键可能带 `#deleted:<随机>` 后缀或没有厂商前缀（契约已放宽，见 AdminModelLabelKey）。
   * 显示名去掉后缀；完整键留在副行 / 详情里供核对，不因为键不规范丢掉整行。
   */
  const modelName = (key: string) => stripDeletedSuffix(modelLabel(models, key));

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
        '其中思考token',
        '音频输入token',
        '音频输出token',
        '合成字数',
        '识别秒数',
        '用量来源',
        '耗时ms',
        '已记上游成本(元)',
        '成本状态',
        '用户扣除(积分)',
        '状态',
        '错误类型',
      ];
      const rows = r.items.map((x) => [
        formatDateTime(x.createdAt),
        userDisplayName(x.userId, { nickname: x.nickname, username: x.username }) +
          ' (' +
          shortUserId(x.userId) +
          ')',
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
        x.reasoningTokens ?? '',
        x.audioInputTokens ?? '',
        x.audioOutputTokens ?? '',
        x.ttsChars ?? '',
        x.asrSeconds ?? '',
        usageSource(x),
        x.latencyMs,
        (x.costMicros / 1_000_000).toFixed(4),
        x.costKnown === false ? '待核' : x.costKnown ? '已记' : '未知',
        pointsOf(x.chargedMicros).toFixed(2),
        x.status === 'succeeded' ? '成功' : '失败',
        x.errorCode ?? '',
      ]);
      downloadCsvRows('调用记录-' + new Date().toISOString().slice(0, 10), header, rows);
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
      render: (_, r) => (
        <button
          type="button"
          className="usage-record-open"
          aria-label={`查看 ${formatDateTime(r.createdAt)} 调用详情`}
          onClick={(event) => {
            event.stopPropagation();
            setDetail(r);
          }}
        >
          {formatDateTime(r.createdAt)}
        </button>
      ),
    },
    {
      title: '模型',
      width: 190,
      render: (_, r) => (
        <div className="cell-main">
          {/* 3.27：显示名去掉 `#deleted:` 后缀；副行保留完整键 + 线路，方便和账本核对。 */}
          <span className="cell-title">{modelName(r.modelKey)}</span>
          <span className="cell-sub">
            {upstreamName(r.upstreamId)} · {PURPOSE_LABELS[r.purpose] ?? r.purpose}
          </span>
        </div>
      ),
    },
    {
      title: '用户',
      width: 112,
      render: (_, r) => (
        <UserIdentity
          compact
          userId={r.userId}
          label={{ nickname: r.nickname, username: r.username }}
        />
      ),
    },
    {
      title: '用量',
      width: 150,
      render: (_, r) => (
        <div className="cell-main">
          <span>
            {r.ttsChars !== undefined
              ? `${formatInt(r.ttsChars)} 字`
              : r.asrSeconds !== undefined
                ? `${r.asrSeconds} 秒`
                : r.inputTokens || r.cachedInputTokens || r.outputTokens
                  ? `${formatInt(r.inputTokens + r.cachedInputTokens + (r.cacheWrite5mTokens ?? 0) + (r.cacheWrite1hTokens ?? 0))} / ${formatInt(r.outputTokens)} token`
                  : '—'}
          </span>
          <span className={r.estimated ? 'usage-estimate-label' : 'cell-sub'}>
            {usageSource(r)}
          </span>
        </div>
      ),
    },
    {
      title: '已记上游成本',
      width: 110,
      render: (_, r) => (
        <span className="cell-main">
          <span>{r.costKnown === false && !r.costMicros ? '—' : formatYuan(r.costMicros, 4)}</span>
          {r.costKnown === false && <span className="usage-estimate-label">成本待核</span>}
        </span>
      ),
    },
    {
      title: '用户扣除',
      width: 110,
      render: (_, r) =>
        r.billingOwner === 'platform' ? '平台承担' : `${pointsOf(r.chargedMicros).toFixed(2)} 积分`,
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
    <div className="admin-stack">
      <div className="usage-record-actions">
        <span>点时间查看单次调用的用量和费用。</span>
        <Space size={8}>
          <Button icon={<DownloadOutlined />} onClick={() => void exportCsv()}>
            导出 CSV
          </Button>
        </Space>
      </div>
      <div className="filter-panel usage-filters">
        <DatePicker.RangePicker
          showTime={{ format: 'HH:mm' }}
          format="YYYY-MM-DD HH:mm"
          value={range}
          onChange={(v) => {
            if (v?.[0] && v[1]) {
              setPeriod({
                from: fromLocalInput(v[0].format('YYYY-MM-DDTHH:mm')),
                to: fromLocalInput(v[1].format('YYYY-MM-DDTHH:mm')),
              });
              setCursors([undefined]);
            }
          }}
          allowClear={false}
        />
        <UserPicker
          multiple
          placeholder="用户（可多选昵称、账号或编号）"
          value={userIds}
          onChange={(ids) => {
            setUserIds(ids);
            setCursors([undefined]);
          }}
        />
        <Input
          style={{ width: 160 }}
          placeholder="角色 ID（可多个）"
          aria-label="角色 ID"
          value={characterInput}
          onChange={(e) => setCharacterInput(e.target.value)}
          onPressEnter={applyCharacterFilter}
        />
        <Select
          style={{ width: 170 }}
          value={modelKey}
          aria-label="模型筛选"
          onChange={(value) => {
            setModelKey(value);
            setCursors([undefined]);
          }}
          options={[
            { value: '', label: '全部模型' },
            ...[
              ...new Set(
                [modelKey, ...models.map((m) => m.modelKey)].filter(
                  (key) => ModelKey.safeParse(key).success,
                ),
              ),
            ].map((key) => ({
              value: key,
              label: modelName(key),
            })),
          ]}
        />
        <Select
          style={{ width: 150 }}
          value={upstreamId}
          aria-label="上游账号筛选"
          onChange={(value) => {
            setUpstreamId(value);
            setCursors([undefined]);
          }}
          options={[
            { value: '', label: '全部上游账号' },
            ...upstreams.map((u) => ({ value: u.upstreamId, label: upstreamName(u.upstreamId) })),
          ]}
        />
        <Select
          style={{ width: 130 }}
          value={purpose}
          aria-label="用途筛选"
          onChange={(value) => {
            setPurpose(value);
            setCursors([undefined]);
          }}
          options={[
            { value: '', label: '全部用途' },
            ...Object.entries(PURPOSE_LABELS).map(([value, label]) => ({ value, label })),
          ]}
        />
        <Select
          style={{ width: 110 }}
          value={status}
          aria-label="调用结果筛选"
          onChange={(value) => {
            setStatus(value);
            setCursors([undefined]);
          }}
          options={[
            { value: '', label: '全部状态' },
            { value: 'succeeded', label: '成功' },
            { value: 'failed', label: '失败' },
          ]}
        />
        <Select<RecordQuality>
          style={{ width: 156 }}
          value={quality}
          aria-label="用量与成本筛选"
          onChange={(value) => {
            setQuality(value);
            setCursors([undefined]);
          }}
          options={[
            { value: '', label: '全部计量状态' },
            { value: 'estimated', label: '本地计量或估算' },
            { value: 'cost_pending', label: '成本待核' },
          ]}
        />
        <Button icon={<ReloadOutlined />} onClick={applyCharacterFilter}>
          刷新
        </Button>
      </div>
      <DataTable<AdminUsageRecord>
        rowKey="usageRecordId"
        columns={columns}
        showTools={false}
        data={page?.items ?? []}
        loading={loading}
        error={error}
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
              {/* 3.27：详情保留完整模型键（显示名去掉了 `#deleted:` 后缀）。 */}
              <span className="cell-sub mono">{detail.modelKey}</span>
            </div>
            <div>
              <span className="detail-label">实际模型名</span>
              <span className="mono">{detail.upstreamModelId ?? '—'}</span>
            </div>
            <div>
              <span className="detail-label">用户</span>
              <span>
                {userDisplayName(detail.userId, {
                  nickname: detail.nickname,
                  username: detail.username,
                })}{' '}
                <Typography.Text
                  type="secondary"
                  copyable={{ text: detail.userId }}
                  className="mono"
                >
                  {shortUserId(detail.userId)}
                </Typography.Text>
              </span>
            </div>
            <div>
              <span className="detail-label">角色</span>
              <span className="mono">
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
              <span className="detail-label">计量来源</span>
              <span>{usageSource(detail)}</span>
            </div>
            {(detail.ttsChars !== undefined || detail.asrSeconds !== undefined) && (
              <div>
                <span className="detail-label">语音用量</span>
                <span>
                  {detail.ttsChars !== undefined
                    ? `合成 ${formatInt(detail.ttsChars)} 字`
                    : `识别 ${detail.asrSeconds} 秒`}
                </span>
              </div>
            )}
            <div>
              <span className="detail-label">文字 token</span>
              <span>
                未命中输入 {formatInt(detail.inputTokens)}（缓存读取{' '}
                {formatInt(detail.cachedInputTokens)}
                {(detail.cacheWrite5mTokens ?? 0) + (detail.cacheWrite1hTokens ?? 0) > 0
                  ? ` · 缓存写入 ${formatInt(detail.cacheWrite5mTokens ?? 0)}${
                      detail.cacheWrite1hTokens
                        ? ` + 1 小时 ${formatInt(detail.cacheWrite1hTokens)}`
                        : ''
                    }`
                  : ''}
                ）· 输出 {formatInt(detail.outputTokens)}
                {detail.reasoningTokens !== undefined
                  ? `（含思考 ${formatInt(detail.reasoningTokens)}）`
                  : ''}
              </span>
            </div>
            {(detail.audioInputTokens !== undefined || detail.audioOutputTokens !== undefined) && (
              <div>
                <span className="detail-label">音频用量</span>
                <span>
                  输入{' '}
                  {detail.audioInputTokens === undefined
                    ? '未报告'
                    : formatInt(detail.audioInputTokens)}{' '}
                  · 输出{' '}
                  {detail.audioOutputTokens === undefined
                    ? '未报告'
                    : formatInt(detail.audioOutputTokens)}{' '}
                  token（供应商报告）
                </span>
              </div>
            )}
            <div>
              <span className="detail-label">耗时</span>
              <span>
                {formatInt(detail.latencyMs)} ms
                {detail.ttftMs != null ? ` · 首字 ${formatInt(detail.ttftMs)} ms` : ''} · 重试{' '}
                {detail.retryCount} 次
              </span>
            </div>
            <div>
              <span className="detail-label">已记上游成本</span>
              <span>
                {detail.costKnown === false && !detail.costMicros
                  ? '—'
                  : formatYuan(detail.costMicros, 4)}
                {detail.costKnown === false ? '（成本待核）' : ''}
              </span>
            </div>
            <div>
              <span className="detail-label">用户扣除</span>
              <span>
                {detail.billingOwner === 'platform'
                  ? '平台承担'
                  : `${pointsOf(detail.chargedMicros).toFixed(2)} 积分`}
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
