import { useEffect, useState, type FormEvent } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  ImporterEndpoints,
  UserCustomEndpoints,
  type AgeSetting,
  type CharacterBasis,
  type ImportResult,
  type RealPersonKind,
} from '@weiban/contracts';
import { ActiveImportsRow } from './import.js';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';

const basisOptions: { value: CharacterBasis; label: string; description: string }[] = [
  {
    value: 'original',
    label: '原创角色',
    description:
      '名字和经历是新编的，不以任何真实人物的身份出现。以某位真人的性格、说话风格为灵感也算原创，只要不用 TA 的真名、不写 TA 的真实作品、人际关系和经历。',
  },
  {
    value: 'fictional',
    label: '虚构作品中的角色',
    description: '出自影视、动画、小说、游戏等作品。',
  },
  {
    value: 'real_person',
    label: '真人',
    description:
      '以真实人物本人的身份出现：用 TA 的真名，或写了 TA 的真实作品、人际关系、经历。包括你身边的朋友、家人。',
  },
];

const ageOptions: { value: AgeSetting; label: string }[] = [
  { value: 'minor', label: '未满 18 岁' },
  { value: 'adult', label: '已满 18 岁' },
];

export function CreateCustomCharacterPage() {
  const [params] = useSearchParams();
  const importJobId = params.get('import');
  return (
    <CustomCharacterEditor key={importJobId ?? 'new'} mode="create" importJobId={importJobId} />
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
    catchphrase: (result.editorFields?.catchphrases ?? data.speech?.catchphrases ?? []).join('\n'),
    speechStyle: result.editorFields?.speechStyle ?? data.speech?.tone ?? '',
    exampleDialogue: result.editorFields?.exampleDialogue ?? examples,
    tags: (result.editorFields?.tags ?? data.persona?.personaTagsCustom ?? [])
      .slice(0, 10)
      .join('，'),
  };
}

export function EditCustomCharacterPage() {
  const { characterId = '' } = useParams();
  return <CustomCharacterEditor key={characterId} mode="edit" characterId={characterId} />;
}

