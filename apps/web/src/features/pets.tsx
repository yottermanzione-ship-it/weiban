import { useEffect, useMemo, useRef, useState, type ChangeEvent, type ReactNode } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import {
  Cat,
  Dog,
  HandTap,
  Plant,
  Rabbit,
  UsersThree,
  CaretLeft,
  CaretRight,
  DotsThree,
  Hand,
  PawPrint,
  Plus,
  TennisBall,
  Fish,
} from '@phosphor-icons/react';
import {
  PET_LIMITS,
  PetEndpoints,
  type Pet,
  type PetDetail,
  type PetSpecies,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useUpdates } from '../data/updates.js';
import { useCharacterNames } from '../data/character-names.js';
import { prepareImage, uploadMedia } from '../data/upload.js';
import { CharacterAvatar } from './character-avatar.js';
import { MediaImg } from './media.js';
import { Dialog, showToast } from './toast.js';
import { IconTile, NavBar } from './shell-kit.js';

/*
 * 共同领养宠物（PLAY-02；设计 pet.md）。只奖励不惩罚：没有饥饿值、没有「今天还没喂」、没有上限提示。
 * 按钮互动不调用模型；反应小字是预置文案。
 */

const stageNames: Record<string, string> = { baby: '幼年', junior: '少年', adult: '成年' };
const reactions = {
  feed: ['吧唧吧唧', '吃得好香', '还要一口'],
  play: ['扑！', '转圈圈', '开心地跳起来'],
  pat: ['呼噜呼噜～', '蹭蹭你的手', '眯起眼睛'],
} as const;

function usePetsChanged(refresh: () => void) {
  useUpdates((update) => {
    if (update.type === 'data.changed' && (update.data as { section?: string })?.section === 'pets')
      refresh();
  });
}

