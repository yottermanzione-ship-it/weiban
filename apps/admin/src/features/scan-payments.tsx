import { useEffect, useEffectEvent, useState, type MouseEvent } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  Popover,
  Radio,
  Segmented,
  Space,
  Spin,
  Switch,
  Table,
  Tabs,
  Tag,
} from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import {
  ScanPaymentAdminEndpoints as A,
  type ScanPaymentSettings,
  type ScanReceipt,
  type ScanOrder,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { formatDate, formatInt } from '../ui/format.js';
import { Page, SectionCard, StatusTag, useToast } from '../ui/page.js';
import { UserIdentity, userDisplayName, useUserDirectory } from './users/identity.js';
import './scan-payments.css';

type PaymentStatus = ScanOrder['status'] | ScanReceipt['status'];

const statusNames: Record<PaymentStatus, string> = {
  pending: '待付款',
  paid: '已到账',
  cancelled: '已取消',
  expired: '已过期',
  review: '待核对',
  matched: '已入账',
  ignored: '已忽略',
};
const reasons: Record<string, string> = {
  automatic: '自动核对',
  manual: '人工核对',
  manual_ignored: '人工忽略',
  manual_registered: '人工登记',
  no_order: '没有对应订单',
  ambiguous: '对应多笔订单',
  delayed_or_clock: '迟到通知或手机时间异常',
  monitor_offline: '监控未及时连接',
  payments_disabled: '收款未开放',
  account_unavailable: '账号已停用',
  first_price_already_used: '会员首次优惠已使用',
  notice_uncertain: '有金额的通知，收款性质待核对，不自动入账',
  notice_multiple_amounts: '通知包含多个金额，不自动入账',
  notice_summary: '汇总通知，不自动入账',
};
const money = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const channel = (s: ScanOrder['channel']) => (s === 'wechat' ? '微信' : '支付宝');
const date = (s: string | null) =>
  s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '尚未连接';
const clock = new Intl.DateTimeFormat('zh-CN', { timeStyle: 'medium', hour12: false });
const tableHeight = 'min(54vh, 480px)';
const receiptSource = (row: ScanReceipt) => (row.deviceId ? '手机监控' : '人工登记');
const reasonText = (reason: string) => reasons[reason] ?? '待核对';
const clickedRowBody = (event: MouseEvent) =>
  event.target instanceof Element &&
  event.currentTarget.contains(event.target) &&
  !event.target.closest('a, button, input, label');

function PaymentStatusTag({ status }: { status: PaymentStatus }) {
  const tone =
    status === 'review'
      ? 'warning'
      : status === 'paid' || status === 'matched'
        ? 'success'
        : 'default';
  return <StatusTag tone={tone}>{statusNames[status]}</StatusTag>;
}

function PaymentTime({ at }: { at: string }) {
  return (
    <time className="cell-main" dateTime={at}>
      <span className="mono">{clock.format(new Date(at))}</span>
      <span className="cell-sub">{formatDate(at)}</span>
    </time>
  );
}

function PaymentAmount({ amountFen }: Pick<ScanOrder, 'amountFen'>) {
  return <strong className="scan-payment-amount mono">{money(amountFen)}</strong>;
}

function PaymentChannel({ method }: { method: ScanOrder['channel'] }) {
  return <Tag color={method === 'wechat' ? 'green' : 'blue'}>{channel(method)}</Tag>;
}

function OrderIdentifier({ id }: { id: string }) {
  const toast = useToast();
  const short = `…${id.slice(-8)}`;

  async function copy() {
    try {
      await navigator.clipboard.writeText(id);
      toast.success('已复制订单编号');
    } catch {
      toast.error('复制失败，请选中编号后复制');
    }
  }

  return (
    <Popover
      title="完整订单编号"
      trigger={['hover', 'click']}
      placement="bottomLeft"
      content={
        <div className="scan-id-preview">
          <code>{id}</code>
          <Button
            size="small"
            icon={<CopyOutlined />}
            aria-label="复制订单编号"
            onClick={() => void copy()}
          >
            复制
          </Button>
        </div>
      }
    >
      <button type="button" className="os-id-chip mono" aria-label={`预览订单编号 ${short}`}>
        {short}
      </button>
    </Popover>
  );
}

function ReceiptDialog({
  row,
  onClose,
  onResolved,
  onIgnore,
  onBrowseOrders,
}: {
  row: ScanReceipt;
  onClose: () => void;
  onResolved: () => void;
  onIgnore: (receipt: ScanReceipt) => void;
  onBrowseOrders: (receipt: ScanReceipt) => void;
}) {
  const [cursor, setCursor] = useState<string>();
  const [orderId, setOrderId] = useState<string>();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const detail = useRemote(A.receiptDetails, {
    params: { receiptId: row.id },
    query: { cursor, limit: 8 },
  });
  const receipt = detail.data?.receipt ?? row;
  const linked = detail.data?.linkedOrder;
  const candidates = detail.data?.candidates;
  const directory = useUserDirectory([
    linked?.userId,
    ...(candidates?.items ?? []).map((order) => order.userId),
  ]);
  const review = receipt.status === 'review';
  const initialReason = receipt.reviewReason ?? (review ? receipt.reason : null);
  const selected = candidates?.items.find((order) => order.id === orderId);

  async function confirm() {
    if (busy || !selected || !review) return;
    setError('');
    setBusy(true);
    try {
      const result = await api.call(A.resolve, {
        params: { receiptId: receipt.id },
        body: { orderId: selected.id, reason: '管理员确认关联入账' },
      });
      if (result.status === 'matched' && result.orderId === selected.id) onResolved();
      else {
        setError(reasons[result.reason] ?? '未能入账，请核对订单状态');
        detail.refresh();
      }
    } catch (e) {
      setError(errorText(e));
      detail.refresh();
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal
      open
      width={760}
      title={review ? '核对到账' : '到账详情'}
      onCancel={busy ? undefined : onClose}
      closable={!busy}
      maskClosable={!busy}
      keyboard={!busy}
      footer={
        <Space wrap>
          {review && (
            <Button disabled={busy} onClick={() => onIgnore(receipt)}>
              忽略到账
            </Button>
          )}
          <Button disabled={busy} onClick={onClose}>
            关闭
          </Button>
          {review && (
            <Button
              type="primary"
              disabled={!selected}
              loading={busy}
              onClick={() => void confirm()}
            >
              确认关联并入账
            </Button>
          )}
        </Space>
      }
    >
      <dl className="scan-detail-grid">
        <div>
          <dt>渠道</dt>
          <dd>
            <PaymentChannel method={receipt.channel} />
          </dd>
        </div>
        <div>
          <dt>通知金额</dt>
          <dd>
            <PaymentAmount amountFen={receipt.amountFen} />
          </dd>
        </div>
        <div>
          <dt>来源</dt>
          <dd>{receiptSource(receipt)}</dd>
        </div>
        <div>
          <dt>状态</dt>
          <dd>
            <PaymentStatusTag status={receipt.status} />
          </dd>
        </div>
        <div>
          <dt>通知时间</dt>
          <dd>{date(receipt.postedAt ?? receipt.observedAt)}</dd>
        </div>
        <div>
          <dt>服务器收报</dt>
          <dd>{date(receipt.receivedAt)}</dd>
        </div>
        {initialReason && (
          <div>
            <dt>未自动入账原因</dt>
            <dd>{reasonText(initialReason)}</dd>
          </div>
        )}
        {!review && (
          <div>
            <dt>处理结果</dt>
            <dd>{reasonText(receipt.reason)}</dd>
          </div>
        )}
        {receipt.orderId && (
          <div>
            <dt>关联订单</dt>
            <dd>
              <OrderIdentifier id={receipt.orderId} />
            </dd>
          </div>
        )}
        {linked && (
          <div>
            <dt>购买内容</dt>
            <dd>
              {linked.title} · {formatInt(linked.points)} 积分
            </dd>
          </div>
        )}
        {linked?.userId && (
          <div>
            <dt>付款人</dt>
            <dd>{userDisplayName(linked.userId, directory.byId.get(linked.userId))}</dd>
          </div>
        )}
      </dl>
      {(error || detail.error) && <Alert type="error" showIcon message={error || detail.error} />}
      {receipt.deviceId && (
        <section className="scan-detail-section" aria-label="收款通知原文">
          <h3>收款通知原文</h3>
          {detail.data?.noticeText ? (
            <pre className="scan-notice-text">{detail.data.noticeText}</pre>
          ) : detail.loading ? (
            <Spin size="small" />
          ) : (
            !detail.error && <span className="cell-sub">这条记录没有可查看的通知原文</span>
          )}
        </section>
      )}
      {review && (
        <section className="scan-detail-section" aria-label="候选订单">
          <h3>同渠道、同金额的 APP 订单</h3>
          {detail.loading && !candidates && <Spin size="small" />}
          {candidates?.items.length ? (
            <Radio.Group
              className="scan-candidate-list"
              aria-label="选择候选订单"
              value={orderId}
              disabled={busy}
              onChange={(e) => setOrderId(e.target.value as string)}
            >
              {candidates.items.map((order) => (
                <Radio value={order.id} key={order.id}>
                  <span className="scan-candidate-content">
                    <strong>
                      {order.userId &&
                        userDisplayName(order.userId, directory.byId.get(order.userId))}
                    </strong>
                    <span>
                      {order.title} · {formatInt(order.points)} 积分
                    </span>
                    <code>…{order.id.slice(-8)}</code>
                    <time dateTime={order.createdAt}>{date(order.createdAt)}</time>
                    <PaymentStatusTag status={order.status} />
                  </span>
                </Radio>
              ))}
            </Radio.Group>
          ) : (
            candidates && <p className="cell-sub">未找到可关联的同金额订单</p>
          )}
          <Space wrap>
            {(cursor || candidates?.nextCursor) && (
              <>
                <Button
                  size="small"
                  disabled={!cursor || busy}
                  onClick={() => {
                    setCursor(undefined);
                    setOrderId(undefined);
                  }}
                >
                  返回首批
                </Button>
                <Button
                  size="small"
                  disabled={!candidates?.nextCursor || busy}
                  onClick={() => {
                    setCursor(candidates?.nextCursor ?? undefined);
                    setOrderId(undefined);
                  }}
                >
                  更多订单
                </Button>
              </>
            )}
            <Button
              type="link"
              size="small"
              disabled={busy}
              onClick={() => onBrowseOrders(receipt)}
            >
              查看 APP 订单
            </Button>
          </Space>
        </section>
      )}
    </Modal>
  );
}

export function ScanPaymentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('receipts');
  const settings = useRemote(A.settings);
  const devices = useRemote(A.devices);
  const [oc, setOc] = useState<string | undefined>();
  const [rc, setRc] = useState<string | undefined>();
  const [receiptFilter, setReceiptFilter] = useState<'all' | 'review'>('all');
  const orders = useRemote(A.orders, { query: { cursor: oc, limit: 30 } });
  const receipts = useRemote(A.receipts, {
    query: { cursor: rc, limit: 30, ...(receiptFilter === 'review' ? { status: 'review' } : {}) },
  });
  const poll = useEffectEvent(() => {
    if (document.visibilityState !== 'hidden') {
      if (!receipts.loading) receipts.refresh();
      if (!orders.loading) orders.refresh();
      if (!devices.loading) devices.refresh();
    }
  });
  useEffect(() => {
    const timer = window.setInterval(poll, 5000);
    document.addEventListener('visibilitychange', poll);
    return () => {
      window.clearInterval(timer);
      document.removeEventListener('visibilitychange', poll);
    };
  }, []);
  const [draft, setDraft] = useState<ScanPaymentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<ScanOrder | null>(null);
  const [inspectedReceipt, setInspectedReceipt] = useState<ScanReceipt | null>(null);
  const [inspectedOrder, setInspectedOrder] = useState<ScanOrder | null>(null);
  const [receiptId, setReceiptId] = useState<string>();
  const [orderId, setOrderId] = useState<string>();
  const selectedReceipt = receipts.data?.items.find(
    (row) => row.id === receiptId && row.status === 'review',
  );
  const selectedOrder = orders.data?.items.find(
    (row) => row.id === orderId && row.status !== 'paid' && row.userId,
  );
  const pairMismatch =
    selectedReceipt &&
    selectedOrder &&
    (selectedReceipt.channel !== selectedOrder.channel ||
      selectedReceipt.amountFen !== selectedOrder.amountFen);
  const directory = useUserDirectory([
    ...(orders.data?.items ?? []).map((item) => item.userId),
    manual?.userId,
    inspectedOrder?.userId,
  ]);
  const [bankRef, setBankRef] = useState('');
  const [actualMoney, setActualMoney] = useState('');
  const [whole = '', decimal = ''] = actualMoney.trim().split('.');
  const actualFen = /^\d+(\.\d{1,2})?$/.test(actualMoney.trim())
    ? Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
    : 0;
  const [message, setMessage] = useState('');
  const [monitorOpen, setMonitorOpen] = useState(false);
  const [deviceName, setDeviceName] = useState('收款手机');
  const [pairing, setPairing] = useState<{
    deviceId: string;
    pairCode: string;
    expiresAt: string;
  } | null>(null);
  const [ignoredReceipt, setIgnoredReceipt] = useState<ScanReceipt | null>(null);
  function refresh() {
    directory.refresh();
    settings.refresh();
    devices.refresh();
    orders.refresh();
    receipts.refresh();
  }
  async function run(fn: () => Promise<unknown>, done?: () => void) {
    if (busy) return;
    setBusy(true);
    try {
      await fn();
      done?.();
      refresh();
    } catch (e) {
      setMessage(e instanceof Error ? e.message : '操作失败，请重试');
    } finally {
      setBusy(false);
    }
  }
  function clearSelection() {
    setReceiptId(undefined);
    setOrderId(undefined);
  }
  function openManual(order: ScanOrder) {
    setInspectedOrder(null);
    setManual(order);
    setBankRef('');
    setActualMoney('');
  }
  function linkReceipt() {
    if (!selectedReceipt || !selectedOrder || pairMismatch) return;
    void run(async () => {
      const result = await api.call(A.resolve, {
        params: { receiptId: selectedReceipt.id },
        body: { orderId: selectedOrder.id, reason: '管理员确认关联入账' },
      });
      if (result.status === 'matched' && result.orderId === selectedOrder.id) {
        clearSelection();
        toast.success('已关联并入账');
      } else {
        setMessage(reasons[result.reason] ?? '未能入账，请核对订单状态');
      }
    });
  }
  async function image(file: File | undefined, key: 'wechatQr' | 'alipayQr') {
    if (!file) return;
    if (!['image/png', 'image/jpeg'].includes(file.type) || file.size > 290_000) {
      setMessage('请选择不超过290KB的收款码图片');
      return;
    }
    const reader = new FileReader();
    reader.onload = () => setDraft((old) => old && { ...old, [key]: String(reader.result) });
    reader.onerror = () => setMessage('图片读取失败');
    reader.readAsDataURL(file);
  }
  const pairedDevices = (devices.data ?? []).filter((d) => d.paired);
  const available =
    !!settings.data?.enabled &&
    !!settings.data?.cutoverConfirmed &&
    pairedDevices.some((d) => d.online);
  return (
    <Page
      title="扫码收款"
      fullWidth
      extra={
        <Space wrap>
          <Tag color={available ? 'green' : 'default'}>
            {available ? '已开放' : settings.data?.enabled ? '暂停接单' : '未开放'}
          </Tag>
          <Button disabled={!settings.data} onClick={() => setDraft(settings.data ?? null)}>
            收款设置
          </Button>
          <Button onClick={() => setMonitorOpen(true)}>监控手机</Button>
          <Button onClick={refresh}>刷新</Button>
        </Space>
      }
    >
      {(settings.error || devices.error || orders.error || receipts.error) && (
        <Alert
          type="error"
          showIcon
          message={settings.error || devices.error || orders.error || receipts.error}
        />
      )}
      {(selectedReceipt || selectedOrder) && (
        <div className="scan-match-bar">
          <div className="scan-match-selection" aria-live="polite">
            {selectedReceipt && (
              <span>
                到账 <strong>{money(selectedReceipt.amountFen)}</strong> ·{' '}
                {channel(selectedReceipt.channel)}
              </span>
            )}
            {selectedOrder?.userId && (
              <span>
                订单 <strong>{money(selectedOrder.amountFen)}</strong> ·{' '}
                {channel(selectedOrder.channel)} ·{' '}
                {userDisplayName(selectedOrder.userId, directory.byId.get(selectedOrder.userId))}
              </span>
            )}
            {pairMismatch ? (
              <span className="scan-match-error">金额或收款渠道不同</span>
            ) : !selectedReceipt ? (
              <span>选择对应的待核对到账</span>
            ) : !selectedOrder ? (
              <span>选择对应的 APP 订单</span>
            ) : null}
          </div>
          <Space wrap>
            <Button type="text" disabled={busy} onClick={clearSelection}>
              清空选择
            </Button>
            <Button
              type="primary"
              disabled={!selectedReceipt || !selectedOrder || !!pairMismatch || busy}
              onClick={linkReceipt}
            >
              确认关联并入账
            </Button>
          </Space>
        </div>
      )}
      <SectionCard bodyStyle={{ padding: 0 }}>
        <Tabs
          className="scan-record-tabs"
          activeKey={tab}
          onChange={setTab}
          tabBarExtraContent={
            tab === 'receipts' && (
              <Segmented<'all' | 'review'>
                size="small"
                aria-label="筛选扫码到账"
                value={receiptFilter}
                options={[
                  { label: '全部', value: 'all' },
                  { label: '待核对', value: 'review' },
                ]}
                onChange={(value) => {
                  setReceiptFilter(value);
                  setRc(undefined);
                  setReceiptId(undefined);
                }}
              />
            )
          }
          items={[
            {
              key: 'receipts',
              label: '扫码到账记录',
              children: (
                <section aria-label="扫码到账记录">
                  <Table<ScanReceipt>
                    className="scan-payment-table"
                    rowKey="id"
                    size="small"
                    tableLayout="fixed"
                    loading={!receipts.data && receipts.loading}
                    dataSource={receipts.data?.items ?? []}
                    locale={{ emptyText: '暂无扫码到账记录' }}
                    pagination={false}
                    scroll={{ x: 858, y: tableHeight }}
                    onRow={(row) => ({
                      className: 'scan-view-row',
                      onClick: (event) => {
                        if (clickedRowBody(event)) setInspectedReceipt(row);
                      },
                    })}
                    rowSelection={{
                      type: 'radio',
                      columnWidth: 32,
                      selectedRowKeys: selectedReceipt ? [selectedReceipt.id] : [],
                      onChange: ([key]) =>
                        setReceiptId(key === undefined ? undefined : String(key)),
                      getCheckboxProps: (r) => ({
                        disabled: r.status !== 'review' || busy,
                        'aria-label': `选择到账 ${channel(r.channel)} ${money(r.amountFen)} ${date(r.postedAt ?? r.observedAt)}`,
                      }),
                    }}
                    columns={[
                      {
                        title: '渠道',
                        width: 64,
                        align: 'center',
                        render: (_, r) => <PaymentChannel method={r.channel} />,
                      },
                      {
                        title: '通知金额',
                        width: 88,
                        align: 'right',
                        render: (_, r) => <PaymentAmount amountFen={r.amountFen} />,
                      },
                      {
                        title: '通知时间',
                        width: 94,
                        render: (_, r) => <PaymentTime at={r.postedAt ?? r.observedAt} />,
                      },
                      {
                        title: '服务器收报',
                        width: 98,
                        render: (_, r) => <PaymentTime at={r.receivedAt} />,
                      },
                      {
                        title: '来源',
                        width: 78,
                        render: (_, r) => receiptSource(r),
                      },
                      {
                        title: '状态',
                        align: 'center',
                        width: 76,
                        render: (_, r) => <PaymentStatusTag status={r.status} />,
                      },
                      {
                        title: '核对结果',
                        width: 144,
                        render: (_, r) => {
                          const reason = reasonText(r.reason);
                          return (
                            <div className="cell-main">
                              <span className="scan-truncate" title={reason}>
                                {reason}
                              </span>
                              {r.purchaseTitle && (
                                <span className="cell-sub scan-truncate" title={r.purchaseTitle}>
                                  {r.purchaseTitle}
                                </span>
                              )}
                            </div>
                          );
                        },
                      },
                      {
                        title: '关联订单',
                        width: 96,
                        render: (_, r) =>
                          r.orderId ? (
                            <OrderIdentifier id={r.orderId} />
                          ) : (
                            <span className="cell-sub">—</span>
                          ),
                      },
                      {
                        title: '操作',
                        width: 88,
                        render: (_, r) => (
                          <Button type="link" size="small" onClick={() => setInspectedReceipt(r)}>
                            {r.status === 'review' ? '核对入账' : '详情'}
                          </Button>
                        ),
                      },
                    ]}
                  />
                  <div className="scan-table-pager">
                    <Button
                      size="small"
                      disabled={!rc}
                      onClick={() => {
                        setRc(undefined);
                        setReceiptId(undefined);
                      }}
                    >
                      最新到账
                    </Button>
                    <Button
                      size="small"
                      disabled={!receipts.data?.nextCursor}
                      onClick={() => {
                        setRc(receipts.data?.nextCursor ?? undefined);
                        setReceiptId(undefined);
                      }}
                    >
                      下一页到账
                    </Button>
                  </div>
                </section>
              ),
            },
            {
              key: 'orders',
              label: 'APP 订单',
              children: (
                <section aria-label="APP 订单">
                  <Table<ScanOrder>
                    className="scan-payment-table"
                    rowKey="id"
                    size="small"
                    tableLayout="fixed"
                    loading={!orders.data && orders.loading}
                    dataSource={orders.data?.items ?? []}
                    pagination={false}
                    scroll={{ x: 892, y: tableHeight }}
                    onRow={(row) => ({
                      className: 'scan-view-row',
                      onClick: (event) => {
                        if (clickedRowBody(event)) setInspectedOrder(row);
                      },
                    })}
                    rowSelection={{
                      type: 'radio',
                      columnWidth: 32,
                      selectedRowKeys: selectedOrder ? [selectedOrder.id] : [],
                      onChange: ([key]) => setOrderId(key === undefined ? undefined : String(key)),
                      getCheckboxProps: (r) => ({
                        disabled: r.status === 'paid' || !r.userId || busy,
                        'aria-label': `选择订单 …${r.id.slice(-8)}`,
                      }),
                    }}
                    columns={[
                      {
                        title: '订单编号',
                        width: 92,
                        render: (_, r) => <OrderIdentifier id={r.id} />,
                      },
                      {
                        title: '付款人',
                        width: 128,
                        render: (_, r) =>
                          r.userId ? (
                            <UserIdentity
                              fit
                              userId={r.userId}
                              label={directory.byId.get(r.userId)}
                            />
                          ) : (
                            '已注销账号'
                          ),
                      },
                      {
                        title: '购买内容',
                        width: 120,
                        render: (_, r) => (
                          <div className="cell-main">
                            <span className="scan-truncate" title={r.title}>
                              {r.title}
                            </span>
                            <span className="cell-sub">{formatInt(r.points)} 积分</span>
                          </div>
                        ),
                      },
                      {
                        title: '渠道',
                        width: 64,
                        align: 'center',
                        render: (_, r) => <PaymentChannel method={r.channel} />,
                      },
                      {
                        title: '应付金额',
                        width: 86,
                        align: 'right',
                        render: (_, r) => <PaymentAmount amountFen={r.amountFen} />,
                      },
                      {
                        title: '创建时间',
                        width: 92,
                        render: (_, r) => <PaymentTime at={r.createdAt} />,
                      },
                      {
                        title: '入账时间',
                        width: 92,
                        render: (_, r) =>
                          r.paidAt ? (
                            <PaymentTime at={r.paidAt} />
                          ) : (
                            <span className="cell-sub">—</span>
                          ),
                      },
                      {
                        title: '状态',
                        width: 74,
                        align: 'center',
                        render: (_, r) => <PaymentStatusTag status={r.status} />,
                      },
                      {
                        title: '操作',
                        width: 112,
                        render: (_, r) => (
                          <Space size={2} className="scan-row-actions">
                            <Button type="link" size="small" onClick={() => setInspectedOrder(r)}>
                              详情
                            </Button>
                            {r.status !== 'paid' && r.userId && (
                              <Button
                                type="link"
                                size="small"
                                disabled={busy}
                                onClick={() => openManual(r)}
                              >
                                登记漏报
                              </Button>
                            )}
                          </Space>
                        ),
                      },
                    ]}
                  />
                  <div className="scan-table-pager">
                    <Button
                      size="small"
                      disabled={!oc}
                      onClick={() => {
                        setOc(undefined);
                        setOrderId(undefined);
                      }}
                    >
                      最新订单
                    </Button>
                    <Button
                      size="small"
                      disabled={!orders.data?.nextCursor}
                      onClick={() => {
                        setOc(orders.data?.nextCursor ?? undefined);
                        setOrderId(undefined);
                      }}
                    >
                      下一页订单
                    </Button>
                  </div>
                </section>
              ),
            },
          ]}
        />
      </SectionCard>
      {inspectedReceipt && (
        <ReceiptDialog
          key={inspectedReceipt.id}
          row={inspectedReceipt}
          onClose={() => setInspectedReceipt(null)}
          onResolved={() => {
            setInspectedReceipt(null);
            clearSelection();
            receipts.refresh();
            orders.refresh();
            toast.success('已关联并入账');
          }}
          onIgnore={(receipt) => {
            setInspectedReceipt(null);
            setIgnoredReceipt(receipt);
          }}
          onBrowseOrders={(receipt) => {
            setInspectedReceipt(null);
            setReceiptId(receipt.id);
            setTab('orders');
          }}
        />
      )}
      {inspectedOrder && (
        <Modal
          open
          title="APP 订单详情"
          onCancel={() => setInspectedOrder(null)}
          footer={
            <Space>
              <Button onClick={() => setInspectedOrder(null)}>关闭</Button>
              {inspectedOrder.status !== 'paid' && inspectedOrder.userId && (
                <Button type="primary" onClick={() => openManual(inspectedOrder)}>
                  登记漏报
                </Button>
              )}
            </Space>
          }
        >
          <dl className="scan-detail-grid">
            <div>
              <dt>订单编号</dt>
              <dd>
                <OrderIdentifier id={inspectedOrder.id} />
              </dd>
            </div>
            <div>
              <dt>渠道</dt>
              <dd>
                <PaymentChannel method={inspectedOrder.channel} />
              </dd>
            </div>
            <div>
              <dt>付款人</dt>
              <dd>
                {inspectedOrder.userId
                  ? userDisplayName(
                      inspectedOrder.userId,
                      directory.byId.get(inspectedOrder.userId),
                    )
                  : '已注销账号'}
              </dd>
            </div>
            <div>
              <dt>状态</dt>
              <dd>
                <PaymentStatusTag status={inspectedOrder.status} />
              </dd>
            </div>
            <div>
              <dt>付费类型</dt>
              <dd>{inspectedOrder.kind === 'membership' ? '会员' : '积分充值'}</dd>
            </div>
            <div>
              <dt>购买内容</dt>
              <dd>{inspectedOrder.title}</dd>
            </div>
            <div>
              <dt>应付金额</dt>
              <dd>{money(inspectedOrder.amountFen)}</dd>
            </div>
            <div>
              <dt>积分</dt>
              <dd>{formatInt(inspectedOrder.points)}</dd>
            </div>
            {inspectedOrder.baseFen !== inspectedOrder.amountFen && (
              <div>
                <dt>报价金额</dt>
                <dd>{money(inspectedOrder.baseFen)}</dd>
              </div>
            )}
            <div>
              <dt>创建时间</dt>
              <dd>{date(inspectedOrder.createdAt)}</dd>
            </div>
            <div>
              <dt>到期时间</dt>
              <dd>{date(inspectedOrder.expiresAt)}</dd>
            </div>
            {inspectedOrder.paidAt && (
              <div>
                <dt>入账时间</dt>
                <dd>{date(inspectedOrder.paidAt)}</dd>
              </div>
            )}
          </dl>
        </Modal>
      )}
      <Modal
        open={monitorOpen && !pairing}
        title="到账监控手机"
        width={760}
        footer={<Button onClick={() => setMonitorOpen(false)}>关闭</Button>}
        onCancel={() => setMonitorOpen(false)}
      >
        <Space wrap className="scan-monitor-controls">
          <Input
            aria-label="监控设备名称"
            value={deviceName}
            maxLength={40}
            onChange={(e) => setDeviceName(e.target.value)}
          />
          <Button
            disabled={!deviceName.trim()}
            loading={busy}
            onClick={() =>
              void run(async () => {
                setPairing(await api.call(A.pairCode, { body: { name: deviceName.trim() } }));
              })
            }
          >
            {pairedDevices.length ? '连接另一台手机' : '设置收款手机'}
          </Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          dataSource={pairedDevices}
          pagination={{ pageSize: 10, hideOnSinglePage: true }}
          scroll={{ x: 620 }}
          locale={{ emptyText: '尚未连接收款手机，首次设置一次即可' }}
          columns={[
            { title: '设备', dataIndex: 'name' },
            {
              title: '状态',
              render: (_, r) =>
                !r.paired ? '待配对' : !r.active ? '已停用' : r.online ? '正在监听' : '未连接',
            },
            { title: '最近连接', render: (_, r) => date(r.lastSeenAt) },
            { title: '待补报', dataIndex: 'queued' },
            {
              title: '操作',
              render: (_, r) => (
                <Button
                  disabled={!r.paired || busy}
                  onClick={() =>
                    void run(() =>
                      api.call(A.activate, {
                        params: { deviceId: r.id },
                        body: { active: !r.active },
                      }),
                    )
                  }
                >
                  {r.active ? '暂停监控' : '启用监控'}
                </Button>
              ),
            },
          ]}
        />
        <p>
          已连接的手机无需重复设置，打开软件点“开始监控”即可。首次连接自动启用；更换手机前先补报原手机记录，再启用新手机。
        </p>
      </Modal>
      <Modal
        open={!!draft}
        title="收款设置"
        okText="保存设置"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setDraft(null)}
        onOk={() =>
          draft &&
          void run(
            () => api.call(A.saveSettings, { body: draft }),
            () => setDraft(null),
          )
        }
      >
        {draft && (
          <Space direction="vertical" style={{ width: '100%' }}>
            <p>
              请确认旧站已停止对同一收款码独立认单，或两个站使用不同的收款账户。收款手机断连时会暂停新订单。
            </p>
            {(['wechatQr', 'alipayQr'] as const).map((key) => (
              <div key={key}>
                <label>
                  {key === 'wechatQr' ? '微信收款码' : '支付宝收款码'}
                  <input
                    aria-label={key === 'wechatQr' ? '微信收款码' : '支付宝收款码'}
                    type="file"
                    accept="image/png,image/jpeg"
                    onChange={(e) => void image(e.target.files?.[0], key)}
                  />
                </label>
                {draft[key] && (
                  <img
                    src={draft[key]}
                    alt="收款码预览"
                    style={{ width: 160, height: 160, objectFit: 'contain', display: 'block' }}
                  />
                )}
              </div>
            ))}
            <Checkbox
              checked={draft.cutoverConfirmed}
              onChange={(e) => setDraft({ ...draft, cutoverConfirmed: e.target.checked })}
            >
              已核实旧站不再独立认领同一收款账户的到账
            </Checkbox>
            <label>
              开放扫码收款{' '}
              <Switch
                checked={draft.enabled}
                onChange={(enabled) => setDraft({ ...draft, enabled })}
              />
            </label>
          </Space>
        )}
      </Modal>
      <Modal
        open={!!pairing}
        title="设置收款手机"
        footer={<Button onClick={() => setPairing(null)}>关闭</Button>}
        onCancel={() => setPairing(null)}
      >
        <p>
          首次使用：复制下面的连接码，粘贴到收款手机软件，点“保存设置”。只需设置一次，连接码十分钟有效，请勿转发。
        </p>
        <Input.TextArea
          aria-label="监控配对信息"
          readOnly
          rows={4}
          value={pairing ? `wbpair1:${pairing.deviceId}:${pairing.pairCode}` : ''}
        />
        <Button
          onClick={() =>
            void run(async () => {
              if (!pairing) return;
              await navigator.clipboard.writeText(
                `wbpair1:${pairing.deviceId}:${pairing.pairCode}`,
              );
              setMessage('连接码已复制，请在收款手机粘贴并保存。');
            })
          }
        >
          复制连接码
        </Button>
        <p>
          第一台手机保存后自动启用。已有连接的手机无需生成连接码；换机需先补报旧手机记录，再启用新手机。
        </p>
      </Modal>
      <Modal
        open={!!ignoredReceipt}
        title="忽略这笔到账？"
        okText="确认忽略"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setIgnoredReceipt(null)}
        onOk={() =>
          ignoredReceipt &&
          void run(
            () =>
              api.call(A.resolve, {
                params: { receiptId: ignoredReceipt.id },
                body: { orderId: null, reason: '管理员确认忽略到账' },
              }),
            () => {
              setIgnoredReceipt(null);
              setReceiptId(undefined);
              toast.success('已忽略到账');
            },
          )
        }
      >
        {ignoredReceipt && (
          <p>
            {channel(ignoredReceipt.channel)} {money(ignoredReceipt.amountFen)} ·{' '}
            {date(ignoredReceipt.postedAt ?? ignoredReceipt.observedAt)}
          </p>
        )}
        <p>该记录将标记为「已忽略」。</p>
      </Modal>
      <Modal
        open={!!manual}
        title="核实漏报到账"
        okText="已核实实际收款，登记入账"
        cancelText="取消"
        confirmLoading={busy}
        onCancel={() => setManual(null)}
        okButtonProps={{
          disabled:
            !manual ||
            actualFen !== manual.amountFen ||
            !/^[A-Za-z0-9_-]{8,100}$/.test(bankRef.trim()),
        }}
        onOk={() =>
          manual &&
          void run(async () => {
            const result = await api.call(A.manualReceipt, {
              body: {
                orderId: manual.id,
                amountFen: actualFen,
                receiptReference: bankRef.trim(),
                reason: '管理员核实支付机构账单',
              },
            });
            if (result.status === 'matched') {
              setManual(null);
              setOrderId(undefined);
              toast.success('已登记并入账');
            } else {
              setMessage(reasons[result.reason] ?? '未能入账，请核对订单状态');
            }
          })
        }
      >
        <p>
          {manual &&
            `${manual.title} · ${channel(manual.channel)} · 订单应付 ${money(manual.amountFen)}`}
        </p>
        {manual?.userId && (
          <UserIdentity userId={manual.userId} label={directory.byId.get(manual.userId)} />
        )}
        <p>
          仅用于实际已收款、手机未上报的订单。先打开微信或支付宝账单，核对付款人、金额和交易编号；登记后会开通权益，不会再向用户收款。
        </p>
        <label>
          账单实收金额（元）
          <Input
            aria-label="账单实收金额"
            inputMode="decimal"
            value={actualMoney}
            maxLength={12}
            onChange={(e) => setActualMoney(e.target.value)}
          />
        </label>
        <label>
          支付机构交易编号
          <Input
            aria-label="支付机构交易编号"
            value={bankRef}
            maxLength={100}
            onChange={(e) => setBankRef(e.target.value)}
          />
        </label>
        <p>编号只保存摘要用于防止重复登记。请不要填写密码、付款凭据截图或私人聊天内容。</p>
      </Modal>
      <Modal
        open={!!message}
        title="操作提示"
        onCancel={() => setMessage('')}
        footer={<Button onClick={() => setMessage('')}>知道了</Button>}
      >
        {message}
      </Modal>
    </Page>
  );
}