function CustomCharacterEditor({
  mode,
  characterId,
  importJobId = null,
}: {
  mode: 'create' | 'edit';
  characterId?: string;
  importJobId?: string | null;
}) {
  const navigate = useNavigate();
  const [imported, setImported] = useState<{
    realNames: string[];
    rawKept: boolean;
    realPersonKind: RealPersonKind;
    fields: Set<string>;
  } | null>(null);
  const [declared, setDeclared] = useState(false);
  const [importDraft, setImportDraft] = useState<ImportDraft | null>(null);

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [basis, setBasis] = useState<CharacterBasis>('original');
  const [ageSetting, setAgeSetting] = useState<AgeSetting>('adult');
  const [catchphrase, setCatchphrase] = useState('');
  const [speechStyle, setSpeechStyle] = useState('');
  const [loading, setLoading] = useState(mode === 'edit');
  const [loaded, setLoaded] = useState(mode === 'create');
  const [exampleDialogue, setExampleDialogue] = useState('');
  const [tags, setTags] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [childWarning, setChildWarning] = useState(false);

  // Track original classification for one-way lock enforcement (set after first load or save)
  const [originalBasis, setOriginalBasis] = useState<CharacterBasis | null>(null);
  const [originalAge, setOriginalAge] = useState<AgeSetting | null>(null);

  useEffect(() => {
    if (mode !== 'edit' || !characterId) return;
    let active = true;
    void api
      .call(UserCustomEndpoints.list, { networkOnly: true })
      .then((result) => {
        if (!active) return;
        const character = result.items.find((item) => item.characterId === characterId);
        if (!character) throw new Error('角色已不可用');
        setName(character.name);
        setDescription(character.description);
        setCatchphrase(
          (character.catchphrases ?? (character.catchphrase ? [character.catchphrase] : [])).join(
            '\n',
          ),
        );
        setSpeechStyle(character.speechStyle ?? '');
        setExampleDialogue(character.exampleDialogue ?? '');
        setTags(character.tags.join('，'));
        setBasis(character.classification.basis);
        setAgeSetting(character.classification.ageSetting);
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
        setName(fields.name);
        setDescription(fields.description);
        setCatchphrase(fields.catchphrase);
        setSpeechStyle(fields.speechStyle);
        setExampleDialogue(fields.exampleDialogue);
        setTags(fields.tags);
        setBasis(result.suggestedClassification.basis);
        setAgeSetting(result.suggestedClassification.ageSetting);
        setImported({
          realNames: result.detectedRealNames,
          rawKept: job.keepRaw && !job.rawDeletedAt,
          realPersonKind: result.suggestedClassification.realPersonKind ?? 'private_person',
          fields: new Set(
            Object.entries(fields)
              .filter(([, v]) => v)
              .map(([k]) => k),
          ),
        });
      } catch (e) {
        if (active) setError(friendlyError(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [importJobId]);
  const fromImport = (field: string) =>
    imported?.fields.has(field) ? <span className="tag neutral">来自导入</span> : null;
  const touch = (field: string) =>
    setImported((v) => {
      if (!v || !v.fields.has(field)) return v;
      const fields = new Set(v.fields);
      fields.delete(field);
      return { ...v, fields };
    });

  function isBasisLocked(value: CharacterBasis): boolean {
    return originalBasis === 'real_person' && value !== 'real_person';
  }

  function isAgeLocked(value: AgeSetting): boolean {
    return originalAge === 'minor' && value === 'adult';
  }

  async function saveImportDraft() {
    if (!importJobId || !importDraft) return;
    setPending(true);
    setError('');
    try {
      const result = await api.call(ImporterEndpoints.saveResultDraft, {
        params: { jobId: importJobId },
        body: {
          ...importDraft,
          editorFields: {
            name,
            description,
            speechStyle,
            exampleDialogue,
            catchphrases: catchphrase
              .split(/\r?\n/)
              .map((v) => v.trim())
              .filter(Boolean),
            tags: tags
              .split(/[,，、]/)
              .map((v) => v.trim())
              .filter(Boolean),
          },
          suggestedClassification: {
            ...importDraft.suggestedClassification,
            basis,
            ageSetting,
            realPersonKind:
              basis === 'real_person' ? (imported?.realPersonKind ?? 'private_person') : null,
          },
        },
      });
      if (result.kind === 'new_character') setImportDraft(result);
      setMessage('草稿已保存，可以稍后继续编辑');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    try {
      const catchphrases = catchphrase
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter(Boolean);
      if (catchphrases.length > 10 || catchphrases.some((line) => line.length > 50)) {
        setError('最多 10 条口头禅，每条不超过 50 字');
        return;
      }
      const tagList = tags
        .split(/[,，、]/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 10);

      if (mode === 'create') {
        const result = await api.call(UserCustomEndpoints.create, {
          body: {
            name,
            description,
            classification: {
              basis,
              realPersonKind:
                basis === 'real_person' ? (imported?.realPersonKind ?? 'celebrity') : null,
              ageSetting,
              childAppearance: false,
            },
            catchphrases,
            speechStyle,
            exampleDialogue: exampleDialogue || undefined,
            tags: tagList.length ? tagList : undefined,
          },
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
            name: name || undefined,
            description: description || undefined,
            catchphrases,
            speechStyle,
            exampleDialogue: exampleDialogue || undefined,
            tags: tagList.length ? tagList : undefined,
          },
        });
        if (result.childFeaturesDetected) setChildWarning(true);
        setOriginalBasis(result.classification.basis);
        setOriginalAge(result.classification.ageSetting);
        setMessage('已保存');
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
    if (!characterId) return;
    setPending(true);
    try {
      const result = await api.call(UserCustomEndpoints.startTrial, {
        params: { characterId },
      });
      navigate(`/chat/${result.conversationId}`);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
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
  return (
    <main>
      <h1 className="page-title">{mode === 'create' ? '创建角色' : '编辑角色'}</h1>
      {mode === 'create' && !importJobId && <ActiveImportsRow />}
      {mode === 'create' && !importJobId && (
        <Link className="panel row-link" to="/imports/new">
          <span>导入聊天记录</span>
          <small>›</small>
        </Link>
      )}
      {imported && (
        <p className="inline-tip">
          {imported.rawKept
            ? '原始聊天记录已保存，可以在 TA 的「我的补充设定」里继续补充'
            : '原始聊天记录已删除，只保留了草稿和示例对话'}
        </p>
      )}
      <form className="panel stack" onSubmit={(e) => void submit(e)}>
        <label>
          名字 <span aria-hidden="true">*</span> {fromImport('name')}
          <input
            required
            maxLength={32}
            value={name}
            onChange={(e) => {
              setName(e.target.value);
              touch('name');
            }}
            placeholder="角色名字"
          />
        </label>

        <fieldset>
          <legend>
            角色分类 <span aria-hidden="true">*</span>
          </legend>
          {basisOptions.map(({ value, label, description: desc }) => {
            const locked =
              isBasisLocked(value) || (!!imported && value !== 'real_person' && !declared);
            return (
              <label key={value} className={`radio-option${locked ? ' disabled' : ''}`}>
                <input
                  type="radio"
                  name="basis"
                  value={value}
                  checked={basis === value}
                  disabled={locked}
                  onChange={() => setBasis(value)}
                />
                <span>
                  <strong>{label}</strong>
                  <span className="hint">{desc}</span>
                </span>
              </label>
            );
          })}
          <p className="hint">选择「真人」的角色不会有成人模式，也不会生成 TA 的肖像。</p>
          {imported && (
            <label className="check">
              <input
                type="checkbox"
                checked={declared}
                onChange={(e) => {
                  setDeclared(e.target.checked);
                  if (!e.target.checked) setBasis('real_person');
                }}
              />
              我确认这个角色不以真实人物的身份出现，会替换掉真名和真实经历
            </label>
          )}
          {imported && basis !== 'real_person' && imported.realNames.length > 0 && (
            <p className="inline-tip warn">
              草稿里可能有真名：{imported.realNames.join('、')}，请替换成新的名字
            </p>
          )}
        </fieldset>

        <fieldset>
          <legend>
            年龄设定 <span aria-hidden="true">*</span>
          </legend>
          {ageOptions.map(({ value, label }) => {
            const locked = isAgeLocked(value);
            return (
              <label key={value} className={`radio-option${locked ? ' disabled' : ''}`}>
                <input
                  type="radio"
                  name="ageSetting"
                  value={value}
                  checked={ageSetting === value}
                  disabled={locked}
                  onChange={() => setAgeSetting(value)}
                />
                {label}
                {locked && <span className="hint">（已保存为未成年，不可更改为成年）</span>}
              </label>
            );
          })}
        </fieldset>

        <label>
          人设描述 <span aria-hidden="true">*</span>（至少 50 字） {fromImport('description')}
          <textarea
            required
            minLength={50}
            maxLength={2000}
            rows={5}
            value={description}
            onChange={(e) => {
              setDescription(e.target.value);
              touch('description');
            }}
            placeholder="性格、说话方式、背景故事……至少 50 字"
          />
          <span className="hint char-count">{description.length} / 2000</span>
        </label>

        {childWarning && (
          <p className="inline-tip warn" role="alert">
            人设描述中检测到儿童特征，该角色已标记为未成年，不能开启成人模式。
          </p>
        )}

        <label>
          说话方式（可选） {fromImport('speechStyle')}
          <textarea
            maxLength={500}
            value={speechStyle}
            onChange={(event) => {
              setSpeechStyle(event.target.value);
              touch('speechStyle');
            }}
          />
        </label>
        <label>
          口头禅（可选） {fromImport('catchphrase')}
          <textarea
            rows={4}
            maxLength={510}
            placeholder="每行一条，最多 10 条，每条 50 字"
            value={catchphrase}
            onChange={(e) => {
              setCatchphrase(e.target.value);
              touch('catchphrase');
            }}
          />
        </label>

        <label>
          示例对话（可选） {fromImport('exampleDialogue')}
          <textarea
            maxLength={2000}
            rows={3}
            value={exampleDialogue}
            onChange={(e) => {
              setExampleDialogue(e.target.value);
              touch('exampleDialogue');
            }}
            placeholder="多轮对话用换行分隔"
          />
        </label>

        <label>
          标签（可选，逗号分隔，最多 10 个）
          <input
            maxLength={200}
            value={tags}
            onChange={(e) => setTags(e.target.value)}
            placeholder="如：傲娇、高冷、害羞"
          />
        </label>

        <button className="primary" disabled={loading || pending}>
          {mode === 'create' ? '创建角色' : '保存'}
        </button>
      </form>

      {mode === 'edit' && characterId && (
        <button className="panel full" disabled={pending} onClick={() => void startTrial()}>
          试聊
        </button>
      )}

      {error && (
        <p role="alert" className="error">
          {error}
        </p>
      )}
      {importJobId && (
        <div className="stack">
          <button disabled={pending || !importDraft} onClick={() => void saveImportDraft()}>
            保存草稿
          </button>
          <Link to={`/imports/new?mergeIntoJobId=${importJobId}`}>
            继续导入下一批（请先保存编辑）
          </Link>
        </div>
      )}
      {message && <p role="status">{message}</p>}
    </main>
  );
}
