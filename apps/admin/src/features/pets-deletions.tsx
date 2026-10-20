/**
 * 宠物图鉴：物种与外观。每个外观要有幼年/少年/成年三张图，传齐才能上架。
 */
import { useState } from 'react';
import { Alert, Button, Checkbox, Form, Input, Space, Switch, Upload } from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import { MediaAdminEndpoints, PetSpeciesAdminEndpoints, type PetSpecies } from '@weiban/contracts';
import { api } from '../data/client.js';
import { adminMediaUrl } from '../data/media-url.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import {
  FieldHelp,
  Page,
  SectionCard,
  StatusTag,
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import { useFormFeedback } from '../data/form-feedback.js';

const STAGES = [
  ['baby', '幼年'],
  ['junior', '少年'],
  ['adult', '成年'],
] as const;

type StageKey = (typeof STAGES)[number][0];

interface AppearanceDraft {
  appearanceId?: string;
  name: string;
  listed: boolean;
  images: Partial<Record<StageKey, { mediaId: string; url: string }>>;
}

function draftsOf(species: PetSpecies | null): AppearanceDraft[] {
  if (!species) return [{ name: '', listed: true, images: {} }];
  return species.appearances.map((a) => ({
    appearanceId: a.appearanceId,
    name: a.name,
    listed: a.listed ?? true,
    images: { baby: a.images.baby, junior: a.images.junior, adult: a.images.adult },
  }));
}

