import { Input, Modal, Spin, type InputRef } from 'antd';
import { ArrowBendDownLeftIcon, MagnifyingGlassIcon } from '@phosphor-icons/react';
import {
  AdminUsersEndpoints,
  CharacterAdminEndpoints,
  ModelAccessAdminEndpoints,
} from '@weiban/contracts';
import { useEffect, useRef, useState, type KeyboardEvent } from 'react';
import { useNavigate } from 'react-router-dom';
import { api } from '../data/client.js';
import { settle } from '../data/use-async.js';
import { redactContact } from '../ui/csv.js';
import { shortUserId, userDisplayName } from '../features/users/identity.js';
import { NAV_LINKS } from './menu.js';

interface SearchResult {
  label: string;
  kind: string;
  path: string;
  code?: string;
  detail?: string;
}

export function Spotlight({ open, onClose }: { open: boolean; onClose: () => void }) {
  const input = useRef<InputRef>(null);
  return (
    <Modal
      title="全局搜索"
      open={open}
      onCancel={onClose}
      afterOpenChange={(visible) => {
        if (visible) input.current?.focus();
      }}
      width={600}
      footer={null}
      destroyOnHidden
      className="os-spotlight"
      styles={{ header: { marginBottom: 14 }, body: { padding: 0 } }}
    >
      <SpotlightResults input={input} onClose={onClose} />
    </Modal>
  );
}

function SpotlightResults({
  input,
  onClose,
}: {
  input: React.RefObject<InputRef | null>;
  onClose: () => void;
}) {
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [matches, setMatches] = useState<{
    query: string;
    entries: SearchResult[];
    partial: boolean;
  }>();
  const navigate = useNavigate();
  const term = query.trim().slice(0, 200);
  const pageMatch = term.toLowerCase();

  useEffect(() => {
    if (!term) return;
    let active = true;
    const timer = window.setTimeout(() => {
      void Promise.all([
        settle(api.call(AdminUsersEndpoints.lookupLabels, { query: { q: term } })),
        settle(api.call(CharacterAdminEndpoints.lookup, { query: { q: term } })),
        settle(api.call(ModelAccessAdminEndpoints.modelPage, { query: { q: term, pageSize: 5 } })),
      ]).then(([people, roles, models]) => {
        if (!active) return;
        setMatches({
          query: term,
          partial: !people || !roles || !models,
          entries: [
            ...(people?.items.slice(0, 5).map((person) => ({
              kind: '用户',
              label: userDisplayName(person.userId, person),
              code: shortUserId(person.userId),
              detail:
                person.nickname && person.username ? redactContact(person.username) : undefined,
              path: '/accounts?userId=' + encodeURIComponent(person.userId),
            })) ?? []),
            ...(roles?.items.slice(0, 5).map((role) => ({
              kind: '角色',
              label: role.name,
              path: '/characters?characterId=' + encodeURIComponent(role.characterId),
            })) ?? []),
            ...(models?.items.map((model) => ({
              kind: '模型',
              label: model.displayName,
              path: '/model?modelKey=' + encodeURIComponent(model.modelKey),
            })) ?? []),
          ],
        });
      });
    }, 225);
    return () => {
      active = false;
      window.clearTimeout(timer);
    };
  }, [term]);

  const pages = NAV_LINKS.filter(({ group, link }) =>
    [group, link.name, link.aliases ?? '', link.path].some((value) =>
      value.toLowerCase().includes(pageMatch),
    ),
  ).slice(0, term ? 8 : 6);
  const current = term && matches?.query === term ? matches : undefined;
  const isLoading = !!term && !current;
  const results: SearchResult[] = [
    ...pages.map(({ group, link }) => ({ label: link.name, kind: group, path: link.path })),
    ...(current?.entries ?? []),
  ];
  const index = Math.min(cursor, Math.max(results.length - 1, 0));

  function choose(result: SearchResult) {
    onClose();
    navigate(result.path);
  }

  function onKeyDown(event: KeyboardEvent<HTMLInputElement>) {
    if (event.nativeEvent.isComposing || !results.length) return;
    if (event.key === 'ArrowDown' || event.key === 'ArrowUp') {
      event.preventDefault();
      const step = event.key === 'ArrowDown' ? 1 : -1;
      setCursor((index + step + results.length) % results.length);
    } else if (event.key === 'Enter') {
      event.preventDefault();
      const result = results[index];
      if (result) choose(result);
    }
  }

  return (
    <>
      <Input
        ref={input}
        size="large"
        prefix={<MagnifyingGlassIcon />}
        suffix={isLoading ? <Spin size="small" /> : undefined}
        placeholder="检索页面、用户、角色、模型…"
        aria-label="检索页面、用户、角色、模型"
        role="combobox"
        aria-expanded={true}
        aria-controls="os-spotlight-results"
        aria-activedescendant={results.length ? 'os-result-' + index : undefined}
        value={query}
        onChange={(event) => {
          setQuery(event.target.value);
          setCursor(0);
        }}
        onKeyDown={onKeyDown}
      />
      <div
        id="os-spotlight-results"
        role="listbox"
        aria-label="搜索结果"
        className="os-search-results"
      >
        {results.map((result, i) => (
          <button
            type="button"
            key={result.path}
            id={'os-result-' + i}
            role="option"
            aria-selected={i === index}
            className="os-search-result"
            onClick={() => choose(result)}
            onMouseEnter={() => setCursor(i)}
            ref={(element) => {
              if (element && i === index) element.scrollIntoView({ block: 'nearest' });
            }}
          >
            <span>
              {result.label}
              {result.detail && <small> · {result.detail}</small>}{' '}
              {result.code && <code>{result.code}</code>}
            </span>
            <small>{result.kind}</small>
          </button>
        ))}
      </div>
      {!results.length && !isLoading && <p role="status">没有匹配结果</p>}
      {current?.partial && <p role="status">部分搜索结果暂不可用</p>}
      <div className="os-search-keys">
        <span>
          <kbd>↑</kbd>
          <kbd>↓</kbd> 选择
        </span>
        <span>
          <ArrowBendDownLeftIcon /> 打开
        </span>
        <span>
          <kbd>Esc</kbd> 关闭
        </span>
      </div>
    </>
  );
}
