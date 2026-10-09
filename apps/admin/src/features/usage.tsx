/**
 * 管理后台用量与费用页（ADM-08）。
 * 对接三个接口：usageSummary / listUsageRecords / exportUsageRecords。
 * CSV 导出在前端把 JSON 转成文件下载，不含任何消息内容。
 */
import { useState, type FormEvent } from 'react';
import {
  ModelAccessAdminUsageEndpoints,
  type AdminUsageRecord,
  type AdminUsageSummary,
  type AdminUsageFilter,
  type AdminUsageDimension,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

const PURPOSE_LABELS: Record<string, string> = {
  chat_reply: '聊天回复',
  memory: '记忆',
  simulation: '模拟',
  proactive: '主动消息',
  moments: '朋友圈',
  vision: '识图',
  voice: '语音',
  image_generation: '图片生成',
  web_search: '联网搜索',
  import_analysis: '导入分析',
  safety_check: '安全检查',
  safety_followup: '安全跟进',
  behavior_planning: '行为规划',
  admin_test: '管理员测试',
  admin_eval: '管理员评测',
  admin_persona_check: '人设稳定检查',
  admin_upstream_test: '上游连通测试',
};

const DIM_LABELS: Record<AdminUsageDimension, string> = {
  user: '用户',
  character: '角色',
  model: '模型',
  purpose: '用途',
  upstream: '上游',
  day: '日期',
};

function formatMicros(n: number): string {
  return `¥${(n / 1_000_000).toFixed(4)}`;
}

function formatNum(n: number): string {
  return n.toLocaleString('zh-CN');
}

function defaultRange(): { from: string; to: string } {
  const now = new Date();
  const from = new Date(now.getTime() - 7 * 86_400_000);
  const formatLocal = (d: Date) => {
    const s = d.toLocaleString('sv', { timeZone: 'Asia/Shanghai' });
    return s.slice(0, 16);
  };
  return { from: formatLocal(from), to: formatLocal(now) };
}

function toIso(local: string): string {
  return new Date(local + ':00+08:00').toISOString();
}

function exportCsv(items: AdminUsageRecord[], truncated: boolean): void {
  const header = [
    '调用时间',
    '用户ID',
    '角色ID',
    '会话类型',
    '用途',
    '计费归属',
    '模型',
    '上游ID',
    '输入Token',
    '缓存输入Token',
    '输出Token',
    '是否估算',
    '耗时(ms)',
    '状态',
    '错误码',
    '重试次数',
    '扣费(微元)',
    '成本(微元)',
    '平台吸收(微元)',
    '价目表版本',
    '安全透支',
  ].join(',');
  const rows = items.map((r) =>
    [
      r.createdAt,
      r.userId,
      r.characterId ?? '',
      r.conversationKind ?? '',
      r.purpose,
      r.billingOwner,
      r.modelKey,
      r.upstreamId,
      r.inputTokens,
      r.cachedInputTokens,
      r.outputTokens,
      r.estimated ? '是' : '否',
      r.latencyMs,
      r.status,
      r.errorCode ?? '',
      r.retryCount,
      r.chargedMicros,
      r.costMicros,
      r.absorbedCostMicros,
      r.priceVersionId ?? '',
      r.safetyOverdraft ? '是' : '否',
    ]
      .map((v) => `"${String(v).replace(/"/g, '""')}"`)
      .join(','),
  );
  const note = truncated ? '# 注意：结果已截断，请缩小筛选范围\n' : '';
  const blob = new Blob(['﻿' + note + header + '\n' + rows.join('\n')], {
    type: 'text/csv;charset=utf-8',
  });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = `usage-export-${Date.now()}.csv`;
  a.click();
  URL.revokeObjectURL(url);
}

export function UsagePage() {
  const range = defaultRange();
  const [from, setFrom] = useState(range.from);
  const [to, setTo] = useState(range.to);
  const [dim1, setDim1] = useState<AdminUsageDimension>('day');
  const [dim2, setDim2] = useState<AdminUsageDimension | ''>('');
  const [billingOwner, setBillingOwner] = useState<'user' | 'platform' | ''>('');
  const [status, setStatus] = useState<'succeeded' | 'failed' | ''>('');
  const [summary, setSummary] = useState<AdminUsageSummary | null>(null);
  const [records, setRecords] = useState<AdminUsageRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [tab, setTab] = useState<'summary' | 'detail'>('summary');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [exportPending, setExportPending] = useState(false);

  function buildFilter(): AdminUsageFilter {
    return {
      from: toIso(from),
      to: toIso(to),
      ...(billingOwner ? { billingOwner } : {}),
      ...(status ? { status } : {}),
    };
  }

  async function runSummary(e: FormEvent) {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const groupBy: AdminUsageDimension[] = dim2 ? [dim1, dim2] : [dim1];
      const res = await api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: { filter: buildFilter(), groupBy, sort: dim1 === 'day' ? 'key_asc' : 'charged_desc' },
      });
      setSummary(res);
      setTab('summary');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function runDetail(cursor?: string) {
    setError('');
    setLoading(true);
    try {
      const res = await api.call(ModelAccessAdminUsageEndpoints.listUsageRecords, {
        body: { filter: buildFilter(), cursor, limit: 50 },
      });
      setRecords(cursor ? (prev) => [...prev, ...res.items] : res.items);
      setNextCursor(res.nextCursor ?? null);
      setTab('detail');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  async function doExport() {
    setExportPending(true);
    setError('');
    try {
      const res = await api.call(ModelAccessAdminUsageEndpoints.exportUsageRecords, {
        body: { filter: buildFilter() },
      });
      exportCsv(res.items, res.truncated);
      if (res.truncated) setError('结果已截断（超过 50,000 行），请缩小筛选范围');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setExportPending(false);
    }
  }

  const totals = summary?.totals;

  return (
    <div className="stack">
      <h1>用量与费用</h1>

      <form className="form-grid" onSubmit={(e) => void runSummary(e)}>
        <label>
          开始时间（北京时间）
          <input
            type="datetime-local"
            value={from}
            onChange={(e) => setFrom(e.target.value)}
            required
          />
        </label>
        <label>
          结束时间（北京时间）
          <input
            type="datetime-local"
            value={to}
            onChange={(e) => setTo(e.target.value)}
            required
          />
        </label>
        <label>
          第一维度
          <select value={dim1} onChange={(e) => setDim1(e.target.value as AdminUsageDimension)}>
            {(Object.keys(DIM_LABELS) as AdminUsageDimension[]).map((d) => (
              <option key={d} value={d}>
                {DIM_LABELS[d]}
              </option>
            ))}
          </select>
        </label>
        <label>
          第二维度（可选）
          <select
            value={dim2}
            onChange={(e) => setDim2(e.target.value as AdminUsageDimension | '')}
          >
            <option value="">不选</option>
            {(Object.keys(DIM_LABELS) as AdminUsageDimension[])
              .filter((d) => d !== dim1)
              .map((d) => (
                <option key={d} value={d}>
                  {DIM_LABELS[d]}
                </option>
              ))}
          </select>
        </label>
        <label>
          计费归属
          <select
            value={billingOwner}
            onChange={(e) => setBillingOwner(e.target.value as 'user' | 'platform' | '')}
          >
            <option value="">全部</option>
            <option value="user">用户</option>
            <option value="platform">平台</option>
          </select>
        </label>
        <label>
          状态
          <select
            value={status}
            onChange={(e) => setStatus(e.target.value as 'succeeded' | 'failed' | '')}
          >
            <option value="">全部</option>
            <option value="succeeded">成功</option>
            <option value="failed">失败</option>
          </select>
        </label>
        <div className="form-actions">
          <button type="submit" disabled={loading}>
            汇总
          </button>
          <button type="button" disabled={loading} onClick={() => void runDetail()}>
            明细
          </button>
          <button type="button" disabled={exportPending} onClick={() => void doExport()}>
            {exportPending ? '导出中…' : '导出 CSV'}
          </button>
        </div>
      </form>

      <Feedback error={error} />

      {totals && tab === 'summary' && (
        <div className="stack">
          <div className="stat-row">
            <div className="stat-tile">
              <span className="stat-label">调用次数</span>
              <span className="stat-value">{formatNum(totals.calls)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">失败次数</span>
              <span className="stat-value">{formatNum(totals.failedCalls)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">合计 Token</span>
              <span className="stat-value">{formatNum(totals.totalTokens)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">用户扣费</span>
              <span className="stat-value">{formatMicros(totals.chargedMicros)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">平台成本</span>
              <span className="stat-value">{formatMicros(totals.costMicros)}</span>
            </div>
            <div className="stat-tile">
              <span className="stat-label">平台吸收</span>
              <span className="stat-value">{formatMicros(totals.absorbedCostMicros)}</span>
            </div>
          </div>
          {summary.truncated && (
            <p className="text-warn">分组行数超过上限，已截断，请缩小筛选范围。</p>
          )}
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>{DIM_LABELS[dim1]}</th>
                  {dim2 && <th>{DIM_LABELS[dim2]}</th>}
                  <th className="num">调用</th>
                  <th className="num">失败</th>
                  <th className="num">输入</th>
                  <th className="num">缓存输入</th>
                  <th className="num">输出</th>
                  <th className="num">合计Token</th>
                  <th className="num">扣费</th>
                  <th className="num">成本</th>
                </tr>
              </thead>
              <tbody>
                {summary.rows.map((row, i) => (
                  <tr key={i}>
                    <td>{row.keys[0]}</td>
                    {dim2 && <td>{row.keys[1] ?? '-'}</td>}
                    <td className="num">{formatNum(row.calls)}</td>
                    <td className="num">{formatNum(row.failedCalls)}</td>
                    <td className="num">{formatNum(row.inputTokens)}</td>
                    <td className="num">{formatNum(row.cachedInputTokens)}</td>
                    <td className="num">{formatNum(row.outputTokens)}</td>
                    <td className="num">{formatNum(row.totalTokens)}</td>
                    <td className="num">{formatMicros(row.chargedMicros)}</td>
                    <td className="num">{formatMicros(row.costMicros)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      )}

      {tab === 'detail' && (
        <div className="stack">
          <div style={{ overflowX: 'auto' }}>
            <table>
              <thead>
                <tr>
                  <th>时间</th>
                  <th>模型</th>
                  <th>用途</th>
                  <th>计费归属</th>
                  <th className="num">输入</th>
                  <th className="num">输出</th>
                  <th className="num">扣费</th>
                  <th className="num">成本</th>
                  <th>状态</th>
                </tr>
              </thead>
              <tbody>
                {records.map((r) => (
                  <tr key={r.usageRecordId}>
                    <td>
                      {new Date(r.createdAt).toLocaleString('zh-CN', { timeZone: 'Asia/Shanghai' })}
                    </td>
                    <td>{r.modelKey}</td>
                    <td>{PURPOSE_LABELS[r.purpose] ?? r.purpose}</td>
                    <td>{r.billingOwner === 'user' ? '用户' : '平台'}</td>
                    <td className="num">{formatNum(r.inputTokens)}</td>
                    <td className="num">{formatNum(r.outputTokens)}</td>
                    <td className="num">{formatMicros(r.chargedMicros)}</td>
                    <td className="num">{formatMicros(r.costMicros)}</td>
                    <td>{r.status === 'succeeded' ? '成功' : `失败(${r.errorCode ?? ''})`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {nextCursor && (
            <button type="button" disabled={loading} onClick={() => void runDetail(nextCursor)}>
              加载更多
            </button>
          )}
        </div>
      )}
    </div>
  );
}
