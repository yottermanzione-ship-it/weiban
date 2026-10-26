import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'react-router-dom';
import { CaretRight } from './old-icons.js';
import {
  FAMILIARITY_STAGE_NAMES,
  GrowthEndpoints,
  type Anniversary,
  type FamiliarityInfo,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { NavBar } from './shell-kit.js';
import { SubPageLayer } from './edit-page.js';
import { showSnackbar } from './toast.js';
import { DateField } from './wheel-picker.js';

/**
 * 好感度六阶段名称（3.25 改回旧版说法：粉丝 → 朋友 → 亲密好友 → 暧昧 → 恋人 → 伴侣，名称来自契约）与图标。
 */
export const familiarityNames = FAMILIARITY_STAGE_NAMES;
export const familiarityMoons = ['◔', '◑', '◐', '◕', '●', '♥'] as const;
const moons = familiarityMoons;

/** 阶段名（服务器给的优先）。 */
export function stageNameOf(info: Pick<FamiliarityInfo, 'level' | 'stageName'>): string {
  return info.stageName || familiarityNames[info.level - 1] || '';
}

/** 3.25：被卡住时的说明（从未充值且非会员 / 未成年设定角色）；没卡住返回 null。 */
export function familiarityCapHint(info: Pick<FamiliarityInfo, 'capReason'>): string | null {
  if (info.capReason === 'membership') return '充值或开通 PRO+ 后可以继续升级';
  if (info.capReason === 'minor') return 'TA 是未成年设定，好感度最高到「亲密好友」';
  return null;
}

/** 进度说明：最高阶段 / 被卡住 / 距下一阶段还差几点。 */
export function familiarityProgressText(info: FamiliarityInfo): string {
  if (info.pointsToNextLevel === null) return '已经是最高阶段';
  return (
    familiarityCapHint(info) ??
    `距「${familiarityNames[info.level] ?? '下一阶段'}」还差 ${info.pointsToNextLevel} 点`
  );
}

function daysUntil(date: string): number {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  const target = new Date(y, m - 1, d).getTime();
  const now = new Date();
  const today = new Date(now.getFullYear(), now.getMonth(), now.getDate()).getTime();
  return Math.round((target - today) / 86400000);
}

/**
 * 资料页头部副信息行「认识第 N 天 · ◐ 亲密好友 ›」，点开底部弹层（l3-companion.md 第 4 节）。
 * 天数和阶段只显示服务器给的数，不自己算。
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
  const capped = familiarity.data.capReason != null;
  const progress =
    familiarity.data.pointsToNextLevel === null || capped
      ? 1
      : familiarity.data.pointsInLevel /
        (familiarity.data.pointsInLevel + familiarity.data.pointsToNextLevel);
  const custom = days.data.anniversaries.length;
  const stageName = stageNameOf(familiarity.data);
  return (
    <>
      <button className="subline" onClick={() => setOpen(true)}>
        {dayText} · {moons[level - 1]} {stageName}
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
            好感度 {moons[level - 1]} {stageName}
            {familiarity.data.romancePaused && '（亲密表达已暂停）'}
          </h3>
          <div
            className="meter"
            role="progressbar"
            aria-valuemin={0}
            aria-valuemax={100}
            aria-valuenow={Math.round(progress * 100)}
            aria-label="好感度进度"
          >
            <span style={{ transform: `scaleX(${progress})` }} />
          </div>
          <small className="hint">
            {familiarityProgressText(familiarity.data)}
            {familiarity.data.capReason === 'membership' && (
              <>
                {' '}
                <Link to="/membership">去看看 ›</Link>
              </>
            )}
          </small>
          <ol className="level-list">
            {familiarityNames.map((name, index) => (
              <li key={name} aria-current={index + 1 === level ? 'true' : undefined}>
                {moons[index]} {name}
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
  const [label, setLabel] = useState('');
  const [date, setDate] = useState('');
  // U2：删除纪念日可撤销——直接删，底部撤销条「撤销」用添加纪念日接口按原名称、日期加回来
  function remove(item: Anniversary) {
    void run(
      () =>
        api.call(GrowthEndpoints.removeAnniversary, {
          params: { characterId, anniversaryId: item.id },
        }),
      () =>
        showSnackbar({
          text: `已删除纪念日「${item.label}」`,
          onAction: () =>
            run(
              () =>
                api.call(GrowthEndpoints.addAnniversary, {
                  params: { characterId },
                  body: { label: item.label, date: item.date },
                }),
              () => undefined,
            ),
        }),
    );
  }
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const systems = days.data?.anniversaries.filter((item) => item.kind === 'system') ?? [];
  const customs = days.data?.anniversaries.filter((item) => item.kind === 'custom') ?? [];
  const nextSystem = systems
    .filter((item) => item.nextOccurrence && daysUntil(item.nextOccurrence) >= 0)
    .sort((a, b) => (a.nextOccurrence ?? '').localeCompare(b.nextOccurrence ?? ''))[0];
  async function run(operation: () => Promise<unknown>, after: () => void) {
    if (pending) return;
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
  function submit(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (pending || !label.trim() || !date) return;
    void run(
      () =>
        api.call(GrowthEndpoints.addAnniversary, {
          params: { characterId },
          body: { label: label.trim(), date },
        }),
      () => setAdding(false),
    );
  }
  return (
    <main>
      <NavBar title="纪念日" fallback={`/characters/${characterId}`} />
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
                    onClick={() => {
                      setError('');
                      remove(item);
                    }}
                  >
                    删除
                  </button>
                </span>
              </div>
            ))}
          </div>
          <button
            className="primary full"
            disabled={pending || customs.length >= 10}
            onClick={() => {
              setLabel('');
              setDate('');
              setError('');
              setAdding(true);
            }}
          >
            {customs.length >= 10 ? '最多 10 个纪念日' : '添加纪念日'}
          </button>
          <p className="hint">纪念日当天，TA 会记得给你发消息。</p>
        </>
      )}
      {/* U2：添加纪念日改整页二级页面，日期用滚轮 */}
      {adding && (
        <SubPageLayer
          title="添加纪念日"
          canSave={!!label.trim() && !!date}
          pending={pending}
          onCancel={() => setAdding(false)}
          onSave={() => submit()}
        >
          <form className="stack subpage-form" onSubmit={submit}>
            <label>
              名称
              <input
                name="label"
                maxLength={20}
                required
                value={label}
                disabled={pending}
                onChange={(e) => setLabel(e.target.value)}
              />
            </label>
            <label>
              日期
              <DateField
                title="纪念日日期"
                value={date}
                disabled={pending}
                max={`${new Date().getFullYear() + 10}-12-31`}
                onChange={setDate}
              />
            </label>
            {error && <p role="alert">{error}</p>}
          </form>
        </SubPageLayer>
      )}
      {error && !adding && <p role="alert">{error}</p>}
    </main>
  );
}
