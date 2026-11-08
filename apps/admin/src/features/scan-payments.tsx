import { useEffect, useEffectEvent, useState } from 'react';
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
import { UserIdentity, userDisplayName, useUserDirectory } from './users/identity.js';

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
  notice_uncertain: '有金额的通知，收款性质待核对，不自动入账',
  notice_multiple_amounts: '通知包含多个金额，不自动入账',
  notice_summary: '汇总通知，不自动入账',
};
const money = (fen: number) => `¥${(fen / 100).toFixed(2)}`;
const purchase = (kind?: string | null) =>
  kind === 'recharge' ? '积分充值' : kind === 'membership' ? '会员购买' : '待核对';
const channel = (s: string) => (s === 'wechat' ? '微信' : '支付宝');
const date = (s: string | null) =>
  s ? new Date(s).toLocaleString('zh-CN', { hour12: false }) : '尚未连接';

export function ScanPaymentsPage() {
  const directory = useUserDirectory();
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
          <Tag color={available ? 'green' : 'default'}>
            {available
              ? '已开放'
              : settings.data?.enabled
                ? '暂停接单（监控未连接或切换未完成）'
                : '未开放'}
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
            {pairedDevices.length ? '连接另一台手机' : '设置收款手机'}
          </Button>
        </Space>
        <Table
          rowKey="id"
          size="small"
          dataSource={pairedDevices}
          pagination={{ pageSize: 10 }}
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
            {
              title: '付款人',
              render: (_, r) =>
                r.userId ? (
                  <UserIdentity userId={r.userId} label={directory.byId.get(r.userId)} />
                ) : (
                  '已注销账号'
                ),
              width: 260,
            },
            { title: '购买类型', render: (_, r) => purchase(r.kind) },
            { title: '购买内容', dataIndex: 'title' },
            { title: '渠道', render: (_, r) => channel(r.channel) },
            { title: '应付金额', render: (_, r) => money(r.amountFen) },
            { title: '积分', dataIndex: 'points' },
            { title: '状态', render: (_, r) => statusNames[r.status] },
            { title: '创建时间', render: (_, r) => date(r.createdAt) },
            { title: '入账时间', render: (_, r) => (r.paidAt ? date(r.paidAt) : '未入账') },
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
      <SectionCard title="监控上报记录">
        <p>
          手机报来的金额通知都会保留在这里，每五秒更新；明确收款才自动核对订单，促销、汇总和金额冲突仅登记待核对。
        </p>
        <Table
          rowKey="id"
          loading={receipts.loading}
          dataSource={receipts.data?.items ?? []}
          locale={{ emptyText: '暂无上报记录；监控连接正常不等于已收到收款通知' }}
          pagination={false}
          scroll={{ x: 900 }}
          columns={[
            { title: '渠道', render: (_, r) => channel(r.channel) },
            { title: '通知／登记金额', render: (_, r) => money(r.amountFen) },
            { title: '购买类型', render: (_, r) => purchase(r.purchaseKind) },
            { title: '购买内容', render: (_, r) => r.purchaseTitle ?? '尚未匹配订单' },
            {
              title: '到账通知时间',
              render: (_, r) => (r.deviceId ? date(r.postedAt ?? r.observedAt) : '人工登记'),
            },
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
          购买类型由对应订单自动确定，通知时间为手机收到该通知的发布时间。未匹配的到账请对照实际账单核对；本页不退款。
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
              .map((r) => ({
                value: r.id,
                label: `${userDisplayName(r.userId!, directory.byId.get(r.userId!))} · ${r.title} ${money(r.amountFen)} · ${r.id}`,
              })),
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
