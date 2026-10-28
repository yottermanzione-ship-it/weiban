import { useState } from 'react';
import {
  Alert,
  AutoComplete,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Table,
  TimePicker,
} from 'antd';
import { PlusOutlined, MinusCircleOutlined } from '@ant-design/icons';
import type { z } from 'zod';
import {
  BillingAdminEndpoints,
  ModelAccessAdminEndpoints,
  PriceUnit,
  type AdminPriceVersion,
} from '@weiban/contracts';
import { yuanToMicros } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, Page, StatusTag, useDangerConfirm, useToast } from '../ui/page.js';
import { formatDateTime, formatYuan } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';
import { splitSelected } from './batch-helpers.js';

type PriceVersion = z.infer<typeof AdminPriceVersion>;
type PriceItem = PriceVersion['items'][number];

/** 价格条目没有独立 id；草稿内按数组下标定位（删除后会重置选择）。 */
const priceItemKey = (_item: PriceItem, index: number) => String(index);

const UNIT_LABELS: Record<string, string> = {
  input_tokens_per_million: '输入 / 百万 token',
  cached_input_tokens_per_million: '缓存输入 / 百万 token',
  cache_write_5m_tokens_per_million: '缓存写入 5 分钟 / 百万 token',
  cache_write_1h_tokens_per_million: '缓存写入 1 小时 / 百万 token',
  output_tokens_per_million: '输出 / 百万 token',
  image: '每张图片',
  tts_10k_chars: '每万字语音',
  asr_minute: '每分钟识别',
  realtime_minute: '每分钟通话',
  search_call: '每次搜索',
  audio_input_tokens_per_million: '音频输入 / 百万 token',
  audio_output_tokens_per_million: '音频输出 / 百万 token',
  voice_clone: '每个复刻音色',
};

interface PriceRow {
  modelKey: string;
  unit: PriceUnit;
  price: number;
  cost: number;
  bandEnabled: boolean;
  bandName?: string;
  bandStart?: string;
  bandEnd?: string;
  bandWeekdays?: number[];
}

interface VersionForm {
  versionLabel: string;
  note?: string;
  rows: PriceRow[];
}

const WEEKDAYS = [
  { value: 1, label: '一' },
  { value: 2, label: '二' },
  { value: 3, label: '三' },
  { value: 4, label: '四' },
  { value: 5, label: '五' },
  { value: 6, label: '六' },
  { value: 7, label: '日' },
];

