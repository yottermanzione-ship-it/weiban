/**
 * 角色库：官方角色的列表与人设编辑。上架前需要通过三项检查。
 * 人设内容仍由 WB-Card schema 驱动（components/card-editor），只换了外观。
 */
import { useState } from 'react';
import {
  Alert,
  Button,
  Checkbox,
  DatePicker,
  Input,
  Select,
  Space,
  Upload,
} from 'antd';
import { PlusOutlined, UploadOutlined } from '@ant-design/icons';
import dayjs from 'dayjs';
import {
  AdminCharacterWrite,
  AgeSetting,
  AvatarPattern,
  CharacterAdminEndpoints,
  CharacterBasis,
  MediaAdminEndpoints,
  RealPersonKind,
  type AdminCharacter,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { DataTable, type ProColumns } from '../ui/table.js';
import { DrawerActions, RecordDrawer } from '../ui/drawer.js';
import {
  Page,
  SectionCard,
  StatusTag,
  useDangerConfirm,
  useToast,
} from '../ui/page.js';
import { formatDateTime } from '../ui/format.js';
import { CardEditor } from '../components/card-editor.js';

const STATUS_LABELS: Record<string, string> = {
  draft: '草稿',
  pending_check: '待检测',
  published: '已上架',
  unpublished: '已下架',
  disabled: '已禁用',
};

const BASIS_LABELS: Record<string, string> = {
  real_person: '真人',
  fictional: '虚构',
  original: '原创',
};

const REAL_PERSON_LABELS: Record<string, string> = {
  celebrity: '公众人物',
  historical: '历史人物',
  private_person: '身边真人',
};

function blank(): AdminCharacterWrite {
  return {
    name: '',
    aliases: [],
    works: [],
    tagline: '',
    intro: '',
    tags: [],
    categoryId: null,
    birthday: null,
    fanName: null,
    fallbackGreetings: [],
    avatar: {
      imageMediaId: null,
      display: { supportColors: [], avatarText: null, avatarPattern: 'star', themeColor: null },
    },
    classification: {
      basis: 'original',
      realPersonKind: null,
      ageSetting: 'adult',
      childAppearance: false,
    },
    card: { cardSchemaVersion: 1, data: {} },
  };
}

function draftOf(row: AdminCharacter): AdminCharacterWrite {
  return {
    name: row.name,
    aliases: row.aliases,
    works: row.works,
    tagline: row.tagline,
    intro: row.intro,
    tags: row.tags,
    categoryId: row.categoryId,
    birthday: row.birthday,
    fanName: row.fanName,
    classification: {
      basis: row.classification.basis,
      realPersonKind: row.classification.realPersonKind,
      ageSetting: row.classification.ageSetting,
      childAppearance: row.classification.childAppearance,
    },
    avatar: { imageMediaId: row.avatar.image?.mediaId ?? null, display: row.avatar.display },
    fallbackGreetings: row.fallbackGreetings,
    card: row.card,
  };
}

export function CharactersPage() {
  const toast = useToast();
  const confirm = useDangerConfirm();
  const list = useRemote(CharacterAdminEndpoints.list);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [editing, setEditing] = useState<AdminCharacter | 'new' | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  const rows = (list.data?.items ?? []).filter(
    (row) =>
      (!status || row.status === status) &&
      (!query.trim() ||
        `${row.name} ${row.aliases.join(' ')} ${row.works.join(' ')}`.includes(query.trim())),
  );

  async function togglePublish(row: AdminCharacter) {
    const publish = row.status !== 'published';
    const run = async () => {
      setBusy(row.characterId);
      try {
        await api.call(
          publish ? CharacterAdminEndpoints.publish : CharacterAdminEndpoints.unpublish,
          { params: { characterId: row.characterId } },
        );
        toast.success(publish ? '已上架' : '已下架');
        list.refresh();
      } catch (e) {
        toast.error(errorText(e));
        list.refresh();
      } finally {
        setBusy(null);
      }
    };
    if (publish) await run();
    else
      confirm({
        title: `下架「${row.name}」？`,
        content: '下架后用户端不再显示这个角色；已经加为好友的用户不受影响。',
        okText: '下架',
        onOk: run,
      });
  }

  const columns: ProColumns<AdminCharacter>[] = [
    {
      title: '角色',
      fixed: 'left',
      width: 240,
      render: (_, row) => (
        <div className="cell-main">
          <span className="cell-title">{row.name}</span>
          <span className="cell-sub">{row.tagline || '—'}</span>
        </div>
      ),
    },
    {
      title: '状态',
      width: 100,
      render: (_, row) => (
        <StatusTag
          tone={
            row.status === 'published'
              ? 'success'
              : row.status === 'draft'
                ? 'default'
                : row.status === 'disabled'
                  ? 'error'
                  : 'warning'
          }
        >
          {STATUS_LABELS[row.status] ?? row.status}
        </StatusTag>
      ),
    },
    {
      title: '人设版本',
      width: 90,
      render: (_, row) => `v${row.personaVersion}`,
    },
    {
      title: '上架检查',
      width: 230,
      render: (_, row) => {
        const checks = [
          ['结构', row.publishChecks.requiredFieldsComplete],
          ['稳定', row.publishChecks.personaStabilityPassed],
          ['边界', row.publishChecks.hardBoundaryCasesPassed],
          ['开场白', row.publishChecks.hasFallbackGreeting],
        ] as const;
        return (
          <Space size={4} wrap>
            {checks.map(([label, pass]) => (
              <StatusTag key={label} tone={pass ? 'success' : 'default'}>
                {label}
                {pass ? ' ✓' : ' ✗'}
              </StatusTag>
            ))}
          </Space>
        );
      },
    },
    {
      title: '最近更新',
      width: 150,
      render: (_, row) => formatDateTime(row.updatedAt),
    },
    {
      title: '操作',
      width: 130,
      fixed: 'right',
      render: (_, row) => (
        <Space size={4}>
          <Button type="link" size="small" onClick={() => setEditing(row)}>
            编辑
          </Button>
          <Button
            type="link"
            size="small"
            danger={row.status === 'published'}
            loading={busy === row.characterId}
            onClick={() => void togglePublish(row)}
          >
            {row.status === 'published' ? '下架' : '上架'}
          </Button>
        </Space>
      ),
    },
  ];

  return (
    <Page
      title="角色库"
      desc="官方角色。上架前要过「必填结构 / 人设稳定 / 边界检测」三项检查；点一行编辑人设。"
      extra={
        <Space>
          <Button onClick={() => list.refresh()}>刷新</Button>
          <Button type="primary" icon={<PlusOutlined />} onClick={() => setEditing('new')}>
            新建角色
          </Button>
        </Space>
      }
    >
      <DataTable<AdminCharacter>
        rowKey="characterId"
        columns={columns}
        data={rows}
        loading={list.loading}
        error={list.error}
        onRefresh={list.refresh}
        onRowClick={(row) => setEditing(row)}
        filters={
          <>
            <Input.Search
              allowClear
              placeholder="搜索名字、别名、作品"
              style={{ width: 260 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Select
              style={{ width: 130 }}
              value={status}
              onChange={setStatus}
              options={[
                { value: '', label: '全部状态' },
                ...Object.entries(STATUS_LABELS).map(([value, label]) => ({ value, label })),
              ]}
            />
          </>
        }
        emptyTitle="还没有角色"
        emptyHint="点右上角「新建角色」，填好名字、人设和至少一条备用开场白，再上架。"
        emptyAction={
          <Button type="primary" onClick={() => setEditing('new')}>
            新建第一个角色
          </Button>
        }
      />
      {editing && (
        <CharacterDrawer
          character={editing === 'new' ? null : editing}
          onClose={() => setEditing(null)}
          onSaved={(text) => {
            toast.success(text);
            list.refresh();
          }}
        />
      )}
    </Page>
  );
}

function CharacterDrawer({
  character,
  onClose,
  onSaved,
}: {
  character: AdminCharacter | null;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  const [draft, setDraft] = useState<AdminCharacterWrite>(() =>
    character ? draftOf(character) : blank(),
  );
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState('');
  const patch = (value: Partial<AdminCharacterWrite>) =>
    setDraft((current) => ({ ...current, ...value }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      const body = AdminCharacterWrite.parse(draft);
      if (character)
        await api.call(CharacterAdminEndpoints.update, {
          params: { characterId: character.characterId },
          body,
        });
      else await api.call(CharacterAdminEndpoints.create, { body });
      onSaved('已保存。改过人设后需要重新完成检测才能上架。');
      onClose();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    setError('');
    try {
      const media = await api.call(MediaAdminEndpoints.adminUpload, {
        query: { purpose: 'character_avatar' },
        file,
      });
      patch({ avatar: { ...draft.avatar, imageMediaId: media.mediaId } });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  const listField = (
    key: 'aliases' | 'works' | 'tags' | 'fallbackGreetings',
    label: string,
    help: string,
    rows = 3,
  ) => (
    <div className="field-line">
      <span className="field-label">
        {label}
        <span className="field-label-hint">{help}</span>
      </span>
      <Input.TextArea
        autoSize={{ minRows: rows, maxRows: 8 }}
        value={draft[key].join('\n')}
        onChange={(e) => patch({ [key]: e.target.value.split('\n') })}
        onBlur={() => patch({ [key]: draft[key].filter((x) => x.trim()) })}
      />
    </div>
  );

  return (
    <RecordDrawer
      open
      onClose={onClose}
      draft={{
        key: `character:${character?.characterId ?? 'new'}`,
        value: draft,
        restore: (v: AdminCharacterWrite) => setDraft(v),
      }}
      title={character ? `编辑角色 · ${character.name}` : '新建角色'}
      subtitle="人设改动保存后需要重新检测才能上架"
      width={860}
      footer={
        <DrawerActions
          onCancel={onClose}
          onSubmit={() => void save()}
          saving={saving}
          submitText="保存"
        />
      }
    >
      {error && <Alert type="error" showIcon message={error} />}
      <SectionCard title="基本信息">
        <div className="form-two">
          <div className="field-line">
            <span className="field-label">角色名字</span>
            <Input
              maxLength={32}
              value={draft.name}
              onChange={(e) => patch({ name: e.target.value })}
            />
          </div>
          <div className="field-line">
            <span className="field-label">一句话介绍</span>
            <Input
              maxLength={60}
              value={draft.tagline}
              onChange={(e) => patch({ tagline: e.target.value })}
            />
          </div>
        </div>
        <div className="form-three">
          <div className="field-line">
            <span className="field-label">
              分类编号
              <span className="field-label-hint">角色广场里的分类</span>
            </span>
            <Input
              value={draft.categoryId ?? ''}
              onChange={(e) => patch({ categoryId: e.target.value || null })}
            />
          </div>
          <div className="field-line">
            <span className="field-label">生日</span>
            <DatePicker
              style={{ width: '100%' }}
              value={draft.birthday ? dayjs(draft.birthday) : null}
              onChange={(value) => patch({ birthday: value ? value.format('YYYY-MM-DD') : null })}
            />
          </div>
          <div className="field-line">
            <span className="field-label">粉丝称呼</span>
            <Input
              maxLength={20}
              value={draft.fanName ?? ''}
              onChange={(e) => patch({ fanName: e.target.value || null })}
            />
          </div>
        </div>
        <div className="field-line">
          <span className="field-label">详细介绍</span>
          <Input.TextArea
            autoSize={{ minRows: 3, maxRows: 8 }}
            maxLength={1000}
            showCount
            value={draft.intro}
            onChange={(e) => patch({ intro: e.target.value })}
          />
        </div>
        {listField('aliases', '别名', '每行一个')}
        {listField('works', '作品', '每行一个')}
        {listField('tags', '展示标签', '每行一个，最多 10 个')}
        {listField('fallbackGreetings', '备用开场白', '每行一条，至少一条；没配模型时用它', 2)}
      </SectionCard>

      <SectionCard title="分类事实" desc="影响能不能用成人/恋爱内容，由服务器判定">
        <div className="form-three">
          <div className="field-line">
            <span className="field-label">
              角色原型
              <span className="field-label-hint">真人角色只能用本人公开形象</span>
            </span>
            <Select
              style={{ width: '100%' }}
              value={draft.classification.basis}
              onChange={(value) => {
                const basis = CharacterBasis.parse(value);
                patch({
                  classification: {
                    ...draft.classification,
                    basis,
                    realPersonKind: basis === 'real_person' ? 'celebrity' : null,
                  },
                });
              }}
              options={CharacterBasis.options.map((value) => ({
                value,
                label: BASIS_LABELS[value] ?? value,
              }))}
            />
          </div>
          {draft.classification.basis === 'real_person' && (
            <div className="field-line">
              <span className="field-label">真人类型</span>
              <Select
                style={{ width: '100%' }}
                value={draft.classification.realPersonKind ?? 'celebrity'}
                onChange={(value) =>
                  patch({
                    classification: {
                      ...draft.classification,
                      realPersonKind: RealPersonKind.parse(value),
                    },
                  })
                }
                options={RealPersonKind.options.map((value) => ({
                  value,
                  label: REAL_PERSON_LABELS[value] ?? value,
                }))}
              />
            </div>
          )}
          <div className="field-line">
            <span className="field-label">年龄设定</span>
            <Select
              style={{ width: '100%' }}
              value={draft.classification.ageSetting}
              onChange={(value) =>
                patch({
                  classification: {
                    ...draft.classification,
                    ageSetting: AgeSetting.parse(value),
                  },
                })
              }
              options={[
                { value: 'adult', label: '成年' },
                { value: 'minor', label: '未成年' },
              ]}
            />
          </div>
        </div>
        <Checkbox
          checked={draft.classification.childAppearance}
          onChange={(e) =>
            patch({
              classification: { ...draft.classification, childAppearance: e.target.checked },
            })
          }
        >
          儿童外观
        </Checkbox>
      </SectionCard>

      <SectionCard title="头像">
        <div className="avatar-row">
          <div
            className="avatar-preview"
            style={{ background: draft.avatar.display.themeColor ?? '#07C160' }}
          >
            {draft.avatar.display.avatarText || draft.name.slice(0, 1) || '伴'}
          </div>
          <div className="avatar-actions">
            <Space>
              <Upload
                accept="image/jpeg,image/png,image/webp,image/gif"
                showUploadList={false}
                beforeUpload={(file) => {
                  void uploadAvatar(file);
                  return false;
                }}
              >
                <Button icon={<UploadOutlined />} loading={uploading}>
                  上传角色图片
                </Button>
              </Upload>
              <Button
                disabled={!draft.avatar.imageMediaId}
                onClick={() =>
                  patch({ avatar: { ...draft.avatar, imageMediaId: null } })
                }
              >
                使用默认头像
              </Button>
            </Space>
            <div className="field-help">
              {draft.avatar.imageMediaId
                ? '已设置角色图片，保存后生效。'
                : '当前使用默认头像（文字 + 图案 + 主题色）。'}
            </div>
          </div>
        </div>
        <div className="form-three">
          <div className="field-line">
            <span className="field-label">头像字</span>
            <Input
              maxLength={2}
              value={draft.avatar.display.avatarText ?? ''}
              onChange={(e) =>
                patch({
                  avatar: {
                    ...draft.avatar,
                    display: { ...draft.avatar.display, avatarText: e.target.value || null },
                  },
                })
              }
            />
          </div>
          <div className="field-line">
            <span className="field-label">头像图案</span>
            <Select
              style={{ width: '100%' }}
              value={draft.avatar.display.avatarPattern}
              onChange={(value) =>
                patch({
                  avatar: {
                    ...draft.avatar,
                    display: {
                      ...draft.avatar.display,
                      avatarPattern: AvatarPattern.parse(value),
                    },
                  },
                })
              }
              options={AvatarPattern.options.map((value) => ({ value, label: value }))}
            />
          </div>
          <div className="field-line">
            <span className="field-label">主题色</span>
            <Input
              type="color"
              value={draft.avatar.display.themeColor ?? '#07c160'}
              onChange={(e) =>
                patch({
                  avatar: {
                    ...draft.avatar,
                    display: { ...draft.avatar.display, themeColor: e.target.value },
                  },
                })
              }
            />
          </div>
        </div>
      </SectionCard>

      <SectionCard title="人设卡" desc="内容很多，按板块填；只有必填项完整才能上架">
        <CardEditor card={draft.card} onChange={(card) => patch({ card })} />
      </SectionCard>
      <div className="detail-muted">
        上架前系统会自动检查：必填结构、人设稳定、边界检测、备用开场白。
      </div>
    </RecordDrawer>
  );
}
