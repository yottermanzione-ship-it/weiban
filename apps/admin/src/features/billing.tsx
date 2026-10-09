/**
 * 管理后台对账与平台花费页（ADM-07 第 5 条、ADM-08 第 7 条）。
 * 三部分：
 *  1. 平台今日成本与每日上限（getPlatformSummary）
 *  2. 每日对账结果列表（listReconciliation）
 *  3. 录入上游实际账单（createUpstreamBill）
 */
import { useState, type FormEvent } from 'react';
import {
  BillingAdminEndpoints,
  ModelAccessAdminEndpoints,
  ReconciliationRun,
} from '@weiban/contracts';
import type { z } from 'zod';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

type Recon = z.infer<typeof ReconciliationRun>;

function formatMicros(n: number): string {
  return `¥${(n / 1_000_000).toFixed(4)}`;
}

function todayBj(): string {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
}

function localDate(offset = 0): string {
  const d = new Date(Date.now() + offset * 86_400_000);
  return d.toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
}

export function BillingPage() {
  const summary = useRemote(BillingAdminEndpoints.getPlatformSummary);
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);

  const [reconcileFrom, setReconcileFrom] = useState(localDate(-30));
  const [reconcileTo, setReconcileTo] = useState(todayBj());
  const [reconItems, setReconItems] = useState<Recon[]>([]);
  const [reconLoading, setReconLoading] = useState(false);
  const [reconError, setReconError] = useState('');

  const [billUpstreamId, setBillUpstreamId] = useState('');
  const [billStart, setBillStart] = useState(localDate(-30));
  const [billEnd, setBillEnd] = useState(todayBj());
  const [billAmountYuan, setBillAmountYuan] = useState('');
  const [billNote, setBillNote] = useState('');
  const [billPending, setBillPending] = useState(false);
  const [billError, setBillError] = useState('');
  const [billMessage, setBillMessage] = useState('');

  async function loadRecon(e: FormEvent) {
    e.preventDefault();
    setReconError('');
    setReconLoading(true);
    try {
      const res = await api.call(BillingAdminEndpoints.listReconciliation, {
        query: { from: reconcileFrom, to: reconcileTo },
      });
      setReconItems(res.items);
    } catch (err) {
      setReconError(errorText(err));
    } finally {
      setReconLoading(false);
    }
  }

  async function submitBill(e: FormEvent) {
    e.preventDefault();
    setBillError('');
    setBillMessage('');
    setBillPending(true);
    try {
      await api.call(BillingAdminEndpoints.createUpstreamBill, {
        body: {
          upstreamId: billUpstreamId,
          periodStart: billStart,
          periodEnd: billEnd,
          amountMicros: Math.round(parseFloat(billAmountYuan) * 1_000_000),
          note: billNote || null,
        },
      });
      setBillMessage('账单录入成功');
      setBillAmountYuan('');
      setBillNote('');
    } catch (err) {
      setBillError(errorText(err));
    } finally {
      setBillPending(false);
    }
  }

  const upstreamList = upstreams.data?.items ?? [];

  return (
    <div className="stack">
      <h1>对账与平台花费</h1>

      {/* 平台成本汇总 */}
      <section className="panel stack">
        <h2>平台今日成本</h2>
        {summary.loading && <p role="status">加载中…</p>}
        {summary.error && <Feedback error={summary.error} />}
        {summary.data && (
          <>
            <div className="stat-row">
              <div className="stat-tile">
                <span className="stat-label">今日成本（北京时间）</span>
                <span className="stat-value">{formatMicros(summary.data.todayCostMicros)}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-label">每日上限</span>
                <span className="stat-value">{formatMicros(summary.data.dailyCapMicros)}</span>
              </div>
              <div className="stat-tile">
                <span className="stat-label">平台账户余额</span>
                <span className="stat-value">
                  {formatMicros(summary.data.platformAccountBalanceMicros)}
                </span>
              </div>
            </div>
            {summary.data.last30DaysCostByUpstream.length > 0 && (
              <>
                <h3>各上游近 30 天成本</h3>
                <table>
                  <thead>
                    <tr>
                      <th>上游 ID</th>
                      <th className="num">成本</th>
                    </tr>
                  </thead>
                  <tbody>
                    {summary.data.last30DaysCostByUpstream.map((row) => (
                      <tr key={row.upstreamId}>
                        <td>
                          {upstreamList.find((u) => u.upstreamId === row.upstreamId)?.name ??
                            row.upstreamId}
                        </td>
                        <td className="num">{formatMicros(row.costMicros)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </>
            )}
          </>
        )}
      </section>

      {/* 每日对账结果 */}
      <section className="panel stack">
        <h2>每日对账结果</h2>
        <form className="form-grid" onSubmit={(e) => void loadRecon(e)}>
          <label>
            开始日期
            <input
              type="date"
              value={reconcileFrom}
              onChange={(e) => setReconcileFrom(e.target.value)}
              required
            />
          </label>
          <label>
            结束日期
            <input
              type="date"
              value={reconcileTo}
              onChange={(e) => setReconcileTo(e.target.value)}
              required
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={reconLoading}>
              查询
            </button>
          </div>
        </form>
        <Feedback error={reconError} />
        {reconItems.length > 0 && (
          <table>
            <thead>
              <tr>
                <th>日期</th>
                <th>账本自洽</th>
                <th className="num">超时冻结</th>
                <th className="num">缺扣费</th>
                <th className="num">多扣费</th>
                <th className="num">金额不一致</th>
                <th className="num">平台吸收</th>
                <th>上游账单偏差</th>
              </tr>
            </thead>
            <tbody>
              {reconItems.map((item) => (
                <tr key={item.runId}>
                  <td>{item.date}</td>
                  <td>
                    {item.ledgerConsistent ? '正常' : <strong className="text-warn">异常</strong>}
                  </td>
                  <td className="num">{item.staleHolds}</td>
                  <td className="num">{item.usageWithoutCharge}</td>
                  <td className="num">{item.chargeWithoutUsage}</td>
                  <td className="num">{item.usageAmountMismatch ?? 0}</td>
                  <td className="num">{formatMicros(item.absorbedMicros)}</td>
                  <td>
                    {item.upstreamDiffs.length === 0
                      ? '—'
                      : item.upstreamDiffs
                          .filter((d) => d.flagged)
                          .map((d) => (
                            <div key={d.upstreamId}>
                              <strong className="text-warn">
                                {upstreamList.find((u) => u.upstreamId === d.upstreamId)?.name ??
                                  d.upstreamId}
                              </strong>
                              ：账单 {formatMicros(d.billedMicros)} / 计算{' '}
                              {formatMicros(d.computedCostMicros)}
                              （偏差 {(d.diffRatio * 100).toFixed(1)}%）
                            </div>
                          ))}
                    {item.upstreamDiffs.length > 0 &&
                      item.upstreamDiffs.every((d) => !d.flagged) && <span>全部正常</span>}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </section>

      {/* 录入上游账单 */}
      <section className="panel stack">
        <h2>录入上游实际账单</h2>
        <form className="form-grid" onSubmit={(e) => void submitBill(e)}>
          <label>
            上游
            <select
              value={billUpstreamId}
              onChange={(e) => setBillUpstreamId(e.target.value)}
              required
            >
              <option value="">请选择</option>
              {upstreamList.map((u) => (
                <option key={u.upstreamId} value={u.upstreamId}>
                  {u.name}
                </option>
              ))}
            </select>
          </label>
          <label>
            账单周期开始
            <input
              type="date"
              value={billStart}
              onChange={(e) => setBillStart(e.target.value)}
              required
            />
          </label>
          <label>
            账单周期结束
            <input
              type="date"
              value={billEnd}
              onChange={(e) => setBillEnd(e.target.value)}
              required
            />
          </label>
          <label>
            金额（元）
            <input
              type="number"
              min="0"
              step="0.0001"
              value={billAmountYuan}
              onChange={(e) => setBillAmountYuan(e.target.value)}
              required
            />
          </label>
          <label>
            备注（可选）
            <input
              type="text"
              maxLength={200}
              value={billNote}
              onChange={(e) => setBillNote(e.target.value)}
            />
          </label>
          <div className="form-actions">
            <button type="submit" disabled={billPending}>
              录入账单
            </button>
          </div>
        </form>
        <Feedback error={billError} message={billMessage} />
      </section>
    </div>
  );
}
