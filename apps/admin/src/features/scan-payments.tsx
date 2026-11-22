import { useEffect, useEffectEvent, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Input,
  Modal,
  Popover,
  Space,
  Switch,
  Table,
  Tabs,
  Tag,
  Tooltip,
} from 'antd';
import { CopyOutlined } from '@ant-design/icons';
import {
  ScanPaymentAdminEndpoints as A,
  type ScanPaymentSettings,
  type ScanReceipt,
  type ScanOrder,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/hooks.js';
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

function PaymentAmount({ amountFen, channel: method }: Pick<ScanOrder, 'amountFen' | 'channel'>) {
  return (
    <div className="cell-main">
      <strong className="scan-payment-amount mono">{money(amountFen)}</strong>
      <span className="cell-sub">{channel(method)}</span>
    </div>
  );
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

export function ScanPaymentsPage() {
  const toast = useToast();
  const [tab, setTab] = useState('receipts');
  const settings = useRemote(A.settings);
  const devices = useRemote(A.devices);
  const [oc, setOc] = useState<string | undefined>();
  const [rc, setRc] = useState<string | undefined>();
  const orders = useRemote(A.orders, { query: { cursor: oc, limit: 30 } });
  const receipts = useRemote(A.receipts, { query: { cursor: rc, limit: 30 } });
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
          ) : !selectedReceipt && !selectedOrder ? (
            <span>各选一笔到账和订单即可关联</span>
          ) : !selectedReceipt ? (
            <span>选择对应的待核对到账</span>
          ) : !selectedOrder ? (
            <span>选择对应的 APP 订单</span>
          ) : null}
        </div>
        <Space wrap>
          {(selectedReceipt || selectedOrder) && (
            <Button type="text" disabled={busy} onClick={clearSelection}>
              清空选择
            </Button>
          )}
          <Button
            type="primary"
            disabled={!selectedReceipt || !selectedOrder || !!pairMismatch || busy}
            onClick={linkReceipt}
          >
            确认关联并入账
          </Button>
        </Space>
      </div>
      <SectionCard bodyStyle={{ padding: 0 }}>
        <Tabs
          className="scan-record-tabs"
          activeKey={tab}
          onChange={setTab}
          tabBarExtraContent={
            tab === 'receipts' ? (
              <Button
                size="small"
                disabled={!selectedReceipt || busy}
                onClick={() => selectedReceipt && setIgnoredReceipt(selectedReceipt)}
              >
                忽略到账
              </Button>
            ) : (
              <Button
                size="small"
                disabled={!selectedOrder || busy}
                onClick={() => {
                  if (!selectedOrder) return;
                  setManual(selectedOrder);
                  setBankRef('');
                  setActualMoney('');
                }}
              >
                登记漏报
              </Button>
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
                    scroll={{ x: 684, y: tableHeight }}
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
                        title: '金额',
                        width: 104,
                        align: 'right',
                        render: (_, r) => (
                          <PaymentAmount amountFen={r.amountFen} channel={r.channel} />
                        ),
                      },
                      {
                        title: '通知时间',
                        width: 118,
                        render: (_, r) => <PaymentTime at={r.postedAt ?? r.observedAt} />,
                      },
                      {
                        title: '服务器收报',
                        width: 118,
                        render: (_, r) => <PaymentTime at={r.receivedAt} />,
                      },
                      {
                        title: '来源',
                        width: 86,
                        render: (_, r) => (r.deviceId ? '手机监控' : '人工登记'),
                      },
                      {
                        title: '状态',
                        render: (_, r) => (
                          <Tooltip
                            trigger={['hover', 'focus']}
                            title={
                              <div>
                                <div>{reasons[r.reason] ?? '待核对'}</div>
                                {r.purchaseTitle && <div>{r.purchaseTitle}</div>}
                                <div>
                                  {r.deviceId ? '手机监控' : '人工登记'} · 收到于{' '}
                                  {date(r.receivedAt)}
                                </div>
                              </div>
                            }
                          >
                            <div className="cell-main scan-payment-status" tabIndex={0}>
                              <span>
                                <PaymentStatusTag status={r.status} />
                              </span>
                              <span className="cell-sub scan-truncate">
                                {r.status === 'matched' && r.purchaseTitle
                                  ? r.purchaseTitle
                                  : (reasons[r.reason] ?? '待核对')}
                              </span>
                            </div>
                          </Tooltip>
                        ),
                      },
                      {
                        title: '关联订单',
                        width: 102,
                        render: (_, r) =>
                          r.orderId ? (
                            <OrderIdentifier id={r.orderId} />
                          ) : (
                            <span className="cell-sub">—</span>
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
                    scroll={{ x: 776, y: tableHeight }}
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
                        width: 100,
                        render: (_, r) => <OrderIdentifier id={r.id} />,
                      },
                      {
                        title: '付款人',
                        width: 146,
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
                        title: '应付金额',
                        width: 102,
                        align: 'right',
                        render: (_, r) => (
                          <PaymentAmount amountFen={r.amountFen} channel={r.channel} />
                        ),
                      },
                      {
                        title: '创建时间',
                        width: 106,
                        render: (_, r) => <PaymentTime at={r.createdAt} />,
                      },
                      {
                        title: '入账时间',
                        width: 106,
                        render: (_, r) =>
                          r.paidAt ? (
                            <PaymentTime at={r.paidAt} />
                          ) : (
                            <span className="cell-sub">—</span>
                          ),
                      },
                      {
                        title: '状态',
                        width: 88,
                        render: (_, r) => <PaymentStatusTag status={r.status} />,
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
          void run(
            () =>
              api.call(A.manualReceipt, {
                body: {
                  orderId: manual.id,
                  amountFen: actualFen,
                  receiptReference: bankRef.trim(),
                  reason: '管理员核实支付机构账单',
                },
              }),
            () => {
              setManual(null);
              setOrderId(undefined);
            },
          )
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