export function PricesPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const list = useRemote(BillingAdminEndpoints.listPriceVersions);
  const catalog = useRemote(ModelAccessAdminEndpoints.listCatalog);
  const [editing, setEditing] = useState<{
    mode: 'new' | 'edit' | 'copy';
    version?: PriceVersion;
  } | null>(null);
  const [detail, setDetail] = useState<PriceVersion | null>(null);
  const [detailSelected, setDetailSelected] = useState<string[]>([]);
  const [error, setError] = useState('');

  function openDetail(version: PriceVersion) {
    setDetail(version);
    setDetailSelected([]);
  }

  function removeDetailItems() {
    if (!detail) return;
    if (detail.status !== 'draft') {
      toast.warning('已生效或已停用的价目表不可修改，请先复制调价或新建草稿版本。');
      return;
    }
    const { remaining, removed } = splitSelected(detail.items, detailSelected, priceItemKey);
    if (removed.length === 0) return;
    if (remaining.length === 0) {
      toast.warning('草稿至少要保留一条价格，不能把全部条目删光。');
      return;
    }
    const names = removed.map(
      (item) => `${item.modelKey} · ${UNIT_LABELS[item.unit] ?? item.unit}`,
    );
    confirm({
      title: `删除草稿里的 ${removed.length} 条价格？`,
      content: (
        <div className="delete-impact">
          <p className="delete-impact-head">将影响 {removed.length} 项</p>
          <ul>
            {names.slice(0, 20).map((name, index) => (
              <li key={`${name}-${index}`}>{name}</li>
            ))}
          </ul>
          {removed.length > 20 && <p className="delete-impact-foot">等共 {removed.length} 条</p>}
          <p className="delete-impact-foot">
            只改这个草稿版本，已生效 /
            已停用的价目表不受影响；删除后立即保存，草稿至少要保留一条价格。
          </p>
        </div>
      ),
      okText: `删除 ${removed.length} 条`,
      onOk: async () => {
        try {
          const updated = await api.call(BillingAdminEndpoints.updatePriceDraft, {
            params: { priceVersionId: detail.priceVersionId },
            body: {
              items: remaining.map((item) => ({
                modelKey: item.modelKey,
                unit: item.unit,
                priceMicros: item.priceMicros,
                costMicros: item.costMicros,
                band: item.band,
              })),
            },
          });
          setDetail(updated);
          setDetailSelected([]);
          toast.success(`已从草稿删除 ${removed.length} 条价格`);
          list.refresh();
        } catch (e) {
          toast.error(errorText(e));
          throw e;
        }
      },
    });
  }

  async function publish(version: PriceVersion) {
    const priced = new Set(version.items.map((p) => p.modelKey));
    const missing = (catalog.data?.items ?? []).filter((m) => m.enabled && !priced.has(m.modelKey));
    confirm({
      title: `立即启用「${version.versionLabel}」？`,
      content:
        missing.length > 0
          ? `这个版本没有给 ${missing.length} 个已上架模型定价（${missing
              .slice(0, 5)
              .map((m) => m.displayName)
              .join('、')}${missing.length > 5 ? ' 等' : ''}）。启用后这些模型会暂时不可调用。`
          : '启用后旧版本立即停用，用户从下一条消息起按新价格计费。',
      okText: '立即启用',
      onOk: async () => {
        setError('');
        try {
          await api.call(BillingAdminEndpoints.activatePriceVersion, {
            params: { priceVersionId: version.priceVersionId },
            body: { effectiveFrom: null },
          });
          toast.success('已启用');
          list.refresh();
        } catch (e) {
          setError(errorText(e));
        }
      },
    });
  }

  const columns: ProColumns<PriceVersion>[] = [
    {
      title: '版本',
      width: 200,
      render: (_, v) => (
        <div className="cell-main">
          <span className="cell-title">{v.versionLabel}</span>
          <span className="cell-sub">{formatDateTime(v.createdAt)}</span>
        </div>
      ),
    },
    {
      title: '状态',
      width: 110,
      render: (_, v) =>
        v.status === 'active' ? (
          <StatusTag tone="success">生效中</StatusTag>
        ) : v.status === 'draft' ? (
          <StatusTag tone="warning">草稿</StatusTag>
        ) : (
          <StatusTag tone="default">已停用</StatusTag>
        ),
    },
    {
      title: '生效时间',
      width: 160,
      render: (_, v) => formatDateTime(v.effectiveFrom),
    },
    {
      title: '价格条数',
      width: 120,
      render: (_, v) => (
        <Button type="link" size="small" onClick={() => openDetail(v)}>
          {v.items.length} 条 ›
        </Button>
      ),
    },
    {
      title: '备注',
      render: (_, v) => v.note ?? '—',
    },
    {
      title: '操作',
      width: 170,
      fixed: 'right',
      render: (_, v) => (
        <Space size={4}>
          {v.status === 'draft' ? (
            <>
              <Button
                type="link"
                size="small"
                onClick={() => setEditing({ mode: 'edit', version: v })}
              >
                编辑
              </Button>
              <Button type="link" size="small" onClick={() => void publish(v)}>
                立即启用
              </Button>
            </>
          ) : (
            <Button
              type="link"
              size="small"
              onClick={() => setEditing({ mode: 'copy', version: v })}
            >
              复制调价
            </Button>
          )}
        </Space>
      ),
    },
  ];

  const versions = list.data?.items ?? [];
  const hasDraft = versions.some((version) => version.status === 'draft');

  return (
    <Page
      title="AI 模型价格"
      desc="这里按「价目表版本」管理所有模型的价格。点「条数」打开条目列表：草稿版可以勾选后批量删除条目；已生效 / 已停用的版本只读。日常单个调价建议在「模型管理 › 模型」里改，系统会自动生成新版本。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing({ mode: 'new' })}>
          新建价格版本
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      {list.data && !hasDraft && (
        <Alert
          type="info"
          showIcon
          message="当前没有草稿版本"
          description="已生效、已停用的价目表都不可修改。要批量删除价格条目，请先点某个版本的「复制调价」或右上角「新建价格版本」生成草稿。"
          style={{ marginBottom: 12 }}
        />
      )}
      <DataTable<PriceVersion>
        rowKey="priceVersionId"
        columns={columns}
        data={versions}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        onRowClick={openDetail}
        emptyTitle="还没有价目表"
        emptyHint="点右上角「新建价格版本」，给每个模型填上每百万 token 的售价和成本价，然后启用。"
        emptyAction={
          <Button type="primary" onClick={() => setEditing({ mode: 'new' })}>
            新建第一个版本
          </Button>
        }
      />
      {editing && (
        <VersionDrawer
          version={editing.version ?? null}
          mode={editing.mode}
          catalog={(catalog.data?.items ?? [])
            .filter((m) => !m.deletedAt)
            .map((m) => ({
              modelKey: m.modelKey,
              displayName: m.displayName,
            }))}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            toast.success(text);
            setEditing(null);
            list.refresh();
          }}
        />
      )}
      {detail && (
        <RecordDrawer
          open
          onClose={() => setDetail(null)}
          title={detail.versionLabel}
          subtitle={`${detail.status === 'draft' ? '草稿' : detail.status === 'active' ? '生效中' : '已停用'} · ${formatDateTime(detail.createdAt)}`}
          width={720}
        >
          {detail.status === 'draft' ? (
            <>
              <Alert
                type="info"
                showIcon
                message="这是草稿，可批量删除价格条目"
                description="勾选后点「批量删除所选条目」，删除会立即保存到这个草稿；草稿至少要保留一条价格。表头复选框只全选当前草稿的全部条目。"
                style={{ marginBottom: 12 }}
              />
              <Table<PriceItem>
                size="small"
                rowKey={(_, index) => String(index ?? 0)}
                dataSource={detail.items}
                pagination={false}
                columns={[
                  { title: '模型', dataIndex: 'modelKey' },
                  {
                    title: '单位',
                    render: (_, item) => UNIT_LABELS[item.unit] ?? item.unit,
                  },
                  {
                    title: '售价',
                    width: 110,
                    render: (_, item) => formatYuan(item.priceMicros, 4),
                  },
                  {
                    title: '成本',
                    width: 110,
                    render: (_, item) => formatYuan(item.costMicros, 4),
                  },
                  {
                    title: '分时价',
                    width: 100,
                    render: (_, item) => item.band?.name ?? '—',
                  },
                ]}
                rowSelection={{
                  selectedRowKeys: detailSelected,
                  onChange: (keys) => setDetailSelected(keys.map(String)),
                  preserveSelectedRowKeys: false,
                }}
                locale={{ emptyText: '这个草稿没有价格条目。' }}
              />
              <div className="drawer-row-head" style={{ marginTop: 12 }}>
                <span className="cell-sub">已选 {detailSelected.length} 条</span>
                <Space>
                  <Button
                    size="small"
                    type="link"
                    disabled={!detailSelected.length}
                    onClick={() => setDetailSelected([])}
                  >
                    清空选择
                  </Button>
                  <Button
                    size="small"
                    danger
                    disabled={!detailSelected.length}
                    onClick={removeDetailItems}
                  >
                    批量删除所选条目
                  </Button>
                </Space>
              </div>
            </>
          ) : (
            <>
              <Alert
                type="warning"
                showIcon
                message={
                  detail.status === 'active' ? '已生效的价目表不可修改' : '已停用的价目表不可修改'
                }
                description="价格条目只能从草稿里删除。请点该版本的「复制调价」生成新草稿，或新建价格版本。"
                style={{ marginBottom: 12 }}
              />
              <div className="price-list">
                {detail.items.map((item, index) => (
                  <div className="price-row" key={`${item.modelKey}-${index}`}>
                    <div className="cell-main">
                      <span className="cell-title">{item.modelKey}</span>
                      <span className="cell-sub">{UNIT_LABELS[item.unit] ?? item.unit}</span>
                    </div>
                    <div className="price-values">
                      <span>售价 {formatYuan(item.priceMicros, 4)}</span>
                      <span className="cell-sub">成本 {formatYuan(item.costMicros, 4)}</span>
                      {item.band && <span className="cell-sub">分时价：{item.band.name}</span>}
                    </div>
                  </div>
                ))}
                {detail.items.length === 0 && (
                  <div className="detail-muted">这个版本没有价格条目。</div>
                )}
              </div>
            </>
          )}
        </RecordDrawer>
      )}
    </Page>
  );
}