function useNames(ids: string[]) {
  const { state } = useChat();
  const names = useCharacterNames(ids);
  return (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || 'TA';
}

function useActiveContactIds() {
  const { state } = useChat();
  return useMemo(
    () => new Set(state.contacts.filter((c) => c.status === 'active').map((c) => c.characterId)),
    [state.contacts],
  );
}

function PetImage({ url, alt, size }: { url: string | null; alt: string; size?: number }) {
  const [failed, setFailed] = useState(false);
  const [loaded, setLoaded] = useState(false);
  return (
    <span className="pet-image" style={size ? { width: size, height: size } : undefined}>
      {(!url || failed) && <span className="pet-image-fallback">{alt}</span>}
      {url && !failed && (
        <img
          src={url}
          alt={alt}
          loading="lazy"
          style={{ opacity: loaded ? 1 : 0 }}
          onLoad={() => setLoaded(true)}
          onError={() => setFailed(true)}
        />
      )}
    </span>
  );
}

/** 聊天信息页「和 TA 的相处 › 我们的宠物」。 */
export function PetRow({ characterId }: { characterId: string }) {
  const pets = useRemote(PetEndpoints.listPets, { query: { characterId } });
  usePetsChanged(pets.refresh);
  const pet = pets.data?.items.find((p) => p.status === 'active');
  return (
    <Link
      className="row-link"
      to={pet ? `/pets/${pet.petId}` : `/pets/adopt?characterId=${characterId}`}
    >
      <span>我们的宠物</span>
      <small>{pet ? pet.name : '一起领养'} ›</small>
    </Link>
  );
}

// ---------- 宠物总览（服务 › 宠物） ----------

export function PetsPage() {
  const pets = useRemote(PetEndpoints.listPets, { query: {} });
  usePetsChanged(pets.refresh);
  const items = pets.data?.items ?? [];
  const active = items.filter((p) => p.status === 'active');
  const memories = items.filter((p) => p.status === 'sent_away');
  const name = useNames(items.map((p) => p.characterId));
  const contacts = useActiveContactIds();
  const full = active.length >= PET_LIMITS.activeTotal;
  const navigate = useNavigate();
  if (pets.data && items.length === 0 && !flag(GUIDE_SEEN))
    return (
      <PetGuide
        onStart={() => {
          setFlag(GUIDE_SEEN);
          navigate('/pets/adopt');
        }}
      />
    );
  const row = (pet: Pet, memory: boolean) => {
    const deleted = !memory && !contacts.has(pet.characterId);
    return (
      <Link key={pet.petId} to={`/pets/${pet.petId}`} className={memory || deleted ? 'muted' : ''}>
        <PetImage url={pet.image.url} alt={pet.name} size={56} />
        <span className="overview-name">
          {pet.name}
          <small className="hint">
            {deleted
              ? `${name(pet.characterId)} 已删除，恢复 TA 时${pet.name}会回来`
              : memory
                ? `和 ${name(pet.characterId)} · 养了 ${pet.daysAdopted} 天`
                : `和 ${name(pet.characterId)} 一起养 · 第 ${pet.daysAdopted} 天`}
          </small>
          {!memory && <span className="tag">{stageNames[pet.stage] ?? ''}</span>}
        </span>
        <CaretRight />
      </Link>
    );
  };
  return (
    <main>
      <h1 className="page-title">宠物</h1>
      {pets.loading && !pets.data && <span className="spinner" role="status" />}
      {pets.error && !pets.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={pets.refresh}>重试</button>
        </div>
      )}
      {pets.data && active.length === 0 && memories.length === 0 ? (
        <div className="empty">
          <PawPrint size={48} aria-hidden />
          <p>和 TA 一起养一只小家伙吧</p>
          <Link className="button primary" to="/pets/adopt">
            开始领养
          </Link>
        </div>
      ) : (
        pets.data && (
          <>
            <p className="hint">
              在养 {active.length} 只（最多 {PET_LIMITS.activeTotal} 只）
            </p>
            <div className="panel rows">{active.map((p) => row(p, false))}</div>
            {full ? (
              <p className="hint center">最多同时养 {PET_LIMITS.activeTotal} 只</p>
            ) : (
              <Link className="plain full" to="/pets/adopt">
                ＋ 和 TA 一起领养
              </Link>
            )}
            {memories.length > 0 && (
              <>
                <h2 className="section-label">回忆</h2>
                <div className="panel rows">{memories.map((p) => row(p, true))}</div>
              </>
            )}
          </>
        )
      )}
    </main>
  );
}

// ---------- 首次引导（docs/refactor/02 第 6.3 节） ----------

const GUIDE_SEEN = 'weiban:pet-guide-seen';
const TIP_SEEN = 'weiban:pet-tip-seen';
function flag(key: string) {
  try {
    return localStorage.getItem(key) === '1';
  } catch {
    return false;
  }
}
function setFlag(key: string) {
  try {
    localStorage.setItem(key, '1');
  } catch {
    // 无法记住时下次再显示
  }
}

function PetGuide({ onStart }: { onStart(): void }) {
  const { state } = useChat();
  const hasContacts = state.contacts.some((c) => c.status === 'active' && c.conversationId);
  return (
    <main>
      <section className="pet-guide" aria-label="宠物是什么">
        <div className="pet-guide-art" aria-hidden>
          <IconTile icon={Cat} tint="orange" size="lg" />
          <IconTile icon={Dog} tint="gold" size="lg" />
          <IconTile icon={Rabbit} tint="pink" size="lg" />
        </div>
        <h2>和 TA 一起养一只小家伙</h2>
        <div className="guide-lines">
          <p className="guide-line">
            <UsersThree size={24} aria-hidden />
            <span>
              <strong>你们俩一起养</strong>
              <small>TA 会在聊天里提起它、发它的照片</small>
            </span>
          </p>
          <p className="guide-line">
            <HandTap size={24} aria-hidden />
            <span>
              <strong>点一点就能互动</strong>
              <small>喂食、玩耍、摸摸，不花余额</small>
            </span>
          </p>
          <p className="guide-line">
            <Plant size={24} aria-hidden />
            <span>
              <strong>它只会长大，不会生病挨饿</strong>
              <small>不用每天打卡，想起来就来看看</small>
            </span>
          </p>
        </div>
        {hasContacts ? (
          <button className="primary" onClick={onStart}>
            开始领养
          </button>
        ) : (
          <Link className="button primary" to="/discover/plaza">
            先去添加一个 TA
          </Link>
        )}
        <p className="hint center">每个 TA 可以一起养 1 只，最多 {PET_LIMITS.activeTotal} 只</p>
      </section>
    </main>
  );
}

