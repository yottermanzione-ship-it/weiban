/**
 * 素材库：表情商店、音色库、卡面模板、作品链接。
 * 图片/音频先上传拿 mediaId，再登记；表情必须确认不含真人本人肖像。
 */
import { useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  Form,
  Input,
  InputNumber,
  Select,
  Space,
  Switch,
  Tag,
  Upload,
} from 'antd';
import { PlusOutlined, UploadOutlined, MinusCircleOutlined } from '@ant-design/icons';
import {
  CardTemplateAdminEndpoints,
  CharacterAdminEndpoints,
  MediaAdminEndpoints,
  StickerAdminEndpoints,
  VoiceAdminEndpoints,
  WorkLinkAdminEndpoints,
  type AdminVoice,
  type CardTemplate,
  type StickerPack,
  type WorkLink,
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
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';

function useCharacters() {
  const characters = useRemote(CharacterAdminEndpoints.list);
  return (characters.data?.items ?? []).map((c) => ({
    value: c.characterId,
    label: `${c.name}${c.status === 'published' ? '' : '（未上架）'}`,
  }));
}

async function uploadMedia(file: File, purpose: string) {
  return api.call(MediaAdminEndpoints.adminUpload, { query: { purpose: purpose as never }, file });
}

// ---------- 表情商店 ----------

export function StickerLibraryPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const packs = useRemote(StickerAdminEndpoints.listPacks);
  const characters = useCharacters();
  const [editing, setEditing] = useState<StickerPack | 'new' | null>(null);
  const [error, setError] = useState('');

  const nameOf = (id: string) => characters.find((c) => c.value === id)?.label ?? id.slice(0, 8);

  const columns: ProColumns<StickerPack>[] = [
    {
      title: '表情包',
      width: 240,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.name}</span>
          <span className="cell-sub">{row.intro || '没有简介'}</span>
        </div>
      ),
    },
    {
      title: '给哪些角色',
      width: 200,
      render: (_, row) =>
        row.characterIds.length === 0 ? '所有角色' : row.characterIds.map(nameOf).join('、'),
    },
    { title: '表情数', width: 90, render: (_, row) => row.stickers.length },
    {
      title: '商店',
      width: 100,
      render: (_, row) =>
        row.inStore ? <StatusTag tone="success">已上架</StatusTag> : <StatusTag>未上架</StatusTag>,
    },
    {
      title: '用户可见 / 启用',
      width: 140,
      render: (_, row) => (
        <Space size={4}>
          <Tag bordered={false} color={row.userVisible ? 'green' : 'default'}>
            用户{row.userVisible ? '可见' : '不可见'}
          </Tag>
          <Tag bordered={false} color={row.enabled ? 'green' : 'red'}>
            {row.enabled ? '启用' : '停用'}
          </Tag>
        </Space>
      ),
    },
    {
      title: '更新时间',
      width: 150,
      render: (_, row) => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      width: 90,
      fixed: 'right',
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setEditing(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Page
      title="表情商店"
      desc="角色聊天用的表情包。表情不能包含真人本人的照片或肖像，每次添加都要确认。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          新建表情包
        </Button>
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <DataTable<StickerPack>
        rowKey="packId"
        columns={columns}
        data={packs.data?.items ?? []}
        loading={packs.loading}
        error={packs.error}
        onRefresh={packs.refresh}
        onRowClick={(row) => setEditing(row)}
        emptyTitle="还没有表情包"
        emptyHint="点右上角「新建表情包」，起个名字，再往里面加表情图片。"
      />
      {editing && (
        <StickerPackDrawer
          pack={editing === 'new' ? null : editing}
          characters={characters}
          onClose={() => setEditing(null)}
          onChanged={() => {
            packs.refresh();
          }}
          onError={setError}
          onToast={toast.success}
          confirm={confirm}
        />
      )}
    </Page>
  );
}

