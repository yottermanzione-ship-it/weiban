/**
 * 节日清单：角色会在节日当天主动问候（可选发节日卡）。
 * 日期规则只有三种：每年公历、每年农历、只此一次。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, DatePicker, Form, Input, Select, Switch, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import { HolidayAdminEndpoints, type HolidayDateType, type HolidayEvent } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, Page, useDangerConfirm, useToast } from '../ui/page.js';

const DATE_TYPE_LABELS: Record<HolidayDateType, string> = {
  annual: '每年（公历）',
  lunar_annual: '每年（农历）',
  once: '只此一次',
};

const CATEGORY_LABELS: Record<string, string> = {
  traditional: '传统节日',
  common: '普通节日',
};

const CATEGORY_OPTIONS = [
  { value: 'celebrity', label: '公众人物' },
  { value: 'historical', label: '历史人物' },
  { value: 'private_person', label: '身边真人' },
  { value: 'fictional', label: '虚构' },
  { value: 'original', label: '原创' },
];

function bjToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}

function dateText(item: HolidayEvent): string {
  if (item.dateType === 'annual') return `每年 ${item.dateValue}`;
  if (item.dateType === 'lunar_annual') return `每年农历 ${item.dateValue}`;
  return item.dateValue;
}

interface Draft {
  name: string;
  dateType: HolidayDateType;
  dateValue: string;
  romantic: boolean;
  sendCard: boolean;
  category: 'traditional' | 'common';
  characterCategories: string[];
  enabled: boolean;
}

export function HolidaysPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const [romantic, setRomantic] = useState<'' | 'yes' | 'no'>('');
  const [enabled, setEnabled] = useState<'' | 'true' | 'false'>('');
  const [items, setItems] = useState<HolidayEvent[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ item: HolidayEvent | null; draft: Draft } | null>(null);
  const [saving, setSaving] = useState(false);

  async function load() {
    setLoading(true);
    setError('');
    try {
      const result = await api.call(HolidayAdminEndpoints.list, {
        query: {
          enabled: (enabled || undefined) as 'true' | undefined,
          limit: 200,
        },
      });
      setItems(result.items);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [enabled]);

  const rows = items
    .filter((h) => (romantic === '' ? true : romantic === 'yes' ? h.romantic : !h.romantic))
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-CN'));

  async function toggle(item: HolidayEvent, value: boolean) {
    setItems((prev) =>
      prev.map((h) => (h.holidayId === item.holidayId ? { ...h, enabled: value } : h)),
    );
    try {
      await api.call(HolidayAdminEndpoints.update, {
        params: { holidayId: item.holidayId },
        body: { enabled: value },
      });
      toast.success(value ? '已启用' : '已停用');
    } catch (e) {
      setItems((prev) =>
        prev.map((h) => (h.holidayId === item.holidayId ? { ...h, enabled: !value } : h)),
      );
      toast.error(errorText(e));
    }
  }

  async function save(mode: 'save' | 'delete') {
    if (!editing) return;
    const { item, draft } = editing;
    setSaving(true);
    setError('');
    try {
      const body = {
        name: draft.name,
        dateType: draft.dateType,
        dateValue: draft.dateValue,
        romantic: draft.romantic,
        sendCard: draft.sendCard,
        category: draft.category,
        characterCategories: draft.characterCategories as never,
      };
      if (mode === 'delete' && item)
        await api.call(HolidayAdminEndpoints.remove, { params: { holidayId: item.holidayId } });
      else if (item)
        await api.call(HolidayAdminEndpoints.update, {
          params: { holidayId: item.holidayId },
          body: { ...body, enabled: draft.enabled },
        });
      else await api.call(HolidayAdminEndpoints.create, { body });
      toast.success(mode === 'delete' ? '已删除' : '已保存');
      setEditing(null);
      await load();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  const columns: ProColumns<HolidayEvent>[] = [
    {
      title: '节日',
      width: 220,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.name}</span>
          <span className="cell-sub">
            {CATEGORY_LABELS[row.category] ?? row.category}
            {row.romantic ? ' · 恋爱含义' : ''}
          </span>
        </div>
      ),
    },
    { title: '日期', width: 180, render: (_, row) => dateText(row) },
    {
      title: '最近日期',
      width: 200,
      render: (_, row) => (row.upcomingDates.length > 0 ? row.upcomingDates.join('、') : '—'),
    },
    {
      title: '节日卡',
      width: 100,
      render: (_, row) =>
        row.sendCard ? (
          <Tag color="green" bordered={false}>
            发送
          </Tag>
        ) : (
          <span className="cell-sub">不发送</span>
        ),
    },
    {
      title: '启用',
      width: 90,
      render: (_, row) => (
        <Switch size="small" checked={row.enabled} onChange={(value) => void toggle(row, value)} />
      ),
    },
    {
      title: '操作',
      width: 90,
      fixed: 'right',
      render: (_, row) => (
        <Button
          type="link"
          size="small"
          onClick={() => setEditing({ item: row, draft: draftOf(row) })}
        >
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Page
      title="节日清单"
      desc="角色在节日当天会主动问候；带恋爱含义的节日只在恋爱关系或恋爱情景下用恋爱口吻。"
      extra={
        <Button
          type="primary"
          icon={<PlusOutlined />}
          onClick={() =>
            setEditing({
              item: null,
              draft: {
                name: '',
                dateType: 'annual',
                dateValue: '',
                romantic: false,
                sendCard: true,
                category: 'common',
                characterCategories: [],
                enabled: true,
              },
            })
          }
        >
          添加节日
        </Button>
      }
    >
      <DataTable<HolidayEvent>
        rowKey="holidayId"
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        filters={
          <>
            <Select
              style={{ width: 140 }}
              value={romantic}
              onChange={setRomantic}
              options={[
                { value: '', label: '全部节日' },
                { value: 'yes', label: '恋爱含义' },
                { value: 'no', label: '普通' },
              ]}
            />
            <Select
              style={{ width: 130 }}
              value={enabled}
              onChange={setEnabled}
              options={[
                { value: '', label: '全部状态' },
                { value: 'true', label: '已启用' },
                { value: 'false', label: '已停用' },
              ]}
            />
          </>
        }
        emptyTitle="还没有节日"
        emptyHint="点右上角「添加节日」，填名字和日期；每年重复的节日只填月-日。"
      />
      {editing && (
        <HolidayDrawer
          item={editing.item}
          draft={editing.draft}
          saving={saving}
          error={error}
          onClose={() => setEditing(null)}
          onSave={(next) => setEditing({ ...editing, draft: next })}
          onSubmit={() => void save('save')}
          onDelete={
            editing.item
              ? () =>
                  confirm({
                    title: `删除「${editing.item!.name}」？`,
                    content: '删除后角色不会在这个节日问候；已经发过的内容不受影响。',
                    okText: '删除',
                    onOk: () => save('delete'),
                  })
              : undefined
          }
        />
      )}
    </Page>
  );
}

function draftOf(item: HolidayEvent): Draft {
  return {
    name: item.name,
    dateType: item.dateType,
    dateValue: item.dateValue,
    romantic: item.romantic,
    sendCard: item.sendCard,
    category: item.category as 'traditional' | 'common',
    characterCategories: item.characterCategories,
    enabled: item.enabled,
  };
}

function HolidayDrawer({
  item,
  draft,
  saving,
  error,
  onClose,
  onSave,
  onSubmit,
  onDelete,
}: {
  item: HolidayEvent | null;
  draft: Draft;
  saving: boolean;
  error: string;
  onClose: () => void;
  onSave: (draft: Draft) => void;
  onSubmit: () => void;
  onDelete?: () => void;
}) {
  const [values, setValues] = useState<Draft>(draft);
  const patch = (value: Partial<Draft>) => {
    const next = { ...values, ...value };
    setValues(next);
    onSave(next);
  };

  return (
    <RecordDrawer
      open
      onClose={onClose}
      draft={{
        key: `holiday:${item?.holidayId ?? 'new'}`,
        value: values,
        restore: (v: Draft) => {
          setValues(v);
          onSave(v);
        },
      }}
      title={item ? `编辑节日 · ${item.name}` : '添加节日'}
      width={600}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={onSubmit}
          saving={saving}
          extra={
            onDelete ? (
              <Button danger onClick={onDelete}>
                删除
              </Button>
            ) : undefined
          }
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form layout="vertical">
        <FormSection title="节日信息" />
        <Form.Item
          label="名称"
          required
          extra={<FieldHelp>例：春节、情人节、角色生日。</FieldHelp>}
        >
          <Input
            maxLength={100}
            value={values.name}
            onChange={(e) => patch({ name: e.target.value })}
          />
        </Form.Item>
        <div className="form-two">
          <Form.Item label="日期规则">
            <Select
              value={values.dateType}
              onChange={(value) => patch({ dateType: value, dateValue: '' })}
              options={Object.entries(DATE_TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item
            label="日期"
            required
            extra={
              <FieldHelp>
                {values.dateType === 'once'
                  ? '完整日期，例 2026-12-25。'
                  : '只填月-日，例 02-14；农历也按 月-日 填。'}
              </FieldHelp>
            }
          >
            {values.dateType === 'once' ? (
              <DatePicker
                style={{ width: '100%' }}
                value={values.dateValue ? dayjs(values.dateValue) : null}
                onChange={(value) => patch({ dateValue: value ? value.format('YYYY-MM-DD') : '' })}
              />
            ) : (
              <Input
                placeholder="MM-DD"
                maxLength={5}
                value={values.dateValue}
                onChange={(e) => patch({ dateValue: e.target.value })}
              />
            )}
          </Form.Item>
        </div>
        <Form.Item label="节日类型">
          <Select
            value={values.category}
            onChange={(value) => patch({ category: value })}
            options={Object.entries(CATEGORY_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item label="适用角色" extra={<FieldHelp>不选 = 所有角色都过这个节。</FieldHelp>}>
          <Checkbox.Group
            options={CATEGORY_OPTIONS}
            value={values.characterCategories}
            onChange={(checked) => patch({ characterCategories: checked as string[] })}
          />
        </Form.Item>
        <FormSection title="行为" />
        <Form.Item
          label="恋爱含义"
          extra={<FieldHelp>开启后，只在恋爱关系或恋爱情景模式里用恋爱口吻。</FieldHelp>}
        >
          <Switch checked={values.romantic} onChange={(checked) => patch({ romantic: checked })} />
        </Form.Item>
        <Form.Item
          label="发节日卡"
          extra={<FieldHelp>节日当天和角色聊天时，是否送一张节日卡。</FieldHelp>}
        >
          <Switch checked={values.sendCard} onChange={(checked) => patch({ sendCard: checked })} />
        </Form.Item>
        <Form.Item label="启用">
          <Switch checked={values.enabled} onChange={(checked) => patch({ enabled: checked })} />
        </Form.Item>
        <div className="detail-muted">今天是 {bjToday()}（北京时间）。</div>
      </Form>
    </RecordDrawer>
  );
}