export function PetSpeciesPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const list = useRemote(PetSpeciesAdminEndpoints.listSpecies);
  const [editing, setEditing] = useState<PetSpecies | 'new' | null>(null);

  async function toggleListed(species: PetSpecies) {
    const run = async () => {
      try {
        await api.call(PetSpeciesAdminEndpoints.updateSpecies, {
          params: { speciesId: species.speciesId },
          body: { listed: !species.listed },
        });
        toast.success(species.listed ? '已下架' : '已上架');
        list.refresh();
      } catch (e) {
        toast.error(errorText(e));
      }
    };
    if (species.listed)
      confirm({
        title: `下架「${species.name}」？`,
        content: '下架后用户领养时看不到这个物种；已经领养的不受影响。',
        okText: '下架',
        onOk: run,
      });
    else await run();
  }

  const columns: ProColumns<PetSpecies>[] = [
    {
      title: '物种',
      width: 200,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.name}</span>
          <span className="cell-sub">{row.intro || '没有简介'}</span>
        </div>
      ),
    },
    {
      title: '外观',
      width: 260,
      render: (_, row) => (
        <Space size={6} wrap>
          {row.appearances.map((a) => (
            <span key={a.appearanceId} className="chip">
              {a.name}
            </span>
          ))}
        </Space>
      ),
    },
    {
      title: '预设名字',
      render: (_, row) => <span className="cell-sub">{row.presetNames.join('、') || '—'}</span>,
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) =>
        row.listed ? <StatusTag tone="success">已上架</StatusTag> : <StatusTag>已下架</StatusTag>,
    },
    {
      title: '操作',
      width: 140,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditing(row)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger={row.listed}
            onClick={() => void toggleListed(row)}
          >
            {row.listed ? '下架' : '上架'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="宠物图鉴"
      desc="每个外观要传幼年、少年、成年三张图（透明底 512×512），三张看得出是同一只才能上架。"
      extra={
        <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
          新建物种
        </Button>
      }
    >
      <DataTable<PetSpecies>
        rowKey="speciesId"
        columns={columns}
        data={list.data?.items ?? []}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        onRowClick={(row) => setEditing(row)}
        emptyTitle="还没有宠物物种"
        emptyHint="点右上角「新建物种」，填名字、预设名字，再为每个外观传三张图。"
      />
      {editing && (
        <PetDrawer
          species={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={() => {
            toast.success('已保存');
            setEditing(null);
            list.refresh();
          }}
        />
      )}
    </Page>
  );
}

function PetDrawer({
  species,
  onClose,
  onSaved,
}: {
  species: PetSpecies | null;
  onClose: () => void;
  onSaved: () => void;
}) {
  const [form] = Form.useForm<{
    name: string;
    intro: string;
    presetNames: string;
    listed: boolean;
  }>();
  const feedback = useFormFeedback(form);
  const [drafts, setDrafts] = useState<AppearanceDraft[]>(() => draftsOf(species));
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState<string | null>(null);
  const [error, setError] = useState('');

  const complete =
    drafts.length > 0 &&
    drafts.every((d) => d.name.trim() && STAGES.every(([stage]) => d.images[stage]));

  async function uploadStage(index: number, stage: StageKey, file: File) {
    const key = `${index}-${stage}`;
    setUploading(key);
    setError('');
    try {
      const media = await api.call(MediaAdminEndpoints.adminUpload, {
        query: { purpose: 'pet_art' },
        file,
      });
      setDrafts((items) =>
        items.map((item, i) =>
          i === index
            ? {
                ...item,
                images: { ...item.images, [stage]: { mediaId: media.mediaId, url: media.url } },
              }
            : item,
        ),
      );
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(null);
    }
  }

  async function save() {
    const values = await feedback.validate();
    if (!values) return;
    if (values.listed && !complete) {
      setError('每个外观的三张图都传齐后才能上架。');
      return;
    }
    setSaving(true);
    setError('');
    const body = {
      name: values.name,
      intro: values.intro ?? '',
      presetNames: (values.presetNames ?? '')
        .split(/[,，、\s]+/)
        .map((n) => n.trim())
        .filter(Boolean)
        .slice(0, 30),
      listed: values.listed,
      appearances: drafts.map((d) => ({
        ...(d.appearanceId ? { appearanceId: d.appearanceId } : {}),
        name: d.name.trim(),
        listed: d.listed,
        imageMediaIds: {
          baby: d.images.baby?.mediaId ?? '',
          junior: d.images.junior?.mediaId ?? '',
          adult: d.images.adult?.mediaId ?? '',
        },
      })),
    };
    try {
      if (species)
        await api.call(PetSpeciesAdminEndpoints.updateSpecies, {
          params: { speciesId: species.speciesId },
          body,
        });
      else await api.call(PetSpeciesAdminEndpoints.createSpecies, { body });
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
      draftKey={`pet-species:${species?.speciesId ?? 'new'}`}
      open
      onClose={onClose}
      title={species ? `编辑物种 · ${species.name}` : '新建物种'}
      width={720}
      footer={<DrawerActions onCancel={onClose} onSubmit={() => void save()} saving={saving} />}
    >
      {error && <Alert type="error" showIcon message={error} />}
      <SectionCard title="基本信息">
        <Form
          form={form}
          layout="vertical"
          initialValues={{
            name: species?.name ?? '',
            intro: species?.intro ?? '',
            presetNames: species?.presetNames.join('，') ?? '',
            listed: species?.listed ?? false,
          }}
        >
          <div className="form-two">
            <Form.Item
              name="name"
              label="名称"
              rules={[{ required: true, message: '填写名称' }]}
              extra={<FieldHelp>最多 12 字，例：云朵猫。</FieldHelp>}
            >
              <Input maxLength={12} />
            </Form.Item>
            <Form.Item name="intro" label="简介" extra={<FieldHelp>最多 50 字。</FieldHelp>}>
              <Input maxLength={50} />
            </Form.Item>
          </div>
          <Form.Item
            name="presetNames"
            label="预设名字"
            extra={<FieldHelp>用户不自己起名时的候选，用逗号分隔，每个不超过 8 字。</FieldHelp>}
          >
            <Input placeholder="团子，雪球，棉花" />
          </Form.Item>
          <Form.Item
            name="listed"
            label="上架"
            valuePropName="checked"
            extra={<FieldHelp>{complete ? '用户领养时可以看到这个物种。' : '三张图传齐后才能上架。'}</FieldHelp>}
          >
            <Switch disabled={!complete} />
          </Form.Item>
        </Form>
      </SectionCard>
      <SectionCard
        title="外观"
        desc="每个外观都要三张图"
        extra={
          <Button
            size="small"
            onClick={() => setDrafts((items) => [...items, { name: '', listed: true, images: {} }])}
          >
            新增外观
          </Button>
        }
      >
        <div className="appearance-list">
          {drafts.map((draft, index) => (
            <div className="appearance-card" key={draft.appearanceId ?? `new-${index}`}>
              <div className="appearance-head">
                <Input
                  placeholder="外观名，例：奶油色"
                  maxLength={12}
                  value={draft.name}
                  onChange={(e) =>
                    setDrafts((items) =>
                      items.map((item, i) => (i === index ? { ...item, name: e.target.value } : item)),
                    )
                  }
                  style={{ width: 200 }}
                />
                <Checkbox
                  checked={draft.listed}
                  onChange={(e) =>
                    setDrafts((items) =>
                      items.map((item, i) =>
                        i === index ? { ...item, listed: e.target.checked } : item,
                      ),
                    )
                  }
                >
                  这个外观上架
                </Checkbox>
                {!draft.appearanceId && drafts.length > 1 && (
                  <Button
                    type="link"
                    size="small"
                    danger
                    onClick={() => setDrafts((items) => items.filter((_, i) => i !== index))}
                  >
                    移除
                  </Button>
                )}
              </div>
              <div className="stage-row">
                {STAGES.map(([stage, label]) => (
                  <div className="stage-cell" key={stage}>
                    <span className="field-label">{label}</span>
                    {draft.images[stage] ? (
                      <img src={adminMediaUrl(draft.images[stage]!.url)} alt={`${draft.name}${label}`} />
                    ) : (
                      <div className="stage-empty">未上传</div>
                    )}
                    <Upload
                      accept="image/png,image/webp"
                      showUploadList={false}
                      beforeUpload={(file) => {
                        void uploadStage(index, stage, file);
                        return false;
                      }}
                    >
                      <Button
                        size="small"
                        icon={<UploadOutlined />}
                        loading={uploading === `${index}-${stage}`}
                      >
                        上传
                      </Button>
                    </Upload>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <div className="field-note">
          已有外观只能换图，不能删除（已经被领养的不受影响）。图片要求：透明底 512×512。
        </div>
      </SectionCard>
    </RecordDrawer>
  );
}
