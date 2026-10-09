import { useState, type FormEvent } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { UserCustomEndpoints, type CharacterBasis, type AgeSetting } from '@weiban/contracts';
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
  return <CustomCharacterEditor mode="create" />;
}

export function EditCustomCharacterPage() {
  const { characterId = '' } = useParams();
  return <CustomCharacterEditor mode="edit" characterId={characterId} />;
}

function CustomCharacterEditor({
  mode,
  characterId,
}: {
  mode: 'create' | 'edit';
  characterId?: string;
}) {
  const navigate = useNavigate();

  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [basis, setBasis] = useState<CharacterBasis>('original');
  const [ageSetting, setAgeSetting] = useState<AgeSetting>('adult');
  const [catchphrase, setCatchphrase] = useState('');
  const [exampleDialogue, setExampleDialogue] = useState('');
  const [tags, setTags] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [childWarning, setChildWarning] = useState(false);

  // Track original classification for one-way lock enforcement (set after first load or save)
  const [originalBasis, setOriginalBasis] = useState<CharacterBasis | null>(null);
  const [originalAge, setOriginalAge] = useState<AgeSetting | null>(null);

  // NOTE: There is no GET endpoint for a single custom character in contracts v2.3.
  // Edit mode opens with blank fields; the user re-fills what they want to change.
  // A contract change request is filed in the handoff.

  function isBasisLocked(value: CharacterBasis): boolean {
    return originalBasis === 'real_person' && value !== 'real_person';
  }

  function isAgeLocked(value: AgeSetting): boolean {
    return originalAge === 'minor' && value === 'adult';
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    setMessage('');
    try {
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
              realPersonKind: basis === 'real_person' ? 'celebrity' : null,
              ageSetting,
              childAppearance: false,
            },
            catchphrase: catchphrase || undefined,
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
            catchphrase: catchphrase || undefined,
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

  return (
    <main>
      <h1 className="page-title">{mode === 'create' ? '创建角色' : '编辑角色'}</h1>
      <form className="panel stack" onSubmit={(e) => void submit(e)}>
        <label>
          名字 <span aria-hidden="true">*</span>
          <input
            required
            maxLength={32}
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="角色名字"
          />
        </label>

        <fieldset>
          <legend>
            角色分类 <span aria-hidden="true">*</span>
          </legend>
          {basisOptions.map(({ value, label, description: desc }) => {
            const locked = isBasisLocked(value);
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
          人设描述 <span aria-hidden="true">*</span>（至少 50 字）
          <textarea
            required
            minLength={50}
            maxLength={2000}
            rows={5}
            value={description}
            onChange={(e) => setDescription(e.target.value)}
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
          口头禅（可选）
          <input
            maxLength={200}
            value={catchphrase}
            onChange={(e) => setCatchphrase(e.target.value)}
          />
        </label>

        <label>
          示例对话（可选）
          <textarea
            maxLength={2000}
            rows={3}
            value={exampleDialogue}
            onChange={(e) => setExampleDialogue(e.target.value)}
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

        <button className="primary" disabled={pending}>
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
      {message && <p role="status">{message}</p>}
    </main>
  );
}
