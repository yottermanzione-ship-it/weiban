/*
 * 自建角色创建 / 编辑页（2026-10-27 批 U3：资料卡 + 二级编辑页，26 号 §3.2）。
 * - 首屏：大头像（点了直接弹拍照 / 从相册选择）、名字、角色分类、年龄设定、标签；
 * - 其余按 persona-sections.ts 的板块分组成白色行，行右侧是摘要（已写 N 字、N 条、N 组…），点进整页编辑器；
 * - 必填不用星号：没填完底部「创建角色」灰色，没填的行右侧灰字「未填写」；
 * - 二级页面挂在地址参数 ?edit=子板块编号 上：安卓返回键 / 浏览器后退只关掉这一层（等同取消）。
 * 行的分组、顺序、编辑器类型都由配置决定；加字段见 docs/handoffs/2026-10-27-ui-u3.md。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ImporterEndpoints,
  MediaEndpoints,
  UserCustomEndpoints,
  type AgeSetting,
  type CharacterBasis,
  type ImportResult,
  type RealPersonKind,
  UserCustomTrialWrite,
} from '@weiban/contracts';
import { ImportEntryRow } from './import.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { useAuth } from '../app/auth.js';
import { CharacterTrial } from './character-trial.js';
import { AvatarEditor } from './avatar-editor.js';
import { CharacterVoicePage, useVoiceLibrary, voiceLabel } from './character-voice-select.js';
import { FieldPage } from './edit-page.js';
import { OldIcon } from './old-icons.js';
import {
  AGE_OPTIONS,
  BASIS_OPTIONS,
  REAL_KIND_OPTIONS,
  createSections,
  dialogueGroups,
  findSubsection,
  type PersonaDraft,
  type PersonaSubsection,
} from './persona-sections.js';
import { AgePage, BasisPage, DialoguePage, ListPage, LongTextPage } from './persona-editors.js';
import { MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { showToast } from './toast.js';
import { DatePickerSheet } from './wheel-picker.js';

export function CreateCustomCharacterPage() {
  const [params] = useSearchParams();
  const importJobId = params.get('import');
  return (
    <CustomCharacterEditor
      key={importJobId ?? params.get('candidateName') ?? 'new'}
      mode="create"
      importJobId={importJobId}
      candidate={{
        name: (params.get('candidateName') ?? '').slice(0, 32),
        description: (params.get('candidateDescription') ?? '').slice(0, 500),
        source: (params.get('candidateSource') ?? '').slice(0, 2000),
      }}
    />
  );
}

type ImportDraft = Extract<ImportResult, { kind: 'new_character' }>;

/** 把导入生成的角色卡草稿摊平到编辑器的字段（CHR-08 第 4 条：默认「真人」）。 */
function draftFields(result: ImportDraft, speaker: string | null) {
  const data = result.draft.data;
  const description = [data.persona?.summary, data.persona?.personality, data.persona?.background]
    .filter(Boolean)
    .join('\n')
    .slice(0, 2000);
  const examples = (data.examples ?? [])
    .slice(0, 6)
    .flatMap((e) => e.turns.map((t) => `${t.role === 'user' ? '我' : 'TA'}：${t.text}`))
    .join('\n')
    .slice(0, 2000);
  return {
    name: result.editorFields?.name ?? (speaker ?? '').slice(0, 32),
    description: result.editorFields?.description ?? description,
    catchphrases: result.editorFields?.catchphrases ?? data.speech?.catchphrases ?? [],
    speechStyle: result.editorFields?.speechStyle ?? data.speech?.tone ?? '',
    exampleDialogue: result.editorFields?.exampleDialogue ?? examples,
    birthday: result.editorFields?.birthday ?? '',
    avatarMediaId: result.editorFields?.avatarMediaId ?? null,
    voiceId: result.editorFields?.voiceId ?? null,
    tags: (result.editorFields?.tags ?? data.persona?.personaTagsCustom ?? []).slice(0, 10),
  };
}

export function EditCustomCharacterPage() {
  const { characterId = '' } = useParams();
  return <CustomCharacterEditor key={characterId} mode="edit" characterId={characterId} />;
}

