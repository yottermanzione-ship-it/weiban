import { useEffect, useRef, useState } from 'react';
import {
  ScanPaymentEndpoints as E,
  type ScanChannel,
  type ScanOrder,
  type ScanPurchase,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { Dialog } from './toast.js';
import { saveImageFile } from '../data/shell-files.js';
import './scan-checkout.css';
export const scanOrderStatus: Record<ScanOrder['status'], string> = {
  pending: '等待到账',
  paid: '已到账',
  cancelled: '已取消',
  expired: '已过期',
  review: '待人工核对',
};
const money = (fen: number) => (fen / 100).toFixed(2);

/** No payment acknowledgement writes: refresh only queries server-owned settlement. */
export function ScanCheckout({ purchase, onClose }: { purchase?: ScanPurchase; onClose(): void }) {
  const options = useRemote(E.options, { networkOnly: true });
  const recent = useRemote(E.list, { query: { limit: 10 }, networkOnly: true });
  const [order, setOrder] = useState<ScanOrder | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [saveNotice, setSaveNotice] = useState('');
  const requestId = useRef<Partial<Record<ScanChannel, string>>>({});
  const live = useRef(true);
  useEffect(() => {
    live.current = true;
    return () => {
      live.current = false;
    };
  }, []);
  const pendingOrders = recent.data?.items.filter((r) => r.status === 'pending') ?? [];
  // Existing orders stay explicit in history. Opening a different product must not
  // silently replace the current purchase with an earlier order.
  const showing = order;
  const showingId = showing?.id;
  const showingStatus = showing?.status;
  useEffect(() => {
    if (!showingId || showingStatus !== 'pending') return;
    let active = true;
    const id = window.setInterval(() => {
      void api
        .call(E.get, { params: { orderId: showingId }, networkOnly: true })
        .then((value) => {
          if (active) {
            setOrder(value);
            setError('');
          }
        })
        .catch((e) => {
          if (active) setError(friendlyError(e));
        });
    }, 5000);
    return () => {
      active = false;
      window.clearInterval(id);
    };
  }, [showingId, showingStatus]);
  async function create(channel: ScanChannel) {
    if (busy || !purchase) return;
    setBusy(true);
    setError('');
    const clientOrderId = (requestId.current[channel] ??= crypto.randomUUID());
    try {
      const value = await api.call(E.create, { body: { channel, clientOrderId, purchase } });
      if (live.current) setOrder(value);
    } catch (e) {
      if (live.current) {
        setError(friendlyError(e));
        recent.refresh();
      }
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function update(cancel = false) {
    if (!showing || busy) return;
    setBusy(true);
    setError('');
    try {
      const result = await api.call(cancel ? E.cancel : E.get, {
        params: { orderId: showing.id },
        networkOnly: true,
      });
      if (live.current) setOrder(result);
    } catch (e) {
      if (live.current) setError(friendlyError(e));
    } finally {
      if (live.current) setBusy(false);
    }
  }
  async function saveQr() {
    if (!showing?.qr || saving) return;
    setSaving(true);
    setSaveNotice('');
    try {
      const [header, encoded] = showing.qr.split(',');
      const mime = header?.includes('image/png') ? 'image/png' : 'image/jpeg';
      const bytes = Uint8Array.from(atob(encoded!), (c) => c.charCodeAt(0));
      const result = await saveImageFile(
        new Blob([bytes], { type: mime }),
        `weiban-payment-${showing.channel}.${mime === 'image/png' ? 'png' : 'jpg'}`,
      );
      if (live.current)
        setSaveNotice(
          result === 'saved'
            ? '收款码已保存，请用付款应用识别，并填写本订单的准确金额。'
            : result === 'started'
              ? '已发起保存；也可长按收款码或截图后识别。请按本订单准确金额付款。'
              : '已取消保存',
        );
    } catch {
      if (live.current) setSaveNotice('保存未完成，请长按收款码或截图后识别。');
    } finally {
      if (live.current) setSaving(false);
    }
  }
  return (
    <Dialog
      title={showing ? showing.title : purchase ? '选择扫码付款方式' : '扫码付款记录'}
      actions={[
        { label: '关闭', onClick: onClose },
        ...(showing?.status === 'pending'
          ? [{ label: '查询到账', tone: 'primary' as const, busy, onClick: () => void update() }]
          : []),
      ]}
    >
      <div className="scan-checkout">
        {showing ? (
          <>
            <p role="status">{scanOrderStatus[showing.status]}</p>
            <p className="scan-amount">¥{money(showing.amountFen)}</p>
            <p>
              {showing.kind === 'recharge'
                ? `到账 ${showing.points} 积分`
                : `开通后赠送 ${showing.points} 积分`}
            </p>
            {showing.status === 'pending' && (
              <>
                <img
                  className="scan-qr"
                  src={showing.qr}
                  alt={`${showing.channel === 'wechat' ? '微信' : '支付宝'}收款码`}
                />
                <button type="button" disabled={saving} onClick={() => void saveQr()}>
                  {saving ? '正在保存…' : '保存收款码'}
                </button>
                {saveNotice && <p role="status">{saveNotice}</p>}
                <p>
                  用{showing.channel === 'wechat' ? '微信' : '支付宝'}
                  扫码或识别图片，务必支付上面的准确金额。
                </p>
                {showing.amountFen < showing.baseFen && (
                  <p className="hint">
                    同渠道已有相同金额的待付款订单，本单减去少量零头以区分到账；充值积分按实付金额计算，会员权益不变。
                  </p>
                )}
                <p className="hint">
                  有效至{' '}
                  {new Date(showing.expiresAt).toLocaleTimeString('zh-CN', { hour12: false })}
                  ；请勿重复付款。付款后自动到账，也可点“查询到账”。
                </p>
                <button type="button" disabled={busy} onClick={() => void update(true)}>
                  尚未付款，取消订单
                </button>
              </>
            )}
            {showing.status === 'paid' && <p>已入账，请关闭查看积分或会员。</p>}
            {['expired', 'cancelled', 'review'].includes(showing.status) && (
              <p>请勿继续向这笔订单付款。已经付款但未入账时，请联系管理员核对。</p>
            )}
            <p className="hint">订单编号：{showing.id}</p>
            {!purchase && (
              <button type="button" onClick={() => setOrder(null)}>
                返回付款记录
              </button>
            )}
          </>
        ) : (
          <>
            {(recent.loading || options.loading) && <p>正在查询付款状态…</p>}
            {purchase && pendingOrders.length > 0 && (
              <p className="hint">
                另有未完成的付款订单，可选择空闲渠道购买当前商品。已付款请勿取消或重复付款；原订单可在下方“最近付款记录”查看。
              </p>
            )}
            {purchase && options.data && (!options.data.enabled || !options.data.monitorOnline) && (
              <p>扫码收款暂未准备就绪，请稍后再试或联系管理员。</p>
            )}
            {purchase &&
              options.data?.channels.map((channel) => (
                <button
                  className="primary full"
                  type="button"
                  key={channel}
                  disabled={
                    busy ||
                    recent.loading ||
                    !!recent.error ||
                    pendingOrders.some((r) => r.channel === channel) ||
                    !options.data?.enabled ||
                    !options.data.monitorOnline
                  }
                  onClick={() => void create(channel)}
                >
                  {pendingOrders.some((r) => r.channel === channel)
                    ? `${channel === 'wechat' ? '微信' : '支付宝'}已有待付款订单`
                    : channel === 'wechat'
                      ? '微信扫码付款'
                      : '支付宝扫码付款'}
                </button>
              ))}
            {recent.data?.items.length ? (
              <details open={!purchase || pendingOrders.length > 0}>
                <summary>最近付款记录</summary>
                {recent.data.items.map((r) => (
                  <button
                    className="scan-record"
                    type="button"
                    key={r.id}
                    onClick={() => setOrder(r)}
                  >
                    {r.title} ¥{money(r.amountFen)} · {scanOrderStatus[r.status]}
                  </button>
                ))}
              </details>
            ) : !recent.loading && !recent.error && !purchase ? (
              <p>还没有扫码付款记录</p>
            ) : null}
          </>
        )}
        {(error || options.error || recent.error) && (
          <p role="alert" className="error">
            {error || options.error || recent.error}
          </p>
        )}
      </div>
    </Dialog>
  );
}
