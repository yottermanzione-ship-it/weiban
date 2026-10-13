import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CaretRight } from './old-icons.js';
import { GrowthEndpoints, type Anniversary } from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';

/** 熟悉度 5 级名称与月相（cards-familiarity.md 第 2 节）。 */
export const familiarityNames = ['初识', '眼熟', '熟络', '老友', '知己'] as const;
const moons = ['◔', '◑', '◐', '◕', '●'] as const;

function daysUntil(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86400000);
}

/**
 * 资料页头部副信息行「认识第 N 天 · ◐ L3 熟络 ›」，点开底部弹层（l3-companion.md 第 4 节）。
 * 天数和等级只显示服务器给的数，不自己算。
 */
export function FamiliarityLine({ characterId }: { characterId: string }) {
  const days = useRemote(GrowthEndpoints.getDaysKnown, { params: { characterId } });
  const familiarity = useRemote(GrowthEndpoints.getFamiliarity, { params: { characterId } });
  const [open, setOpen] = useState(false);
  const dialog = useRef<HTMLDialogElement>(null);
  useEffect(() => {
    const element = dialog.current;
    if (!element) return;
    if (open && !element.open) element.showModal?.();
    if (!open && element.open) element.close?.();
  }, [open]);
  if ((days.loading && !days.data) || (familiarity.loading && !familiarity.data))
    return <div className="skeleton-line" role="status" aria-label="正在读取相处信息" />;
  if (!days.data || !familiarity.data) return <p className="subline">认识第 — 天</p>;
  const level = familiarity.data.level;
  const dayText = `${days.data.isRomantic ? '在一起' : '认识'}第 ${days.data.daysKnown} 天`;
  const progress =
    familiarity.data.pointsToNextLevel === null
      ? 1
      : familiarity.data.pointsInLevel /
        (familiarity.data.pointsInLevel + familiarity.data.pointsToNextLevel);
  const custom = days.data.anniversaries.length;
  return (
    <>
      <button className="subline" onClick={() => setOpen(true)}>
        {dayText} · {moons[level - 1]} L{level} {familiarityNames[level - 1]}
        <CaretRight size={14} aria-hidden />
      </button>
      <dialog
        ref={dialog}
        className="sheet"
        aria-label="和 TA 的相处"
        onClose={() => setOpen(false)}
        onClick={(event) => {
          if (event.target === event.currentTarget) setOpen(false);
        }}
      >
        <div className="stack">
          <p className="days-counter">
            <span>{days.data.isRomantic ? '在一起' : '认识'}第</span>
            <strong>{days.data.daysKnown}</strong>
            <span>天</span>
          </p>
          <small className="hint center">从 {days.data.knownSince} 开始</small>
          {days.data.nextAnniversary?.nextOccurrence && (
            <p className="hint center">
              下一个：{days.data.nextAnniversary.label}，还有{' '}
              {daysUntil(days.data.nextAnniversary.nextOccurrence)} 天
            </p>
          )}
          <Link className="row-link" to={`/characters/${characterId}/anniversaries`}>
            纪念日 {custom} 个 <CaretRight size={14} aria-hidden />
          </Link>
          <h3 className="group-label">
            熟悉度 {moons[level - 1]} L{level} {familiarityNames[level - 1]}
          </h3>
          <div
            className="meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="熟悉度进度"
          >
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <small className="hint">
            {familiarity.data.pointsToNextLevel === null
              ? '已经是最高等级'
              : `距下一级还差 ${familiarity.data.pointsToNextLevel} 点`}
          </small>
          <ol className="level-list">
            {familiarityNames.map((name, index) => (
              <li key={name} aria-current={index + 1 === level ? 'true' : undefined}>
                {moons[index]} L{index + 1} {name}
              </li>
            ))}
          </ol>
          <button onClick={() => setOpen(false)}>关闭</button>
        </div>
      </dialog>
    </>
  );
}

