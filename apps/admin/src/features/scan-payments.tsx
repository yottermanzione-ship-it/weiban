import { useState } from 'react';
import { Alert, Button, Checkbox, Input, Modal, Select, Space, Switch, Table, Tag } from 'antd';
import {
  ScanPaymentAdminEndpoints as A,
  type ScanPaymentSettings,
  type ScanReceipt,
  type ScanOrder,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/hooks.js';
import { Page, SectionCard } from '../ui/page.js';

const statusNames: Record<string, string> = {
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
};
const money = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const channel = (s: string) => (s === 'wechat' ? '微信' : '支付宝');
const date = (s: string | null) =>
  s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '尚未连接';

export function ScanPaymentsPage() {
  const settings = useRemote(A.settings);
  const devices = useRemote(A.devices);
  const [oc, setOc] = useState<string | undefined>();
  const [rc, setRc] = useState<string | undefined>();
  const orders = useRemote(A.orders, { query: { cursor: oc, limit: 30 } });
  const receipts = useRemote(A.receipts, { query: { cursor: rc, limit: 30 } });
  const [draft, setDraft] = useState<ScanPaymentSettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [manual, setManual] = useState<ScanOrder | null>(null);
  const [bankRef, setBankRef] = useState('');
  const [actualMoney, setActualMoney] = useState('');
  const [manualReason, setManualReason] = useState('');
  const [whole = '', decimal = ''] = actualMoney.trim().split('.');
  const actualFen = /^\d+(\.\d{1,2})?$/.test(actualMoney.trim())
    ? Number(whole) * 100 + Number(decimal.padEnd(2, '0'))
    : 0;
  const [message, setMessage] = useState('');
  const [deviceName, setDeviceName] = useState('收款手机');
  const [pairing, setPairing] = useState<{
    deviceId: string;
    pairCode: string;
    expiresAt: string;
  } | null>(null);
  const [resolve, setResolve] = useState<ScanReceipt | null>(null);
  const [orderId, setOrderId] = useState<string | null>(null);
  const [reason, setReason] = useState('');
  function refresh() {
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
  return (
    <Page
      title="扫码收款"
      desc="积分充值与会员共用微信、支付宝两个收款码。手机监听到账后自动核对；迟到、金额不符等情况留在这里处理。"
      extra={<Button onClick={refresh}>刷新</Button>}
    >
      {(settings.error || devices.error || orders.error || receipts.error) && (
        <Alert
          type="error"
          showIcon
          message={settings.error || devices.error || orders.error || receipts.error}
        />
      )}
      <SectionCard title="收款设置">
        <Space wrap>
          <Tag color={settings.data?.enabled ? 'green' : 'default'}>
            {settings.data?.enabled ? '已开放' : '未开放'}
          </Tag>
          <Button disabled={!settings.data} onClick={() => setDraft(settings.data!)}>
            配置收款码与开关
          </Button>
        </Space>
        <p>
          请确认旧站已停止对同一收款码独立认单，或两个站使用不同收款账户。收款手机断连时会暂停新订单。
        </p>
      </SectionCard>
      <SectionCard title="到账监控手机">
        <Space wrap>
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
            新增监控配对
          </Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          dataSource={devices.data ?? []}
          pagination={{ pageSize: 10 }}
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
                  {r.active ? '停用' : '设为唯一监控'}
                </Button>
              ),
            },
          ]}
        />
        <p>更换手机前先补报原手机队列。只有这里启用的唯一手机可以报账，配对成功后还需启用。</p>
      </SectionCard>
      <SectionCard title="付款订单">
        <Table
          rowKey="id"
          loading={orders.loading}
          dataSource={orders.data?.items ?? []}
          pagination={false}
          scroll={{ x: 1000 }}
          columns={[
            { title: '订单编号', dataIndex: 'id', width: 260 },
            { title: '用户编号', render: (_, r) => r.userId ?? '已注销', width: 260 },
            { title: '购买内容', dataIndex: 'title' },
            { title: '渠道', render: (_, r) => channel(r.channel) },
            { title: '应付金额', render: (_, r) => money(r.amountFen) },
            { title: '积分', dataIndex: 'points' },
            { title: '状态', render: (_, r) => statusNames[r.status] },
            { title: '创建时间', render: (_, r) => date(r.createdAt) },
            {
              title: '漏报处理',
              render: (_, r) => (
                <Button
                  disabled={r.status === 'paid' || !r.userId}
                  onClick={() => {
                    setManual(r);
                    setBankRef('');
                    setActualMoney('');
                    setManualReason('');
                  }}
                >
                  核实漏报到账
                </Button>
              ),
            },
          ]}
        />
        <Space>
          <Button disabled={!oc} onClick={() => setOc(undefined)}>
            最新订单
          </Button>
          <Button
            disabled={!orders.data?.nextCursor}
            onClick={() => setOc(orders.data?.nextCursor ?? undefined)}
          >
            下一页订单
          </Button>
        </Space>
      </SectionCard>
      <SectionCard title="到账与待核对">
        <Table
          rowKey="id"
          loading={receipts.loading}
          dataSource={receipts.data?.items ?? []}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: '渠道', render: (_, r) => channel(r.channel) },
            { title: '实收金额', render: (_, r) => money(r.amountFen) },
            { title: '观察到账时间', render: (_, r) => date(r.observedAt) },
            { title: '服务器收到时间', render: (_, r) => date(r.receivedAt) },
            { title: '状态', render: (_, r) => statusNames[r.status] },
            { title: '来源', render: (_, r) => (r.deviceId ? '手机监控' : '人工登记') },
            { title: '原因', render: (_, r) => reasons[r.reason] ?? '待核对' },
            { title: '关联订单', render: (_, r) => r.orderId ?? '未关联' },
            {
              title: '操作',
              render: (_, r) => (
                <Button
                  disabled={r.status !== 'review'}
                  onClick={() => {
                    setResolve(r);
                    setOrderId(null);
                    setReason('');
                  }}
                >
                  核对处理
                </Button>
              ),
            },
          ]}
        />
        <Space>
          <Button disabled={!rc} onClick={() => setRc(undefined)}>
            最新到账
          </Button>
          <Button
            disabled={!receipts.data?.nextCursor}
            onClick={() => setRc(receipts.data?.nextCursor ?? undefined)}
          >
            下一页到账
          </Button>
        </Space>
        <p>
          到账依据是手机支付应用通知，不是支付机构交易查询。请对照实际账单处理待核对项；本页不退款。
        </p>
      </SectionCard>
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
        title="配对收款监控"
        footer={<Button onClick={() => setPairing(null)}>已记下，关闭</Button>}
        onCancel={() => setPairing(null)}
      >
        <p>在收款手机安装“微伴收款监控”，把下面配对信息填入软件。十分钟内有效，请勿转发给他人。</p>
        <Input.TextArea
          aria-label="监控配对信息"
          readOnly
          rows={4}
          value={pairing ? `wbpair1:${pairing.deviceId}:${pairing.pairCode}` : ''}
        />
        <p>配对成功后，回到这里将手机“设为唯一监控”。</p>
      </Modal>
      <Modal
        open={!!resolve}
        title="人工核对到账"
        okText={orderId ? '确认关联并入账' : '标记忽略'}
        cancelText="取消"
        confirmLoading={busy}
        okButtonProps={{ disabled: reason.trim().length < 5 }}
        onCancel={() => setResolve(null)}
        onOk={() =>
          resolve &&
          void run(
            () =>
              api.call(A.resolve, { params: { receiptId: resolve.id }, body: { orderId, reason } }),
            () => setResolve(null),
          )
        }
      >
        <p>
          {resolve &&
            `${channel(resolve.channel)} ${money(resolve.amountFen)}，${date(resolve.observedAt)}`}
        </p>
        <p>
          先核实实际账单和购买者。只能关联同渠道、同金额的未入账订单；没有对应订单时可标记忽略。
        </p>
        <Select
          aria-label="关联订单"
          style={{ width: '100%' }}
          value={orderId ?? ''}
          onChange={(v) => setOrderId(v || null)}
          options={[
            { value: '', label: '忽略这条到账，不入账' },
            ...(orders.data?.items ?? [])
              .filter(
                (r) =>
                  r.status !== 'paid' &&
                  r.userId &&
                  r.channel === resolve?.channel &&
                  r.amountFen === resolve?.amountFen,
              )
              .map((r) => ({ value: r.id, label: `${r.title} ${money(r.amountFen)} · ${r.id}` })),
          ]}
        />
        <p>上方订单翻页后再打开核对，可选择该页订单。</p>
        <Input.TextArea
          aria-label="核对依据"
          placeholder="填写核对依据，至少5个字"
          value={reason}
          maxLength={200}
          onChange={(e) => setReason(e.target.value)}
        />
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
            !/^[A-Za-z0-9_-]{8,100}$/.test(bankRef.trim()) ||
            manualReason.trim().length < 5,
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
                  reason: manualReason,
                },
              }),
            () => setManual(null),
          )
        }
      >
        <p>
          {manual &&
            `${manual.title} · ${channel(manual.channel)} · 订单应付 ${money(manual.amountFen)}`}
        </p>
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
        <label>
          核对依据
          <Input.TextArea
            aria-label="漏报核对依据"
            value={manualReason}
            maxLength={200}
            onChange={(e) => setManualReason(e.target.value)}
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