function StickerPackDrawer({
  pack,
  characters,
  onClose,
  onChanged,
  onError,
  onToast,
  confirm,
}: {
  pack: StickerPack | null;
  characters: Array<{ value: string; label: string }>;
  onClose: () => void;
  onChanged: () => void;
  onError: (message: string) => void;
  onToast: (message: string) => void;
  confirm: ReturnType<typeof useDangerConfirm>;
}) {
  const [form] = Form.useForm<{
    name: string;
    characterIds: string[];
    userVisible: boolean;
    enabled: boolean;
    inStore: boolean;
    storeOrder: number;
    intro: string;
    coverStickerId?: string;
  }>();
  const [current, setCurrent] = useState<StickerPack | null>(pack);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const [description, setDescription] = useState('');
  const [noPortrait, setNoPortrait] = useState(false);
  const [uploading, setUploading] = useState(false);

  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    setError('');
    const body = {
      name: values.name,
      characterIds: values.characterIds ?? [],
      userVisible: values.userVisible,
      enabled: values.enabled,
      inStore: values.inStore,
      storeOrder: values.storeOrder ?? 0,
      intro: values.intro ?? '',
      coverStickerId: values.coverStickerId ?? null,
    };
    try {
      const saved = current
        ? await api.call(StickerAdminEndpoints.updatePack, {
            params: { packId: current.packId },
            body,
          })
        : await api.call(StickerAdminEndpoints.createPack, { body });
      setCurrent(saved);
      onChanged();
      onToast('已保存');
      if (!current) onClose();
    } catch (e) {
      setError(errorText(e));
      onError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function addSticker(file: File) {
    if (!current) {
      setError('请先保存表情包，再添加表情');
      return;
    }
    if (!description.trim() || !noPortrait) {
      setError('请填写表情说明，并确认不含真人本人肖像');
      return;
    }
    setUploading(true);
    setError('');
    try {
      const media = await uploadMedia(file, 'sticker_library');
      await api.call(StickerAdminEndpoints.addSticker, {
        params: { packId: current.packId },
        body: {
          mediaId: media.mediaId,
          description: description.trim(),
          confirmNoRealPersonPortrait: true,
        },
      });
      const refreshed = await api.call(StickerAdminEndpoints.listPacks);
      const next = refreshed.items.find((p) => p.packId === current.packId) ?? current;
      setCurrent(next);
      setDescription('');
      setNoPortrait(false);
      onChanged();
      onToast('表情已添加');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  async function removeSticker(stickerId: string) {
    try {
      await api.call(StickerAdminEndpoints.deleteSticker, { params: { stickerId } });
      if (current)
        setCurrent({ ...current, stickers: current.stickers.filter((s) => s.stickerId !== stickerId) });
      onChanged();
      onToast('已删除');
    } catch (e) {
      setError(errorText(e));
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={current ? `编辑表情包 · ${current.name}` : '新建表情包'}
      width={720}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <SectionCard title="基本信息">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            name: current?.name ?? '',
            characterIds: current?.characterIds ?? [],
            userVisible: current?.userVisible ?? true,
            enabled: current?.enabled ?? true,
            inStore: current?.inStore ?? false,
            storeOrder: current?.storeOrder ?? 0,
            intro: current?.intro ?? '',
            coverStickerId: current?.coverStickerId ?? undefined,
          }}
        >
          <div className="form-two">
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '填写名称' }]}
              extra={<FieldHelp>最多 20 字，用户端显示这个名字。</FieldHelp>}
            >
              <Input maxLength={20} />
            </Form.Item>
            <Form.Item
              name="characterIds"
              label="给哪些角色用"
              extra={<FieldHelp>不选 = 所有角色可用。</FieldHelp>}
            >
              <Select
                mode="multiple"
                showSearch
                optionFilterProp="label"
                options={characters}
                placeholder="所有角色"
              />
            </Form.Item>
          </div>
          <Form.Item name="intro" label="商店简介" extra={<FieldHelp>用户在表情商店看到的说明。</FieldHelp>}>
            <Input maxLength={100} />
          </Form.Item>
          <div className="form-three">
            <Form.Item name="inStore" label="商店上架" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="storeOrder" label="商店排序" extra={<FieldHelp>小的在前。</FieldHelp>}>
              <InputNumber min={0} style={{ width: '100%' }} />
            </Form.Item>
            <Form.Item
              name="coverStickerId"
              label="商店封面"
              extra={<FieldHelp>不选 = 用第一个表情。</FieldHelp>}
            >
              <Select
                allowClear
                options={(current?.stickers ?? []).map((s) => ({
                  value: s.stickerId,
                  label: s.description,
                }))}
              />
            </Form.Item>
          </div>
          <Space size={24}>
            <Form.Item name="userVisible" label="用户输入框可见" valuePropName="checked">
              <Switch />
            </Form.Item>
            <Form.Item name="enabled" label="启用" valuePropName="checked">
              <Switch />
            </Form.Item>
          </Space>
        </Form>
      </SectionCard>
      <SectionCard title="表情" desc={current ? `共 ${current.stickers.length} 个` : '先保存表情包再加表情'}>
        <div className="sticker-grid">
          {(current?.stickers ?? []).map((sticker) => (
            <div className="sticker-card" key={sticker.stickerId}>
              <img src={sticker.url} alt={sticker.description} />
              <span>{sticker.description}</span>
              <Button
                type="text"
                size="small"
                danger
                icon={<MinusCircleOutlined />}
                onClick={() =>
                  confirm({
                    title: `删除表情「${sticker.description}」？`,
                    content: '已发出的消息仍能显示，但以后不能再发。',
                    okText: '删除',
                    onOk: () => removeSticker(sticker.stickerId),
                  })
                }
              />
            </div>
          ))}
          {(current?.stickers ?? []).length === 0 && (
            <span className="detail-muted">还没有表情，用下面的「添加表情」上传。</span>
          )}
        </div>
        <div className="sticker-add">
          <Input
            placeholder="表情说明，例：开心"
            maxLength={40}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
            style={{ width: 200 }}
          />
          <Checkbox checked={noPortrait} onChange={(e) => setNoPortrait(e.target.checked)}>
            确认不含真人本人肖像
          </Checkbox>
          <Upload
            accept="image/png,image/gif,image/webp,image/jpeg"
            showUploadList={false}
            beforeUpload={(file) => {
              void addSticker(file);
              return false;
            }}
          >
            <Button icon={<UploadOutlined />} loading={uploading} disabled={!current}>
              添加表情
            </Button>
          </Upload>
        </div>
      </SectionCard>
    </RecordDrawer>
  );
}

