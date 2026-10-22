/**
 * 行为规划：哪些「判断」交给模型、用哪个模型、门槛多少；以及最近的判断记录。
 * 决策层出错会自动退回纯规则，用户无感。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  DatePicker,
  Form,
  Input,
  InputNumber,
  Radio,
  Select,
  Space,
  Tabs,
} from 'antd';
import type { Dayjs } from 'dayjs';
import type { z } from 'zod';
import {
  ModelAccessAdminEndpoints,
  PlannerAdminEndpoints,
  PlanningDecisionRecord,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, Page, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime, formatPercent } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';

type Decision = z.infer<typeof PlanningDecisionRecord>;

const DECISION_TYPES = [
  ['reply_form', '回复形式'],
  ['reply_timing', '回复时机'],
  ['quirk', '小巧思'],
  ['proactive_slot', '主动消息时机'],
  ['call_slot', '来电时机'],
  ['moments_plan', '朋友圈'],
  ['play_slot', '玩法时机'],
] as const;

type DecisionType = (typeof DECISION_TYPES)[number][0];

const IMPL_NAMES: Record<string, string> = {
  rules: '纯规则',
  rules_model: '规则 + 便宜模型',
  jev: 'Jev',
};

const FALLBACK_NAMES: Record<string, string> = {
  low_confidence: '置信度低',
  timeout: '超时',
  error: '出错',
  budget: '预算',
  cost_guard: '成本闸',
  circuit_open: '熔断',
  invalid_choice: '无效选择',
};

const typeName = (t: string) => DECISION_TYPES.find(([key]) => key === t)?.[1] ?? t;

export function PlannerPage() {
  const [tab, setTab] = useState<'config' | 'decisions'>('config');
  return (
    <Page
      title="行为规划"
      desc="决定「角色什么时候回、怎么回」这类判断是交给规则还是交给模型。出错会自动退回规则，用户无感。"
    >
      <div className="page-tabs">
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'config' | 'decisions')}
          items={[
            { key: 'config', label: '决策实现' },
            { key: 'decisions', label: '决策记录' },
          ]}
        />
        {tab === 'config' ? <PlannerConfig /> : <PlannerDecisions />}
      </div>
    </Page>
  );
}

function PlannerConfig() {
  const toast = useToast();
  const config = useRemote(PlannerAdminEndpoints.getConfig);
  const models = useRemote(ModelAccessAdminEndpoints.listModels);
  const [editing, setEditing] = useState<DecisionType | null>(null);

  const entryOf = (type: string) => config.data?.items.find((i) => i.decisionType === type);

  const columns: ProColumns<NonNullable<ReturnType<typeof entryOf>>>[] = [
    {
      title: '决策类型',
      width: 160,
      render: (_, entry) => typeName(entry.decisionType),
    },
    {
      title: '当前实现',
      width: 160,
      render: (_, entry) => (
        <StatusTag tone={entry.implementation === 'rules' ? 'default' : 'processing'}>
          {IMPL_NAMES[entry.implementation] ?? entry.implementation}
        </StatusTag>
      ),
    },
    {
      title: '模型',
      width: 180,
      render: (_, entry) => entry.modelKey ?? '—',
    },
    {
      title: '置信度门槛',
      width: 110,
      render: (_, entry) =>
        entry.implementation === 'rules' ? '—' : entry.confidenceThreshold.toFixed(2),
    },
    {
      title: '评测报告',
      width: 160,
      render: (_, entry) => entry.evalReportId ?? '—',
    },
    {
      title: '最近更新',
      width: 160,
      render: (_, entry) => formatDateTime(entry.updatedAt),
    },
    {
      title: '熔断至',
      width: 160,
      render: (_, entry) =>
        entry.circuitOpenUntil ? (
          <span className="warn-text">{formatDateTime(entry.circuitOpenUntil)}</span>
        ) : (
          '—'
        ),
    },
    {
      title: '操作',
      width: 90,
      render: (_, entry) => (
        <Button
          type="link"
          size="small"
          onClick={() => setEditing(entry.decisionType as DecisionType)}
        >
          设置
        </Button>
      ),
    },
  ];

  // 有些决策类型还没配置过，表格里也要出现一行，方便直接设置。
  const rows = DECISION_TYPES.map(([type]) => {
    const entry = entryOf(type);
    return (
      entry ?? {
        decisionType: type,
        implementation: 'rules' as const,
        modelKey: null,
        confidenceThreshold: 0.55,
        evalReportId: null,
        updatedBy: null,
        updatedAt: '',
        circuitOpenUntil: null,
      }
    );
  });

  return (
    <div className="tab-body">
      <div className="tab-head">
        <div className="tab-desc">
          <strong>决策实现</strong>
          <span>纯规则最省钱；接模型会更自然，但要先有评测报告才能切换。</span>
        </div>
        <Button onClick={() => config.refresh()}>刷新</Button>
      </div>
      <DataTable
        rowKey="decisionType"
        columns={columns}
        data={rows}
        loading={config.loading}
        error={config.error}
        pagination={false}
        onRowClick={(entry) => setEditing(entry.decisionType as DecisionType)}
        emptyTitle="没有决策类型"
        emptyHint="后端还没有返回决策配置。"
      />
      {editing && (
        <PlannerDrawer
          type={editing}
          entry={entryOf(editing)}
          models={(models.data?.items ?? [])
            .filter((m) => !m.deletedAt)
            .map((m) => ({
              value: m.modelKey,
              label: `${m.displayName}（${m.modelKey}）`,
            }))}
          onClose={() => setEditing(null)}
          onSaved={(label) => {
            setEditing(null);
            toast.success(`已保存：${label}`);
            config.refresh();
          }}
        />
      )}
    </div>
  );
}

interface PlannerForm {
  implementation: 'rules' | 'rules_model' | 'jev';
  modelKey?: string;
  confidenceThreshold: number;
  evalReportId?: string;
}

function PlannerDrawer({
  type,
  entry,
  models,
  onClose,
  onSaved,
}: {
  type: DecisionType;
  entry?: {
    implementation: string;
    modelKey: string | null;
    confidenceThreshold: number;
    evalReportId: string | null;
  };
  models: Array<{ value: string; label: string }>;
  onClose: () => void;
  onSaved: (label: string) => void;
}) {
  const [form] = Form.useForm<PlannerForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const implementation = Form.useWatch('implementation', form) ?? 'rules';
  const label = typeName(type);
  const initial = (entry?.implementation ?? 'rules') as PlannerForm['implementation'];
  const switching = implementation !== initial;

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      await api.call(PlannerAdminEndpoints.updateConfig, {
        params: { decisionType: type },
        body: {
          implementation: values.implementation,
          modelKey: values.implementation === 'rules' ? null : (values.modelKey ?? '').trim(),
          confidenceThreshold: Math.round(values.confidenceThreshold * 100) / 100,
          evalReportId: values.evalReportId?.trim() || null,
        },
      });
      onSaved(label);
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      form={form}
      draftKey={`planner:${type}`}
      open
      onClose={onClose}
      title={label}
      subtitle="这个判断交给谁来做"
      width={560}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<PlannerForm>
        form={form}
        layout="vertical"
        initialValues={{
          implementation: initial,
          modelKey: entry?.modelKey ?? undefined,
          confidenceThreshold: entry?.confidenceThreshold ?? 0.55,
          evalReportId: entry?.evalReportId ?? '',
        }}
      >
        <FormSection title="实现方式" />
        <Form.Item
          name="implementation"
          extra={<FieldHelp>接模型更自然，但每次判断都会产生费用。</FieldHelp>}
        >
          <Radio.Group>
            <Radio value="rules">纯规则</Radio>
            <Radio value="rules_model">规则 + 便宜模型</Radio>
            <Radio value="jev" disabled={type === 'play_slot'}>
              Jev
            </Radio>
          </Radio.Group>
        </Form.Item>
        {implementation !== 'rules' && (
          <Form.Item
            name="modelKey"
            label="用哪个模型"
            rules={[{ required: true, message: '选择模型' }]}
            extra={<FieldHelp>从「模型管理」里已上架的模型中选择。</FieldHelp>}
          >
            <Select showSearch options={models} placeholder="选择模型" />
          </Form.Item>
        )}
        <Form.Item
          name="confidenceThreshold"
          label="置信度门槛"
          extra={
            <FieldHelp>模型给出的置信度低于这个值，就退回规则判断。范围 0.30～0.90。</FieldHelp>
          }
        >
          <InputNumber min={0.3} max={0.9} step={0.05} style={{ width: '100%' }} />
        </Form.Item>
        <Form.Item
          name="evalReportId"
          label="评测报告编号"
          rules={switching ? [{ required: true, message: '切换实现必须填写评测报告编号' }] : []}
          extra={
            <FieldHelp>
              切换实现前必须先在评测里跑过这类决策。
              {switching ? '这次是切换实现，必填。' : '只改门槛可以不填。'}
            </FieldHelp>
          }
        >
          <Input maxLength={64} placeholder="例：eval-2026-10-01-reply_form" />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

interface DecisionFilters {
  userId: string;
  characterId: string;
  decisionType?: DecisionType;
  fallback?: string;
  range?: [Dayjs, Dayjs];
}

function PlannerDecisions() {
  const [filters, setFilters] = useState<DecisionFilters>({ userId: '', characterId: '' });
  const [applied, setApplied] = useState<DecisionFilters>({ userId: '', characterId: '' });
  const [items, setItems] = useState<Decision[]>([]);
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [detail, setDetail] = useState<Decision | null>(null);
  const cursor = cursors.at(-1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .call(PlannerAdminEndpoints.listDecisions, {
        query: {
          userId: applied.userId.trim() || undefined,
          characterId: applied.characterId.trim() || undefined,
          decisionType: applied.decisionType,
          fallback: applied.fallback as never,
          from: applied.range?.[0]?.startOf('day').toISOString(),
          to: applied.range?.[1]?.endOf('day').toISOString(),
          cursor,
        },
      })
      .then((page) => {
        if (!active) return;
        setItems(page.items);
        setNextCursor(page.nextCursor);
      })
      .catch((e: unknown) => active && setError(errorText(e)))
      .finally(() => active && setLoading(false));
    return () => {
      active = false;
    };
  }, [applied, cursor]);

  const columns: ProColumns<Decision>[] = [
    { title: '时间', width: 150, render: (_, d) => formatDateTime(d.createdAt) },
    { title: '类型', width: 120, render: (_, d) => typeName(d.decisionType) },
    {
      title: '选择',
      width: 120,
      render: (_, d) => d.choice,
    },
    {
      title: '置信度',
      width: 90,
      render: (_, d) => formatPercent(d.confidence),
    },
    {
      title: '实现',
      width: 140,
      render: (_, d) => IMPL_NAMES[d.implementation] ?? d.implementation,
    },
    {
      title: '退回原因',
      width: 110,
      render: (_, d) =>
        d.fallback ? (
          <StatusTag tone="warning">{FALLBACK_NAMES[d.fallback] ?? d.fallback}</StatusTag>
        ) : (
          '—'
        ),
    },
    {
      title: '理由',
      render: (_, d) => <span className="cell-sub">{d.reason}</span>,
    },
    {
      title: '耗时',
      width: 90,
      render: (_, d) => `${d.latencyMs} ms`,
    },
  ];

  return (
    <div className="tab-body">
      <div className="filter-panel">
        <Input
          style={{ width: 160 }}
          placeholder="用户 ID"
          value={filters.userId}
          onChange={(e) => setFilters({ ...filters, userId: e.target.value })}
        />
        <Input
          style={{ width: 160 }}
          placeholder="角色 ID"
          value={filters.characterId}
          onChange={(e) => setFilters({ ...filters, characterId: e.target.value })}
        />
        <Select
          style={{ width: 150 }}
          allowClear
          placeholder="决策类型"
          value={filters.decisionType}
          onChange={(v) => setFilters({ ...filters, decisionType: v })}
          options={DECISION_TYPES.map(([value, label]) => ({ value, label }))}
        />
        <Select
          style={{ width: 130 }}
          allowClear
          placeholder="退回原因"
          value={filters.fallback}
          onChange={(v) => setFilters({ ...filters, fallback: v })}
          options={Object.entries(FALLBACK_NAMES).map(([value, label]) => ({ value, label }))}
        />
        <DatePicker.RangePicker
          value={filters.range ?? null}
          onChange={(v) =>
            setFilters({ ...filters, range: v?.[0] && v[1] ? [v[0], v[1]] : undefined })
          }
        />
        <Button
          type="primary"
          onClick={() => {
            setApplied(filters);
            setCursors([undefined]);
          }}
        >
          查询
        </Button>
        <Space />
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <DataTable<Decision>
        rowKey="decisionId"
        columns={columns}
        data={items}
        loading={loading}
        pagination={false}
        onRowClick={(d) => setDetail(d)}
        emptyTitle="没有决策记录"
        emptyHint="决策记录保留 90 天。放宽筛选条件或换一个时间段再试。"
        footer={
          <div className="cursor-pager">
            <Button
              size="small"
              disabled={cursors.length <= 1 || loading}
              onClick={() => setCursors((c) => c.slice(0, -1))}
            >
              上一页
            </Button>
            <span>第 {cursors.length} 页</span>
            <Button
              size="small"
              disabled={!nextCursor || loading}
              onClick={() => setCursors((c) => [...c, nextCursor!])}
            >
              下一页
            </Button>
          </div>
        }
      />
      {detail && (
        <RecordDrawer
          open
          onClose={() => setDetail(null)}
          title={`${typeName(detail.decisionType)} · ${detail.choice}`}
          subtitle={formatDateTime(detail.createdAt)}
          width={560}
        >
          <div className="detail-grid">
            <div>
              <span className="detail-label">置信度</span>
              <span>{formatPercent(detail.confidence)}</span>
            </div>
            <div>
              <span className="detail-label">实现</span>
              <span>{IMPL_NAMES[detail.implementation] ?? detail.implementation}</span>
            </div>
            <div>
              <span className="detail-label">退回原因</span>
              <span>
                {detail.fallback ? (FALLBACK_NAMES[detail.fallback] ?? detail.fallback) : '—'}
              </span>
            </div>
            <div>
              <span className="detail-label">耗时</span>
              <span>{detail.latencyMs} ms</span>
            </div>
            <div>
              <span className="detail-label">候选</span>
              <span>{detail.options.join(' / ') || '—'}</span>
            </div>
            <div>
              <span className="detail-label">用户 / 角色</span>
              <span className="mono">
                {detail.userId.slice(0, 12)}… / {detail.characterId?.slice(0, 8) ?? '—'}
              </span>
            </div>
          </div>
          <div className="detail-muted">理由：{detail.reason || '—'}</div>
          <div className="detail-muted">记录里不含任何消息原文。</div>
        </RecordDrawer>
      )}
    </div>
  );
}
