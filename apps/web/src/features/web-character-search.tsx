import { useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  SearchEndpoints,
  type AuthResponse,
  type CharacterSearchCandidate,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError } from '../data/use-remote.js';
import { useAuth } from '../app/auth.js';
import { MenuGroup, MenuRow } from './shell-kit.js';

/** 只在站内搜索为空时显示；手动点击才向联网供应商发查询。切换搜索词时由父组件 key 重建。 */
export function WebCharacterSearch({ query }: { query: string }) {
  const { session } = useAuth();
  return session ? (
    <CandidateSearch
      key={`${session.user.userId}:${session.session.sessionId}:${query}`}
      query={query}
      session={session}
    />
  ) : null;
}
function CandidateSearch({ query, session }: { query: string; session: AuthResponse }) {
  const owner = useRef(`${session.user.userId}:${session.session.sessionId}`);
  owner.current = `${session.user.userId}:${session.session.sessionId}`;
  const [items, setItems] = useState<CharacterSearchCandidate[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const request = useRef(0);
  async function search() {
    if (busy || !session) return;
    const current = owner.current;
    const ordinal = ++request.current;
    setBusy(true);
    setError('');
    try {
      const result = await api.call(SearchEndpoints.characterCandidates, {
        body: { query },
        networkOnly: true,
      });
      if (owner.current !== current || ordinal !== request.current) return;
      setItems(result.items);
    } catch (e) {
      if (owner.current === current && ordinal === request.current) setError(friendlyError(e));
    } finally {
      if (owner.current === current && ordinal === request.current) setBusy(false);
    }
  }
  if (query.trim().length < 2) return null;
  return (
    <section aria-label="联网角色候选">
      <p className="hint page-note">
        只查找公众人物和知名作品角色，请勿输入朋友、家人或私人信息。网页资料尚未核实。
      </p>
      <MenuGroup>
        <MenuRow
          label={busy ? '正在联网查找…' : '联网找找'}
          disabled={busy}
          onClick={() => void search()}
        />
      </MenuGroup>
      {error && <p role="alert">{error}</p>}
      {items?.length === 0 && (
        <p role="status" className="hint page-note">
          没有找到合适的公开资料
        </p>
      )}
      {items && items.length > 0 && (
        <MenuGroup>
          {items.map((item) => (
            <div key={item.sourceUrl}>
              <MenuRow
                label={item.name}
                subtitle={item.description || item.title}
                to={`/characters/custom/new?${new URLSearchParams({ candidateName: item.name, candidateDescription: item.description, candidateSource: item.sourceUrl })}`}
              />
              <p className="hint page-note">
                <a href={item.sourceUrl} target="_blank" rel="noopener noreferrer">
                  查看公开来源
                </a>{' '}
                ·{' '}
                <Link
                  to={`/characters/custom/new?${new URLSearchParams({ candidateName: item.name, candidateDescription: item.description, candidateSource: item.sourceUrl })}`}
                >
                  用这个名字创建角色
                </Link>
              </p>
            </div>
          ))}
        </MenuGroup>
      )}
    </section>
  );
}