// ---------- 音色库 ----------

export function VoiceLibraryPage() {
  const toast = useToast();
  const voices = useRemote(VoiceAdminEndpoints.listVoices);
  const [editing, setEditing] = useState<AdminVoice | 'new' | null>(null);

  const columns: ProColumns<AdminVoice>[] = [
    {
      title: '音色',
      width: 220,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.name}</span>
          <span className="cell-sub">{row.tags.join('、') || '没有标签'}</span>
        </div>
      ),
    },
    {
      title: '音色代号',
      width: 180,
      render: (_, row) => <span className="mono">{row.providerVoiceKey}</span>,
    },
    {
      title: '合成模型',
      width: 180,
      render: (_, row) => <span className="mono">{row.modelKey}</span>,
    },
    {
      title: '试听',
      width: 120,
      render: (_, row) =>
        row.sampleUrl ? (
          <audio controls src={row.sampleUrl} style={{ height: 28, width: 180 }} />
        ) : (
          <span className="cell-sub">未上传</span>
        ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) =>
        row.enabled ? <StatusTag tone="success">启用</StatusTag> : <StatusTag>停用</StatusTag>,
    },
    {
      title: '操作',
      width: 90,
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setEditing(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Page
      title="音色库"
      desc="角色语音用的音色。名字里不能出现真人角色姓名；停用后已选用的角色会退回默认音色。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          登记音色
        </Button>
      }
    >
      <DataTable<AdminVoice>
        rowKey="voiceId"
        columns={columns}
        data={voices.data?.items ?? []}
        loading={voices.loading}
        error={voices.error}
        onRefresh={voices.refresh}
        onRowClick={(row) => setEditing(row)}
        emptyTitle="还没有音色"
        emptyHint="点右上角「登记音色」，填语音服务里的音色代号和合成模型。"
      />
      {editing && (
        <VoiceDrawer
          voice={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('已保存');
            setEditing(null);
            voices.refresh();
          }}
        />
      )}
    </Page>
  );
}

