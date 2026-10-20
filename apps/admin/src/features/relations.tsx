/**
 * 关系网：官方角色之间的关系（一条关系双向生效）。
 * 真人与虚构角色之间不能建立关系；预设角色之间必须写公开依据。
 */
import { useState } from 'react';
import { Alert, Button, Form, Input, Select, Space } from 'antd';
import { PlusOutlined } from '@ant-design/icons';
import {
  CharacterAdminEndpoints,
  RelationAdminEndpoints,
  type CharacterRelation,
  type RelationCloseness,
  type RelationType,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import {
  FieldHelp,
  FormSection,
  Page,
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import { useFormFeedback } from '../data/form-feedback.js';

const TYPE_LABELS: Record<RelationType, string> = {
  groupmate: '同团成员',
  costar: '合作演员',
  friend: '朋友',
  mentor: '师徒',
  family: '家人',
  colleague: '同事',
  in_work: '作品中的关系',
  other: '其他',
};

const CLOSENESS_LABELS: Record<RelationCloseness, string> = {
  acquaintance: '点头之交',
  familiar: '熟悉',
  close: '亲密',
};

export function RelationsPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const characters = useRemote(CharacterAdminEndpoints.list);
  const [characterId, setCharacterId] = useState('');
  const [typeFilter, setTypeFilter] = useState<RelationType | ''>('');
  const list = useRemote(RelationAdminEndpoints.listRelations, {
    query: { characterId: characterId || undefined },
  });
  const [editing, setEditing] = useState<CharacterRelation | 'new' | null>(null);
  const [error, setError] = useState('');

  const all = characters.data?.items ?? [];
  const nameOf = (id: string) => all.find((c) => c.characterId === id)?.name ?? id.slice(0, 8);

  const rows = (list.data?.items ?? [])
    .filter((r) => r.ownerUserId === null)
    .filter((r) => !typeFilter || r.type === typeFilter)
    .map((r) =>
      characterId && r.characterBId === characterId
        ? { ...r, characterAId: r.characterBId, characterBId: r.characterAId }
        : r,
    );

  async function remove(relation: CharacterRelation) {
    setError('');
    try {
      await api.call(RelationAdminEndpoints.deleteRelation, {
        params: { relationId: relation.relationId },
      });
      toast.success('已删除');
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    }
  }

  const columns: ProColumns<CharacterRelation>[] = [
    {
      title: '角色 A',
      width: 160,
      render: (_, row) => nameOf(row.characterAId),
    },
    {
      title: '角色 B',
      width: 160,
      render: (_, row) => nameOf(row.characterBId),
    },
    {
      title: '关系',
      width: 150,
      render: (_, row) => (
        <div className="cell-main">
          <span>{TYPE_LABELS[row.type] ?? row.type}</span>
          {row.label && <span className="cell-sub">{row.label}</span>}
        </div>
      ),
    },
    {
      title: '亲密度',
      width: 110,
      render: (_, row) => CLOSENESS_LABELS[row.closeness] ?? row.closeness,
    },
    {
      title: '公开依据',
      render: (_, row) => <span className="cell-sub">{row.evidence || '—'}</span>,
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
          <Button
            type="link"
            size="small"
            danger
            onClick={() =>
              confirm({
                title: `删除「${nameOf(row.characterAId)}」和「${nameOf(row.characterBId)}」的关系？`,
                content: '删除后两个角色互相不再认识，不影响各自的人设。',
                okText: '删除',
                onOk: () => remove(row),
              })
            }
          >
            删除
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="关系网"
      desc="官方角色之间的固定关系（同团、家人、同事等）。一条关系对双方同时生效。"
      extra={
        <Space>
          <Button onClick={() => list.refresh()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            添加关系
          </Button>
        </Space>
      }
    >
      <DataTable<CharacterRelation>
        rowKey="relationId"
        columns={columns}
        data={rows}
        loading={list.loading}
        error={error || list.error}
        onRefresh={list.refresh}
        onRowClick={(row) => setEditing(row)}
        filters={
          <>
            <Select
              allowClear
              showSearch
              optionFilterProp="label"
              placeholder="按角色筛选"
              style={{ width: 200 }}
              value={characterId || undefined}
              onChange={(value) => setCharacterId(value ?? '')}
              options={all.map((c) => ({ value: c.characterId, label: c.name }))}
            />
            <Select
              allowClear
              placeholder="关系类型"
              style={{ width: 150 }}
              value={typeFilter || undefined}
              onChange={(value) => setTypeFilter((value as RelationType) ?? '')}
              options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </>
        }
        emptyTitle="还没有关系"
        emptyHint="点右上角「添加关系」，选两个角色和关系类型。真人和虚构角色之间不能建立关系。"
        emptyAction={
          <Button type="primary" onClick={() => setEditing('new')}>
            添加第一条
          </Button>
        }
      />
      {editing && (
        <RelationDrawer
          relation={editing === 'new' ? null : editing}
          characters={all.map((c) => ({
            value: c.characterId,
            label: `${c.name}${c.classification.basis === 'real_person' ? '（真人）' : ''}`,
            basis: c.classification.basis,
          }))}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('已保存');
            list.refresh();
          }}
        />
      )}
    </Page>
  );
}

interface RelationForm {
  characterAId: string;
  characterBId: string;
  type: RelationType;
  label?: string;
  closeness: RelationCloseness;
  evidence: string;
}

function RelationDrawer({
  relation,
  characters,
  onClose,
  onSaved,
}: {
  relation: CharacterRelation | null;
  characters: Array<{ value: string; label: string; basis: string }>;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<RelationForm>();
  const feedback = useFormFeedback(form);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const a = Form.useWatch('characterAId', form);
  const b = Form.useWatch('characterBId', form);
  const basisOf = (id?: string) => characters.find((c) => c.value === id)?.basis;
  const mixed =
    !!a && !!b && (basisOf(a) === 'real_person') !== (basisOf(b) === 'real_person');

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    setSaving(true);
    setError('');
    const body = {
      type: values.type,
      label: values.label?.trim() || null,
      closeness: values.closeness,
      evidence: values.evidence.trim(),
    };
    try {
      if (relation)
        await api.call(RelationAdminEndpoints.updateRelation, {
          params: { relationId: relation.relationId },
          body,
        });
      else
        await api.call(RelationAdminEndpoints.createRelation, {
          body: { ...body, characterAId: values.characterAId, characterBId: values.characterBId },
        });
      onSaved();
      onClose();
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.status === 409
          ? '这两个角色已经有关系了。'
          : e instanceof ApiFailure && e.status === 422
            ? '真人和虚构角色之间不能建立关系。'
            : feedback.report(e),
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      form={form}
      draftKey={`relation:${relation?.relationId ?? 'new'}`}
      open
      onClose={onClose}
      title={relation ? '编辑关系' : '添加关系'}
      subtitle="一条关系对双方同时生效"
      width={600}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      {mixed && <Alert type="warning" showIcon message="真人和虚构角色之间不能建立关系" />}
      <Form<RelationForm>
        form={form}
        layout="vertical"
        initialValues={{
          characterAId: relation?.characterAId ?? undefined,
          characterBId: relation?.characterBId ?? undefined,
          type: relation?.type ?? 'friend',
          label: relation?.label ?? '',
          closeness: relation?.closeness ?? 'familiar',
          evidence: relation?.evidence ?? '',
        }}
      >
        <FormSection title="关系双方" />
        <div className="form-two">
          <Form.Item
            name="characterAId"
            label="角色 A"
            rules={[{ required: true, message: '选择角色' }]}
          >
            <Select showSearch optionFilterProp="label" options={characters} disabled={!!relation} />
          </Form.Item>
          <Form.Item
            name="characterBId"
            label="角色 B"
            rules={[
              { required: true, message: '选择角色' },
              {
                validator: (_, value) =>
                  value && value === form.getFieldValue('characterAId')
                    ? Promise.reject(new Error('不能和角色 A 相同'))
                    : Promise.resolve(),
              },
            ]}
          >
            <Select showSearch optionFilterProp="label" options={characters} disabled={!!relation} />
          </Form.Item>
        </div>
        <FormSection title="关系内容" />
        <div className="form-two">
          <Form.Item
            name="type"
            label="关系类型"
            extra={<FieldHelp>决定角色在聊天里怎么称呼对方。</FieldHelp>}
          >
            <Select
              options={Object.entries(TYPE_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
          <Form.Item
            name="closeness"
            label="亲密度"
            extra={<FieldHelp>影响角色提到对方时的语气。</FieldHelp>}
          >
            <Select
              options={Object.entries(CLOSENESS_LABELS).map(([value, label]) => ({ value, label }))}
            />
          </Form.Item>
        </div>
        <Form.Item
          name="label"
          label="关系说明（可选）"
          extra={<FieldHelp>例：同一家公司，认识五年。</FieldHelp>}
        >
          <Input maxLength={40} />
        </Form.Item>
        <Form.Item
          name="evidence"
          label="公开依据"
          rules={[{ required: true, message: '填写公开依据' }]}
          extra={<FieldHelp>必须写公开可查的来源（作品、官方设定），不能凭印象编。</FieldHelp>}
        >
          <Input.TextArea rows={3} maxLength={300} showCount />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}
