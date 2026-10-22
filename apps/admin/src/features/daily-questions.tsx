/**
 * 每日一问题库：每天给角色和用户一个聊天话题。标签决定分给哪些角色。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Select, Space, Switch } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import type { z } from 'zod';
import { AdminDailyQuestion, DailyQuestionAdminEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import { FieldHelp, FormSection, Page, StatusTag, useToast } from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';
import { useFormFeedback } from '../data/form-feedback.js';

type Question = z.infer<typeof AdminDailyQuestion>;

const TAGS = [
  ['romance', '恋爱'],
  ['child_safe', '适合儿童'],
  ['work', '涉及工作'],
  ['family', '家庭'],
  ['childhood', '童年'],
  ['light', '轻松'],
] as const;

const tagName = (tag: string) => TAGS.find(([key]) => key === tag)?.[1] ?? tag;

export function DailyQuestionsPage() {
  const toast = useToast();
  const [tag, setTag] = useState('');
  const [keyword, setKeyword] = useState('');
  const [statusFilter, setStatusFilter] = useState('');
  const [items, setItems] = useState<Question[]>([]);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<Question | 'new' | null>(null);

  async function load(after?: string) {
    setLoading(true);
    setError('');
    try {
      const page = await api.call(DailyQuestionAdminEndpoints.list, {
        query: { tag: (tag || undefined) as never, cursor: after },
      });
      setItems((prev) => (after ? [...prev, ...page.items] : page.items));
      setCursor(page.nextCursor);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }

  useEffect(() => {
    void load();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [tag]);

  const rows = items.filter(
    (q) =>
      (!keyword.trim() || q.text.includes(keyword.trim())) &&
      (!statusFilter || (statusFilter === 'listed') === q.listed),
  );

  async function toggle(question: Question) {
    try {
      const updated = await api.call(DailyQuestionAdminEndpoints.update, {
        params: { questionId: question.questionId },
        body: { listed: !question.listed },
      });
      setItems((prev) => prev.map((x) => (x.questionId === updated.questionId ? updated : x)));
      toast.success(updated.listed ? '已上架' : '已下架');
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  const columns: ProColumns<Question>[] = [
    {
      title: '题目',
      render: (_, row) => <span className="cell-title">{row.text}</span>,
    },
    {
      title: '标签',
      width: 220,
      render: (_, row) => (
        <Space size={4} wrap>
          {row.tags.map((t: string) => (
            <StatusTag key={t}>{tagName(t)}</StatusTag>
          ))}
        </Space>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) =>
        row.listed ? <StatusTag tone="success">已上架</StatusTag> : <StatusTag>已下架</StatusTag>,
    },
    {
      title: '更新时间',
      width: 150,
      render: (_, row) => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      width: 120,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditing(row)}>
            编辑
          </Button>
          <Button type="link" size="small" onClick={() => void toggle(row)}>
            {row.listed ? '下架' : '上架'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="每日一问题库"
      desc="每天给角色和用户一个聊天话题。标签决定这道题会分给哪些角色。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          新建题目
        </Button>
      }
    >
      <DataTable<Question>
        rowKey="questionId"
        columns={columns}
        data={rows}
        loading={loading}
        error={error}
        onRefresh={() => void load()}
        onRowClick={(row) => setEditing(row)}
        filters={
          <>
            <Input.Search
              allowClear
              placeholder="搜题目关键词"
              style={{ width: 220 }}
              value={keyword}
              onChange={(e) => setKeyword(e.target.value)}
            />
            <Select
              allowClear
              style={{ width: 140 }}
              placeholder="全部标签"
              value={tag || undefined}
              onChange={(value) => setTag(value ?? '')}
              options={TAGS.map(([value, label]) => ({ value, label }))}
            />
            <Select
              style={{ width: 130 }}
              value={statusFilter}
              onChange={setStatusFilter}
              options={[
                { value: '', label: '全部状态' },
                { value: 'listed', label: '已上架' },
                { value: 'unlisted', label: '已下架' },
              ]}
            />
          </>
        }
        emptyTitle="还没有题目"
        emptyHint="点右上角「新建题目」，写一句能聊起来的问题，再选适合的标签。"
        footer={
          cursor ? (
            <Button size="small" loading={loading} onClick={() => void load(cursor)}>
              加载更多
            </Button>
          ) : undefined
        }
      />
      {editing && (
        <QuestionDrawer
          question={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(saved) => {
            toast.success('已保存');
            setEditing(null);
            setItems((prev) =>
              prev.some((x) => x.questionId === saved.questionId)
                ? prev.map((x) => (x.questionId === saved.questionId ? saved : x))
                : [saved, ...prev],
            );
          }}
        />
      )}
    </Page>
  );
}

function QuestionDrawer({
  question,
  onClose,
  onSaved,
}: {
  question: Question | null;
  onClose: () => void;
  onSaved: (question: Question) => void;
}) {
  const [form] = Form.useForm<{ text: string; tags: Question['tags']; listed: boolean }>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const tags = Form.useWatch('tags', form) ?? [];

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    const body = { text: values.text.trim(), tags: values.tags ?? [], listed: values.listed };
    try {
      const saved = question
        ? await api.call(DailyQuestionAdminEndpoints.update, {
            params: { questionId: question.questionId },
            body,
          })
        : await api.call(DailyQuestionAdminEndpoints.create, { body });
      onSaved(saved);
      onClose();
    } catch (e) {
      setError(feedback.report(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      form={form}
      draftKey={`question:${question?.questionId ?? 'new'}`}
      open
      onClose={onClose}
      title={question ? '编辑题目' : '新建题目'}
      width={560}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          text: question?.text ?? '',
          tags: question?.tags ?? [],
          listed: question?.listed ?? true,
        }}
      >
        <FormSection title="题目" />
        <Form.Item
          name="text"
          label="问题"
          rules={[
            { required: true, message: '填写问题' },
            { max: 40, message: '最多 40 字' },
          ]}
          extra={<FieldHelp>一句话，具体一点更容易聊起来。例：最近一次熬夜是因为什么？</FieldHelp>}
        >
          <Input.TextArea autoSize={{ minRows: 2, maxRows: 4 }} maxLength={40} showCount />
        </Form.Item>
        <Form.Item
          name="tags"
          label="标签"
          extra={<FieldHelp>决定分给哪些角色，可多选。</FieldHelp>}
        >
          <Checkbox.Group options={TAGS.map(([value, label]) => ({ value, label }))} />
        </Form.Item>
        <div className="field-note">
          {tags.includes('romance') && <div>只有关系类型为「恋人」的角色会被分到。</div>}
          {!tags.includes('child_safe') && <div>没勾「适合儿童」时，儿童角色不会被分到。</div>}
          {tags.includes('work') && <div>涉及工作的话题不会分给真人角色。</div>}
        </div>
        <Form.Item
          name="listed"
          label="上架"
          valuePropName="checked"
          extra={<FieldHelp>下架后不再出现，已答过的历史保留。</FieldHelp>}
        >
          <Switch />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}