function VoiceDrawer({
  voice,
  onClose,
  onSaved,
}: {
  voice: AdminVoice | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{
    name: string;
    tags: string;
    providerVoiceKey: string;
    modelKey: string;
    enabled: boolean;
    sampleMediaId?: string | null;
  }>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [sampleUrl, setSampleUrl] = useState<string | null>(voice?.sampleUrl ?? null);
  const [error, setError] = useState('');

  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    setError('');
    const body = {
      name: values.name,
      tags: values.tags
        ? values.tags
            .split(/[,，、\s]+/)
            .map((t) => t.trim())
            .filter(Boolean)
            .slice(0, 8)
        : [],
      providerVoiceKey: values.providerVoiceKey,
      modelKey: values.modelKey,
      enabled: values.enabled,
      sampleMediaId: values.sampleMediaId ?? null,
      careFallbackMediaId: voice?.careFallbackMediaId ?? null,
    };
    try {
      if (voice)
        await api.call(VoiceAdminEndpoints.updateVoice, {
          params: { voiceId: voice.voiceId },
          body,
        });
      else await api.call(VoiceAdminEndpoints.createVoice, { body });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={voice ? `编辑音色 · ${voice.name}` : '登记音色'}
      width={600}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: voice?.name ?? '',
          tags: voice?.tags.join('，') ?? '',
          providerVoiceKey: voice?.providerVoiceKey ?? '',
          modelKey: voice?.modelKey ?? '',
          enabled: voice?.enabled ?? true,
          sampleMediaId: voice?.sampleMediaId ?? null,
        }}
      >
        <FormSection title="基本信息" />
        <div className="form-two">
          <Form.Item
            name="name"
            label="名称"
            rules={[{ required: true, message: '填写名称' }]}
            extra={<FieldHelp>不能包含真人角色姓名。</FieldHelp>}
          >
            <Input maxLength={20} />
          </Form.Item>
          <Form.Item name="tags" label="气质标签" extra={<FieldHelp>用逗号分隔，例：温柔，低音。</FieldHelp>}>
            <Input placeholder="温柔，低音" />
          </Form.Item>
        </div>
        <div className="form-two">
          <Form.Item
            name="providerVoiceKey"
            label="音色代号"
            rules={[{ required: true, message: '填写音色代号' }]}
            extra={<FieldHelp>语音服务商控制台里的 voice id。</FieldHelp>}
          >
            <Input maxLength={64} />
          </Form.Item>
          <Form.Item
            name="modelKey"
            label="合成模型"
            rules={[{ required: true, message: '填写模型键' }]}
            extra={<FieldHelp>模型管理里带「语音输出」能力的模型。</FieldHelp>}
          >
            <Input maxLength={80} />
          </Form.Item>
        </div>
        <Form.Item label="试听音频" extra={<FieldHelp>上传一段 5～15 秒的样音，用户试听不扣积分。</FieldHelp>}>
          <Space>
            <Upload
              accept="audio/mpeg,audio/wav,audio/mp4"
              showUploadList={false}
              beforeUpload={(file) => {
                setUploading(true);
                void uploadMedia(file, 'voice_sample')
                  .then((media) => {
                    form.setFieldValue('sampleMediaId', media.mediaId);
                    setSampleUrl(media.url);
                  })
                  .catch((e: unknown) => setError(errorText(e)))
                  .finally(() => setUploading(false));
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading}>
                上传样音
              </Button>
            </Upload>
            {sampleUrl && <audio controls src={sampleUrl} style={{ height: 32 }} />}
          </Space>
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

// ---------- 卡面模板 ----------

const CARD_KIND_LABELS: Record<string, string> = {
  anniversary: '纪念日',
  familiarity: '好感度',
  holiday: '节日',
  moment: '朋友圈',
  pet: '宠物',
  play: '玩法',
  daily_photo: '日常配图',
};

export function CardTemplatesPage() {
  const toast = useToast();
  const templates = useRemote(CardTemplateAdminEndpoints.listTemplates);
  const [editing, setEditing] = useState<CardTemplate | 'new' | null>(null);

  const columns: ProColumns<CardTemplate>[] = [
    {
      title: '模板',
      width: 260,
      render: (_, row) => (
        <div className="sticker-card-inline">
          <img src={row.url} alt={row.name} />
          <div className="cell-main">
            <span className="cell-title">{row.name}</span>
            <span className="cell-sub">{row.kinds.map((k) => CARD_KIND_LABELS[k] ?? k).join('、')}</span>
          </div>
        </div>
      ),
    },
    {
      title: '可用于真人角色',
      width: 140,
      render: (_, row) =>
        row.portraitFree ? (
          <StatusTag tone="success">不含人物</StatusTag>
        ) : (
          <StatusTag tone="warning">含人物</StatusTag>
        ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) =>
        row.enabled ? <StatusTag tone="success">启用</StatusTag> : <StatusTag>停用</StatusTag>,
    },
    {
      title: '更新时间',
      width: 150,
      render: (_, row) => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      width: 90,
      render: (_, row) => (
        <Button type="link" size="small" onClick={() => setEditing(row)}>
          编辑
        </Button>
      ),
    },
  ];

  return (
    <Page
      title="卡面模板"
      desc="纪念日、节日等卡片的底图。「不含人物」的模板才能用于真人角色。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          新增模板
        </Button>
      }
    >
      <DataTable<CardTemplate>
        rowKey="templateId"
        columns={columns}
        data={templates.data?.items ?? []}
        loading={templates.loading}
        error={templates.error}
        onRefresh={templates.refresh}
        onRowClick={(row) => setEditing(row)}
        emptyTitle="还没有卡面模板"
        emptyHint="点右上角「新增模板」，上传图片并选择用途。"
      />
      {editing && (
        <CardDrawer
          template={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('已保存');
            setEditing(null);
            templates.refresh();
          }}
        />
      )}
    </Page>
  );
}

