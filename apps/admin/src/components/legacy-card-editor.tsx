/**
 * 旧卡（legacy_card）编辑器。
 *
 * 旧卡就是运行格式：这里只编辑 `legacy_card` 里的旧字段与两张附属表（世界书 / 示例），
 * 不渲染也不保存 WB-Card，不产生新卡密文；未识别的旧字段只读保留，保存时不覆盖。
 * 分类与上架状态不在这里改（资格标注走既有独立接口），保存按 revision 冲突保护。
 */
import { useCallback, useEffect, useState } from 'react';
import {
  Alert,
  Button,
  Collapse,
  Dropdown,
  Input,
  InputNumber,
  Modal,
  Popconfirm,
  Space,
  Switch,
  Upload,
} from 'antd';
import { UploadOutlined } from '@ant-design/icons';
import {
  AdminLegacyCharacterPatch,
  CharacterAdminEndpoints,
  MediaAdminEndpoints,
  type AdminLegacyCharacterDetail,
  type AdminLegacyClearableField,
  type AdminLegacyFields,
  type AdminCharacter,
  legacyDialogueExamples,
  legacyKnowledgeEntries,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { api } from '../data/client.js';
import { errorText } from '../data/hooks.js';
import { adminMediaUrl } from '../data/media-url.js';
import { FieldHelp, SectionCard } from '../ui/page.js';
import { RecordDrawer } from '../ui/drawer.js';
import { formatDateTime } from '../ui/format.js';
import { EligibilityCard } from '../features/character-eligibility.js';
import { PersonaTextEditor } from './persona-text-editor.js';
import { CharacterVoicePanel } from './character-voice-panel.js';
import { CharacterWeiboEditor } from './character-weibo-editor.js';
import { InteractionProfileEditor } from './interaction-profile-editor.js';
import { PersonaCardPreview } from './persona-card-preview.js';
import './legacy-card-editor.css';

type LoreRow = {
  id: string;
  created: boolean;
  deleted: boolean;
  payload: Record<string, unknown>;
};
type ExampleRow = LoreRow & { sortOrder: number };

const LORE_NEW: Record<string, unknown> = {
  title: '',
  trigger_keys_json: '[]',
  content: '',
  priority: 0,
  constant: false,
  enabled: true,
};
const EXAMPLE_NEW: Record<string, unknown> = {
  scene: '',
  user_text: '',
  assistant_text: '',
};

function textOf(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

function keysOf(value: unknown): string[] {
  if (Array.isArray(value)) return value.map((item) => textOf(item)).filter(Boolean);
  const text = textOf(value).trim();
  if (!text) return [];
  try {
    const parsed: unknown = JSON.parse(text);
    return Array.isArray(parsed) ? parsed.map((item) => textOf(item)).filter(Boolean) : [];
  } catch {
    return text
      .split(/[,，、\n]/u)
      .map((item) => item.trim())
      .filter(Boolean);
  }
}

function jsonText(value: unknown): string {
  if (value === null || value === undefined) return '';
  return JSON.stringify(value, null, 2);
}

/** JSON 文本框里的错误单独区分，直接显示给管理员（不套用接口错误文案）。 */
class JsonFieldError extends Error {}

/** 统一 JSON 文本解析：空 = 没有；非法 JSON 报错（不静默丢掉用户输入）。 */
function parseJsonField(value: string, label: string): unknown | null {
  const text = value.trim();
  if (!text) return null;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    throw new JsonFieldError(`${label}不是合法 JSON`);
  }
}

function preview(value: unknown, limit = 4000): string {
  const text = typeof value === 'string' ? value : JSON.stringify(value, null, 2);
  return text.length > limit
    ? `${text.slice(0, limit)}\n…（共 ${text.length} 字，已截断显示）`
    : text;
}

type PersonaPreviewCharacter = Partial<
  Pick<AdminCharacter, 'classification' | 'tags' | 'works' | 'birthday'>
>;

export function LegacyCharacterEditor({
  characterId,
  onSaved,
  character,
}: {
  characterId: string;
  onSaved?: (text: string) => void;
  /** 角色库主表字段（分类、标签、出处、生日），只给人设卡预览用。 */
  character?: PersonaPreviewCharacter;
}) {
  const [activeTab, setActiveTab] = useState('profile');
  const [detail, setDetail] = useState<AdminLegacyCharacterDetail | null>(null);
  const [fields, setFields] = useState<AdminLegacyFields | null>(null);
  const [aliasText, setAliasText] = useState('');
  const [openingText, setOpeningText] = useState('');
  const [momentText, setMomentText] = useState('');
  const [groupText, setGroupText] = useState('');
  const [lorebook, setLorebook] = useState<LoreRow[]>([]);
  const [examples, setExamples] = useState<ExampleRow[]>([]);
  const [avatar, setAvatar] = useState<{ mediaId: string | null; url: string | null }>({
    mediaId: null,
    url: null,
  });
  const [note, setNote] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [revisionBusy, setRevisionBusy] = useState<number | null>(null);
  const [error, setError] = useState('');
  const [notice, setNotice] = useState('');
  const [conflict, setConflict] = useState(false);
  const [brokenAvatar, setBrokenAvatar] = useState(false);

  const adopt = useCallback((value: AdminLegacyCharacterDetail) => {
    setDetail(value);
    setFields(value.fields);
    setAliasText(value.fields.aliases.join('\n'));
    setOpeningText(value.fields.openingMessages.join('\n'));
    setMomentText(jsonText(value.fields.momentProfile));
    setGroupText(jsonText(value.fields.groupChat));
    setLorebook(
      value.lorebook.map((entry) => ({
        id: entry.id,
        created: false,
        deleted: false,
        payload: entry.payload,
      })),
    );
    setExamples(
      value.examples.map((entry) => ({
        id: entry.id,
        created: false,
        deleted: false,
        sortOrder: entry.sortOrder,
        payload: entry.payload,
      })),
    );
    setAvatar({
      mediaId: value.avatar.image?.mediaId ?? null,
      url: value.avatar.image ? adminMediaUrl(value.avatar.image.url) : null,
    });
    setBrokenAvatar(false);
    setNote('');
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    setError('');
    setConflict(false);
    try {
      const value = await api.call(CharacterAdminEndpoints.legacyDetail, {
        params: { characterId },
      });
      adopt(value);
    } catch (e) {
      setError(errorText(e));
    } finally {
      setLoading(false);
    }
  }, [adopt, characterId]);

  useEffect(() => {
    void load();
  }, [load]);

  function patchFields(value: Partial<AdminLegacyFields>) {
    setFields((current) => (current ? { ...current, ...value } : current));
    setNotice('');
  }

  function updateLore(index: number, value: Record<string, unknown>) {
    setLorebook((current) =>
      current.map((row, i) =>
        i === index ? { ...row, payload: { ...row.payload, ...value } } : row,
      ),
    );
    setNotice('');
  }

  function updateExample(index: number, value: Partial<Record<string, unknown>>) {
    setExamples((current) =>
      current.map((row, i) => {
        if (i !== index) return row;
        const payload = { ...row.payload, ...value };
        const sortOrder = typeof value.sort_order === 'number' ? value.sort_order : row.sortOrder;
        return { ...row, payload, sortOrder };
      }),
    );
    setNotice('');
  }

  async function uploadAvatar(file: File) {
    setUploading(true);
    setError('');
    try {
      const media = await api.call(MediaAdminEndpoints.adminUpload, {
        query: { purpose: 'character_avatar' },
        file,
      });
      setAvatar({ mediaId: media.mediaId, url: adminMediaUrl(media.url) });
      setBrokenAvatar(false);
      setNotice('新头像已选择，点保存后生效。');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setUploading(false);
    }
  }

  /** 把表单里真正改动过的内容变成局部保存请求（未提交字段不带、明确清空进 clear）。 */
  function buildPatch(): AdminLegacyCharacterPatch {
    if (!detail || !fields) throw new Error('旧卡详情还没读完');
    const original = detail.fields;
    const patch: Record<string, unknown> = {};
    const clear: AdminLegacyClearableField[] = [];
    if (fields.displayName !== original.displayName) patch.displayName = fields.displayName;
    if (fields.corePersona !== original.corePersona) patch.corePersona = fields.corePersona;
    for (const key of ['nickname', 'signature', 'speakingStyle', 'relationshipMode'] as const) {
      const next = fields[key];
      if (next === original[key]) continue;
      if (!next.trim()) clear.push(key);
      else patch[key] = next;
    }
    const aliases = aliasText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (JSON.stringify(aliases) !== JSON.stringify(original.aliases)) {
      if (aliases.length) patch.aliases = aliases;
      else clear.push('aliases');
    }
    const openings = openingText
      .split('\n')
      .map((item) => item.trim())
      .filter(Boolean);
    if (JSON.stringify(openings) !== JSON.stringify(original.openingMessages)) {
      if (openings.length) patch.openingMessages = openings;
      else clear.push('openingMessages');
    }
    const moment = parseJsonField(momentText, '朋友圈设定');
    if (JSON.stringify(moment) !== JSON.stringify(original.momentProfile)) {
      if (moment === null) clear.push('momentProfile');
      else patch.momentProfile = moment;
    }
    const group = parseJsonField(groupText, '群聊设定');
    if (JSON.stringify(group) !== JSON.stringify(original.groupChat)) {
      if (group === null) clear.push('groupChat');
      else patch.groupChat = group;
    }

    if (JSON.stringify(fields.weibo) !== JSON.stringify(original.weibo)) patch.weibo = fields.weibo;

    const originalLore = new Map(detail.lorebook.map((entry) => [entry.id, entry.payload]));
    const loreUpsert: Array<{ id?: string; payload: Record<string, unknown> }> = [];
    const loreDelete: string[] = [];
    for (const row of lorebook) {
      if (row.deleted) {
        if (!row.created) loreDelete.push(row.id);
        continue;
      }
      if (row.created) {
        loreUpsert.push({ payload: row.payload });
        continue;
      }
      if (JSON.stringify(row.payload) !== JSON.stringify(originalLore.get(row.id)))
        loreUpsert.push({ id: row.id, payload: row.payload });
    }

    const originalExamples = new Map(
      detail.examples.map((entry) => [
        entry.id,
        { payload: entry.payload, sortOrder: entry.sortOrder },
      ]),
    );
    const exampleUpsert: Array<{
      id?: string;
      payload: Record<string, unknown>;
      sortOrder?: number;
    }> = [];
    const exampleDelete: string[] = [];
    for (const row of examples) {
      if (row.deleted) {
        if (!row.created) exampleDelete.push(row.id);
        continue;
      }
      const before = originalExamples.get(row.id);
      if (row.created) {
        exampleUpsert.push({ payload: row.payload, sortOrder: row.sortOrder });
        continue;
      }
      if (
        !before ||
        row.sortOrder !== before.sortOrder ||
        JSON.stringify(row.payload) !== JSON.stringify(before.payload)
      )
        exampleUpsert.push({ id: row.id, payload: row.payload, sortOrder: row.sortOrder });
    }

    return AdminLegacyCharacterPatch.parse({
      expectedRevision: detail.revision,
      fields: Object.keys(patch).length ? patch : undefined,
      clear: clear.length ? clear : undefined,
      lorebook:
        loreUpsert.length || loreDelete.length
          ? {
              upsert: loreUpsert.length ? loreUpsert : undefined,
              delete: loreDelete.length ? loreDelete : undefined,
            }
          : undefined,
      examples:
        exampleUpsert.length || exampleDelete.length
          ? {
              upsert: exampleUpsert.length ? exampleUpsert : undefined,
              delete: exampleDelete.length ? exampleDelete : undefined,
            }
          : undefined,
      avatarMediaId:
        avatar.mediaId !== (detail.avatar.image?.mediaId ?? null) ? avatar.mediaId : undefined,
      note: note.trim() || undefined,
    });
  }

  async function save() {
    setSaving(true);
    setError('');
    setNotice('');
    setConflict(false);
    try {
      const body = buildPatch();
      const updated = await api.call(CharacterAdminEndpoints.legacyUpdate, {
        params: { characterId },
        body,
      });
      adopt(updated);
      setNotice(`已保存（版本 v${updated.revision}），用户端与 AI 会按新内容读取。`);
      onSaved?.('已保存角色资料');
    } catch (e) {
      if (e instanceof JsonFieldError) setError(e.message);
      else if (e instanceof ApiFailure && e.status === 409) {
        setConflict(true);
        setError(e.message);
      } else {
        setError(errorText(e));
      }
    } finally {
      setSaving(false);
    }
  }

  /** 查看某一版快照的完整内容（只读；不含签名 URL）。 */
  async function viewRevision(revision: number) {
    setRevisionBusy(revision);
    setError('');
    try {
      const snapshot = await api.call(CharacterAdminEndpoints.legacyRevision, {
        params: { characterId, revision },
      });
      Modal.info({
        title: `v${revision} 的内容（${snapshot.operatorName || '后台'}）`,
        width: 720,
        okText: '关闭',
        content: (
          <div className="legacy-snapshot">
            <div>名字：{snapshot.name}</div>
            <div>别名：{snapshot.aliases.join('、') || '无'}</div>
            <div>核心人设：{snapshot.fields.corePersona.slice(0, 300)}</div>
            <div>说话风格：{snapshot.fields.speakingStyle.slice(0, 200) || '无'}</div>
            <div>
              世界书 {snapshot.lorebook.length} 条 · 对话示例 {snapshot.examples.length} 条 · 头像：
              {snapshot.avatar.mediaId ? '已设置图片' : '文字头像'}
            </div>
            {snapshot.note && <div>备注：{snapshot.note}</div>}
          </div>
        ),
      });
    } catch (e) {
      setError(errorText(e));
    } finally {
      setRevisionBusy(null);
    }
  }

  /** 恢复某一版：二次确认 + expectedRevision，服务端会写新 revision 并另存恢复前快照。 */
  function confirmRestore(revision: number) {
    if (!detail) return;
    Modal.confirm({
      title: `恢复到 v${revision}？`,
      width: 560,
      okText: '确认恢复',
      cancelText: '取消',
      content: (
        <div className="legacy-snapshot">
          <p>
            当前版本是 v{detail.revision}，恢复后会写成新版本 v{detail.revision + 1}
            ，并在恢复前把当前内容 另存一份快照。
          </p>
          <p>
            只还原角色资料：人设、说话风格、关系 / 朋友圈 / 群聊、开场白、头像、世界书与对话示例。
            不改上架状态、资格标注、角色 ID、联系人和消息。
          </p>
        </div>
      ),
      onOk: async () => {
        setSaving(true);
        setError('');
        setNotice('');
        setConflict(false);
        try {
          const updated = await api.call(CharacterAdminEndpoints.legacyRestore, {
            params: { characterId },
            body: { revision, expectedRevision: detail.revision, confirm: true },
          });
          adopt(updated);
          setNotice(`已恢复到 v${revision}，当前版本 v${updated.revision}。`);
          onSaved?.(`已恢复角色资料到 v${revision}`);
        } catch (e) {
          if (e instanceof ApiFailure && e.status === 409) {
            setConflict(true);
            setError(e.message);
          } else {
            setError(errorText(e));
          }
        } finally {
          setSaving(false);
        }
      },
    });
  }

  if (loading)
    return (
      <div className="legacy-editor-loading">
        <span>正在读取角色资料…</span>
      </div>
    );
  if (!detail || !fields)
    return <Alert type="error" showIcon message={error || '没有读到角色资料'} />;

  const avatarText = detail.name.slice(0, 1) || '伴';
  return (
    <div className="legacy-editor">
      {error && (
        <Alert
          type="error"
          showIcon
          message={error}
          action={
            conflict ? (
              <Button size="small" onClick={() => void load()}>
                读取最新内容
              </Button>
            ) : undefined
          }
        />
      )}
      {notice && <Alert type="success" showIcon message={notice} />}

      <nav className="legacy-section-nav" aria-label="角色资料分区">
        {[
          ['profile', '角色管理首页'],
          ['persona', '人设正文'],
        ].map(([key, label]) => (
          <Button
            key={key}
            type={activeTab === key ? 'primary' : 'default'}
            aria-pressed={activeTab === key}
            onClick={() => setActiveTab(key!)}
          >
            {label}
          </Button>
        ))}
        <Dropdown
          trigger={['click']}
          menu={{
            items: [
              { key: 'preview', label: '人设卡预览' },
              { key: 'records', label: '版本记录与来源存档' },
            ],
            onClick: ({ key }) => setActiveTab(key),
          }}
        >
          <Button className="legacy-more-button" aria-label="更多角色操作">
            更多
          </Button>
        </Dropdown>
      </nav>

      <section className="legacy-tab-panel" hidden={activeTab !== 'profile'}>
        <div className="legacy-home-grid">
          <div className="legacy-home-column">
            <SectionCard title="头像与基本资料">
              <div className="legacy-avatar-row">
                <div className="legacy-avatar">
                  {avatar.url && !brokenAvatar ? (
                    <img
                      src={avatar.url}
                      alt={`${detail.name}头像`}
                      onError={() => setBrokenAvatar(true)}
                    />
                  ) : (
                    <span className="legacy-avatar-fallback">{avatarText}</span>
                  )}
                </div>
                <div className="legacy-avatar-actions">
                  <Space wrap>
                    <Upload
                      accept="image/jpeg,image/png,image/webp"
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
                      disabled={!avatar.mediaId}
                      onClick={() => setAvatar({ mediaId: null, url: null })}
                    >
                      恢复默认头像
                    </Button>
                  </Space>
                  <FieldHelp>
                    {avatar.mediaId
                      ? '已设置角色图片，点保存后生效。'
                      : '当前使用默认文字头像（名字首字）。'}
                  </FieldHelp>
                </div>
              </div>
              <div className="legacy-two">
                <label className="field-line">
                  <span className="field-label">角色名字</span>
                  <Input
                    value={fields.displayName}
                    maxLength={32}
                    onChange={(e) => patchFields({ displayName: e.target.value })}
                  />
                </label>
                <label className="field-line">
                  <span className="field-label">
                    昵称
                    <span className="field-label-hint">留空 = 清空</span>
                  </span>
                  <Input
                    value={fields.nickname}
                    maxLength={32}
                    onChange={(e) => patchFields({ nickname: e.target.value })}
                  />
                </label>
              </div>
              <label className="field-line">
                <span className="field-label">签名</span>
                <Input
                  value={fields.signature}
                  maxLength={200}
                  onChange={(e) => patchFields({ signature: e.target.value })}
                />
              </label>
              <label className="field-line">
                <span className="field-label">
                  别名
                  <span className="field-label-hint">每行一个，用于搜索和称呼</span>
                </span>
                <Input.TextArea
                  autoSize={{ minRows: 1 }}
                  value={aliasText}
                  onChange={(e) => setAliasText(e.target.value)}
                />
              </label>
            </SectionCard>
            <EligibilityCard characterId={characterId} />
          </div>
          <div className="legacy-home-column">
            <CharacterVoicePanel characterId={characterId} />
            <CharacterWeiboEditor
              value={fields.weibo}
              onChange={(weibo) => patchFields({ weibo })}
            />
          </div>
        </div>
      </section>
      <section
        className="legacy-tab-panel legacy-persona-document"
        hidden={activeTab !== 'persona'}
      >
        <SectionCard
          title="人物与性格"
          desc="当前实际生效的人物文本；完整原文与中文分段编辑是同一份内容"
        >
          <PersonaTextEditor
            label="核心人设"
            required
            value={fields.corePersona}
            onChange={(value) => patchFields({ corePersona: value })}
          />
        </SectionCard>
        <SectionCard title="说话方式" desc="语气、句式、回复长度、表达习惯，不混入声音模型配置">
          <PersonaTextEditor
            label="说话风格"
            value={fields.speakingStyle}
            onChange={(value) => patchFields({ speakingStyle: value })}
          />
        </SectionCard>
        <SectionCard
          title="人设引擎 · 场景态度"
          desc="日常、亲近、冷淡、调侃、安慰和拒绝时的态度；按当前文本中的中文标签分段"
        >
          <PersonaTextEditor
            label="关系与场景态度"
            value={fields.relationshipMode}
            onChange={(value) => patchFields({ relationshipMode: value })}
          />
          <FieldHelp>
            这些是给模型参考的人物写作要求，不是另外一套资格门禁；保存后进入后续回复上下文。
          </FieldHelp>
        </SectionCard>
      </section>
      <section
        className="legacy-tab-panel legacy-persona-document"
        hidden={activeTab !== 'persona'}
      >
        <SectionCard title="朋友圈风格" desc="人物在朋友圈的语气、主题和评论习惯">
          <InteractionProfileEditor kind="moments" value={momentText} onChange={setMomentText} />
        </SectionCard>
        <SectionCard
          title="群聊风格与开场白"
          desc="人物在群里的说话方式；备用开场白不作为每轮聊天限制"
        >
          <InteractionProfileEditor kind="group" value={groupText} onChange={setGroupText} />
          <label className="field-line">
            <span className="field-label">
              备用开场白
              <span className="field-label-hint">每行一条，最多 10 条</span>
            </span>
            <Input.TextArea
              autoSize={{ minRows: 1 }}
              value={openingText}
              onChange={(e) => setOpeningText(e.target.value)}
            />
          </label>
        </SectionCard>
      </section>
      <section
        className="legacy-tab-panel legacy-persona-document"
        hidden={activeTab !== 'persona'}
      >
        <SectionCard
          title={`背景与触发词条（${lorebook.filter((row) => !row.deleted).length} 条）`}
          desc="只在对话提到触发词或常驻时进入提示词；保存只动本角色改动过的条目"
          extra={
            <Button
              size="small"
              onClick={() =>
                setLorebook((current) => [
                  ...current,
                  {
                    id: `new-${current.length + 1}`,
                    created: true,
                    deleted: false,
                    payload: { ...LORE_NEW },
                  },
                ])
              }
            >
              添加条目
            </Button>
          }
        >
          {lorebook.filter((row) => !row.deleted).length === 0 && (
            <div className="detail-muted">这张卡还没有世界书条目。</div>
          )}
          <div className="legacy-entries">
            {lorebook.map((row, index) =>
              row.deleted ? null : (
                <div className="legacy-entry" key={row.id}>
                  <div className="legacy-entry-head">
                    <Input
                      className="legacy-entry-title"
                      variant="borderless"
                      aria-label={`词条标题 ${index + 1}`}
                      value={textOf(row.payload.title)}
                      placeholder="词条小标题"
                      onChange={(e) => updateLore(index, { title: e.target.value })}
                    />
                    <Popconfirm
                      title="删除这条世界书？保存后生效"
                      onConfirm={() =>
                        setLorebook((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, deleted: true } : item,
                          ),
                        )
                      }
                    >
                      <Button danger size="small">
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                  <label className="field-line legacy-entry-body">
                    <Input.TextArea
                      aria-label={`词条正文 ${index + 1}`}
                      autoSize={{ minRows: 1 }}
                      value={textOf(row.payload.content)}
                      onChange={(e) => updateLore(index, { content: e.target.value })}
                    />
                  </label>
                  <details className="legacy-entry-options">
                    <summary>
                      {Boolean(
                        row.payload.constant ?? row.payload.is_constant ?? row.payload.always,
                      )
                        ? '常驻词条'
                        : `触发：${keysOf(row.payload.trigger_keys_json).join('、') || '尚未设置'}`}{' '}
                      · 设置
                    </summary>
                    <label className="field-line">
                      <span className="field-label">
                        触发词
                        <span className="field-label-hint">每行一个；留空表示只能常驻</span>
                      </span>
                      <Input.TextArea
                        autoSize={{ minRows: 1, maxRows: 4 }}
                        value={keysOf(row.payload.trigger_keys_json).join('\n')}
                        onChange={(e) =>
                          updateLore(index, {
                            trigger_keys_json: JSON.stringify(
                              e.target.value
                                .split('\n')
                                .map((item) => item.trim())
                                .filter(Boolean),
                            ),
                          })
                        }
                      />
                    </label>
                    <Space size={16} wrap>
                      <span className="legacy-inline">
                        优先级
                        <InputNumber
                          min={0}
                          max={1000}
                          value={
                            typeof row.payload.priority === 'number' ? row.payload.priority : 0
                          }
                          onChange={(value) => updateLore(index, { priority: value ?? 0 })}
                        />
                      </span>
                      <span className="legacy-inline">
                        常驻
                        <Switch
                          size="small"
                          checked={Boolean(
                            row.payload.constant ?? row.payload.is_constant ?? row.payload.always,
                          )}
                          onChange={(checked) => updateLore(index, { constant: checked })}
                        />
                      </span>
                      <span className="legacy-inline">
                        启用
                        <Switch
                          size="small"
                          checked={row.payload.enabled !== false}
                          onChange={(checked) => updateLore(index, { enabled: checked })}
                        />
                      </span>
                    </Space>
                  </details>
                </div>
              ),
            )}
          </div>
        </SectionCard>

        <SectionCard
          title={`对话示例（${examples.filter((row) => !row.deleted).length} 条）`}
          desc="只学语气与长短；保存只动本角色改动过的条目"
          extra={
            <Button
              size="small"
              onClick={() =>
                setExamples((current) => [
                  ...current,
                  {
                    id: `new-${current.length + 1}`,
                    created: true,
                    deleted: false,
                    sortOrder: current.filter((row) => !row.deleted).length,
                    payload: { ...EXAMPLE_NEW },
                  },
                ])
              }
            >
              添加示例
            </Button>
          }
        >
          <div className="legacy-entries">
            {examples.map((row, index) =>
              row.deleted ? null : (
                <div className="legacy-entry" key={row.id}>
                  <div className="legacy-entry-head">
                    <Input
                      className="legacy-entry-title"
                      variant="borderless"
                      aria-label={`示例场景 ${index + 1}`}
                      value={textOf(row.payload.scene)}
                      placeholder="示例场景"
                      onChange={(e) => updateExample(index, { scene: e.target.value })}
                    />
                    <span className="legacy-inline">
                      排序
                      <InputNumber
                        min={0}
                        max={99999}
                        value={row.sortOrder}
                        onChange={(value) => updateExample(index, { sort_order: value ?? 0 })}
                      />
                    </span>
                    <Popconfirm
                      title="删除这条示例？保存后生效"
                      onConfirm={() =>
                        setExamples((current) =>
                          current.map((item, i) =>
                            i === index ? { ...item, deleted: true } : item,
                          ),
                        )
                      }
                    >
                      <Button danger size="small">
                        删除
                      </Button>
                    </Popconfirm>
                  </div>
                  <div className="legacy-dialogue">
                    <label className="field-line">
                      <span className="field-label">对方说</span>
                      <Input.TextArea
                        autoSize={{ minRows: 1 }}
                        value={textOf(row.payload.user_text)}
                        onChange={(e) => updateExample(index, { user_text: e.target.value })}
                      />
                    </label>
                    <label className="field-line">
                      <span className="field-label">角色说</span>
                      <Input.TextArea
                        autoSize={{ minRows: 1 }}
                        value={textOf(row.payload.assistant_text)}
                        onChange={(e) => updateExample(index, { assistant_text: e.target.value })}
                      />
                    </label>
                  </div>
                </div>
              ),
            )}
          </div>
        </SectionCard>
      </section>
      <section className="legacy-tab-panel" hidden={activeTab !== 'preview'}>
        {activeTab === 'preview' && (
          <SectionCard
            title="人设卡预览"
            desc="按当前表单内容（含未保存的改动）预览；用户端人设卡与这里用同一份板块配置"
          >
            <PersonaCardPreview
              source={{
                kind: 'legacy',
                data: {
                  name: fields.displayName,
                  avatarUrl: brokenAvatar ? null : avatar.url,
                  signature: fields.signature,
                  aliases: aliasText
                    .split('\n')
                    .map((item) => item.trim())
                    .filter(Boolean),
                  corePersona: fields.corePersona,
                  speakingStyle: fields.speakingStyle,
                  relationshipMode: fields.relationshipMode,
                  lorebook: legacyKnowledgeEntries(
                    lorebook
                      .filter((row) => !row.deleted)
                      .map((row) => ({ ...row.payload, id: row.id })),
                  ),
                  examples: legacyDialogueExamples(
                    examples
                      .filter((row) => !row.deleted)
                      .map((row) => ({ ...row.payload, id: row.id, sort_order: row.sortOrder })),
                  ),
                  momentProfile: momentText.trim() || null,
                  groupChat: groupText.trim() || null,
                  classification: character?.classification ?? null,
                  tags: character?.tags ?? [],
                  works: character?.works ?? [],
                  birthday: character?.birthday ?? null,
                },
              }}
            />
          </SectionCard>
        )}
      </section>
      <section className="legacy-tab-panel" hidden={activeTab !== 'records'}>
        <SectionCard
          title={`原始资料存档（${Object.keys(detail.preserved).length} 项）`}
          desc="仅供核对来源；保存时完整保留。存档字段不代表全部被当前聊天读取，人设文本分区展示的才是当前有效文字"
        >
          <Collapse
            size="small"
            items={Object.entries(detail.preserved)
              .sort(([a], [b]) =>
                a === 'raw_json' ? 1 : b === 'raw_json' ? -1 : a.localeCompare(b),
              )
              .map(([key, value]) => ({
                key,
                label: key,
                children: <pre className="legacy-json">{preview(value)}</pre>,
              }))}
          />
        </SectionCard>

        <SectionCard
          title={`版本历史（${detail.history.length} 条）`}
          desc="每次保存 / 恢复前都会留一份完整快照（不经审计脱敏）；可以查看内容，或恢复到某一版"
        >
          {detail.history.length === 0 ? (
            <div className="detail-muted">还没有版本快照；第一次保存后就会留下。</div>
          ) : (
            <Collapse
              size="small"
              items={detail.history.map((entry) => ({
                key: String(entry.revision),
                label: `v${entry.revision} · ${formatDateTime(entry.at)} · ${
                  entry.operatorName || '后台'
                } · ${entry.source === 'restore' ? '恢复前留存' : '保存前留存'} · ${
                  entry.changedFields.join('、') || '未记录字段'
                }`,
                children: (
                  <>
                    <div className="detail-muted">
                      {entry.name}
                      {entry.note ? ` · 备注：${entry.note}` : ''}
                    </div>
                    <Space wrap>
                      <Button
                        size="small"
                        disabled={revisionBusy !== null}
                        onClick={() => void viewRevision(entry.revision)}
                      >
                        查看内容
                      </Button>
                      <Button
                        size="small"
                        danger
                        disabled={saving || revisionBusy !== null}
                        onClick={() => confirmRestore(entry.revision)}
                      >
                        恢复到此版本
                      </Button>
                    </Space>
                  </>
                ),
              }))}
            />
          )}
        </SectionCard>
      </section>

      <div className="legacy-save-bar">
        <Input
          className="legacy-note"
          placeholder="这次修改说明（可选，写进修改记录）"
          maxLength={200}
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存角色资料
        </Button>
      </div>
    </div>
  );
}

/** 旧卡编辑抽屉：列表里的旧卡角色从这里进入，不经过 WB-Card 编辑器。 */
export function LegacyCharacterDrawer({
  character,
  onClose,
  onSaved,
}: {
  character: { characterId: string; name: string } & PersonaPreviewCharacter;
  onClose: () => void;
  onSaved: (text: string) => void;
}) {
  return (
    <RecordDrawer
      open
      onClose={onClose}
      title={`角色资料 · ${character.name}`}
      subtitle="首页管理头像、昵称、声线、微博与资格；人设正文集中编辑角色细节"
      width={1120}
    >
      <LegacyCharacterEditor
        characterId={character.characterId}
        onSaved={onSaved}
        character={character}
      />
    </RecordDrawer>
  );
}
