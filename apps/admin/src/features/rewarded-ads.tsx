import { useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Modal, Segmented, Space } from 'antd';
import { BillingAdminEndpoints, AdRevenueDay } from '@weiban/contracts';
import type { z } from 'zod';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Page, SectionCard, useToast } from '../ui/page.js';
import { DataTable } from '../ui/table.js';
import { beijingDayKey, formatYuan } from '../ui/format.js';
type Report = z.infer<typeof AdRevenueDay>;
type Values = { day: string; provider: string; estimated: number | null; settled: number | null };
const money = (n: number | null) => (n === null ? null : n / 1_000_000);
export function RewardedAdsPage() {
  const [days, setDays] = useState(7);
  const remote = useRemote(BillingAdminEndpoints.adRevenue, { query: { days } });
  const [editing, setEditing] = useState<Report | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const [form] = Form.useForm<Values>();
  const reports = remote.data?.reports ?? [],
    rewards = remote.data?.rewards ?? [];
  const withSettlement = reports.filter((r) => r.settledMicros !== null);
  const pending = reports.filter((r) => r.settledMicros === null);
  function open(row?: Report) {
    const value = row ?? {
      day: beijingDayKey(new Date().toISOString()),
      provider: '',
      estimatedMicros: null,
      settledMicros: null,
      revision: 0,
    };
    form.setFieldsValue({
      day: value.day,
      provider: value.provider,
      estimated: money(value.estimatedMicros),
      settled: money(value.settledMicros),
    });
    setError('');
    setEditing(value);
  }
  async function save(values: Values) {
    if (!editing || saving) return;
    if (values.estimated == null && values.settled == null) {
      setError('至少填写一个金额');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.call(BillingAdminEndpoints.saveAdRevenue, {
        body: {
          day: values.day,
          provider: values.provider.trim(),
          estimatedMicros: values.estimated == null ? null : Math.round(values.estimated * 1e6),
          settledMicros: values.settled == null ? null : Math.round(values.settled * 1e6),
          revision: editing.revision,
        },
      });
      setEditing(null);
      toast.success('收入报表已保存');
      remote.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }
  const number = (n: number) => (remote.data ? n.toLocaleString('zh-CN') : '—');
  return (
    <Page
      title="签到与广告"
      extra={
        <Space wrap>
          <Segmented
            value={days}
            onChange={setDays}
            options={[
              { value: 7, label: '近 7 天' },
              { value: 30, label: '近 30 天' },
            ]}
          />
          <Button type="primary" onClick={() => open()}>
            录入收入
          </Button>
        </Space>
      }
    >
      {remote.error && (
        <Alert
          type="error"
          showIcon
          message={remote.error}
          action={<Button onClick={remote.refresh}>重试</Button>}
        />
      )}
      <div className="workbench-metrics">
        <div className="workbench-metric">
          <span>已结算收入</span>
          <strong>
            {withSettlement.length
              ? formatYuan(withSettlement.reduce((n, r) => n + r.settledMicros!, 0))
              : '—'}
          </strong>
          <small>{number(withSettlement.length)} 份已结算报表</small>
        </div>
        <div className="workbench-metric">
          <span>待结算预估</span>
          <strong>
            {pending.length
              ? formatYuan(pending.reduce((n, r) => n + (r.estimatedMicros ?? 0), 0))
              : '—'}
          </strong>
          <small>{number(pending.length)} 份待结算报表</small>
        </div>
        <div className="workbench-metric">
          <span>广告奖励领取</span>
          <strong>
            {number(rewards.reduce((n, r) => n + r.completions, 0))}
            <small> 次</small>
          </strong>
          <small>按奖励到账计数</small>
        </div>
        <div className="workbench-metric">
          <span>活动赠送积分</span>
          <strong>
            {number(rewards.reduce((n, r) => n + r.points, 0))}
            <small> 分</small>
          </strong>
          <small>含签到与广告奖励</small>
        </div>
      </div>
      <SectionCard title="平台收入报表">
        <DataTable<Report>
          rowKey={(r) => r.day + '/' + r.provider}
          data={reports}
          loading={remote.loading}
          columns={[
            { title: '日期', dataIndex: 'day' },
            { title: '广告平台', dataIndex: 'provider' },
            {
              title: '预估收入',
              render: (_, r) =>
                r.estimatedMicros === null ? '未填' : formatYuan(r.estimatedMicros),
            },
            {
              title: '结算收入',
              render: (_, r) => (r.settledMicros === null ? '待结算' : formatYuan(r.settledMicros)),
            },
            {
              title: '操作',
              render: (_, r) => (
                <Button type="link" onClick={() => open(r)}>
                  编辑
                </Button>
              ),
            },
          ]}
          emptyTitle="这段时间还没有平台报表"
        />
      </SectionCard>
      <SectionCard
        title="每日奖励"
        extra={
          import.meta.env.MODE === 'admin-preview' ? (
            <a href="http://127.0.0.1:5185/reward-preview.html" target="_blank" rel="noreferrer">
              体验用户签到 ↗
            </a>
          ) : undefined
        }
      >
        <DataTable
          rowKey="day"
          data={rewards}
          loading={remote.loading}
          columns={[
            { title: '日期', dataIndex: 'day' },
            { title: '签到人数', dataIndex: 'checkins' },
            { title: '领到广告奖励', dataIndex: 'completions' },
            { title: '已发积分', dataIndex: 'points' },
          ]}
          emptyTitle="这段时间还没有奖励记录"
        />
      </SectionCard>
      <Modal
        open={editing !== null}
        title={editing?.revision ? '编辑平台报表' : '录入平台报表'}
        onCancel={() => {
          if (!saving) setEditing(null);
        }}
        onOk={() => form.submit()}
        confirmLoading={saving}
        okText="保存"
      >
        <Form form={form} layout="vertical" onFinish={save}>
          <Form.Item name="day" label="报表日期（北京时间）" rules={[{ required: true }]}>
            <Input
              type="date"
              max={beijingDayKey(new Date().toISOString())}
              disabled={!!editing?.revision}
            />
          </Form.Item>
          <Form.Item
            name="provider"
            label="广告平台"
            rules={[{ required: true, whitespace: true }]}
          >
            <Input maxLength={48} disabled={!!editing?.revision} />
          </Form.Item>
          <Form.Item name="estimated" label="平台预估收入（元）">
            <InputNumber min={0} max={1e6} precision={6} />
          </Form.Item>
          <Form.Item
            name="settled"
            label="已结算收入（元）"
            extra="收到平台结算单后填写。金额为零时请填 0。"
          >
            <InputNumber min={0} max={1e6} precision={6} />
          </Form.Item>
        </Form>
        {error && <Alert type="error" message={error} />}
      </Modal>
    </Page>
  );
}
