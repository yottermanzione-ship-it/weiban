import { useMemo, useState } from 'react';
import { Button, Select, Space } from 'antd';
import { DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import {
  ModelAccessAdminUsageEndpoints as E,
  AdminTaskState,
  type AdminModelTask,
  type AdminTaskAttempt,
  type AdminTaskFilter,
  type VoiceCancellationReason,
  type AdminModelLabel,
  type Upstream,
} from '@weiban/contracts';
import { UserIdentity, UserPicker } from '../users/identity.js';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import { RecordDrawer } from '../../ui/drawer.js';
import { StatusTag, useToast } from '../../ui/page.js';
import { downloadCsvRows } from '../../ui/csv.js';
import { formatDateTime, formatYuan, pointsOf } from '../../ui/format.js';
import { ERROR_LABELS, PURPOSE_LABELS, rangeOf, type RangeKey } from './shared.js';
import { STATE_LABELS, ERROR_HELP, RECEIPT_REASONS, explainError } from './outcome-labels.js';

const options = (labels: Record<string, string>) =>
  Object.entries(labels).map(([value, label]) => ({ value, label }));
const money = (v: number) => formatYuan(v, 6);
const ms = (v: number | null | undefined) => (v == null ? '未记录' : v + ' ms');
const points = (v: number | null) => (v === null ? '未核实' : pointsOf(v).toFixed(4));
function Pager({
  pages,
  next,
  busy,
  setPages,
}: {
  pages: (string | undefined)[];
  next?: string | null;
  busy: boolean;
  setPages: (next: (string | undefined)[]) => void;
}) {
  return (
    <div className="cursor-pager">
      <Button
        size="small"
        disabled={busy || pages.length === 1}
        onClick={() => setPages(pages.slice(0, -1))}
      >
        上一页
      </Button>
      <span>第 {pages.length} 页</span>
      <Button
        size="small"
        disabled={!next || busy}
        onClick={() => next && setPages([...pages, next])}
      >
        下一页
      </Button>
    </div>
  );
}
function Result({ task: t }: { task: AdminModelTask }) {
  const good = [
    'message_saved',
    'proactive_sent',
    'thought_visible',
    'summary_saved',
    'result_saved',
  ].includes(t.state);
  return (
    <Space wrap size={4}>
      <StatusTag
        tone={
          good
            ? 'success'
            : t.state === 'undelivered'
              ? 'error'
              : t.state === 'running'
                ? 'processing'
                : 'default'
        }
      >
        {STATE_LABELS[t.state]}
      </StatusTag>
      {t.rescued && <StatusTag tone="success">备用救回</StatusTag>}
    </Space>
  );
}
export function ModelTasksTab({
  range,
  state,
  rescued,
  models,
  upstreams,
  usageRecordId,
}: {
  usageRecordId?: string;
  range: RangeKey;
  state: string | null;
  rescued: boolean;
  models: AdminModelLabel[];
  upstreams: Upstream[];
}) {
  const [period, setPeriod] = useState(range);
  const dates = useMemo(() => rangeOf(period), [period]);
  const [status, setStatus] = useState<AdminTaskState | undefined>(
    AdminTaskState.safeParse(state).data,
  );
  const [rescue, setRescue] = useState(rescued);
  const [errorCode, setCode] = useState<string>();
  const [modelKey, setModel] = useState<string>();
  const [upstreamId, setAccount] = useState<string>();
  const [users, setUsers] = useState<string[]>([]);
  const [purpose, setPurpose] = useState<AdminTaskFilter['purpose']>();
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const [selected, setSelected] = useState<AdminModelTask | null>(null);
  const [exporting, setExporting] = useState(false);
  const toast = useToast();
  const filter: AdminTaskFilter = {
    ...dates,
    usageRecordId,
    userIds: users.length ? users : undefined,
    state: status,
    rescued: rescue || undefined,
    errorCode,
    modelKey,
    upstreamId,
    purpose,
  };
  const page = useRemote(E.listModelTasks, { body: { filter, limit: 40, cursor: pages.at(-1) } });
  const reset = () => setPages([undefined]);
  const reasonName = (k: string) => ERROR_LABELS[k] ?? k;
  const columns: ProColumns<AdminModelTask>[] = [
    { title: '开始时间', width: 162, render: (_, v) => formatDateTime(v.startedAt) },
    {
      title: '任务',
      render: (_, v) => (
        <div className="cell-main">
          <strong>{PURPOSE_LABELS[v.purpose] ?? v.purpose}</strong>
          <span className="cell-sub">{v.firstModel ?? '未记录模型'}</span>
        </div>
      ),
    },
    {
      title: '用户',
      width: 156,
      render: (_, v) => <UserIdentity userId={v.userId} label={v.userLabel ?? undefined} />,
    },
    { title: '业务结果', render: (_, v) => <Result task={v} /> },
    { title: '线路尝试', render: (_, v) => `${v.attemptCount} 次 · ${v.failedAttempts} 次失败` },
    {
      title: '用户扣 / 退（积分）',
      render: (_, v) => points(v.chargedMicros) + ' / ' + points(v.refundedMicros),
    },
    {
      title: '上游成本',
      render: (_, v) => (
        <div className="cell-main">
          <span>已计 {money(v.reportedCostMicros)}</span>
          <span className="cell-sub">
            估算 {money(v.estimatedCostMicros)}
            {v.pendingCosts > 0 ? ` · ${v.pendingCosts} 笔待核` : ''}
          </span>
        </div>
      ),
    },
    {
      title: '操作',
      width: 75,
      render: (_, v) => (
        <Button type="link" onClick={() => setSelected(v)}>
          详情
        </Button>
      ),
    },
  ];
  async function exportTasks() {
    setExporting(true);
    try {
      const result = await api.call(E.exportModelTasks, { body: { filter } });
      downloadCsvRows(
        '模型任务结果',
        [
          '开始时间',
          '用途',
          '业务结果',
          '备用救回',
          '尝试次数',
          '失败次数',
          '用户扣除积分',
          '用户退款积分',
          '已计成本（元）',
          '估算成本（元）',
          '待核笔数',
        ],
        result.items.map((t) => [
          formatDateTime(t.startedAt),
          PURPOSE_LABELS[t.purpose] ?? t.purpose,
          STATE_LABELS[t.state],
          t.rescued ? '是' : '否',
          t.attemptCount,
          t.failedAttempts,
          points(t.chargedMicros),
          points(t.refundedMicros),
          t.reportedCostMicros / 1e6,
          t.estimatedCostMicros / 1e6,
          t.pendingCosts,
        ]),
      );
      toast.success(
        result.truncated
          ? `已导出前 ${result.items.length} 项，缩小日期可查看更多。`
          : `已导出 ${result.items.length} 项`,
      );
    } catch (e) {
      toast.error(errorText(e));
    } finally {
      setExporting(false);
    }
  }
  return (
    <>
      {usageRecordId && (
        <p>
          已定位到这条调用所属的任务。<a href="/usage?view=tasks">查看全部任务</a>
        </p>
      )}
      <div className="filter-panel usage-filters task-result-filters">
        <Select
          aria-label="任务时间"
          value={period}
          options={options({ today: '今天', '7d': '近 7 天', '30d': '近 30 天', month: '本月' })}
          onChange={(v) => {
            setPeriod(v);
            reset();
          }}
        />
        <Select
          aria-label="业务结果"
          placeholder="全部业务结果"
          allowClear
          value={status}
          options={options(STATE_LABELS)}
          onChange={(v) => {
            setStatus(v);
            reset();
          }}
        />
        <Select
          aria-label="备用救回筛选"
          value={rescue ? 'rescued' : 'all'}
          options={options({ all: '全部任务', rescued: '仅备用救回' })}
          onChange={(v) => {
            setRescue(v === 'rescued');
            reset();
          }}
        />
        <Select
          aria-label="任务用途"
          placeholder="全部用途"
          allowClear
          value={purpose}
          options={options(PURPOSE_LABELS)}
          onChange={(v) => {
            setPurpose(v);
            reset();
          }}
        />
        <UserPicker
          multiple
          placeholder="任务用户（昵称、账号或编号）"
          value={users}
          onChange={(v) => {
            setUsers(v);
            reset();
          }}
        />
        <Select
          aria-label="任务模型"
          placeholder="全部模型"
          allowClear
          showSearch
          optionFilterProp="label"
          value={modelKey}
          options={models.map((m) => ({ value: m.modelKey, label: m.displayName }))}
          onChange={(v) => {
            setModel(v);
            reset();
          }}
        />
        <Select
          aria-label="任务线路"
          placeholder="全部线路"
          allowClear
          showSearch
          optionFilterProp="label"
          value={upstreamId}
          options={upstreams.map((u) => ({ value: u.upstreamId, label: u.name }))}
          onChange={(v) => {
            setAccount(v);
            reset();
          }}
        />
        <Select
          aria-label="任务错误类型"
          placeholder="全部错误"
          allowClear
          value={errorCode}
          options={Object.keys(ERROR_HELP).map((k) => ({ value: k, label: reasonName(k) }))}
          onChange={(v) => {
            setCode(v);
            reset();
          }}
        />
        <Button
          icon={<ReloadOutlined />}
          onClick={() => {
            reset();
            page.refresh();
          }}
        >
          刷新
        </Button>
        <Button icon={<DownloadOutlined />} loading={exporting} onClick={() => void exportTasks()}>
          导出筛选结果
        </Button>
      </div>
      <DataTable<AdminModelTask>
        rowKey="taskKey"
        columns={columns}
        data={page.data?.items ?? []}
        loading={page.loading}
        error={page.error}
        onRefresh={page.refresh}
        onRowClick={setSelected}
        pagination={false}
        emptyTitle="这段时间没有匹配的任务"
        footer={
          <Pager
            pages={pages}
            setPages={setPages}
            next={page.data?.nextCursor}
            busy={page.loading}
          />
        }
      />
      {selected && (
        <TaskDrawer key={selected.taskKey} task={selected} close={() => setSelected(null)} />
      )}
    </>
  );
}
function TaskDrawer({ task, close }: { task: AdminModelTask; close: () => void }) {
  const [pages, setPages] = useState<(string | undefined)[]>([undefined]);
  const page = useRemote(E.listTaskAttempts, {
    body: { taskKey: task.taskKey, limit: 40, cursor: pages.at(-1) },
  });
  return (
    <RecordDrawer
      open
      onClose={close}
      width={790}
      title="任务详情"
      subtitle={PURPOSE_LABELS[task.purpose] ?? task.purpose}
    >
      <Result task={task} />
      <p>
        用户 <UserIdentity compact userId={task.userId} label={task.userLabel ?? undefined} />{' '}
        {task.conversationKind === 'group'
          ? '· 群聊'
          : task.conversationKind === 'direct'
            ? '· 私聊'
            : ''}{' '}
        {task.promptTemplateVersion && ' · ' + task.promptTemplateVersion}
      </p>
      <p>
        开始 {formatDateTime(task.startedAt)} · 最后更新 {formatDateTime(task.updatedAt)}
      </p>
      {task.retryAt && <p>下次重试 {formatDateTime(task.retryAt)}</p>}
      {task.reason && (
        <p>{RECEIPT_REASONS[task.reason] ?? ERROR_LABELS[task.reason] ?? task.reason}</p>
      )}
      <p>
        用户原扣 {points(task.chargedMicros)} 积分 · 已退 {points(task.refundedMicros)} 积分
      </p>
      {page.error && (
        <p role="alert">
          {page.error} <Button onClick={page.refresh}>重试</Button>
        </p>
      )}
      {page.loading && <p>正在读取线路尝试…</p>}
      {page.data?.items.map((a) => (
        <Attempt key={a.usageRecordId} item={a} />
      ))}
      {page.data && !page.data.items.length && <p>没有登记线路尝试。</p>}
      <Pager pages={pages} setPages={setPages} next={page.data?.nextCursor} busy={page.loading} />
    </RecordDrawer>
  );
}
const cancellationLabels: Record<VoiceCancellationReason, string> = {
  authorization_denied: '网关未获本段发送授权',
  realtime_open_failed: '实时语音连接建立失败，释放预留的回应段',
  unused_asr_segment: '语音识别结束，释放未使用的音频段',
  unused_realtime_segment: '实时通话结束，释放未使用的下一段回应',
  realtime_time_limit: '实时通话达到时长上限',
  realtime_insufficient_balance: '实时通话因余额不足结束',
  realtime_failed: '实时通话因故障结束',
  clone_not_started: '音色复刻未开始',
};
function Attempt({ item: a }: { item: AdminTaskAttempt }) {
  const d = a.diagnostic;
  return (
    <section className="detail-section">
      <h3>
        {formatDateTime(a.createdAt)} · {a.upstreamName ?? '账号名称不可用'}
        {a.routePriority != null && ` · 优先级 ${a.routePriority}`}
      </h3>
      <p>
        {a.modelKey} · {a.upstreamModelId}
      </p>
      <p>
        {
          {
            sent: '已派发到适配器',
            authorized: '已授权发送',
            not_sent: '发送前结束',
            unknown: '派发证据不足',
          }[a.sent]
        }{' '}
        ·{' '}
        {a.status === 'succeeded'
          ? '模型返回成功'
          : a.status === 'pending'
            ? '进行中'
            : (ERROR_LABELS[a.errorCode ?? ''] ?? a.errorCode ?? '调用失败')}
      </p>
      {a.errorCode && <p>{explainError(a.errorCode)}</p>}
      {a.errorCode === 'request_too_large' && (
        <p>
          {a.requestPriceLimit ? (
            <>
              预计售价 {points(a.requestPriceLimit.estimatedSellMicros)} 积分（
              {money(a.requestPriceLimit.estimatedSellMicros)}） · 单次保护上限{' '}
              {points(a.requestPriceLimit.limitMicros)} 积分（
              {money(a.requestPriceLimit.limitMicros)}）
            </>
          ) : (
            '该历史记录未保存拦截时的预计售价和上限。'
          )}
        </p>
      )}
      {a.errorCode === 'cancelled' && (
        <p>
          {a.holdStatus === 'released' && '预留额度已释放。'}
          {a.cancellationReason ? cancellationLabels[a.cancellationReason] : '具体取消原因未记录。'}
        </p>
      )}
      <p>
        获配总窗口 {ms(a.deadlineMs)} · 适配器实耗 {ms(a.adapterElapsedMs)} · 空闲等待窗{' '}
        {ms(a.timeoutMs)} · 进度等待窗 {ms(a.progressTimeoutMs)}
      </p>
      <p>
        未命中输入 {a.inputTokens} token · 缓存命中 {a.cachedInputTokens} · 缓存写入（5 分钟 / 1
        小时）{a.cacheWrite5mTokens} / {a.cacheWrite1hTokens} · 输出 {a.outputTokens}
        {a.reasoningTokens != null && `（其中思考 ${a.reasoningTokens}）`}
      </p>
      <p>
        计价版本{' '}
        <span title={a.priceVersionId ?? undefined}>
          {a.priceVersionLabel ?? a.priceVersionId ?? '历史未记录'}
        </span>{' '}
        · {a.estimated ? '含本地计量或估算' : '记录的用量'}
        ；输入包括发送给模型的上下文，输出是本次生成量。
      </p>
      {(a.overallRemainingMs != null || a.crossModelReserveMs != null) && (
        <p>
          派发前全链剩余 {ms(a.overallRemainingMs)} · 计划留给跨模型备用 {ms(a.crossModelReserveMs)}
        </p>
      )}
      <p>
        本次记录耗时 {ms(a.latencyMs)} · 用户扣除 {points(a.chargedMicros)} 积分 · 退款{' '}
        {points(a.refundedMicros)} 积分
      </p>
      <p>
        {a.costKnown ? (a.estimated ? '本地计量或估算成本' : '已记成本') : '成本待核'}{' '}
        {money(a.costMicros)} · 平台吸收 {money(a.absorbedCostMicros)}
      </p>
      {d && (
        <dl className="detail-grid">
          {Object.entries(d)
            .filter(([, v]) => v != null)
            .map(([k, v]) => (
              <div key={k}>
                <dt>{DIAG_LABELS[k] ?? k}</dt>
                <dd>{String(v)}</dd>
              </div>
            ))}
        </dl>
      )}
    </section>
  );
}
const DIAG_LABELS: Record<string, string> = {
  stage: '最后阶段',
  httpStatus: 'HTTP 状态',
  providerCode: '供应商错误码',
  requestId: '供应商追踪号',
  retryAfterMs: '建议等待（毫秒）',
  lastDataMs: '最后数据到达（毫秒）',
  lastProgressMs: '最后有效进度（毫秒）',
  firstProgressMs: '首次有效进度（毫秒）',
  emptyKind: '空响应类型',
  requestField: '请求字段',
  switchReason: '切换条件',
  failureDomain: '上游入口标识',
  rateLimitScope: '限流范围',
};
