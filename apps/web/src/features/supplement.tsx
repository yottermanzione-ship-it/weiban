import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import {
  CharacterEndpoints,
  CharacterSupplementEndpoints,
  PersonaUpdateEndpoints,
  type UserSupplement,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { useUpdates } from '../data/updates.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { Dialog, showToast } from './toast.js';
import { NavBar } from './shell-kit.js';
import { SupplementSourceNote, VariantPublishLink } from './plaza.js';

/*
 * 我的补充设定（CHR-09，import.md 第 3 节）。契约里补充设定是一段文字，这里按行拆成「一条一条」显示和编辑。
 * 自定义角色没有补充设定：导入资料确认后直接合并进人设。
 */

function splitLines(text: string) {
  return text
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
}

export function SupplementPage() {
  const { characterId = '' } = useParams();
  const navigate = useNavigate();
  const profile = useRemote(CharacterEndpoints.getProfile, { params: { characterId } });
  const [data, setData] = useState<UserSupplement | null | undefined>(undefined);
  const [error, setError] = useState('');
  const [editing, setEditing] = useState<{ index: number; text: string } | null>(null);
  const [confirmClear, setConfirmClear] = useState(false);
  const [revision, setRevision] = useState(0);
  useUpdates((update) => {
    const data = update.data as { section?: string; characterId?: string } | undefined;
    if (
      update.type === 'data.changed' &&
      data?.section === 'supplement' &&
      data.characterId === characterId
    )
      setRevision((value) => value + 1);
  });
  const custom = profile.data?.kind === 'custom';
  useEffect(() => {
    let active = true;
    void api
      .call(CharacterSupplementEndpoints.getSupplement, {
        params: { characterId },
        networkOnly: true,
      })
      .then((value) => {
        if (active) setData(value);
      })
      .catch((e) => {
        if (active) setError(friendlyError(e));
      });
    return () => {
      active = false;
    };
  }, [characterId, revision]);
  const lines = splitLines(data?.text ?? '');
  async function save(next: string[]) {
    setError('');
    try {
      if (next.length === 0) {
        await api.call(CharacterSupplementEndpoints.deleteSupplement, { params: { characterId } });
        setData(null);
      } else {
        setData(
          await api.call(CharacterSupplementEndpoints.putSupplement, {
            params: { characterId },
            body: { text: next.join('\n').slice(0, 5000) },
          }),
        );
        // 冲突项由 AI 在保存后几秒内检出（T-081 交接），稍后再拉一次。
        window.setTimeout(() => setRevision((v) => v + 1), 5000);
      }
      showToast('已保存');
    } catch (e) {
      setError(friendlyError(e));
    }
  }
  const conflictOf = (line: string) =>
    data?.conflicts.find((c) => line.includes(c.supplementValue));
  return (
    <main>
      <NavBar
        title="我的补充设定"
        subtitle={
          profile.data?.name ? (
            <small className="nav-subtitle">{profile.data.name}</small>
          ) : undefined
        }
        fallback={`/characters/${characterId}`}
        onBack={() => navigate(-1)}
      />
      {custom ? (
        <p className="hint">导入的资料确认后会直接合并进 TA 的人设。</p>
      ) : (
        <p className="hint">只对你这里的 TA 生效，不会改变其他人看到的 TA。</p>
      )}
      {error && <p role="alert">{error}</p>}
      {!custom && data === undefined && !error && <span className="spinner" role="status" />}
      {!custom && data !== undefined && (
        <>
          <h2 className="section-label">已添加的设定</h2>
          {lines.length === 0 ? (
            <p className="hint">可以把你收集的采访、语录导入进来，让这里的 TA 更像 TA</p>
          ) : (
            <div className="panel rows">
              {lines.map((line, i) => {
                const conflict = conflictOf(line);
                return (
                  <button
                    key={`${i}-${line}`}
                    className="row-button"
                    onClick={() => setEditing({ index: i, text: line })}
                  >
                    <span className="overview-name">
                      {line}
                      {conflict && <small className="hint">与公开资料冲突，不生效</small>}
                    </span>
                  </button>
                );
              })}
            </div>
          )}
          {data?.plazaSource && <SupplementSourceNote characterId={characterId} />}
        </>
      )}
      <div className="button-row">
        <Link
          className="button tonal"
          to={`/imports/new?kind=supplement&characterId=${characterId}`}
        >
          导入资料
        </Link>
        {!custom && <button onClick={() => setEditing({ index: -1, text: '' })}>手写一条</button>}
      </div>
      {!custom && lines.length > 0 && <VariantPublishLink characterId={characterId} />}
      {!custom && lines.length > 0 && (
        <button className="danger danger-row" onClick={() => setConfirmClear(true)}>
          删除全部补充设定
        </button>
      )}
      {editing && (
        <Dialog
          title={editing.index < 0 ? '手写一条' : '编辑设定'}
          actions={[
            ...(editing.index >= 0
              ? [
                  {
                    label: '删除',
                    onClick: () => {
                      void save(lines.filter((_, i) => i !== editing.index));
                      setEditing(null);
                    },
                  },
                ]
              : []),
            { label: '取消', onClick: () => setEditing(null) },
            {
              label: '保存',
              primary: true,
              disabled:
                !editing.text.trim() ||
                (editing.index >= 0 && editing.text.trim() === lines[editing.index]?.trim()),
              onClick: () => {
                const text = editing.text.trim().replace(/\r?\n/g, ' ');
                if (!text) return;
                void save(
                  editing.index < 0
                    ? [...lines, text]
                    : lines.map((l, i) => (i === editing.index ? text : l)),
                );
                setEditing(null);
              },
            },
          ]}
        >
          <textarea
            autoFocus
            rows={4}
            maxLength={200}
            value={editing.text}
            onChange={(e) => setEditing({ ...editing, text: e.target.value })}
          />
          <small className="hint">{editing.text.length} / 200</small>
        </Dialog>
      )}
      {confirmClear && (
        <Dialog
          title="删除全部补充设定？"
          actions={[
            { label: '取消', onClick: () => setConfirmClear(false) },
            {
              label: '删除',
              primary: true,
              onClick: () => {
                setConfirmClear(false);
                void save([]);
              },
            },
          ]}
        >
          <p className="hint">删除后，TA 会回到原本的设定</p>
        </Dialog>
      )}
    </main>
  );
}

/** 资料页「资料已更新 ●」（CHR-10），点开显示更新摘要，看过后消失。 */
export function PersonaUpdateBadge({ characterId }: { characterId: string }) {
  const updates = useRemote(PersonaUpdateEndpoints.listPersonaUpdates, {
    params: { characterId },
    networkOnly: true,
  });
  const [open, setOpen] = useState(false);
  const [seen, setSeen] = useState(false);
  if (!updates.data || updates.data.unseenCount === 0 || seen) return null;
  return (
    <>
      <button
        className="text-button persona-update"
        onClick={() => {
          setOpen(true);
          void api
            .call(PersonaUpdateEndpoints.markPersonaUpdatesSeen, { params: { characterId } })
            .catch(() => {});
        }}
      >
        资料已更新 <span className="red-dot" aria-hidden />
      </button>
      {open && (
        <Dialog
          title="资料已更新"
          actions={[
            {
              label: '知道了',
              primary: true,
              onClick: () => {
                setOpen(false);
                setSeen(true);
              },
            },
          ]}
        >
          {updates.data.items.slice(0, updates.data.unseenCount || 3).map((note) => (
            <p key={note.personaVersion}>
              {note.summary}
              <small className="hint">
                {' '}
                {new Date(note.publishedAt).toLocaleDateString('zh-CN')}
              </small>
            </p>
          ))}
        </Dialog>
      )}
    </>
  );
}
