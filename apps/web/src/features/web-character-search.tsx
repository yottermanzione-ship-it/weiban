/**
 * 联网查找公开人物或作品（S 的站外候选；5.6 起带身份说明、逐项出处、未核实标记，T-20261104e）。
 *
 * - 用户手动点一次才向联网供应商发查询（平台付费、计用户每日额度）；只给 2～64 字的搜索词（allowWebSearch）。
 * - 每个候选单独一项：同名的不同人物分开列出，附身份说明（没有可靠来源写「暂未核实身份」）和可点击的公开出处
 *   （新窗口打开，不带来源页信息）。网页资料是线索，不是平台结论，所以标「未核实」，除非后台核实过。
 * - 点击只提交候选 ID：「添加 / 去聊天」先请服务器重读候选与实体关联，再走现有角色页（添加闸门在那里）；
 *   「自行创建 / 申请官方制作」只把候选 ID 带到创建 / 申请页，那边再向服务器读预填资料。
 * - 同名的不止一位时，可以补充作品或职业再查（又一次手动查找）。
 * 切换账号、换搜索词后迟到的旧响应一律丢弃。
 */
import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import {
  SearchEndpoints,
  type AuthResponse,
  type CharacterSearchCandidate,
  type WebCandidateResolution,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { useAuth } from '../app/auth.js';
import { CharacterAvatar } from './character-avatar.js';
import { OldIcon } from './old-icons.js';
import { MenuGroup, MenuRow } from './shell-kit.js';
import {
  allowWebSearch,
  refineWebQuery,
  sourceLabel,
  webCandidateAction,
  webCandidateIdentity,
  webCandidatePrefillHref,
  webCandidateSources,
  webCandidateUnverified,
  webCandidatesAmbiguous,
  webResolutionHref,
} from './site-search-logic.js';

/** 一次补充的作品 / 职业最多几个字（合起来仍不超过 64 字）。 */
const REFINE_MAX_CHARS = 32;

/**
 * 手动联网查找入口。切换搜索词时由父组件 key 重建。
 * title：放在站内结果下面时写「没有你要找的？」之类的引导；站内为空时不写。
 */
export function WebCharacterSearch({ query, title }: { query: string; title?: string }) {
  const { session } = useAuth();
  return session ? (
    <CandidateSearch
      key={`${session.user.userId}:${session.session.sessionId}:${query}`}
      query={query}
      session={session}
      title={title}
    />
  ) : null;
}

function CandidateSearch({
  query,
  session,
  title,
}: {
  query: string;
  session: AuthResponse;
  title?: string;
}) {
  const owner = useRef(`${session.user.userId}:${session.session.sessionId}`);
  owner.current = `${session.user.userId}:${session.session.sessionId}`;
  const [asked, setAsked] = useState(query);
  const [items, setItems] = useState<CharacterSearchCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [extra, setExtra] = useState('');
  const request = useRef(0);
  async function search(text: string) {
    if (busy || !allowWebSearch(text)) return;
    const current = owner.current;
    const ordinal = ++request.current;
    setBusy(true);
    setError('');
    try {
      const result = await api.call(SearchEndpoints.characterCandidates, {
        body: { query: text },
        networkOnly: true,
      });
      if (owner.current !== current || ordinal !== request.current) return;
      setAsked(text);
      setItems(result.items);
      setExtra('');
    } catch (e) {
      if (owner.current === current && ordinal === request.current) setError(friendlyError(e));
    } finally {
      if (owner.current === current && ordinal === request.current) setBusy(false);
    }
  }
  // 5.5：一个字、空白、超过 64 字只在站内搜，不显示联网查找（收费）入口。
  if (!allowWebSearch(query)) return null;
  const refined = refineWebQuery(query, extra);
  const ambiguous = !!items && webCandidatesAmbiguous(items);
  return (
    <section className="web-candidates" aria-label="联网角色候选">
      {title && <p className="hint page-note">{title}</p>}
      <p className="hint page-note">
        只查找公众人物和知名作品角色，请勿输入朋友、家人或私人信息。网页资料仅供参考，尚未核实。
      </p>
      {!items && (
        <MenuGroup>
          <MenuRow
            label={busy ? '正在联网查找…' : '查找公开人物或作品'}
            disabled={busy}
            onClick={() => void search(query)}
          />
        </MenuGroup>
      )}
      {error && <p role="alert">{error}</p>}
      {items?.length === 0 && (
        <p role="status" className="hint page-note">
          没有找到「{asked}」的公开资料
        </p>
      )}
      {items && items.length > 0 && (
        <section className="wx-search-group site-search" aria-label="公开资料候选">
          <h2>公开资料候选 · 「{asked}」</h2>
          {items.map((item, index) => (
            <CandidateRow key={item.candidateId ?? `${index}:${item.sourceUrl}`} item={item} />
          ))}
        </section>
      )}
      {items && (
        <form
          className="web-candidates-refine"
          onSubmit={(event) => {
            event.preventDefault();
            if (refined) void search(refined);
          }}
        >
          <p className="hint page-note">
            {ambiguous
              ? '同名的不止一位，可以补充作品或职业再查一次。'
              : '不是你要找的？可以补充作品或职业再查一次。'}
          </p>
          <div className="web-candidates-refine-row">
            <input
              type="search"
              value={extra}
              maxLength={REFINE_MAX_CHARS}
              placeholder="例如：演员、某部作品名"
              aria-label="补充作品或职业"
              onChange={(event) => setExtra(event.target.value)}
            />
            <button type="submit" disabled={busy || !refined}>
              {busy ? '正在查找…' : '再查一次'}
            </button>
          </div>
        </form>
      )}
    </section>
  );
}

function CandidateRow({ item }: { item: CharacterSearchCandidate }) {
  const navigate = useNavigate();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const action = webCandidateAction(item);
  const sources = webCandidateSources(item);
  const unverified = webCandidateUnverified(item);
  const candidateId = item.candidateId;

  /** 添加 / 去聊天：只提交候选 ID，服务器重读后给出去哪；关联已失效时退回创建 / 申请。 */
  async function open() {
    if (!candidateId || pending) return;
    setPending(true);
    setError('');
    try {
      const resolution: WebCandidateResolution = await api.call(SearchEndpoints.resolveCandidate, {
        body: { candidateId },
        networkOnly: true,
      });
      const href = webResolutionHref(resolution);
      if (href) navigate(href);
      else navigate(webCandidatePrefillHref('create', candidateId));
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }

  return (
    <div className="wx-search-row site-search-row web-candidate" data-candidate={candidateId}>
      {item.characterId && item.character ? (
        <CharacterAvatar id={item.characterId} profile={item.character} size={40} />
      ) : (
        <OldIcon name="wechat/search" size={24} />
      )}
      <span className="wx-search-text">
        <span>
          {item.name}
          {unverified && <em className="web-candidate-badge">未核实</em>}
        </span>
        <small>{webCandidateIdentity(item)}</small>
        {sources.length > 0 && (
          <small className="web-candidate-sources">
            出处：
            {sources.map((source, i) => (
              <span key={source.url}>
                {i > 0 && '、'}
                <a
                  href={source.url}
                  target="_blank"
                  rel="noopener noreferrer nofollow"
                  referrerPolicy="no-referrer"
                  title={source.title}
                >
                  {sourceLabel(source)}
                </a>
              </span>
            ))}
          </small>
        )}
        {error && <small role="alert">{error}</small>}
      </span>
      <span className="web-candidate-actions">
        {action !== 'create' && candidateId ? (
          <button
            type="button"
            className={`text-button site-search-action${action === 'chat' ? ' is-chat' : ''}`}
            disabled={pending}
            onClick={() => void open()}
          >
            {action === 'chat' ? '去聊天' : '添加'}
          </button>
        ) : candidateId ? (
          <>
            <Link
              className="site-search-action"
              to={webCandidatePrefillHref('create', candidateId)}
            >
              自行创建
            </Link>
            <Link
              className="site-search-action"
              to={webCandidatePrefillHref('request', candidateId)}
            >
              申请官方制作
            </Link>
          </>
        ) : null}
      </span>
    </div>
  );
}

export interface CandidatePrefill {
  status: 'idle' | 'loading' | 'ready' | 'error';
  resolution: WebCandidateResolution | null;
  error: string;
}

/**
 * 创建 / 申请页用候选 ID 向服务器重读预填资料（不用地址栏里的名字或网址）。
 * candidateId 为空时什么也不做；候选过期给出提示，页面照常空白可填。
 */
export function useCandidatePrefill(candidateId: string | null): CandidatePrefill {
  const { session } = useAuth();
  const owner = session ? `${session.user.userId}:${session.session.sessionId}` : '';
  const [state, setState] = useState<CandidatePrefill>({
    status: candidateId ? 'loading' : 'idle',
    resolution: null,
    error: '',
  });
  useEffect(() => {
    if (!candidateId || !owner) {
      setState({ status: 'idle', resolution: null, error: '' });
      return;
    }
    let live = true;
    setState({ status: 'loading', resolution: null, error: '' });
    api
      .call(SearchEndpoints.resolveCandidate, { body: { candidateId }, networkOnly: true })
      .then((resolution) => {
        if (live) setState({ status: 'ready', resolution, error: '' });
      })
      .catch((e: unknown) => {
        if (live) setState({ status: 'error', resolution: null, error: friendlyError(e) });
      });
    return () => {
      live = false;
    };
  }, [candidateId, owner]);
  return state;
}

/** 预填提示条：候选已关联到本站官方角色时引导去添加；过期时说明。 */
export function CandidatePrefillNote({ prefill }: { prefill: CandidatePrefill }) {
  if (prefill.status === 'error')
    return (
      <p className="hint page-note" role="status">
        {prefill.error || '这个候选已过期，请重新联网查找'}
      </p>
    );
  const resolution = prefill.resolution;
  if (!resolution) return null;
  const href = webResolutionHref(resolution);
  if (href)
    return (
      <p className="hint page-note" role="status">
        本站已有这个角色，
        <Link to={href}>{resolution.action === 'chat' ? '去聊天' : '去添加'}</Link>
      </p>
    );
  return resolution.prefill ? (
    <p className="hint page-note" role="status">
      已按公开资料预填「{resolution.prefill.name}」，资料尚未核实，请自行确认后再提交。
    </p>
  ) : null;
}