function CardDrawer({
  template,
  onClose,
  onSaved,
}: {
  template: CardTemplate | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{
    name: string;
    kinds: string[];
    portraitFree: boolean;
    enabled: boolean;
    mediaId?: string;
  }>();
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [preview, setPreview] = useState<string | null>(template?.url ?? null);
  const [error, setError] = useState('');

  async function save() {
    const values = await form.validateFields();
    if (!values.mediaId) {
      setError('请先上传卡面图片');
      return;
    }
    setSaving(true);
    setError('');
    const body = {
      name: values.name,
      kinds: values.kinds as never,
      mediaId: values.mediaId,
      portraitFree: values.portraitFree,
      enabled: values.enabled,
    };
    try {
      if (template)
        await api.call(CardTemplateAdminEndpoints.updateTemplate, {
          params: { templateId: template.templateId },
          body,
        });
      else await api.call(CardTemplateAdminEndpoints.createTemplate, { body });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={template ? `编辑模板 · ${template.name}` : '新增卡面模板'}
      width={560}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          name: template?.name ?? '',
          kinds: template?.kinds ?? [],
          portraitFree: template?.portraitFree ?? false,
          enabled: template?.enabled ?? true,
          mediaId: template?.mediaId,
        }}
      >
        <FormSection title="模板" />
        <Form.Item
          name="name"
          label="名称"
          rules={[{ required: true, message: '填写名称' }]}
          extra={<FieldHelp>管理员自己看的名字，例：新年红金。</FieldHelp>}
        >
          <Input maxLength={20} />
        </Form.Item>
        <Form.Item
          name="kinds"
          label="用途"
          rules={[{ required: true, message: '至少选一个用途' }]}
          extra={<FieldHelp>决定这张卡会在什么场景被挑到。</FieldHelp>}
        >
          <Checkbox.Group
            options={Object.entries(CARD_KIND_LABELS).map(([value, label]) => ({ value, label }))}
          />
        </Form.Item>
        <Form.Item label="图片" extra={<FieldHelp>建议 3:2 横图，大小不超过 2MB。</FieldHelp>}>
          <Space>
            <Upload
              accept="image/png,image/jpeg,image/webp"
              showUploadList={false}
              beforeUpload={(file) => {
                setUploading(true);
                void uploadMedia(file, 'card_template')
                  .then((media) => {
                    form.setFieldValue('mediaId', media.mediaId);
                    setPreview(media.url);
                  })
                  .catch((e: unknown) => setError(errorText(e)))
                  .finally(() => setUploading(false));
                return false;
              }}
            >
              <Button icon={<UploadOutlined />} loading={uploading}>
                上传图片
              </Button>
            </Upload>
            {preview && <img src={preview} alt="卡面预览" style={{ height: 64, borderRadius: 6 }} />}
          </Space>
        </Form.Item>
        <Form.Item
          name="portraitFree"
          label="不含人物"
          valuePropName="checked"
          extra={<FieldHelp>勾上后，这张卡才能用于真人角色。</FieldHelp>}
        >
          <Switch />
        </Form.Item>
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}

// ---------- 作品链接 ----------

export function WorkLinksPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const characters = useRemote(CharacterAdminEndpoints.list);
  const [characterId, setCharacterId] = useState('');
  const [items, setItems] = useState<WorkLink[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<WorkLink | 'new' | null>(null);

  const published = (characters.data?.items ?? []).filter((c) => c.status === 'published');

  async function load() {
    if (!characterId) {
      setItems([]);
      return;
    }
    setLoading(true);
    setError('');
    try {
      const result = await api.call(WorkLinkAdminEndpoints.listWorkLinks, {
        params: { characterId },
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
  }, [characterId]);

  async function remove(link: WorkLink) {
    try {
      await api.call(WorkLinkAdminEndpoints.deleteWorkLink, {
        params: { characterId, workLinkId: link.workLinkId },
      });
      toast.success('已删除');
      await load();
    } catch (e) {
      toast.error(errorText(e));
    }
  }

  const columns: ProColumns<WorkLink>[] = [
    {
      title: '作品',
      width: 240,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.title}</span>
          <span className="cell-sub mono">{row.url}</span>
        </div>
      ),
    },
    {
      title: '类型',
      width: 90,
      render: (_, row) => ({ music: '音乐', video: '视频', web: '网页' })[row.appHint] ?? row.appHint,
    },
    {
      title: '来源',
      width: 120,
      render: (_, row) => row.source ?? '—',
    },
    {
      title: '可访问',
      width: 110,
      render: (_, row) =>
        row.lastCheck ? (
          row.lastCheck.ok ? (
            <StatusTag tone="success">正常</StatusTag>
          ) : (
            <StatusTag tone="error">打不开</StatusTag>
          )
        ) : (
          <span className="cell-sub">未检查</span>
        ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, row) =>
        row.enabled ? <StatusTag tone="success">启用</StatusTag> : <StatusTag>停用</StatusTag>,
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
                title: `删除「${row.title}」？`,
                content: '删除后角色不会再分享这个链接。',
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
      title="作品链接"
      desc="角色的音乐、视频、网页作品。保存后系统会检查链接能不能打开；打不开的链接角色不再分享。"
      extra={
        <Space>
          <Select
            showSearch
            optionFilterProp="label"
            style={{ width: 220 }}
            placeholder="选择角色"
            value={characterId || undefined}
            onChange={(value) => setCharacterId(value ?? '')}
            options={published.map((c) => ({ value: c.characterId, label: c.name }))}
          />
          <Button
            type="primary"
            icon={<PlusOutlined />}
            disabled={!characterId}
            onClick={() => setEditing('new')}
          >
            添加链接
          </Button>
        </Space>
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <DataTable<WorkLink>
        rowKey="workLinkId"
        columns={columns}
        data={items}
        loading={loading}
        onRefresh={() => void load()}
        onRowClick={(row) => setEditing(row)}
        pagination={false}
        emptyTitle={characterId ? '这个角色还没有作品链接' : '先选一个角色'}
        emptyHint={
          characterId
            ? '点右上角「添加链接」，填标题和 https 链接。'
            : '在右上角选择角色后，这里会列出 TA 的作品链接。'
        }
      />
      {editing && (
        <WorkLinkDrawer
          characterId={characterId}
          link={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('已保存');
            setEditing(null);
            void load();
          }}
        />
      )}
    </Page>
  );
}

function WorkLinkDrawer({
  characterId,
  link,
  onClose,
  onSaved,
}: {
  characterId: string;
  link: WorkLink | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{
    title: string;
    url: string;
    source: string;
    appHint: 'music' | 'video' | 'web';
    enabled: boolean;
  }>();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function save() {
    const values = await form.validateFields();
    setSaving(true);
    setError('');
    const body = {
      title: values.title,
      url: values.url,
      source: values.source?.trim() || null,
      appHint: values.appHint,
      coverMediaId: link?.coverMediaId ?? null,
      enabled: values.enabled,
    };
    try {
      if (link)
        await api.call(WorkLinkAdminEndpoints.updateWorkLink, {
          params: { characterId, workLinkId: link.workLinkId },
          body,
        });
      else await api.call(WorkLinkAdminEndpoints.createWorkLink, { params: { characterId }, body });
      onSaved();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={link ? '编辑作品链接' : '添加作品链接'}
      width={560}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <Form
        form={form}
        layout="vertical"
        initialValues={{
          title: link?.title ?? '',
          url: link?.url ?? '',
          source: link?.source ?? '',
          appHint: link?.appHint ?? 'web',
          enabled: link?.enabled ?? true,
        }}
      >
        <FormSection title="链接" />
        <Form.Item
          name="title"
          label="标题"
          rules={[{ required: true, message: '填写标题' }]}
          extra={<FieldHelp>角色分享时会说「这是我的一首…」。</FieldHelp>}
        >
          <Input maxLength={100} />
        </Form.Item>
        <Form.Item
          name="url"
          label="链接"
          rules={[
            { required: true, message: '填写链接' },
            { type: 'url', message: '要以 https:// 开头' },
          ]}
          extra={<FieldHelp>必须公开可访问，保存后系统会检查一次。</FieldHelp>}
        >
          <Input placeholder="https://…" />
        </Form.Item>
        <div className="form-two">
          <Form.Item name="appHint" label="类型">
            <Select
              options={[
                { value: 'music', label: '音乐' },
                { value: 'video', label: '视频' },
                { value: 'web', label: '网页' },
              ]}
            />
          </Form.Item>
          <Form.Item name="source" label="来源" extra={<FieldHelp>例：网易云音乐。</FieldHelp>}>
            <Input maxLength={30} />
          </Form.Item>
        </div>
        <Form.Item name="enabled" label="启用" valuePropName="checked">
          <Switch />
        </Form.Item>
      </Form>
    </RecordDrawer>
  );
}