/** 从聊天里按 TA 打开：已有宠物 → 宠物主页；没有 → 领养页（TA 已选好）。 */
export function PetWithPage() {
  const { characterId = '' } = useParams();
  const navigate = useNavigate();
  const pets = useRemote(PetEndpoints.listPets, { query: { characterId }, networkOnly: true });
  useEffect(() => {
    if (!pets.data) return;
    const pet = pets.data.items.find((p) => p.status === 'active');
    navigate(pet ? `/pets/${pet.petId}` : `/pets/adopt?characterId=${characterId}`, {
      replace: true,
    });
  }, [pets.data, characterId, navigate]);
  return (
    <main>
      {pets.error ? (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={pets.refresh}>重试</button>
        </div>
      ) : (
        <span className="spinner" role="status" />
      )}
    </main>
  );
}

// ---------- 领养（一页完成，第 6.4 节） ----------

export function AdoptPage() {
  const [guided, setGuided] = useState(() => flag(GUIDE_SEEN));
  if (!guided)
    return (
      <PetGuide
        onStart={() => {
          setFlag(GUIDE_SEEN);
          setGuided(true);
        }}
      />
    );
  return <AdoptForm />;
}

function AdoptForm() {
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const { state } = useChat();
  const pets = useRemote(PetEndpoints.listPets, { query: {} });
  const species = useRemote(PetEndpoints.listSpecies);
  const activePets = (pets.data?.items ?? []).filter((p) => p.status === 'active');
  const taken = new Set(activePets.map((p) => p.characterId));
  const candidates = state.contacts.filter(
    (c) => c.status === 'active' && c.conversationId && !taken.has(c.characterId),
  );
  const name = useNames(state.contacts.map((c) => c.characterId));
  const preset = params.get('characterId');
  const [chosen, setChosen] = useState<string | null>(preset);
  const characterId = chosen && candidates.some((c) => c.characterId === chosen) ? chosen : null;
  const [pick, setPick] = useState<{ speciesId: string; appearanceId: string } | null>(null);
  const [petName, setPetName] = useState('');
  const [naming, setNaming] = useState<{
    requestId: string;
    names: string[];
    status: string;
  } | null>(null);
  const [namingNote, setNamingNote] = useState('');
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const requestKey = useRef(crypto.randomUUID());
  const chosenSpecies: PetSpecies | undefined = species.data?.items.find(
    (s) => s.speciesId === pick?.speciesId,
  );
  const appearance = chosenSpecies?.appearances.find((a) => a.appearanceId === pick?.appearanceId);
  const full = activePets.length >= PET_LIMITS.activeTotal;

  // 起名请求：轮询直到候选名回来（也随 data.changed(pets) 刷新）。
  const [namingRevision, setNamingRevision] = useState(0);
  usePetsChanged(() => setNamingRevision((v) => v + 1));
  useEffect(() => {
    if (!naming || naming.status !== 'pending') return;
    let active = true;
    const timer = window.setTimeout(() => {
      void api
        .call(PetEndpoints.getNamingRequest, {
          params: { requestId: naming.requestId },
          networkOnly: true,
        })
        .then((r) => {
          if (!active) return;
          setNaming({ requestId: r.requestId, names: r.names, status: r.status });
          if (r.status === 'failed') setNamingNote('TA 暂时没想出来，你可以先自己起一个');
          else if (r.status === 'ready') setNamingNote('');
        })
        .catch(() => {});
    }, 1500);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [naming, namingRevision]);

  async function askName() {
    if (!characterId || !pick) return;
    setNamingNote(`${name(characterId)} 正在想名字…`);
    try {
      const r = await api.call(PetEndpoints.requestNames, {
        body: { characterId, speciesId: pick.speciesId, appearanceId: pick.appearanceId },
      });
      setNaming({ requestId: r.requestId, names: r.names, status: r.status });
      if (r.status === 'ready') setNamingNote('');
    } catch (e) {
      setNamingNote(
        e instanceof ApiFailure && e.code === 'insufficient_balance'
          ? `余额不足，${name(characterId)} 暂时没法起名，你可以先自己起一个`
          : friendlyError(e),
      );
    }
  }
  const nameLength = Array.from(petName.trim()).length;
  const missing = !characterId
    ? '先选和谁一起养'
    : !pick
      ? '先选一只'
      : nameLength === 0
        ? '先起个名字'
        : nameLength > PET_LIMITS.nameMaxChars
          ? `名字最多 ${PET_LIMITS.nameMaxChars} 个字`
          : null;
  async function adopt() {
    if (missing || !characterId || !pick) return;
    setPending(true);
    setError('');
    try {
      const pet = await api.call(PetEndpoints.adopt, {
        body: {
          clientRequestId: requestKey.current,
          characterId,
          speciesId: pick.speciesId,
          appearanceId: pick.appearanceId,
          name: petName.trim(),
          namingRequestId: naming?.requestId ?? null,
        },
      });
      navigate(`/pets/${pet.petId}?new=1`, { replace: true });
    } catch (e) {
      setError(
        e instanceof ApiFailure && e.code === 'limit_reached'
          ? `每个 TA 只能一起养 1 只，最多同时养 ${PET_LIMITS.activeTotal} 只`
          : friendlyError(e),
      );
    } finally {
      setPending(false);
    }
  }
  return (
    <main className="adopt-page">
      <NavBar title="一起领养" fallback="/services/pets" />
      <div className="adopt-preview" aria-live="polite">
        {appearance ? (
          <PetImage url={appearance.images.baby.url} alt={appearance.name} size={96} />
        ) : (
          <span className="adopt-placeholder">选一只吧</span>
        )}
        <div>
          <strong>{petName.trim() || '还没起名'}</strong>
          {characterId ? (
            <small className="hint pet-with">
              <CharacterAvatar id={characterId} size={20} /> 和 {name(characterId)} 一起养
            </small>
          ) : (
            <small className="hint">还没选和谁一起养</small>
          )}
        </div>
      </div>

      <h2 className="adopt-step">① 和谁一起养</h2>
      {pets.loading && !pets.data ? (
        <div className="skeleton-row" role="status" />
      ) : full || candidates.length === 0 ? (
        <p className="hint">
          {state.contacts.some((c) => c.status === 'active')
            ? `每个 TA 只能一起养 1 只，最多同时养 ${PET_LIMITS.activeTotal} 只 · `
            : '还没有角色 · '}
          {state.contacts.some((c) => c.status === 'active') ? (
            <Link to="/services/pets">去看看我的宠物</Link>
          ) : (
            <Link to="/discover/plaza">去角色广场</Link>
          )}
        </p>
      ) : (
        <div className="adopt-who" role="radiogroup" aria-label="和谁一起养">
          {candidates.map((c) => (
            <button
              key={c.characterId}
              type="button"
              role="radio"
              aria-checked={characterId === c.characterId}
              onClick={() => setChosen(c.characterId)}
            >
              <CharacterAvatar id={c.characterId} size={48} />
              {name(c.characterId)}
            </button>
          ))}
        </div>
      )}

      <h2 className="adopt-step">② 选一只</h2>
      {species.loading && !species.data && <div className="skeleton-row" role="status" />}
      {species.error && !species.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={species.refresh}>重试</button>
        </div>
      )}
      {species.data?.items.length === 0 && (
        <div className="empty">
          <p>小家伙们正在赶来，稍后再试试</p>
          <button onClick={species.refresh}>重试</button>
        </div>
      )}
      <div className="adopt-pets" role="radiogroup" aria-label="选一只">
        {species.data?.items.flatMap((s) =>
          s.appearances.map((a) => (
            <button
              key={a.appearanceId}
              type="button"
              role="radio"
              aria-checked={pick?.appearanceId === a.appearanceId}
              onClick={() => setPick({ speciesId: s.speciesId, appearanceId: a.appearanceId })}
            >
              <PetImage url={a.images.baby.url} alt={a.name} />
              {a.name}
            </button>
          )),
        )}
      </div>
      {appearance && (
        <div className="stage-strip">
          长大后：
          {(['baby', 'junior', 'adult'] as const).map((stage) => (
            <span key={stage} className="stage-thumb">
              <PetImage url={appearance.images[stage].url} alt={stageNames[stage]!} size={48} />
              <small>{stageNames[stage]}</small>
            </span>
          ))}
        </div>
      )}

      <h2 className="adopt-step">③ 起个名字</h2>
      <div className="stack">
        <label>
          给它起个名字
          <input
            value={petName}
            maxLength={16}
            onChange={(e) => setPetName(e.target.value)}
            aria-invalid={nameLength > PET_LIMITS.nameMaxChars}
          />
        </label>
        <small className={nameLength > PET_LIMITS.nameMaxChars ? 'error' : 'hint'}>
          {nameLength}/{PET_LIMITS.nameMaxChars}
        </small>
        {characterId && pick && (
          <button
            className="tonal"
            disabled={naming?.status === 'pending'}
            onClick={() => void askName()}
          >
            让 {name(characterId)} 起名
          </button>
        )}
        {namingNote && <small className="hint">{namingNote}</small>}
        {naming?.status === 'ready' && (
          <div className="chip-row">
            {naming.names.map((n) => (
              <button
                key={n}
                className="chip"
                aria-selected={petName === n}
                onClick={() => setPetName(n)}
              >
                {n}
              </button>
            ))}
          </div>
        )}
      </div>
      {error && <p role="alert">{error}</p>}
      <div className="adopt-footer">
        <button className="primary" disabled={pending || !!missing} onClick={() => void adopt()}>
          {missing ?? `和 ${name(characterId!)} 一起领养「${petName.trim()}」`}
        </button>
      </div>
    </main>
  );
}

