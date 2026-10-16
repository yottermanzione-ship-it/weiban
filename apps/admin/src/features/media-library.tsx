/**
 * 素材库（ADM-04 第 1～3 条；MED-01、MED-03、MED-05、GRW-05）：表情包库、音色库（试听）、卡面模板库、作品链接库。
 * 接口：StickerAdminEndpoints、VoiceAdminEndpoints、CardTemplateAdminEndpoints、WorkLinkAdminEndpoints；
 * 文件先经 MediaAdminEndpoints.adminUpload 上传，再登记到对应素材接口。
 */
import { useEffect, useRef, useState, type FormEvent } from 'react';
import {
  CardTemplateAdminEndpoints,
  CharacterAdminEndpoints,
  MediaAdminEndpoints,
  MediaEndpoints,
  ModelAccessAdminEndpoints,
  StickerAdminEndpoints,
  VoiceAdminEndpoints,
  WorkLinkAdminEndpoints,
  type AdminVoice,
  type CardTemplate,
  type StickerPack,
  type WorkLink,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { adminMediaUrl } from '../data/media-url.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

type AdminPurpose = 'sticker_library' | 'voice_sample' | 'card_template' | 'character_avatar';
async function upload(purpose: AdminPurpose, file: File) {
  return api.call(MediaAdminEndpoints.adminUpload, { query: { purpose }, file });
}

function useAction() {
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function run(work: () => Promise<unknown>, success: string) {
    setPending(true);
    setMessage('');
    setError('');
    try {
      await work();
      setMessage(success);
      return true;
    } catch (e) {
      setError(errorText(e));
      return false;
    } finally {
      setPending(false);
    }
  }
  return { pending, message, error, run };
}

function CharacterPicker({
  value,
  onChange,
  multiple = false,
}: {
  value: string[];
  onChange(next: string[]): void;
  multiple?: boolean;
}) {
  const characters = useRemote(CharacterAdminEndpoints.list);
  const all = characters.data?.items ?? [];
  if (!multiple)
    return (
      <select
        value={value[0] ?? ''}
        onChange={(e) => onChange(e.target.value ? [e.target.value] : [])}
      >
        <option value="">请选择角色</option>
        {all.map((c) => (
          <option key={c.characterId} value={c.characterId}>
            {c.name}
          </option>
        ))}
      </select>
    );
  return (
    <div className="chip-list">
      {all.map((c) => (
        <label key={c.characterId} className="check">
          <input
            type="checkbox"
            checked={value.includes(c.characterId)}
            onChange={(e) =>
              onChange(
                e.target.checked
                  ? [...value, c.characterId]
                  : value.filter((id) => id !== c.characterId),
              )
            }
          />
          {c.name}
        </label>
      ))}
    </div>
  );
}

// ---------- 表情包库 ----------

export function StickerLibraryPage() {
  const packs = useRemote(StickerAdminEndpoints.listPacks);
  const action = useAction();
  const [editing, setEditing] = useState<StickerPack | 'new' | null>(null);
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null);
  const pack = packs.data?.items.find((p) => p.packId === selected) ?? null;
  async function savePack(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name') ?? '').trim(),
      characterIds,
      userVisible: form.get('userVisible') === 'on',
      enabled: form.get('enabled') === 'on',
      inStore: form.get('inStore') === 'on',
      storeOrder: Number(form.get('storeOrder') || 0),
      intro: String(form.get('intro') || '').trim(),
      coverStickerId: String(form.get('coverStickerId') || '') || null,
    };
    const ok = await action.run(
      () =>
        editing === 'new'
          ? api.call(StickerAdminEndpoints.createPack, { body })
          : api.call(StickerAdminEndpoints.updatePack, {
              params: { packId: (editing as StickerPack).packId },
              body,
            }),
      '已保存',
    );
    if (ok) {
      setEditing(null);
      packs.refresh();
    }
  }
  return (
    <>
      <h1>表情包库</h1>
      <p className="inline-tip">表情包不得包含真人本人的照片或肖像；每次添加都要确认。</p>
      {packs.error && (
        <p role="alert" className="error-banner">
          加载失败：{packs.error} <button onClick={packs.refresh}>重试</button>
        </p>
      )}
      <Feedback message={action.message} error={action.error} />
      <button
        className="primary"
        onClick={() => {
          setEditing('new');
          setCharacterIds([]);
        }}
      >
        新建分类
      </button>
      {editing && (
        <form
          key={editing === 'new' ? 'new' : editing.packId}
          className="panel"
          onSubmit={(e) => void savePack(e)}
        >
          <label>
            分类名称
            <input
              name="name"
              required
              maxLength={20}
              defaultValue={editing === 'new' ? '' : editing.name}
            />
          </label>
          <fieldset>
            <legend>给哪些角色用（不选 = 所有角色可用）</legend>
            <CharacterPicker multiple value={characterIds} onChange={setCharacterIds} />
          </fieldset>
          <label className="check">
            <input
              type="checkbox"
              name="userVisible"
              defaultChecked={editing === 'new' ? true : editing.userVisible}
            />
            用户表情面板可见
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={editing === 'new' ? true : editing.enabled}
            />
            启用
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="inStore"
              defaultChecked={editing === 'new' ? false : editing.inStore}
            />
            在表情商店上架
          </label>
          <label>
            商店排序（小的在前）
            <input
              type="number"
              name="storeOrder"
              min={0}
              max={100000}
              defaultValue={editing === 'new' ? 0 : (editing.storeOrder ?? 0)}
            />
          </label>
          <label>
            商店介绍
            <textarea
              name="intro"
              maxLength={100}
              defaultValue={editing === 'new' ? '' : (editing.intro ?? '')}
            />
          </label>
          <label>
            封面表情
            <select
              name="coverStickerId"
              defaultValue={editing === 'new' ? '' : (editing.coverStickerId ?? '')}
            >
              <option value="">默认首张</option>
              {editing !== 'new' &&
                editing.stickers.map((sticker) => (
                  <option key={sticker.stickerId} value={sticker.stickerId}>
                    {sticker.description}
                  </option>
                ))}
            </select>
          </label>
          <div className="button-row">
            <button className="primary" disabled={action.pending}>
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      <table>
        <thead>
          <tr>
            <th>分类</th>
            <th>数量</th>
            <th>适用角色</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {packs.data?.items.map((p) => (
            <tr key={p.packId}>
              <td>{p.name}</td>
              <td>{p.stickers.length}</td>
              <td>{p.characterIds.length ? `${p.characterIds.length} 个角色` : '所有角色'}</td>
              <td>
                <span className={p.enabled ? 'tag success' : 'tag'}>
                  {p.enabled ? '启用' : '停用'}
                </span>
                {p.userVisible && <span className="tag">默认可用</span>}
                {p.inStore && <span className="tag">商店上架 · 排序{p.storeOrder}</span>}
              </td>
              <td>
                <button onClick={() => setSelected(p.packId)}>管理表情</button>
                <button
                  onClick={() => {
                    setEditing(p);
                    setCharacterIds(p.characterIds);
                  }}
                >
                  编辑
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      {pack && <StickerPackEditor pack={pack} onChanged={packs.refresh} />}
    </>
  );
}

function StickerPackEditor({ pack, onChanged }: { pack: StickerPack; onChanged(): void }) {
  const action = useAction();
  const file = useRef<HTMLInputElement>(null);
  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const formElement = event.currentTarget;
    const form = new FormData(formElement);
    const picked = file.current?.files?.[0];
    if (!picked) return;
    const ok = await action.run(async () => {
      const media = await upload('sticker_library', picked);
      await api.call(StickerAdminEndpoints.addSticker, {
        params: { packId: pack.packId },
        body: {
          mediaId: media.mediaId,
          description: String(form.get('description') ?? ''),
          confirmNoRealPersonPortrait: true,
        },
      });
    }, '已添加');
    if (ok) {
      formElement.reset();
      onChanged();
    }
  }
  return (
    <section className="panel">
      <h2>「{pack.name}」里的表情</h2>
      <Feedback message={action.message} error={action.error} />
      <form className="inline" onSubmit={(e) => void add(e)}>
        <label>
          图片
          <input ref={file} type="file" accept="image/*" required />
        </label>
        <label>
          含义（例：捂脸笑）
          <input name="description" required maxLength={40} />
        </label>
        <label className="check">
          <input type="checkbox" required />
          我确认这张图不含真人本人的照片或肖像
        </label>
        <button className="primary" disabled={action.pending}>
          添加表情
        </button>
      </form>
      <div className="asset-grid">
        {pack.stickers.map((s) => (
          <figure key={s.stickerId}>
            <img src={adminMediaUrl(s.url)} alt={s.description} loading="lazy" />
            <figcaption>{s.description}</figcaption>
            <button
              disabled={action.pending}
              onClick={() =>
                void action
                  .run(
                    () =>
                      api.call(StickerAdminEndpoints.deleteSticker, {
                        params: { stickerId: s.stickerId },
                      }),
                    '已删除',
                  )
                  .then((ok) => ok && onChanged())
              }
            >
              删除
            </button>
          </figure>
        ))}
      </div>
    </section>
  );
}

// ---------- 音色库 ----------

export function VoiceLibraryPage() {
  const voices = useRemote(VoiceAdminEndpoints.listVoices);
  const catalog = useRemote(ModelAccessAdminEndpoints.listCatalog);
  const action = useAction();
  const [editing, setEditing] = useState<AdminVoice | 'new' | null>(null);
  const [sampleId, setSampleId] = useState<string | null>(null);
  const [careId, setCareId] = useState<string | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);
  const audio = useRef<HTMLAudioElement | null>(null);
  const ttsModels = (catalog.data?.items ?? []).filter((m) =>
    (m.capabilities as string[]).includes('voice_output'),
  );
  function open(target: AdminVoice | 'new') {
    setEditing(target);
    setSampleId(target === 'new' ? null : target.sampleMediaId);
    setCareId(target === 'new' ? null : target.careFallbackMediaId);
  }
  function preview(voice: AdminVoice) {
    audio.current?.pause();
    if (playing === voice.voiceId || !voice.sampleUrl) {
      setPlaying(null);
      return;
    }
    const element = new Audio(adminMediaUrl(voice.sampleUrl));
    audio.current = element;
    element.onended = () => setPlaying(null);
    setPlaying(voice.voiceId);
    void element.play().catch(() => setPlaying(null));
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const body = {
      name: String(form.get('name') ?? '').trim(),
      tags: String(form.get('tags') ?? '')
        .split(/[,，\s]+/)
        .map((t) => t.trim())
        .filter(Boolean)
        .slice(0, 8),
      providerVoiceKey: String(form.get('providerVoiceKey') ?? '').trim(),
      modelKey: String(form.get('modelKey') ?? ''),
      sampleMediaId: sampleId,
      careFallbackMediaId: careId,
      enabled: form.get('enabled') === 'on',
    };
    const ok = await action.run(
      () =>
        editing === 'new'
          ? api.call(VoiceAdminEndpoints.createVoice, { body })
          : api.call(VoiceAdminEndpoints.updateVoice, {
              params: { voiceId: (editing as AdminVoice).voiceId },
              body,
            }),
      '已保存',
    );
    if (ok) {
      setEditing(null);
      voices.refresh();
    }
  }
  async function pickAudio(file: File | undefined, set: (id: string) => void) {
    if (!file) return;
    await action.run(async () => {
      const media = await upload('voice_sample', file);
      set(media.mediaId);
    }, '音频已上传；保存后生效');
  }
  return (
    <>
      <h1>音色库</h1>
      <p className="inline-tip">
        只登记平台预置的合成音色，不克隆任何真人声音；音色名称不能含真人角色的姓名（保存时检查）。
      </p>
      {voices.error && (
        <p role="alert" className="error-banner">
          加载失败：{voices.error} <button onClick={voices.refresh}>重试</button>
        </p>
      )}
      <Feedback message={action.message} error={action.error} />
      <button className="primary" onClick={() => open('new')}>
        登记音色
      </button>
      {editing && (
        <form className="panel" onSubmit={(e) => void save(e)}>
          <label>
            名称
            <input
              name="name"
              required
              maxLength={20}
              defaultValue={editing === 'new' ? '' : editing.name}
            />
          </label>
          <label>
            气质标签（用逗号分隔，最多 8 个）
            <input name="tags" defaultValue={editing === 'new' ? '' : editing.tags.join('，')} />
          </label>
          <label>
            语音合成模型
            <select
              name="modelKey"
              required
              defaultValue={editing === 'new' ? '' : editing.modelKey}
            >
              <option value="">请选择</option>
              {ttsModels.map((m) => (
                <option key={m.modelKey} value={m.modelKey}>
                  {m.displayName}
                </option>
              ))}
            </select>
          </label>
          <label>
            服务里的音色代号
            <input
              name="providerVoiceKey"
              required
              maxLength={64}
              defaultValue={editing === 'new' ? '' : editing.providerVoiceKey}
            />
          </label>
          <label>
            试听音频{sampleId ? '（已上传）' : ''}
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => void pickAudio(e.target.files?.[0], setSampleId)}
            />
          </label>
          <label>
            关怀兜底音频（余额不足时通话中播放）{careId ? '（已上传）' : ''}
            <input
              type="file"
              accept="audio/*"
              onChange={(e) => void pickAudio(e.target.files?.[0], setCareId)}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={editing === 'new' ? true : editing.enabled}
            />
            启用
          </label>
          <div className="button-row">
            <button className="primary" disabled={action.pending}>
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>标签</th>
            <th>模型</th>
            <th>试听</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {voices.data?.items.map((v) => (
            <tr key={v.voiceId}>
              <td>{v.name}</td>
              <td>{v.tags.join('、')}</td>
              <td>{v.modelKey}</td>
              <td>
                <button disabled={!v.sampleUrl} onClick={() => preview(v)}>
                  {playing === v.voiceId ? '停止' : '试听'}
                </button>
              </td>
              <td>
                <span className={v.enabled ? 'tag success' : 'tag'}>
                  {v.enabled ? '启用' : '停用'}
                </span>
              </td>
              <td>
                <button onClick={() => open(v)}>编辑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">停用后，已选用该音色的角色会退回预设默认音色或平台默认音色。</p>
    </>
  );
}

// ---------- 卡面模板库 ----------

const kindNames: Record<string, string> = {
  daily_photo: '日常照片',
  anniversary: '纪念日',
  familiarity: '熟悉度',
  holiday: '节日',
  moment: '名场面',
  pet: '宠物',
  play: '玩法',
};

export function CardTemplatesPage() {
  const templates = useRemote(CardTemplateAdminEndpoints.listTemplates);
  const action = useAction();
  const [editing, setEditing] = useState<CardTemplate | 'new' | null>(null);
  const [mediaId, setMediaId] = useState<string | null>(null);
  const [kinds, setKinds] = useState<string[]>([]);
  function open(target: CardTemplate | 'new') {
    setEditing(target);
    setMediaId(target === 'new' ? null : target.mediaId);
    setKinds(target === 'new' ? [] : target.kinds);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    if (!mediaId) return;
    const body = {
      name: String(form.get('name') ?? '').trim(),
      kinds: kinds as CardTemplate['kinds'],
      mediaId,
      portraitFree: form.get('portraitFree') === 'on',
      classicalStyle: form.get('classicalStyle') === 'on',
      enabled: form.get('enabled') === 'on',
    };
    const ok = await action.run(
      () =>
        editing === 'new'
          ? api.call(CardTemplateAdminEndpoints.createTemplate, { body })
          : api.call(CardTemplateAdminEndpoints.updateTemplate, {
              params: { templateId: (editing as CardTemplate).templateId },
              body,
            }),
      '已保存',
    );
    if (ok) {
      setEditing(null);
      templates.refresh();
    }
  }
  return (
    <>
      <h1>卡面与日常照片素材库</h1>
      <p className="inline-tip">
        日常照片用于聊天和朋友圈配图。真人配图只选「不含人物」的素材，历史人物配图还须为古风插画。
      </p>
      {templates.error && (
        <p role="alert" className="error-banner">
          加载失败：{templates.error} <button onClick={templates.refresh}>重试</button>
        </p>
      )}
      <Feedback message={action.message} error={action.error} />
      <button className="primary" onClick={() => open('new')}>
        新增模板
      </button>
      {editing && (
        <form className="panel" onSubmit={(e) => void save(e)}>
          <label>
            名称
            <input
              name="name"
              required
              maxLength={20}
              defaultValue={editing === 'new' ? '' : editing.name}
            />
          </label>
          <fieldset>
            <legend>素材用途（至少一种）</legend>
            <div className="chip-list">
              {Object.entries(kindNames).map(([kind, label]) => (
                <label key={kind} className="check">
                  <input
                    type="checkbox"
                    checked={kinds.includes(kind)}
                    onChange={(e) =>
                      setKinds((list) =>
                        e.target.checked ? [...list, kind] : list.filter((k) => k !== kind),
                      )
                    }
                  />
                  {label}
                </label>
              ))}
            </div>
          </fieldset>
          <label>
            卡面图片{mediaId ? '（已上传）' : ''}
            <input
              type="file"
              accept="image/*"
              required={!mediaId}
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked)
                  void action.run(async () => {
                    const media = await upload('card_template', picked);
                    setMediaId(media.mediaId);
                  }, '图片已上传；保存后生效');
              }}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="portraitFree"
              defaultChecked={editing === 'new' ? false : editing.portraitFree}
            />
            不含人物（可用于真人角色）
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="classicalStyle"
              defaultChecked={editing === 'new' ? false : (editing.classicalStyle ?? false)}
            />
            古风插画（历史人物优先使用）
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={editing === 'new' ? true : editing.enabled}
            />
            启用
          </label>
          <div className="button-row">
            <button className="primary" disabled={action.pending || !mediaId || !kinds.length}>
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      <div className="asset-grid">
        {templates.data?.items.map((t) => (
          <figure key={t.templateId}>
            <img src={adminMediaUrl(t.url)} alt={t.name} loading="lazy" />
            <figcaption>
              {t.name} · {t.kinds.map((k) => kindNames[k] ?? k).join('、')}
              {t.portraitFree && <span className="tag">不含人物</span>}
              {t.classicalStyle && <span className="tag">古风</span>}
              <span className={t.enabled ? 'tag success' : 'tag'}>
                {t.enabled ? '启用' : '停用'}
              </span>
            </figcaption>
            <button onClick={() => open(t)}>编辑</button>
          </figure>
        ))}
      </div>
    </>
  );
}

// ---------- 作品链接库 ----------

const hintNames = { music: '音乐', video: '视频', web: '网页' } as const;

export function WorkLinksPage() {
  const voices = useRemote(VoiceAdminEndpoints.listVoices);
  const [characterIds, setCharacterIds] = useState<string[]>([]);
  const characterId = characterIds[0] ?? '';
  return (
    <>
      <h1>作品链接库</h1>
      <p className="inline-tip">
        角色只会分享这里登记、启用并且检查能打开的链接。保存后立即检查一次，之后每天检查。
      </p>
      <label>
        预设角色
        <CharacterPicker value={characterIds} onChange={setCharacterIds} />
      </label>
      {characterId && (
        <>
          <DefaultVoice
            key={characterId}
            characterId={characterId}
            voices={voices.data?.items ?? []}
          />
          <WorkLinkList key={characterId} characterId={characterId} />
        </>
      )}
    </>
  );
}

function DefaultVoice({ characterId, voices }: { characterId: string; voices: AdminVoice[] }) {
  const action = useAction();
  const current = useRemote(WorkLinkAdminEndpoints.getDefaultVoice, { params: { characterId } });
  const [voiceId, setVoiceId] = useState('');
  useEffect(() => {
    if (current.data) setVoiceId(current.data.voiceId ?? '');
  }, [current.data]);
  return (
    <form
      className="panel inline"
      onSubmit={(e) => {
        e.preventDefault();
        void action.run(
          () =>
            api.call(WorkLinkAdminEndpoints.setDefaultVoice, {
              params: { characterId },
              body: { voiceId: voiceId || null },
            }),
          '默认音色已保存',
        );
      }}
    >
      <label>
        默认音色
        <select
          disabled={!current.data}
          value={voiceId}
          onChange={(e) => setVoiceId(e.target.value)}
        >
          <option value="">平台默认</option>
          {current.data?.voiceId && !voices.some((v) => v.voiceId === current.data?.voiceId) && (
            <option value={current.data.voiceId} disabled>
              当前音色（未在列表中）
            </option>
          )}
          {voices
            .filter((v) => v.enabled || v.voiceId === current.data?.voiceId)
            .map((v) => (
              <option key={v.voiceId} value={v.voiceId} disabled={!v.enabled}>
                {v.name}
                {!v.enabled ? '（已停用）' : ''}
              </option>
            ))}
        </select>
      </label>
      <button disabled={action.pending || !current.data}>保存默认音色</button>
      <Feedback message={action.message} error={action.error || current.error} />
    </form>
  );
}

function WorkLinkList({ characterId }: { characterId: string }) {
  const links = useRemote(WorkLinkAdminEndpoints.listWorkLinks, { params: { characterId } });
  const action = useAction();
  const [editing, setEditing] = useState<WorkLink | 'new' | null>(null);
  const [coverId, setCoverId] = useState<string | null>(null);
  function open(target: WorkLink | 'new') {
    setEditing(target);
    setCoverId(target === 'new' ? null : target.coverMediaId);
  }
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const source = String(form.get('source') ?? '').trim();
    const body = {
      title: String(form.get('title') ?? '').trim(),
      url: String(form.get('url') ?? '').trim(),
      source: source || null,
      appHint: String(form.get('appHint') ?? 'web') as WorkLink['appHint'],
      coverMediaId: coverId,
      enabled: form.get('enabled') === 'on',
    };
    const ok = await action.run(
      () =>
        editing === 'new'
          ? api.call(WorkLinkAdminEndpoints.createWorkLink, { params: { characterId }, body })
          : api.call(WorkLinkAdminEndpoints.updateWorkLink, {
              params: { characterId, workLinkId: (editing as WorkLink).workLinkId },
              body,
            }),
      '已保存',
    );
    if (ok) {
      setEditing(null);
      links.refresh();
    }
  }
  return (
    <section>
      <Feedback message={action.message} error={action.error || links.error} />
      <button className="primary" onClick={() => open('new')}>
        添加作品链接
      </button>
      {editing && (
        <form className="panel" onSubmit={(e) => void save(e)}>
          <label>
            标题
            <input
              name="title"
              required
              maxLength={100}
              defaultValue={editing === 'new' ? '' : editing.title}
            />
          </label>
          <label>
            网址
            <input
              name="url"
              type="url"
              required
              maxLength={2000}
              defaultValue={editing === 'new' ? '' : editing.url}
            />
          </label>
          <label>
            来源（例：QQ 音乐）
            <input
              name="source"
              maxLength={30}
              defaultValue={editing === 'new' ? '' : (editing.source ?? '')}
            />
          </label>
          <label>
            类型
            <select name="appHint" defaultValue={editing === 'new' ? 'web' : editing.appHint}>
              {Object.entries(hintNames).map(([value, label]) => (
                <option key={value} value={value}>
                  {label}
                </option>
              ))}
            </select>
          </label>
          <label>
            封面{coverId ? '（已上传）' : '（可选）'}
            <input
              type="file"
              accept="image/*"
              onChange={(e) => {
                const picked = e.target.files?.[0];
                if (picked)
                  void action.run(async () => {
                    const media = await upload('character_avatar', picked);
                    setCoverId(media.mediaId);
                  }, '封面已上传；保存后生效');
              }}
            />
          </label>
          <label className="check">
            <input
              type="checkbox"
              name="enabled"
              defaultChecked={editing === 'new' ? true : editing.enabled}
            />
            启用
          </label>
          <div className="button-row">
            <button className="primary" disabled={action.pending}>
              保存
            </button>
            <button type="button" onClick={() => setEditing(null)}>
              取消
            </button>
          </div>
        </form>
      )}
      <table>
        <thead>
          <tr>
            <th>封面</th>
            <th>标题</th>
            <th>类型</th>
            <th>检查</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {links.data?.items.map((l) => (
            <tr key={l.workLinkId}>
              <td>{l.coverMediaId ? <Cover mediaId={l.coverMediaId} /> : '—'}</td>
              <td>
                <a href={l.url} target="_blank" rel="noopener noreferrer">
                  {l.title}
                </a>
                {l.source && <small> · {l.source}</small>}
              </td>
              <td>{hintNames[l.appHint]}</td>
              <td>
                {l.lastCheck ? (
                  <span className={l.lastCheck.ok ? 'tag success' : 'tag danger'}>
                    {l.lastCheck.ok ? '能打开' : '打不开'}
                  </span>
                ) : (
                  <span className="tag">未检查</span>
                )}
              </td>
              <td>
                <span className={l.enabled ? 'tag success' : 'tag'}>
                  {l.enabled ? '启用' : '停用'}
                </span>
              </td>
              <td>
                <button onClick={() => open(l)}>编辑</button>
                <button
                  disabled={action.pending}
                  onClick={() =>
                    void action
                      .run(
                        () =>
                          api.call(WorkLinkAdminEndpoints.deleteWorkLink, {
                            params: { characterId, workLinkId: l.workLinkId },
                          }),
                        '已删除',
                      )
                      .then((ok) => ok && links.refresh())
                  }
                >
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </section>
  );
}

function Cover({ mediaId }: { mediaId: string }) {
  const media = useRemote(MediaEndpoints.getMedia, { params: { mediaId } });
  return media.data ? (
    <img
      className="asset-thumb"
      src={adminMediaUrl(media.data.thumbnailUrl ?? media.data.url)}
      alt=""
      loading="lazy"
    />
  ) : null;
}