function VersionDrawer({
  version,
  mode,
  catalog,
  onClose,
  onSaved,
}: {
  version: PriceVersion | null;
  mode: 'new' | 'edit' | 'copy';
  catalog: Array<{ modelKey: string; displayName: string }>;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [form] = Form.useForm<VersionForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const isDraft = mode === 'edit' && version?.status === 'draft';

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    try {
      const items = values.rows.map((row) => ({
        modelKey: row.modelKey,
        unit: row.unit,
        priceMicros: yuanToMicros(String(row.price ?? 0)),
        costMicros: yuanToMicros(String(row.cost ?? 0)),
        band:
          row.bandEnabled && row.bandStart && row.bandEnd
            ? {
                name: row.bandName?.trim() || '分时段',
                weekdays: row.bandWeekdays?.length ? row.bandWeekdays : [1, 2, 3, 4, 5, 6, 7],
                start: row.bandStart,
                end: row.bandEnd,
              }
            : null,
      }));
      if (isDraft && version) {
        await api.call(BillingAdminEndpoints.updatePriceDraft, {
          params: { priceVersionId: version.priceVersionId },
          body: { note: values.note || null, items },
        });
        onSaved('已保存');
      } else {
        await api.call(BillingAdminEndpoints.createPriceVersion, {
          body: { versionLabel: values.versionLabel, note: values.note || null, items },
        });
        onSaved('已创建草稿，确认无误后点「立即启用」');
      }
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  const initialRows: PriceRow[] = version?.items.map((item) => ({
    modelKey: item.modelKey,
    unit: item.unit,
    price: item.priceMicros / 1_000_000,
    cost: item.costMicros / 1_000_000,
    bandEnabled: !!item.band,
    bandName: item.band?.name,
    bandStart: item.band?.start,
    bandEnd: item.band?.end,
    bandWeekdays: item.band?.weekdays,
  })) ?? [
    {
      modelKey: '',
      unit: 'input_tokens_per_million' as PriceUnit,
      price: 0,
      cost: 0,
      bandEnabled: false,
    },
  ];

  return (
    <RecordDrawer
      form={form}
      draftKey={`price-version:${mode}:${version?.priceVersionId ?? 'new'}`}
      open
      onClose={onClose}
      title={
        mode === 'edit' && version
          ? `编辑价格草稿 · ${version.versionLabel}`
          : mode === 'copy' && version
            ? `复制调价 · 基于「${version.versionLabel}」`
            : '新建价格版本'
      }
      subtitle="价格单位是元；1 元 = 100 积分"
      width={860}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form<VersionForm>
        form={form}
        layout="vertical"
        initialValues={{
          versionLabel: mode === 'copy' ? '' : (version?.versionLabel ?? ''),
          note: version?.note ?? '',
          rows: initialRows,
        }}
      >
        <FormSection title="版本信息" />
        <div className="form-two">
          <Form.Item
            name="versionLabel"
            label="版本名称"
            rules={[{ required: true, message: '给这个版本起个名字' }]}
            extra={<FieldHelp>例：2026-10 调价。保存后不能改。</FieldHelp>}
          >
            <Input maxLength={32} disabled={mode === 'edit'} placeholder="例：2026-10 调价" />
          </Form.Item>
          <Form.Item name="note" label="备注" extra={<FieldHelp>给自己看的说明。</FieldHelp>}>
            <Input maxLength={200} placeholder="例：DeepSeek 官方降价" />
          </Form.Item>
        </div>

        <FormSection title="价格条目" desc="每行一个模型的一种计价单位" />
        <Form.List name="rows">
          {(fields, { add, remove }) => (
            <div className="price-rows">
              {fields.map((field) => (
                <div className="price-edit-row" key={field.key}>
                  <Form.Item
                    name={[field.name, 'modelKey']}
                    rules={[{ required: true, message: '填写模型键' }]}
                    style={{ marginBottom: 6 }}
                  >
                    <AutoComplete
                      options={catalog.map((m) => ({
                        value: m.modelKey,
                        label: `${m.displayName}（${m.modelKey}）`,
                      }))}
                      filterOption={(input, option) => String(option?.value ?? '').includes(input)}
                      placeholder="模型键"
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'unit']} style={{ marginBottom: 6 }}>
                    <Select
                      options={PriceUnit.options.map((u) => ({
                        value: u,
                        label: UNIT_LABELS[u] ?? u,
                      }))}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'price']} style={{ marginBottom: 6 }}>
                    <InputNumber
                      min={0}
                      step={0.01}
                      addonBefore="售价"
                      addonAfter="元"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Form.Item name={[field.name, 'cost']} style={{ marginBottom: 6 }}>
                    <InputNumber
                      min={0}
                      step={0.01}
                      addonBefore="成本"
                      addonAfter="元"
                      style={{ width: '100%' }}
                    />
                  </Form.Item>
                  <Form.Item
                    name={[field.name, 'bandEnabled']}
                    valuePropName="checked"
                    style={{ marginBottom: 6 }}
                  >
                    <Checkbox>分时价</Checkbox>
                  </Form.Item>
                  <Button
                    type="text"
                    danger
                    icon={<MinusCircleOutlined />}
                    onClick={() => remove(field.name)}
                  />
                  <Form.Item
                    noStyle
                    shouldUpdate={(prev, next) =>
                      prev.rows?.[field.name]?.bandEnabled !== next.rows?.[field.name]?.bandEnabled
                    }
                  >
                    {({ getFieldValue }) =>
                      getFieldValue(['rows', field.name, 'bandEnabled']) ? (
                        <div className="band-row">
                          <Form.Item name={[field.name, 'bandName']} style={{ marginBottom: 6 }}>
                            <Input placeholder="时段名称，例：夜间半价" />
                          </Form.Item>
                          <Form.Item name={[field.name, 'bandStart']} style={{ marginBottom: 6 }}>
                            <TimePicker format="HH:mm" minuteStep={5} placeholder="开始" />
                          </Form.Item>
                          <Form.Item name={[field.name, 'bandEnd']} style={{ marginBottom: 6 }}>
                            <TimePicker format="HH:mm" minuteStep={5} placeholder="结束" />
                          </Form.Item>
                          <Form.Item
                            name={[field.name, 'bandWeekdays']}
                            style={{ marginBottom: 6 }}
                          >
                            <Checkbox.Group options={WEEKDAYS} />
                          </Form.Item>
                        </div>
                      ) : null
                    }
                  </Form.Item>
                </div>
              ))}
              <Button
                type="dashed"
                block
                onClick={() =>
                  add({
                    modelKey: '',
                    unit: 'input_tokens_per_million',
                    price: 0,
                    cost: 0,
                    bandEnabled: false,
                  })
                }
              >
                添加一行
              </Button>
            </div>
          )}
        </Form.List>
      </Form>
    </RecordDrawer>
  );
}