/** 领养后第一次进宠物主页的一次性新手提示（第 6.6 节）。 */
function PetTip({ petName, who }: { petName: string; who: string }) {
  const [open, setOpen] = useState(() => !flag(TIP_SEEN));
  if (!open) return null;
  return (
    <div className="inline-tip" role="note">
      <p>
        点下面的按钮和{petName}玩
        <br />
        {who} 会在聊天里提起{petName}
        <br />第 {PET_LIMITS.stageStartDay.junior} 天长成少年，第 {PET_LIMITS.stageStartDay.adult}{' '}
        天长成成年
      </p>
      <button
        className="text-button"
        onClick={() => {
          setFlag(TIP_SEEN);
          setOpen(false);
        }}
      >
        知道了
      </button>
    </div>
  );
}

// ---------- 宠物主页 ----------

type View = 'home' | 'timeline' | 'album' | 'settings' | 'rename';

export function PetPage() {
  const { petId = '' } = useParams();
  const [params] = useSearchParams();
  const navigate = useNavigate();
  const remote = useRemote(PetEndpoints.getPet, { params: { petId }, networkOnly: true });
  usePetsChanged(remote.refresh);
  const [pet, setPet] = useState<PetDetail | null>(null);
  const [view, setView] = useState<View>('home');
  const [reaction, setReaction] = useState<{ text: string; key: number } | null>(null);
  const [bounce, setBounce] = useState(0);
  const [error, setError] = useState('');
  const [confirmSendAway, setConfirmSendAway] = useState(false);
  const [newName, setNewName] = useState('');
  const [pop, setPop] = useState(params.get('new') === '1');
  const contacts = useActiveContactIds();
  const { state } = useChat();
  useEffect(() => {
    if (remote.data) setPet(remote.data);
  }, [remote.data]);
  const name = useNames(pet ? [pet.characterId] : []);
  if (!pet)
    return (
      <main>
        {remote.error ? (
          <div className="empty">
            <p>{remote.error}</p>
            <button onClick={remote.refresh}>重试</button>
          </div>
        ) : (
          <span className="spinner" role="status" />
        )}
      </main>
    );
  const memory = pet.status === 'sent_away';
  const deleted = !memory && !contacts.has(pet.characterId);
  const readOnly = memory || deleted;
  const who = name(pet.characterId);
  const conversationId = state.contacts.find(
    (c) => c.characterId === pet.characterId,
  )?.conversationId;

  async function interact(kind: 'feed' | 'play' | 'pat') {
    const options = reactions[kind];
    setReaction({ text: options[Math.floor(Math.random() * options.length)]!, key: Date.now() });
    setBounce((v) => v + 1);
    try {
      const r = await api.call(PetEndpoints.interact, {
        params: { petId },
        body: { kind, clientActionId: crypto.randomUUID() },
      });
      setPet((p) => (p ? { ...p, ...r.pet } : p));
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  async function update(body: { name?: string; allowMomentsShare?: boolean }) {
    setError('');
    try {
      setPet(await api.call(PetEndpoints.updatePet, { params: { petId }, body }));
      return true;
    } catch (e) {
      setError(friendlyError(e));
      return false;
    }
  }

  const header = (title: string, onBack: () => void, right?: ReactNode) => (
    <header className="page-header">
      <button className="text-button" aria-label="返回" onClick={onBack}>
        <CaretLeft size={24} />
      </button>
      <h1>{title}</h1>
      {right ?? <span />}
    </header>
  );

  if (view === 'timeline')
    return (
      <main>
        {header('成长记录', () => setView('home'))}
        <ol className="timeline">
          {pet.timeline.map((entry, i) => (
            <li key={i} className="timeline-item">
              <span className="timeline-dot" aria-hidden />
              <div className="timeline-content">
                <small className="timeline-time">
                  {new Date(entry.at).toLocaleDateString('zh-CN', {
                    month: 'long',
                    day: 'numeric',
                  })}
                </small>
                <p>{timelineText(entry, who)}</p>
              </div>
            </li>
          ))}
        </ol>
      </main>
    );
  if (view === 'album')
    return <PetAlbum pet={pet} who={who} readOnly={readOnly} onBack={() => setView('home')} />;
  if (view === 'rename')
    return (
      <main>
        {header(
          '改名字',
          () => setView('settings'),
          <button
            className="text-button"
            disabled={
              !newName.trim() || Array.from(newName.trim()).length > PET_LIMITS.nameMaxChars
            }
            onClick={() =>
              void update({ name: newName.trim() }).then((ok) => {
                if (ok) setView('settings');
              })
            }
          >
            完成
          </button>,
        )}
        <label>
          名字
          <input
            autoFocus
            value={newName}
            maxLength={16}
            onChange={(e) => setNewName(e.target.value)}
          />
        </label>
        <small
          className={Array.from(newName.trim()).length > PET_LIMITS.nameMaxChars ? 'error' : 'hint'}
        >
          {Array.from(newName.trim()).length}/{PET_LIMITS.nameMaxChars}
        </small>
        {error && <p role="alert">{error}</p>}
      </main>
    );
  if (view === 'settings')
    return (
      <main>
        {header('设置', () => setView('home'))}
        <div className="panel rows">
          <label className="switch-row">
            <span>
              允许 {who} 在朋友圈晒{pet.name}
              <small className="hint"> TA 只会晒{pet.name}，不会提到你</small>
            </span>
            <input
              type="checkbox"
              checked={pet.allowMomentsShare}
              onChange={(e) => void update({ allowMomentsShare: e.target.checked })}
            />
          </label>
          <button
            className="row-button"
            onClick={() => {
              setNewName(pet.name);
              setView('rename');
            }}
          >
            改名字
            <small>{pet.name} ›</small>
          </button>
        </div>
        <button className="danger full" onClick={() => setConfirmSendAway(true)}>
          送养
        </button>
        {error && <p role="alert">{error}</p>}
        {confirmSendAway && (
          <Dialog
            title={`送养 ${pet.name}？`}
            actions={[
              { label: '取消', onClick: () => setConfirmSendAway(false) },
              {
                label: '送养',
                primary: true,
                onClick: () => {
                  setConfirmSendAway(false);
                  void api
                    .call(PetEndpoints.sendAway, { params: { petId } })
                    .then(() => navigate('/services/pets', { replace: true }))
                    .catch((e) => setError(friendlyError(e)));
                },
              },
            ]}
          >
            <p className="hint">
              {pet.name}会移到「回忆」里，成长记录和相册都会保留。之后可以和 {who} 再领养一只
            </p>
          </Dialog>
        )}
      </main>
    );

  const stages = ['baby', 'junior', 'adult'] as const;
  const stageIndex = Math.max(0, stages.indexOf(pet.stage as (typeof stages)[number]));
  return (
    <main className="pet-page">
      {header(
        pet.name,
        () => navigate(-1),
        readOnly ? (
          <span className="tag neutral">{memory ? '回忆' : '只读'}</span>
        ) : (
          <button className="icon-button" aria-label="宠物设置" onClick={() => setView('settings')}>
            <DotsThree size={24} />
          </button>
        ),
      )}
      <div className={`pet-stage ${pop ? 'card-pop' : ''}`} onAnimationEnd={() => setPop(false)}>
        <span key={bounce} className={bounce ? 'pet-bounce' : ''}>
          <PetImage url={pet.image.url} alt={pet.name} />
        </span>
        <span className="tag stage-tag">{stageNames[pet.stage] ?? ''}</span>
        {reaction && (
          <span key={reaction.key} className="pet-reaction">
            「{reaction.text}」
          </span>
        )}
      </div>
      <h2 className="pet-name">{pet.name}</h2>
      <p className="hint pet-with">
        <Link to={`/characters/${pet.characterId}`} aria-label="查看资料">
          <CharacterAvatar id={pet.characterId} size={20} />
        </Link>
        {deleted
          ? `${who} 已删除，恢复 TA 时${pet.name}会回来`
          : `和 ${who} 一起养 · 领养第 ${pet.daysAdopted} 天`}
      </p>
      <p className="pet-intimacy">
        亲密值 <strong className="numeric">{pet.intimacy}</strong>
      </p>
      {!readOnly && <PetTip petName={pet.name} who={who} />}
      {!readOnly && (
        <div className="pet-actions">
          {(
            [
              ['feed', '喂食', Fish],
              ['play', '玩耍', TennisBall],
              ['pat', '摸摸', Hand],
            ] as const
          ).map(([kind, label, Icon]) => (
            <button key={kind} className="pet-action" onClick={() => void interact(kind)}>
              <span className="pet-action-icon">
                <Icon size={28} />
              </span>
              <small>{label}</small>
            </button>
          ))}
        </div>
      )}
      <ol className="growth-steps" aria-label="成长阶段">
        {stages.map((stage, i) => (
          <li key={stage} className={i <= stageIndex ? 'done' : ''}>
            <span aria-hidden />
            <small>{stageNames[stage]}</small>
          </li>
        ))}
      </ol>
      <p className="hint center">
        第 {PET_LIMITS.stageStartDay.junior} 天长成少年 · 第 {PET_LIMITS.stageStartDay.adult}{' '}
        天长成成年
      </p>
      <div className="panel rows">
        <button className="row-button" onClick={() => setView('timeline')}>
          成长记录 <small>›</small>
        </button>
        <button className="row-button" onClick={() => setView('album')}>
          相册 <small>›</small>
        </button>
      </div>
      {!readOnly && conversationId && (
        <Link className="plain full" to={`/chat/${conversationId}`}>
          去和 {who} 聊聊{pet.name}
        </Link>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

function timelineText(entry: PetDetail['timeline'][number], who: string) {
  const d = entry.detail;
  switch (entry.kind) {
    case 'adopted':
      return `和 ${d.characterName ?? who} 一起领养了${d.name ?? ''}${d.namedBy === 'character' ? `，名字是 ${d.characterName ?? who} 起的` : ''}`;
    case 'stage_changed':
      return `${d.name ?? ''}长成${stageNames[d.stage ?? ''] ?? ''}啦`;
    case 'renamed':
      return `${d.from ?? ''} 改名为 ${d.to ?? ''}`;
    case 'sent_away':
      return `${d.name ?? ''}被送养了`;
    default:
      return '';
  }
}

function PetAlbum({
  pet,
  who,
  readOnly,
  onBack,
}: {
  pet: PetDetail;
  who: string;
  readOnly: boolean;
  onBack(): void;
}) {
  const album = useRemote(PetEndpoints.listAlbum, {
    params: { petId: pet.petId },
    networkOnly: true,
  });
  const [uploading, setUploading] = useState(false);
  const [viewing, setViewing] = useState<string | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const photos = [...(album.data?.items ?? [])].sort((a, b) =>
    b.createdAt.localeCompare(a.createdAt),
  );
  async function pick(event: ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    setUploading(true);
    try {
      const prepared = await prepareImage(file);
      const media = await uploadMedia('pet_photo', prepared.blob);
      await api.call(PetEndpoints.addAlbumPhoto, {
        params: { petId: pet.petId },
        body: { mediaId: media.mediaId },
      });
      album.refresh();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setUploading(false);
    }
  }
  return (
    <main>
      <header className="page-header">
        <button className="text-button" aria-label="返回" onClick={onBack}>
          <CaretLeft size={24} />
        </button>
        <h1>相册</h1>
        {readOnly ? (
          <span />
        ) : (
          <button
            className="icon-button"
            aria-label="上传照片"
            disabled={uploading}
            onClick={() => input.current?.click()}
          >
            <Plus size={22} />
          </button>
        )}
      </header>
      <input ref={input} type="file" accept="image/*" hidden onChange={(e) => void pick(e)} />
      {uploading && <span className="spinner" role="status" aria-label="正在上传" />}
      {album.data && photos.length === 0 && (
        <p className="empty">
          {who} 发来的{pet.name}照片会收在这里
        </p>
      )}
      <div className="album-grid">
        {photos.map((photo) => (
          <button
            key={photo.photoId}
            className="album-cell"
            onClick={() => setViewing(photo.mediaId)}
          >
            <MediaImg mediaId={photo.mediaId} />
            {photo.source === 'character' && (
              <span className="album-source">
                <CharacterAvatar id={pet.characterId} size={16} />
              </span>
            )}
          </button>
        ))}
      </div>
      {viewing && (
        <div
          className="ios-save-scrim"
          role="dialog"
          aria-label="查看照片"
          onClick={() => setViewing(null)}
        >
          <MediaImg mediaId={viewing} thumbnail={false} />
        </div>
      )}
    </main>
  );
}
