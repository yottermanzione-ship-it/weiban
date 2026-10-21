/**
 * 3.27（H1，总经理 10-21「先用后扣、可欠一次」）：对账页的「欠费用户」与「先用后扣保护」两块。
 * - 欠费用户：余额 < 0 的用户与欠费金额（欠得多的在前）；欠费期间这些用户的一切付费调用都会被拒，直到充值转正。
 * - 先用后扣保护：同一用户付费调用并发上限、前台排队等待秒数、异常巨额请求拦截线（立即生效，写审计）。
 */
import { useState } from 'react';
import { Alert, Button, Form, InputNumber, Typography } from 'antd';
import type { z } from 'zod';
import { BillingAdminEndpoints, type BillingDebtor, PostpaidSettings } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/hooks.js';
import { useFormFeedback } from '../data/form-feedback.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, SectionCard, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime, formatPoints, formatYuan } from '../ui/format.js';

type Settings = z.infer<typeof PostpaidSettings>;
type SettingsValues = Omit<Settings, 'updatedAt'>;

export function PostpaidPanel() {
  const toast = useToast();
  const debts = useRemote(BillingAdminEndpoints.listDebts);
  const settings = useRemote(BillingAdminEndpoints.getPostpaidSettings);
  const [editing, setEditing] = useState(false);
  const s = settings.data;

  const columns: ProColumns<BillingDebtor>[] = [
    {
      title: '用户',
      dataIndex: 'username',
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.username || '（已注销）'}</span>
          <span className="cell-sub mono">{row.userId}</span>
        </div>
      ),
    },
    {
      title: '欠费',
      dataIndex: 'debtMicros',
      width: 180,
      render: (_, row) => (
        <div className="cell-main">
          <Typography.Text type="danger" strong>
            {formatPoints(row.debtMicros)} 积分
          </Typography.Text>
          <span className="cell-sub">{formatYuan(row.debtMicros)}</span>
        </div>
      ),
    },
    {
      title: '当前余额',
      dataIndex: 'balanceMicros',
      width: 140,
      render: (_, row) => `${formatPoints(row.balanceMicros)} 积分`,
    },
    {
      title: '最近一笔扣费',
      dataIndex: 'lastChargeAt',
      width: 180,
      render: (_, row) => formatDateTime(row.lastChargeAt),
    },
  ];

  return (
    <>
      <SectionCard
        title="先用后扣保护"
        desc="调用前只要求余额大于 0，用完按实际扣，可以欠一次；欠费后这位用户的一切付费调用都停，充值转正后恢复。"
        extra={
          <Button onClick={() => setEditing(true)} disabled={!s}>
            修改
          </Button>
        }
      >
        {settings.error && <Alert type="error" showIcon message={settings.error} />}
        <div className="mini-stats">
          <div className="mini-stat">
            <span>同一用户同时付费调用</span>
            <strong>{s ? `最多 ${s.maxConcurrentPaidCalls} 个` : '—'}</strong>
            <em>防止多个调用一起把余额扣成大额负数</em>
          </div>
          <div className="mini-stat">
            <span>满了时聊天回复排队</span>
            <strong>{s ? `最多等 ${s.concurrencyWaitSeconds} 秒` : '—'}</strong>
            <em>角色生态、记忆整理等后台任务不排队，直接跳过</em>
          </div>
          <div className="mini-stat">
            <span>异常巨额请求拦截</span>
            <strong>{s ? `预估超过 ${s.largeRequestLimitPoints} 积分` : '—'}</strong>
            <em>按实际发送的内容 + 最长回复估算，超过就不调用</em>
          </div>
        </div>
      </SectionCard>

      <SectionCard
        title="欠费用户"
        desc="余额为负的用户。他们的聊天、角色生态、主动消息、记忆整理等付费调用都已停止，充值后自动恢复。"
        extra={<Button onClick={() => debts.refresh()}>刷新</Button>}
      >
        {debts.data && (
          <div className="detail-muted" style={{ marginBottom: 12 }}>
            {debts.data.count === 0 ? (
              <StatusTag tone="success">目前没有欠费用户</StatusTag>
            ) : (
              <>
                <StatusTag tone="error">{debts.data.count} 位用户欠费</StatusTag>
                合计欠 {formatPoints(debts.data.totalDebtMicros)} 积分（
                {formatYuan(debts.data.totalDebtMicros)}）
              </>
            )}
          </div>
        )}
        <DataTable<BillingDebtor>
          rowKey="userId"
          columns={columns}
          data={debts.data?.items ?? []}
          loading={debts.loading}
          error={debts.error}
          pagination={false}
          emptyTitle="没有欠费用户"
          emptyHint="用户余额扣成负数后会出现在这里；给他们充值后自动消失。"
        />
      </SectionCard>

      {editing && s && (
        <SettingsDrawer
          initial={s}
          onClose={() => setEditing(false)}
          onSaved={() => {
            setEditing(false);
            toast.success('已保存，立即生效');
            settings.refresh();
          }}
        />
      )}
    </>
  );
}

function SettingsDrawer({
  initial,
  onClose,
  onSaved,
}: {
  initial: Settings;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<SettingsValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(BillingAdminEndpoints.updatePostpaidSettings, { body: values });
      onSaved();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      form={form}
      draftKey="postpaid-settings:global"
      open
      onClose={onClose}
      title="先用后扣保护"
      subtitle="改完立即生效，所有用户共用这一套"
      width={560}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<SettingsValues>
        form={form}
        layout="vertical"
        initialValues={{
          maxConcurrentPaidCalls: initial.maxConcurrentPaidCalls,
          concurrencyWaitSeconds: initial.concurrencyWaitSeconds,
          largeRequestLimitPoints: initial.largeRequestLimitPoints,
        }}
      >
        <FormSection title="防止欠费叠加" />
        <Form.Item
          name="maxConcurrentPaidCalls"
          label="同一用户同时进行的付费调用最多几个"
          rules={[{ required: true, message: '填写 1–20' }]}
          extra={
            <FieldHelp>
              默认 3：语音通话时会同时有「听你说话」「想怎么回」「念出来」三路调用，设成 2 通话可能卡住。
            </FieldHelp>
          }
        >
          <InputNumber min={1} max={20} precision={0} style={{ width: '100%' }} addonAfter="个" />
        </Form.Item>
        <Form.Item
          name="concurrencyWaitSeconds"
          label="满了时聊天回复最多排队几秒"
          rules={[{ required: true, message: '填写 0–30' }]}
          extra={<FieldHelp>超过还没轮到就提示「暂时没法回复」；后台任务不排队，下次再做。</FieldHelp>}
        >
          <InputNumber min={0} max={30} precision={0} style={{ width: '100%' }} addonAfter="秒" />
        </Form.Item>
        <FormSection title="异常巨额请求" />
        <Form.Item
          name="largeRequestLimitPoints"
          label="单次预估超过多少积分就拦截"
          rules={[{ required: true, message: '填写拦截线' }]}
          extra={
            <FieldHelp>
              默认 200 积分（2 元）。按这次实际发给模型的内容加上最长回复估算；正常聊天一条通常不到 10 积分。
            </FieldHelp>
          }
        >
          <InputNumber
            min={1}
            max={1_000_000}
            precision={0}
            style={{ width: '100%' }}
            addonAfter="积分"
          />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}