/** 纪念日列表页（l3-companion.md 第 5 节）。契约暂不支持「每年提醒」与编辑，只做新增与删除。 */
export function AnniversariesPage() {
  const { characterId = '' } = useParams();
  const days = useRemote(GrowthEndpoints.getDaysKnown, { params: { characterId } });
  const [adding, setAdding] = useState(false);
  const [removing, setRemoving] = useState<Anniversary | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const systems = days.data?.anniversaries.filter((item) => item.kind === 'system') ?? [];
  const customs = days.data?.anniversaries.filter((item) => item.kind === 'custom') ?? [];
  const nextSystem = systems
    .filter((item) => item.nextOccurrence && daysUntil(item.nextOccurrence) >= 0)
    .sort((a, b) => (a.nextOccurrence ?? '').localeCompare(b.nextOccurrence ?? ''))[0];
  async function run(operation: () => Promise<unknown>, after: () => void) {
    setPending(true);
    setError('');
    try {
      await operation();
      after();
      days.refresh();
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    void run(
      () =>
        api.call(GrowthEndpoints.addAnniversary, {
          params: { characterId },
          body: { label: String(form.get('label') ?? ''), date: String(form.get('date') ?? '') },
        }),
      () => setAdding(false),
    );
  }
  return (
    <main>
      <Link to={`/characters/${characterId}`}>‹ 返回资料</Link>
      <h1 className="page-title">纪念日</h1>
      {days.loading && !days.data && (
        <div className="stack" role="status" aria-label="正在读取">
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
          <div className="skeleton-row" />
        </div>
      )}
      {days.error && !days.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={days.refresh}>重试</button>
        </div>
      )}
      {days.data && (
        <>
          <h2 className="group-label">认识的日子</h2>
          <div className="panel rows">
            <div>
              <span>认识那天</span>
              <span>{days.data.knownSince}</span>
            </div>
            {nextSystem?.nextOccurrence && (
              <div>
                <span>下一个：{nextSystem.label}</span>
                <span>还有 {daysUntil(nextSystem.nextOccurrence)} 天</span>
              </div>
            )}
          </div>
          <h2 className="group-label">我们的纪念日</h2>
          <div className="panel rows">
            {customs.length === 0 && (
              <div>
                <span className="hint">可以把你们的重要日子记下来</span>
              </div>
            )}
            {customs.map((item) => (
              <div key={item.id}>
                <span>{item.label}</span>
                <span>
                  {item.date}{' '}
                  <button
                    className="text-button danger"
                    disabled={pending}
                    onClick={() => setRemoving(item)}
                  >
                    删除
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button
            className="primary"
            disabled={pending || customs.length >= 10}
            onClick={() => setAdding(true)}
          >
            {customs.length >= 10 ? '最多 10 个纪念日' : '添加纪念日'}
          </button>
          <p className="hint">纪念日当天，TA 会记得给你发消息。</p>
        </>
      )}
      {adding && (
        <form className="panel stack" onSubmit={submit}>
          <label>
            名称
            <input name="label" maxLength={20} required />
          </label>
          <label>
            日期
            <input name="date" type="date" required />
          </label>
          <button className="primary" disabled={pending}>
            完成
          </button>
          <button type="button" disabled={pending} onClick={() => setAdding(false)}>
            取消
          </button>
        </form>
      )}
      {removing && (
        <div role="dialog" aria-label="删除纪念日" className="panel">
          <p>删除后 TA 不会再在这天特别找你</p>
          <button
            className="danger"
            disabled={pending}
            onClick={() =>
              void run(
                () =>
                  api.call(GrowthEndpoints.removeAnniversary, {
                    params: { characterId, anniversaryId: removing.id },
                  }),
                () => setRemoving(null),
              )
            }
          >
            删除纪念日
          </button>
          <button disabled={pending} onClick={() => setRemoving(null)}>
            取消
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