const EMPTY_DRAFT: PersonaDraft = {
  avatarMediaId: null,
  avatarUrl: null,
  name: '',
  basis: 'original',
  realKind: 'private_person',
  ageSetting: 'adult',
  childAppearance: false,
  tags: [],
  description: '',
  speechStyle: '',
  catchphrases: [],
  exampleDialogue: '',
  birthday: '',
  voiceId: null,
};

/** 必填子板块是否填好（配置里 required 的行）。 */
function isFilled(sub: PersonaSubsection, draft: PersonaDraft): boolean {
  const value = sub.field ? draft[sub.field] : undefined;
  const editor = sub.create?.editor;
  if (editor?.kind === 'longText')
    return typeof value === 'string' && value.trim().length >= (editor.minLength ?? 1);
  if (Array.isArray(value)) return value.length > 0;
  if (typeof value === 'string') return value.trim().length > 0;
  return value !== null && value !== undefined;
}

function dateText(value: string) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/u.exec(value);
  return m ? `${Number(m[1])}年${Number(m[2])}月${Number(m[3])}日` : value;
}

function CustomCharacterEditor({
  mode,
  characterId,
  importJobId = null,
  candidate,
}: {
  mode: 'create' | 'edit';
  characterId?: string;
  importJobId?: string | null;
  candidate?: { name: string; description: string; source: string };
}) {
  const navigate = useNavigate();
  const { session } = useAuth();
  const [params, setParams] = useSearchParams();
  const voices = useVoiceLibrary();
  const [trial, setTrial] = useState<{
    conversationId: string;
    name: string;
    owner: { userId: string; sessionId: string };
  } | null>(null);
  const [imported, setImported] = useState<{
    realNames: string[];
    rawKept: boolean;
    realPersonKind: RealPersonKind;
    fields: Set<string>;
  } | null>(null);
  const [declared, setDeclared] = useState(false);
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);
  const [draft, setDraft] = useState<PersonaDraft>(() =>
    mode === 'create' && !importJobId && candidate?.name
      ? {
          ...EMPTY_DRAFT,
          name: candidate.name,
          description: `${candidate.description}${candidate.source ? `\n参考公开资料（尚未核实）：${candidate.source}` : ''}`,
        }
      : EMPTY_DRAFT,
  );
  const patch = (next: Partial<PersonaDraft>) => setDraft((d) => ({ ...d, ...next }));
  const [uploadPending, setUploadPending] = useState(false);
  const [loading, setLoading] = useState(mode === 'edit');
  const [loaded, setLoaded] = useState(mode === 'create');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [childWarning, setChildWarning] = useState(false);
  const [avatarOpen, setAvatarOpen] = useState(false);
  /** 正在用滚轮选的日期字段（生日）；滚轮是底部面板，不进地址。 */
  const [dateSub, setDateSub] = useState<PersonaSubsection | null>(null);

  // Track original classification for one-way lock enforcement (set after first load or save)
  const [originalBasis, setOriginalBasis] = useState<CharacterBasis | null>(null);
  const [originalAge, setOriginalAge] = useState<AgeSetting | null>(null);

  // ---------- 二级页面：挂在 ?edit= 上，返回键只关这一层 ----------
  const editing = findSubsection(params.get('edit'));
  const pushed = useRef(false);
  useEffect(() => {
    if (!editing) pushed.current = false;
  }, [editing]);
  function openRow(sub: PersonaSubsection) {
    const kind = sub.create?.editor.kind;
    if (kind === 'avatar') return setAvatarOpen(true);
    if (kind === 'date') return setDateSub(sub);
    const next = new URLSearchParams(params);
    next.set('edit', sub.id);
    pushed.current = true;
    setParams(next);
  }
  function closeEditor() {
    if (pushed.current) {
      pushed.current = false;
      navigate(-1);
      return;
    }
    const next = new URLSearchParams(params);
    next.delete('edit');
    setParams(next, { replace: true });
  }

  useEffect(() => {
    if (mode !== 'edit' || !characterId) return;
    let active = true;
    void api
      .call(UserCustomEndpoints.list, { networkOnly: true })
      .then((result) => {
        if (!active) return;
        const character = result.items.find((item) => item.characterId === characterId);
        if (!character) throw new Error('角色已不可用');
        setDraft({
          name: character.name,
          description: character.description,
          catchphrases:
            character.catchphrases ?? (character.catchphrase ? [character.catchphrase] : []),
          speechStyle: character.speechStyle ?? '',
          exampleDialogue: character.exampleDialogue ?? '',
          tags: character.tags,
          basis: character.classification.basis,
          realKind: character.classification.realPersonKind ?? 'private_person',
          childAppearance: character.classification.childAppearance,
          birthday: character.birthday ?? '',
          avatarMediaId: character.avatar.image?.mediaId ?? null,
          avatarUrl: character.avatar.image?.url ?? null,
          voiceId: character.voiceId ?? null,
          ageSetting: character.classification.ageSetting,
        });
        setOriginalBasis(character.classification.basis);
        setOriginalAge(character.classification.ageSetting);
        setLoaded(true);
      })
      .catch((error) => {
        if (active) setError(friendlyError(error));
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    return () => {
      active = false;
    };
  }, [mode, characterId]);

  useEffect(() => {
    if (!importJobId) return;
    let active = true;
    void (async () => {
      try {
        const [job, result] = await Promise.all([
          api.call(ImporterEndpoints.getJob, { params: { jobId: importJobId }, networkOnly: true }),
          api.call(ImporterEndpoints.getResult, {
            params: { jobId: importJobId },
            networkOnly: true,
          }),
        ]);
        if (!active || result.kind !== 'new_character') return;
        setImportDraft(result);
        const fields = draftFields(result, job.selectedSpeaker);
        setDraft({
          ...fields,
          avatarUrl: null,
          realKind: result.suggestedClassification.realPersonKind ?? 'private_person',
          childAppearance: result.suggestedClassification.childAppearance,
          basis: result.suggestedClassification.basis,
          ageSetting: result.suggestedClassification.ageSetting,
        });
        setImported({
          realNames: result.detectedRealNames,
          rawKept: job.keepRaw && !job.rawDeletedAt,
          realPersonKind: result.suggestedClassification.realPersonKind ?? 'private_person',
          fields: new Set(
            Object.entries(fields)
              .filter(([, v]) => (Array.isArray(v) ? v.length > 0 : !!v))
              .map(([k]) => k),
          ),
        });
        if (fields.avatarMediaId) {
          const media = await api.call(MediaEndpoints.getMedia, {
            params: { mediaId: fields.avatarMediaId },
            networkOnly: true,
          });
          if (active) patch({ avatarUrl: media.url });
        }
      } catch (e) {
        if (active) setError(friendlyError(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [importJobId]);

  // 10-21 G2：编辑已有角色时没改动、或必填（名字、至少 50 字的人设描述）没填好，「保存」保持灰色
  // 头像地址只是显示用，比较改动看 avatarMediaId
  const snapshot = JSON.stringify({ ...draft, avatarUrl: undefined });
  const [baseline, setBaseline] = useState<string | null>(null);
  if (mode === 'edit' && loaded && baseline === null) setBaseline(snapshot);
  const unchanged = mode === 'edit' && snapshot === baseline;
  const groups = createSections();
  const required = groups.flatMap((g) => g.rows).filter((sub) => sub.create?.required);
  const incomplete = required.some((sub) => !isFilled(sub, draft));
  const fromImport = (field: string | undefined) =>
    field && imported?.fields.has(field) ? <span className="tag neutral">来自导入</span> : null;
  const touch = (field: string | undefined) =>
    setImported((v) => {
      if (!field || !v || !v.fields.has(field)) return v;
      const fields = new Set(v.fields);
      fields.delete(field);
      return { ...v, fields };
    });

  function isBasisLocked(value: CharacterBasis, isDeclared: boolean): boolean {
    return (
      (originalBasis === 'real_person' && value !== 'real_person') ||
      (!!imported && value !== 'real_person' && !isDeclared)
    );
  }

  function isAgeLocked(value: AgeSetting): boolean {
    return originalAge === 'minor' && value === 'adult';
  }

  const classification = () => ({
    basis: draft.basis,
    realPersonKind: draft.basis === 'real_person' ? draft.realKind : null,
    ageSetting: draft.ageSetting,
    childAppearance: draft.childAppearance,
  });

  async function saveImportDraft() {
    if (!importJobId || !importDraft || !session || pending || uploadPending) return;
    const owner = { userId: session.user.userId, sessionId: session.session.sessionId };
    setPending(true);
    setError('');
    try {
      const result = await api.call(ImporterEndpoints.saveResultDraft, {
        params: { jobId: importJobId },
        body: {
          ...importDraft,
          editorFields: {
            name: draft.name,
            description: draft.description,
            speechStyle: draft.speechStyle,
            exampleDialogue: draft.exampleDialogue,
            birthday: draft.birthday || null,
            avatarMediaId: draft.avatarMediaId,
            voiceId: draft.voiceId,
            catchphrases: draft.catchphrases,
            tags: draft.tags,
          },
          suggestedClassification: { ...importDraft.suggestedClassification, ...classification() },
        },
      });
      if (!api.owns(owner)) return;
      if (result.kind === 'new_character') setImportDraft(result);
      showToast('草稿已保存，可以稍后继续编辑', 2000, 'success');
    } catch (e) {
      if (api.owns(owner)) setError(friendlyError(e));
    } finally {
      if (api.owns(owner)) setPending(false);
    }
  }

  async function submit() {
    if (pending || uploadPending) return;
    setPending(true);
    setError('');
    try {
      const body = {
        classification: classification(),
        birthday: draft.birthday || null,
        avatarMediaId: draft.avatarMediaId,
        voiceId: draft.voiceId,
        catchphrases: draft.catchphrases,
        speechStyle: draft.speechStyle,
        exampleDialogue: draft.exampleDialogue,
        tags: draft.tags.slice(0, 10),
      };
      if (mode === 'create') {
        const result = await api.call(UserCustomEndpoints.create, {
          body: { ...body, name: draft.name, description: draft.description },
        });
        if (result.childFeaturesDetected) setChildWarning(true);
        // Lock classification after save
        setOriginalBasis(result.classification.basis);
        setOriginalAge(result.classification.ageSetting);
        navigate(`/characters/${result.characterId}`);
      } else if (characterId) {
        const result = await api.call(UserCustomEndpoints.update, {
          params: { characterId },
          body: {
            ...body,
            name: draft.name || undefined,
            description: draft.description || undefined,
          },
        });
        if (result.childFeaturesDetected) setChildWarning(true);
        setOriginalBasis(result.classification.basis);
        setOriginalAge(result.classification.ageSetting);
        setBaseline(snapshot);
        showToast('已保存', 1500, 'success');
      }
    } catch (e) {
      const msg = friendlyError(e);
      if (msg.includes('classification_change_forbidden')) {
        setError('此角色分类不能更改（真人 → 其他 或 未满 18 岁 → 成年 不允许）');
      } else {
        setError(msg);
      }
    } finally {
      setPending(false);
    }
  }

  async function startTrial() {
    if (!session) return;
    const owner = { userId: session.user.userId, sessionId: session.session.sessionId };
    setPending(true);
    setError('');
    try {
      const parsed = UserCustomTrialWrite.safeParse({
        sourceCharacterId: characterId,
        birthday: draft.birthday || null,
        avatarMediaId: draft.avatarMediaId,
        voiceId: draft.voiceId,
        name: draft.name,
        description: draft.description,
        classification: classification(),
        catchphrases: draft.catchphrases,
        speechStyle: draft.speechStyle,
        exampleDialogue: draft.exampleDialogue || undefined,
        tags: draft.tags,
      });
      if (!parsed.success) {
        setError('请填写名字和至少50字的人设，检查口头禅与标签长度');
        return;
      }
      if (imported && draft.basis !== 'real_person' && !declared) {
        setError('请先确认角色分类声明');
        return;
      }
      const result = await api.call(UserCustomEndpoints.draftTrial, {
        body: parsed.data,
        networkOnly: true,
      });
      if (api.owns(owner))
        setTrial({ conversationId: result.conversationId, name: draft.name, owner });
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  /** 行右侧摘要；必填没填好时是灰字「未填写」。 */
  function summary(sub: PersonaSubsection): string {
    const editor = sub.create!.editor;
    const value = sub.field ? draft[sub.field] : undefined;
    const missing = sub.create?.required && !isFilled(sub, draft);
    switch (editor.kind) {
      case 'line':
        return String(value ?? '').trim() || (missing ? '未填写' : '');
      case 'basis': {
        const word = BASIS_OPTIONS.find((o) => o.value === draft.basis)?.word ?? '';
        return draft.basis === 'real_person'
          ? `${word} · ${REAL_KIND_OPTIONS.find((o) => o.value === draft.realKind)?.label ?? ''}`
          : word;
      }
      case 'age':
        return `${AGE_OPTIONS.find((o) => o.value === draft.ageSetting)?.label ?? ''}${draft.childAppearance ? ' · 外表是儿童' : ''}`;
      case 'list': {
        const items = Array.isArray(value) ? value : [];
        if (!items.length) return missing ? '未填写' : '';
        return editor.summary === 'join' ? items.join('、') : `${items.length} 条`;
      }
      case 'longText': {
        const n = typeof value === 'string' ? value.trim().length : 0;
        if (!n) return missing ? '未填写' : '';
        return editor.minLength && n < editor.minLength
          ? `已写 ${n} 字，至少 ${editor.minLength} 字`
          : `已写 ${n} 字`;
      }
      case 'dialogue': {
        const n = dialogueGroups(typeof value === 'string' ? value : '');
        return n ? `${n} 组` : '';
      }
      case 'date':
        return typeof value === 'string' && value ? dateText(value) : '';
      case 'voice':
        return voiceLabel(voices, draft.voiceId);
      default:
        return '';
    }
  }

  function renderEditor(sub: PersonaSubsection) {
    const editor = sub.create!.editor;
    const field = sub.field!;
    const save = (next: Partial<PersonaDraft>) => {
      patch(next);
      touch(field);
      closeEditor();
    };
    switch (editor.kind) {
      case 'line':
        return (
          <FieldPage
            title={sub.title}
            initial={String(draft[field] ?? '')}
            maxLength={editor.maxLength}
            placeholder={editor.placeholder}
            required={sub.create?.required}
            onClose={closeEditor}
            onSave={(value) => save({ [field]: value })}
          />
        );
      case 'longText':
        return (
          <LongTextPage
            title={sub.title}
            editor={editor}
            initial={String(draft[field] ?? '')}
            onClose={closeEditor}
            onSave={(value) => save({ [field]: value })}
          />
        );
      case 'list':
        return (
          <ListPage
            title={sub.title}
            editor={editor}
            initial={(draft[field] as string[]) ?? []}
            onClose={closeEditor}
            onSave={(value) => save({ [field]: value })}
          />
        );
      case 'dialogue':
        return (
          <DialoguePage
            editor={editor}
            initial={String(draft[field] ?? '')}
            onClose={closeEditor}
            onSave={(value) => save({ [field]: value })}
          />
        );
      case 'basis':
        return (
          <BasisPage
            initial={{ basis: draft.basis, realKind: draft.realKind, declared }}
            isLocked={isBasisLocked}
            imported={imported}
            onClose={closeEditor}
            onSave={(value) => {
              setDeclared(value.declared);
              save({ basis: value.basis, realKind: value.realKind });
            }}
          />
        );
      case 'age':
        return (
          <AgePage
            initial={{ ageSetting: draft.ageSetting, childAppearance: draft.childAppearance }}
            isLocked={isAgeLocked}
            onClose={closeEditor}
            onSave={(value) => save(value)}
          />
        );
      case 'voice':
        return (
          <CharacterVoicePage
            library={voices}
            value={draft.voiceId}
            onClose={closeEditor}
            onSave={(voiceId) => save({ voiceId })}
          />
        );
      default:
        return null;
    }
  }

  if (loading)
    return (
      <main>
        <span className="spinner" role="status" />
        正在读取角色…
      </main>
    );
  if (!loaded)
    return (
      <main>
        <p role="alert">{error || '角色已不可用'}</p>
        <Link to="/">返回</Link>
      </main>
    );
  const busy = pending || uploadPending;
  const avatarSub = groups[0]?.rows.find((sub) => sub.create?.editor.kind === 'avatar');
  return (
    <main className="custom-character">
      <NavBar
        title={mode === 'create' ? '创建角色' : '编辑角色'}
        fallback={mode === 'create' ? '/contacts' : `/characters/${characterId}`}
      />
      {imported && (
        <p className="inline-tip">
          {imported.rawKept
            ? '原始聊天记录已保存，可以在 TA 的「我的补充设定」里继续补充'
            : '原始聊天记录已删除，只保留了草稿和示例对话'}
        </p>
      )}
      {avatarSub && (
        <div className="persona-avatar-block">
          <button
            type="button"
            className="persona-avatar"
            aria-label={draft.avatarUrl ? '更换头像' : '设置头像'}
            disabled={busy}
            onClick={() => openRow(avatarSub)}
          >
            {draft.avatarUrl ? (
              <img src={draft.avatarUrl} alt="角色头像" width={88} height={88} />
            ) : draft.name.trim() ? (
              <span className="persona-avatar-initial">{Array.from(draft.name.trim())[0]}</span>
            ) : (
              <OldIcon name="wechat/camera" size={32} />
            )}
            <span className="persona-avatar-badge" aria-hidden>
              <OldIcon name="wechat/camera" size={14} />
            </span>
          </button>
          <small>{draft.avatarUrl ? '点按更换头像' : '设置头像'}</small>
          {fromImport('avatarMediaId')}
        </div>
      )}
      {groups.map(({ section, rows }) => {
        const visible = rows.filter((sub) => sub.create?.editor.kind !== 'avatar');
        if (!visible.length) return null;
        return (
          <MenuGroup key={section.id} className="persona-group">
            {visible.map((sub) => (
              <MenuRow
                key={sub.id}
                label={sub.title}
                badge={fromImport(sub.field)}
                value={summary(sub) || undefined}
                disabled={busy}
                onClick={() => openRow(sub)}
              />
            ))}
          </MenuGroup>
        );
      })}
      {childWarning && (
        <p className="inline-tip warn" role="alert">
          人设描述中检测到儿童特征，该角色已标记为未成年，不能开启成人模式。
        </p>
      )}
      {mode === 'create' && !importJobId && (
        <MenuGroup>
          <ImportEntryRow />
        </MenuGroup>
      )}
      {importJobId && (
        <MenuGroup>
          <MenuRow
            label="保存草稿"
            subtitle="稍后可以从「进行中的导入」继续编辑"
            disabled={busy || !importDraft}
            onClick={() => void saveImportDraft()}
          />
          <MenuRow
            label="继续导入下一批"
            subtitle="请先保存草稿"
            to={`/imports/new?mergeIntoJobId=${importJobId}`}
          />
        </MenuGroup>
      )}
      {error && (
        <p role="alert" className="persona-error">
          {error}
        </p>
      )}
      <div className="persona-actions">
        <button
          type="button"
          className="persona-trial"
          disabled={busy || loading || !!trial || incomplete}
          onClick={() => void startTrial()}
        >
          试聊
        </button>
        <button
          type="button"
          className="primary"
          disabled={loading || busy || unchanged || incomplete}
          aria-busy={pending}
          onClick={() => void submit()}
        >
          {pending
            ? mode === 'create'
              ? '正在创建…'
              : '正在保存…'
            : mode === 'create'
              ? '创建角色'
              : '保存'}
        </button>
      </div>
      {trial && <CharacterTrial {...trial} onClose={() => setTrial(null)} />}
      {editing && renderEditor(editing)}
      {avatarOpen && (
        <AvatarEditor
          sheet
          purpose="custom_character_avatar"
          onPendingChange={setUploadPending}
          onClose={() => setAvatarOpen(false)}
          onSaved={async (mediaId) => {
            const media = await api.call(MediaEndpoints.getMedia, {
              params: { mediaId },
              networkOnly: true,
            });
            patch({ avatarMediaId: mediaId, avatarUrl: media.url });
            touch('avatarMediaId');
          }}
          onRestore={
            draft.avatarMediaId
              ? () => {
                  patch({ avatarMediaId: null, avatarUrl: null });
                  touch('avatarMediaId');
                }
              : undefined
          }
        />
      )}
      {dateSub?.field && dateSub.create?.editor.kind === 'date' && (
        <DatePickerSheet
          title={dateSub.title}
          value={String(draft[dateSub.field] ?? '') || null}
          onCancel={() => setDateSub(null)}
          onConfirm={(value) => {
            patch({ [dateSub.field!]: value });
            touch(dateSub.field);
            setDateSub(null);
          }}
          onClear={
            draft[dateSub.field]
              ? () => {
                  patch({ [dateSub.field!]: '' });
                  touch(dateSub.field);
                  setDateSub(null);
                }
              : undefined
          }
          clearLabel={dateSub.create.editor.clearLabel}
        />
      )}
    </main>
  );
}
