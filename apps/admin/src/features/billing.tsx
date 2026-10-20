/**
 * 对账与平台花费：平台今日成本、各上游近 30 天成本、每日对账结果、录入上游账单。
 * 数据仍来自 billing 管理接口，界面统一 Ant Design。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Select,
  Skeleton,
  Space,
} from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs, { type Dayjs } from 'dayjs';
import type { z } from 'zod';
import {
  BillingAdminEndpoints,
  ModelAccessAdminEndpoints,
  ReconciliationRun,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import {
  FieldHelp,
  FormSection,
  Page,
  SectionCard,
  StatusTag,
  useToast,
} from '../ui/page.js';
import { formatDate, formatYuan } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';

type Recon = z.infer<typeof ReconciliationRun>;

function todayBj(): string {
  return new Date().toLocaleDateString('sv', { timeZone: 'Asia/Shanghai' });
}

function localDate(offset = 0): string {
  return new Date(Date.now() + offset * 86_400_000).toLocaleDateString('sv', {
    timeZone: 'Asia/Shanghai',
  });
}

export function BillingPage() {
  const toast = useToast();
  const summary = useRemote(BillingAdminEndpoints.getPlatformSummary);
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const [range, setRange] = useState<[Dayjs, Dayjs]>([dayjs(localDate(-30)), dayjs(todayBj())]);
  const [items, setItems] = useState<Recon[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [billOpen, setBillOpen] = useState(false);

  async function loadRecon() {
    setLoading(true);
    setError('');
    try {
      const res = await api.call(BillingAdminEndpoints.listReconciliation, {
        query: { from: range[0].format('YYYY-MM-DD'), to: range[1].format('YYYY-MM-DD') },
      });
      setItems(res.items);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void loadRecon();
    // 只在首次进入时查一次，后续点「查询」。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const upstreamName = (id: string) =>
    (upstreams.data?.items ?? []).find((u) => u.upstreamId === id)?.name ?? id;

  const columns: ProColumns<Recon>[] = [
    { title: '日期', width: 110, render: (_, r) => formatDate(r.date) },
    {
      title: '账本自洽',
      width: 100,
      render: (_, r) =>
        r.ledgerConsistent ? (
          <StatusTag tone="success">正常</StatusTag>
        ) : (
          <StatusTag tone="error">异常</StatusTag>
        ),
    },
    {
      title: '超时冻结',
      width: 90,
      render: (_, r) => r.staleHolds,
    },
    {
      title: '缺扣费 / 多扣费',
      width: 130,
      render: (_, r) => `${r.usageWithoutCharge} / ${r.chargeWithoutUsage}`,
    },
    {
      title: '金额不一致',
      width: 110,
      render: (_, r) => r.usageAmountMismatch ?? 0,
    },
    {
      title: '平台吸收',
      width: 120,
      render: (_, r) => formatYuan(r.netAbsorbedMicros ?? r.absorbedMicros ?? 0, 4),
    },
    {
      title: '待核成本',
      width: 160,
      render: (_, r) =>
        (r.unknownCostCalls ?? 0) > 0 ? (
          <span className="warn-text">
            {r.unknownCostCalls} 笔待核，风险上界 {formatYuan(r.uncertainCostMicros ?? 0, 4)}
          </span>
        ) : (
          '—'
        ),
    },
    {
      title: '上游账单偏差',
      render: (_, r) =>
        r.upstreamDiffs.length === 0 ? (
          '—'
        ) : (
          <div className="cell-main">
            {r.upstreamDiffs
              .filter((d) => d.flagged)
              .map((d) => (
                <span key={d.upstreamId} className="cell-sub">
                  {upstreamName(d.upstreamId)}：账单 {formatYuan(d.billedMicros, 4)} / 计算{' '}
                  {formatYuan(d.netComputedCostMicros ?? d.computedCostMicros, 4)}（偏差{' '}
                  {(d.diffRatio * 100).toFixed(1)}%）
                </span>
              ))}
            {r.upstreamDiffs.filter((d) => d.flagged).length === 0 && (
              <span className="cell-sub">账单与计算一致</span>
            )}
          </div>
        ),
    },
  ];

  const data = summary.data;

  return (
    <Page
      title="对账与平台花费"
      desc="平台自己花了多少钱、每个上游对不对得上账。用户扣费在「用量与花费」里看。"
      extra={
        <Space>
          <Button onClick={() => summary.refresh()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setBillOpen(true)}>
            录入上游账单
          </Button>
        </Space>
      }
    >
      {summary.loading && !data ? (
        <SectionCard>
          <Skeleton active paragraph={{ rows: 3 }} />
        </SectionCard>
      ) : (
        <div className="mini-stats">
          <div className="mini-stat">
            <span>今日成本（北京时间）</span>
            <strong>{formatYuan(data?.todayCostMicros ?? 0)}</strong>
            <em>付给模型服务商的钱</em>
          </div>
          <div className="mini-stat">
            <span>每日上限</span>
            <strong>{formatYuan(data?.dailyCapMicros ?? 0)}</strong>
            <em>超过后平台调用会被拦住</em>
          </div>
          <div className="mini-stat">
            <span>平台账户余额</span>
            <strong>{formatYuan(data?.platformAccountBalanceMicros ?? 0)}</strong>
            <em>平台自己账户里的积分折合</em>
          </div>
          <div className="mini-stat">
            <span>今日剩余额度</span>
            <strong>
              {formatYuan(Math.max(0, (data?.dailyCapMicros ?? 0) - (data?.todayCostMicros ?? 0)))}
            </strong>
            <em>上限减去今日已花</em>
          </div>
        </div>
      )}
      {summary.error && <Alert type="error" showIcon message={summary.error} />}

      <SectionCard title="各上游近 30 天成本" desc="按线路看钱花在哪">
        {(data?.last30DaysCostByUpstream ?? []).length === 0 ? (
          <div className="detail-muted">近 30 天没有成本记录。</div>
        ) : (
          <div className="rank-list">
            {[...(data?.last30DaysCostByUpstream ?? [])]
              .sort((a, b) => b.costMicros - a.costMicros)
              .map((row) => (
                <div className="rank-row" key={row.upstreamId}>
                  <span className="rank-name">{upstreamName(row.upstreamId)}</span>
                  <span className="rank-meta">{formatYuan(row.costMicros)}</span>
                </div>
              ))}
          </div>
        )}
      </SectionCard>

      <div className="tab-head">
        <div className="tab-desc">
          <strong>每日对账结果</strong>
          <span>系统每天自动核对一次：账本是否自洽、有没有漏扣或多扣、和上游账单差多少。</span>
        </div>
        <Space size={8}>
          <DatePicker.RangePicker
            value={range}
            allowClear={false}
            onChange={(v) => {
              if (v?.[0] && v[1]) setRange([v[0], v[1]]);
            }}
          />
          <Button type="primary" onClick={() => void loadRecon()} loading={loading}>
            查询
          </Button>
        </Space>
      </div>
      <DataTable<Recon>
        rowKey="runId"
        columns={columns}
        data={items}
        loading={loading}
        error={error}
        pagination={false}
        emptyTitle="这段时间没有对账记录"
        emptyHint="对账每天凌晨自动跑一次；刚部署或当天还没跑完时这里是空的。"
      />

      {billOpen && (
        <BillDrawer
          upstreams={(upstreams.data?.items ?? []).map((u) => ({
            value: u.upstreamId,
            label: u.name,
          }))}
          onClose={() => setBillOpen(false)}
          onSaved={() => {
            setBillOpen(false);
            toast.success('账单已录入');
            summary.refresh();
            void loadRecon();
          }}
        />
      )}
    </Page>
  );
}

interface BillValues {
  upstreamId: string;
  period: [Dayjs, Dayjs];
  amountYuan: number;
  note?: string;
}

function BillDrawer({
  upstreams,
  onClose,
  onSaved,
}: {
  upstreams: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<BillValues>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(BillingAdminEndpoints.createUpstreamBill, {
        body: {
          upstreamId: values.upstreamId,
          periodStart: values.period[0].format('YYYY-MM-DD'),
          periodEnd: values.period[1].format('YYYY-MM-DD'),
          amountMicros: Math.round(values.amountYuan * 1_000_000),
          note: values.note || null,
        },
      });
      onSaved();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title="录入上游账单"
      subtitle="把服务商给的账单金额记进来，系统会和你算出来的成本对比"
      width={560}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<BillValues>
        form={form}
        layout="vertical"
        initialValues={{
          upstreamId: upstreams[0]?.value,
          period: [dayjs(localDate(-30)), dayjs(todayBj())],
          amountYuan: 0,
        }}
      >
        <FormSection title="账单信息" />
        <Form.Item
          name="upstreamId"
          label="上游账号"
          rules={[{ required: true, message: '选择上游账号' }]}
          extra={<FieldHelp>这条账单是哪个服务商开的。</FieldHelp>}
        >
          <Select options={upstreams} placeholder="选择上游账号" />
        </Form.Item>
        <Form.Item
          name="period"
          label="账单周期"
          rules={[{ required: true, message: '选择账单周期' }]}
          extra={<FieldHelp>服务商账单上写的起止日期。</FieldHelp>}
        >
          <DatePicker.RangePicker allowClear={false} />
        </Form.Item>
        <Form.Item
          name="amountYuan"
          label="账单金额（元）"
          rules={[{ required: true, message: '填写账单金额' }]}
          extra={<FieldHelp>按服务商账单上的实际金额填写，不要估算。</FieldHelp>}
        >
          <InputNumber min={0} step={0.01} style={{ width: '100%' }} addonAfter="元" />
        </Form.Item>
        <Form.Item name="note" label="备注" extra={<FieldHelp>例：8 月账单，含赠送额度。</FieldHelp>}>
          <Input maxLength={200} />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}
