/**
 * 角色生态（v5 批 C）：决策模型、四档每天唤醒次数、平台关掉的动作、唤醒时段；最近 24 小时概况与运行记录。
 * 决策模型未配置时生态不运行（不会改用用户的聊天模型）。运行记录不含碎碎念和消息原文。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Form, Input, InputNumber, Select, Space, Statistic, Tabs } from 'antd';
import {
  ECOLOGY_ACTION_KEYS,
  EcologyAdminEndpoints,
  ModelAccessAdminEndpoints,
  type EcologyConfig,
  type EcologyRunRecord,
  type EcologyRunStatus,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { FieldHelp, FormSection, Page, SectionCard, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';

const LEVELS = [
  ['occasional', '偶尔冒泡'],
  ['often', '时常出现'],
  ['close', '常伴左右'],
  ['inseparable', '形影不离'],
] as const;

const ACTION_NAMES: Record<string, string> = {
  message: '主动发消息',
  greeting: '早安 / 晚安',
  voice: '发语音消息',
  photo: '发照片',
  sticker: '发表情包',
  nudge: '拍一拍',
  share_link: '分享链接',
  moment_post: '发朋友圈',
  moment_interact: '点赞评论用户朋友圈',
  moment_reply: '回复朋友圈评论',
  moment_peer: '其他角色朋友圈互动',
  status: '更新状态',
  signature: '改个性签名',
  care_period: '经期关心',
  care_weather: '天气提醒',
  care_anniversary: '日子提醒',
  care_absence: '久未联系问候',
  care_late_night: '熬夜催睡',
  care_follow_up: '跟进说过的事',
  play_letter: '慢信',
  play_wish: '心愿',
  play_focus: '专注邀请',
  play_daily_question: '每日一问',
  play_pet: '宠物',
  play_reminder: '记约定',
  group_talk: '群里说话',
};

const STATUS_NAMES: Record<
  string,
  [string, 'success' | 'warning' | 'error' | 'default' | 'processing']
> = {
  done: ['已执行', 'success'],
  idle: ['没动', 'default'],
  skipped: ['跳过', 'default'],
  failed: ['失败', 'error'],
  paused: ['积分不足暂停', 'warning'],
  running: ['执行中', 'processing'],
  scheduled: ['待执行', 'processing'],
};

export function EcologyAdminPage() {
  const [tab, setTab] = useState<'config' | 'runs'>('config');
  return (
    <Page
      title="角色生态"
      desc="角色定时「想一想」：看近况，自己挑一个动作或不动。用户须是 PRO+ 并打开生态，每次唤醒和动作按积分扣费。"
    >
      <div className="page-tabs">
        <Tabs
          activeKey={tab}
          onChange={(key) => setTab(key as 'config' | 'runs')}
          items={[
            { key: 'config', label: '参数' },
            { key: 'runs', label: '运行记录' },
          ]}
        />
        {tab === 'config' ? <EcologyConfigTab /> : <EcologyRunsTab />}
      </div>
    </Page>
  );
}

function EcologyConfigTab() {
  const toast = useToast();
  const overview = useRemote(EcologyAdminEndpoints.getOverview);
  const models = useRemote(ModelAccessAdminEndpoints.listModels);
  const [form] = Form.useForm<EcologyConfig>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const data = overview.data;

  useEffect(() => {
    if (data) form.setFieldsValue(data.config);
  }, [data, form]);

  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    setError('');
    try {
      await api.call(EcologyAdminEndpoints.updateConfig, {
        body: { ...values, decisionModelKey: values.decisionModelKey || null },
      });
      toast.success('已保存生态参数');
      overview.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="tab-body">
      {overview.error && <Alert type="error" showIcon message={overview.error} />}
      {data?.warnings.map((w) => (
        <Alert key={w} type="warning" showIcon message={w} />
      ))}
      {data && (
        <SectionCard title="最近 24 小时">
          <Space size={48} wrap>
            <Statistic title="开着生态的用户" value={data.last24h.enabledUsers} />
            <Statistic title="唤醒次数" value={data.last24h.runs} />
            <Statistic title="执行了动作" value={data.last24h.actions} />
            <Statistic title="花费积分" value={data.last24h.points} precision={1} />
            <Statistic
              title="决策模型"
              value={data.decisionModelReady ? '可用' : '不可用'}
              valueStyle={{ color: data.decisionModelReady ? undefined : '#cf1322' }}
            />
          </Space>
        </SectionCard>
      )}
      <SectionCard
        title="参数"
        extra={
          <Button type="primary" loading={saving} onClick={() => void save()} disabled={!data}>
            保存
          </Button>
        }
      >
        {error && <Alert type="error" showIcon message={error} />}
        <Form<EcologyConfig> form={form} layout="vertical" style={{ maxWidth: 720 }}>
          <FormSection
            title="决策模型"
            desc="角色「想一想」用哪个模型；建议选便宜、会输出 JSON 的模型。"
          />
          <Form.Item
            name="decisionModelKey"
            extra={
              <FieldHelp>不配置 = 生态不运行，不会改用用户的聊天模型。按用户积分计费。</FieldHelp>
            }
          >
            <Select
              allowClear
              showSearch
              placeholder="选择决策模型"
              options={(models.data?.items ?? []).map((m) => ({
                value: m.modelKey,
                label: `${m.displayName}（${m.modelKey}）`,
              }))}
            />
          </Form.Item>
          <FormSection
            title="活跃程度"
            desc="每个角色每天「醒来想一想」的次数范围（用户选档位）。"
          />
          {LEVELS.map(([key, label]) => (
            <Space key={key} align="baseline" style={{ display: 'flex' }}>
              <span style={{ width: 80, display: 'inline-block' }}>{label}</span>
              <Form.Item name={['levels', key, 'min']} rules={[{ required: true }]} label="最少">
                <InputNumber min={0} max={48} />
              </Form.Item>
              <Form.Item name={['levels', key, 'max']} rules={[{ required: true }]} label="最多">
                <InputNumber min={0} max={48} />
              </Form.Item>
              <span>次 / 天</span>
            </Space>
          ))}
          <FormSection
            title="唤醒时段"
            desc="唤醒时刻分布在用户当地的这个时段里；角色仍会按时间和人设自己判断要不要打扰。"
          />
          <Space align="baseline">
            <Form.Item name={['wakeWindow', 'startHour']} label="从" rules={[{ required: true }]}>
              <InputNumber min={0} max={23} addonAfter="点" />
            </Form.Item>
            <Form.Item name={['wakeWindow', 'endHour']} label="到" rules={[{ required: true }]}>
              <InputNumber min={1} max={24} addonAfter="点" />
            </Form.Item>
          </Space>
          <FormSection
            title="平台关掉的动作"
            desc="选中的动作所有用户都不执行，用户端显示「平台暂未开放」。"
          />
          <Form.Item name="disabledActions">
            <Select
              mode="multiple"
              allowClear
              placeholder="不关任何动作"
              options={ECOLOGY_ACTION_KEYS.map((k) => ({ value: k, label: ACTION_NAMES[k] ?? k }))}
            />
          </Form.Item>
          <Form.Item
            name="decisionMaxOutputTokens"
            label="决策最大输出 token"
            rules={[{ required: true }]}
            extra={<FieldHelp>一次决策含动作说明和碎碎念，300～600 足够。</FieldHelp>}
          >
            <InputNumber min={100} max={2000} />
          </Form.Item>
        </Form>
      </SectionCard>
    </div>
  );
}

function EcologyRunsTab() {
  const [userId, setUserId] = useState('');
  const [status, setStatus] = useState<EcologyRunStatus | undefined>();
  const [applied, setApplied] = useState<{ userId: string; status?: EcologyRunStatus }>({
    userId: '',
  });
  const [cursors, setCursors] = useState<Array<string | undefined>>([undefined]);
  const [items, setItems] = useState<EcologyRunRecord[]>([]);
  const [nextCursor, setNextCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const cursor = cursors.at(-1);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setError('');
    void api
      .call(EcologyAdminEndpoints.listRuns, {
        query: {
          userId: applied.userId.trim() || undefined,
          status: applied.status,
          cursor,
          limit: 50,
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

  const columns: ProColumns<EcologyRunRecord>[] = [
    { title: '时间', width: 150, render: (_, r) => formatDateTime(r.scheduledAt) },
    {
      title: '用户',
      width: 120,
      render: (_, r) => <span className="cell-sub">{r.userId.slice(0, 8)}</span>,
    },
    {
      title: '角色',
      width: 120,
      render: (_, r) => <span className="cell-sub">{r.characterId.slice(0, 8)}</span>,
    },
    {
      title: '来源',
      width: 90,
      render: (_, r) => (r.origin === 'user_request' ? '用户要求' : '生态唤醒'),
    },
    {
      title: '状态',
      width: 120,
      render: (_, r) => {
        const [label, tone] = STATUS_NAMES[r.status] ?? [r.status, 'default'];
        return <StatusTag tone={tone}>{label}</StatusTag>;
      },
    },
    {
      title: '动作',
      width: 140,
      render: (_, r) => (r.actionKey ? (ACTION_NAMES[r.actionKey] ?? r.actionKey) : '—'),
    },
    { title: '结果', render: (_, r) => <span className="cell-sub">{r.outcome ?? '—'}</span> },
    { title: '积分', width: 80, render: (_, r) => r.points.toFixed(2) },
    { title: '模型', width: 160, render: (_, r) => r.modelKey ?? '—' },
    { title: '耗时', width: 90, render: (_, r) => `${r.latencyMs} ms` },
  ];

  return (
    <div className="tab-body">
      <div className="filter-panel">
        <Input
          style={{ width: 280 }}
          placeholder="用户 ID（完整）"
          value={userId}
          onChange={(e) => setUserId(e.target.value)}
        />
        <Select
          style={{ width: 150 }}
          allowClear
          placeholder="状态"
          value={status}
          onChange={(v) => setStatus(v)}
          options={Object.entries(STATUS_NAMES).map(([value, [label]]) => ({ value, label }))}
        />
        <Button
          type="primary"
          onClick={() => {
            setApplied({ userId, status });
            setCursors([undefined]);
          }}
        >
          查询
        </Button>
      </div>
      {error && <Alert type="error" showIcon message={error} />}
      <DataTable<EcologyRunRecord>
        rowKey="runId"
        columns={columns}
        data={items}
        loading={loading}
        pagination={false}
        emptyTitle="没有运行记录"
        emptyHint="用户打开生态、平台配置了决策模型后，这里会出现每次唤醒的记录（保留 90 天）。"
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
    </div>
  );
}
