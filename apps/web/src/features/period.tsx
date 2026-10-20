import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { CaretLeft, CaretRight, Lock } from './old-icons.js';
import {
  HealthEndpoints,
  HealthTagEndpoints,
  type CycleRecord,
  type DayLog,
  type HealthSettings,
  type PeriodFlow,
  type PeriodPain,
  type PredictionResult,
} from '@weiban/contracts';
import { ApiFailure } from '@weiban/client-core';
import { useAuth } from '../app/auth.js';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { NavBar } from './shell-kit.js';

/*
 * 经期日记（PLAY-01，设计见 docs/design/pages/period-diary.md）。
 * 健康数据一律 networkOnly：不写入本机响应缓存（IndexedDB），只在页面内存里。
 */

const DAY = 86400000;
function today(): string {
  return toDate(new Date());
}
function toDate(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}
function parse(date: string): Date {
  const [y, m, d] = date.split('-').map(Number) as [number, number, number];
  return new Date(y, m - 1, d);
}
function addDays(date: string, days: number): string {
  const d = parse(date);
  d.setDate(d.getDate() + days);
  return toDate(d);
}
function diffDays(a: string, b: string): number {
  return Math.round((parse(b).getTime() - parse(a).getTime()) / DAY);
}
function monthDay(date: string): string {
  const d = parse(date);
  return `${d.getMonth() + 1} 月 ${d.getDate()} 日`;
}
function cycleEnd(cycle: CycleRecord): string {
  return cycle.endDate ?? today();
}
function cycleOf(cycles: CycleRecord[], date: string): CycleRecord | undefined {
  return cycles.find((c) => c.startDate <= date && date <= cycleEnd(c));
}

const introKey = (userId: string) => `weiban:period-intro:${userId}`;
function useIntro() {
  const { session } = useAuth();
  const key = introKey(session?.user.userId ?? '');
  const [seen, setSeen] = useState(() => {
    try {
      return localStorage.getItem(key) === '1';
    } catch {
      return false;
    }
  });
  const set = (value: boolean) => {
    try {
      if (value) localStorage.setItem(key, '1');
      else localStorage.removeItem(key);
    } catch {
      // 无法保存时，下次进入会再看到一次说明，不影响使用。
    }
    setSeen(value);
  };
  return [seen, set] as const;
}

/** 读取全部经期记录（游标翻页直到结束）、预测与设置。 */
function usePeriodData() {
  const [cycles, setCycles] = useState<CycleRecord[]>();
  const [prediction, setPrediction] = useState<PredictionResult>();
  const [error, setError] = useState('');
  const [revision, setRevision] = useState(0);
  useEffect(() => {
    let active = true;
    setError('');
    void (async () => {
      try {
        const all: CycleRecord[] = [];
        let cursor: string | undefined;
        do {
          const page = await api.call(HealthEndpoints.listCycles, {
            query: { limit: 100, cursor },
            networkOnly: true,
          });
          all.push(...page.items);
          cursor = page.nextCursor ?? undefined;
        } while (cursor);
        const predicted = await api.call(HealthEndpoints.getPrediction, { networkOnly: true });
        if (!active) return;
        setCycles(all.sort((a, b) => b.startDate.localeCompare(a.startDate)));
        setPrediction(predicted);
      } catch (e) {
        if (active) setError(friendlyError(e));
      }
    })();
    return () => {
      active = false;
    };
  }, [revision]);
  return { cycles, prediction, error, refresh: () => setRevision((v) => v + 1) };
}

function conflictMessage(e: unknown): string {
  return e instanceof ApiFailure && e.status === 409
    ? '这段日期与已有的经期记录重叠'
    : friendlyError(e);
}

function Intro({ onStart }: { onStart(): void }) {
  return (
    <div className="period-intro stack">
      <p>
        经期记录会加密保存，只有你授权的角色知道；不会出现在朋友圈、群聊、分享图里，也不会随角色发布到人设广场。预测仅供参考，不能用于避孕或医疗判断。
      </p>
      <button className="primary" onClick={onStart}>
        开始记录
      </button>
    </div>
  );
}

function StatusCard({
  cycles,
  prediction,
  busy,
  onStart,
  onEnd,
}: {
  cycles: CycleRecord[];
  prediction: PredictionResult;
  busy: boolean;
  onStart(): void;
  onEnd(cycle: CycleRecord): void;
}) {
  const now = today();
  const current = cycleOf(cycles, now);
  const uncertain = prediction.confidence !== 'normal';
  if (cycles.length === 0)
    return (
      <section className="panel stack period-status">
        <p>记下最近一次经期，就能帮你预测下一次</p>
        <button className="primary" disabled={busy} onClick={onStart}>
          记录一次经期
        </button>
      </section>
    );
  if (current) {
    const day = diffDays(current.startDate, now) + 1;
    const left =
      prediction.predictedDays !== null ? Math.max(prediction.predictedDays - day, 0) : null;
    return (
      <section className="panel stack period-status">
        <strong className="period-status-title">经期第 {day} 天</strong>
        <small>
          {uncertain
            ? '记录较少 / 不规律，预测可能不准'
            : left !== null
              ? `预计还有 ${left} 天`
              : ''}{' '}
          · {prediction.disclaimer}
        </small>
        <div className="button-row">
          <Link className="button primary" to={`/services/period/day/${now}`}>
            记录今天
          </Link>
          {!current.endDate && (
            <button disabled={busy} onClick={() => onEnd(current)}>
              经期结束了
            </button>
          )}
        </div>
      </section>
    );
  }
  const next = prediction.predictedNextStart;
  return (
    <section className="panel stack period-status">
      <strong className="period-status-title">
        {next && diffDays(now, next) >= 0 ? `距下次预计还有 ${diffDays(now, next)} 天` : '经期日记'}
      </strong>
      <small>
        {uncertain ? '记录较少 / 不规律，预测可能不准' : next ? `预计 ${monthDay(next)}开始` : ''} ·{' '}
        {prediction.disclaimer}
      </small>
      <div className="button-row">
        <button className="primary" disabled={busy} onClick={onStart}>
          经期开始了
        </button>
        <Link className="button" to={`/services/period/day/${now}`}>
          记录今天
        </Link>
      </div>
    </section>
  );
}

function Calendar({
  cycles,
  prediction,
  month,
  onMonth,
}: {
  cycles: CycleRecord[];
  prediction: PredictionResult;
  month: string;
  onMonth(month: string): void;
}) {
  const navigate = useNavigate();
  const now = today();
  const first = parse(`${month}-01`);
  const offset = (first.getDay() + 6) % 7;
  const count = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
  const recorded = new Set<string>();
  const logged = new Set<string>();
  for (const cycle of cycles) {
    for (let d = cycle.startDate; d <= cycleEnd(cycle); d = addDays(d, 1)) recorded.add(d);
    for (const log of cycle.dayLogs)
      if (log.pain || log.flow || log.symptoms.length || log.notes) logged.add(log.date);
  }
  const predicted = new Set<string>();
  if (prediction.predictedNextStart)
    for (let i = 0; i < (prediction.predictedDays ?? 5); i++)
      predicted.add(addDays(prediction.predictedNextStart, i));
  const shift = (n: number) => {
    const d = new Date(first.getFullYear(), first.getMonth() + n, 1);
    onMonth(toDate(d).slice(0, 7));
  };
  return (
    <section className="panel period-calendar">
      <header>
        <button className="icon-button" aria-label="上个月" onClick={() => shift(-1)}>
          <CaretLeft size={20} />
        </button>
        <strong>
          {first.getFullYear()} 年 {first.getMonth() + 1} 月
        </strong>
        <button className="icon-button" aria-label="下个月" onClick={() => shift(1)}>
          <CaretRight size={20} />
        </button>
      </header>
      <div className="calendar-grid" role="grid">
        {['一', '二', '三', '四', '五', '六', '日'].map((w) => (
          <span key={w} className="calendar-week">
            {w}
          </span>
        ))}
        {Array.from({ length: offset }, (_, i) => (
          <span key={`blank-${i}`} />
        ))}
        {Array.from({ length: count }, (_, i) => {
          const date = `${month}-${String(i + 1).padStart(2, '0')}`;
          const future = date > now;
          const classes = [
            'calendar-day',
            recorded.has(date) ? 'recorded' : '',
            !recorded.has(date) && predicted.has(date) ? 'predicted' : '',
            date === now ? 'today' : '',
          ].join(' ');
          return (
            <button
              key={date}
              className={classes}
              disabled={future}
              aria-label={`${monthDay(date)}${recorded.has(date) ? '，经期' : predicted.has(date) ? '，预测经期' : ''}`}
              onClick={() => navigate(`/services/period/day/${date}`)}
            >
              <span>{i + 1}</span>
              {logged.has(date) && <i className="calendar-dot" aria-hidden />}
              {date === now && <small>今天</small>}
            </button>
          );
        })}
      </div>
      <p className="calendar-legend">
        <span className="legend recorded" /> 已记录 <span className="legend predicted" />{' '}
        预测（仅供参考）
      </p>
    </section>
  );
}

/** 经期日记主页（period-diary.md 第 2、3 节）。 */
export function PeriodPage() {
  const [seen, setSeen] = useIntro();
  const data = usePeriodData();
  const auth = useRemote(HealthEndpoints.getAuthorization, { networkOnly: true });
  const { state } = useChat();
  const names = useCharacterNames(auth.data?.authorizedCharacterIds ?? []);
  const [params, setParams] = useSearchParams();
  const month = params.get('month') ?? today().slice(0, 7);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const [privacyOpen, setPrivacyOpen] = useState(false);
  async function run(operation: () => Promise<unknown>) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage('已记下');
      data.refresh();
    } catch (e) {
      setError(conflictMessage(e));
    } finally {
      setBusy(false);
    }
  }
  const authorizedNames = (auth.data?.authorizedCharacterIds ?? [])
    .map((id) => state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色')
    .join('、');
  return (
    <main className="period-page">
      <NavBar
        title="经期日记"
        fallback="/miniapps"
        right={
          seen ? (
            <Link className="text-button text-action" to="/services/period/settings">
              设置
            </Link>
          ) : undefined
        }
      />
      {!seen ? (
        <Intro onStart={() => setSeen(true)} />
      ) : data.error && !data.cycles ? (
        <div className="empty">
          <p role="alert">{data.error}</p>
          <button className="text-button" onClick={data.refresh}>
            重试
          </button>
        </div>
      ) : !data.cycles || !data.prediction ? (
        <div className="stack" role="status" aria-label="正在读取">
          <div className="skeleton-card" />
          <div className="skeleton-card" />
        </div>
      ) : (
        <>
          <StatusCard
            cycles={data.cycles}
            prediction={data.prediction}
            busy={busy}
            onStart={() =>
              void run(() =>
                api.call(HealthEndpoints.createCycle, { body: { startDate: today() } }),
              )
            }
            onEnd={(cycle) =>
              void run(() =>
                api.call(HealthEndpoints.updateCycle, {
                  params: { cycleId: cycle.cycleId },
                  body: { endDate: today() },
                }),
              )
            }
          />
          <Calendar
            cycles={data.cycles}
            prediction={data.prediction}
            month={month}
            onMonth={(value) => setParams({ month: value }, { replace: true })}
          />
          <div className="panel rows">
            <Link to="/services/period/authorization">
              让谁知道
              <small className="row-value">{authorizedNames || '还没有'}</small>
              <CaretRight />
            </Link>
            <Link to="/services/period/history">
              历史记录
              <CaretRight />
            </Link>
          </div>
          {message && <p role="status">{message}</p>}
          {error && <p role="alert">{error}</p>}
          <button className="text-button period-privacy" onClick={() => setPrivacyOpen((v) => !v)}>
            <Lock size={14} aria-hidden /> 加密保存，只有你授权的角色知道
          </button>
          {privacyOpen && (
            <p className="hint">
              经期记录会加密保存，只有你授权的角色知道；不会出现在朋友圈、群聊、分享图里，也不会随角色发布到人设广场。预测仅供参考，不能用于避孕或医疗判断。
            </p>
          )}
        </>
      )}
    </main>
  );
}

const flows: Array<[PeriodFlow, string]> = [
  ['light', '少'],
  ['medium', '中'],
  ['heavy', '多'],
];
const pains: Array<[PeriodPain, string]> = [
  ['none', '无'],
  ['mild', '轻'],
  ['moderate', '中'],
  ['severe', '重'],
];

/** 某一天的记录页（period-diary.md 3.2）。 */
export function PeriodDayPage() {
  const { date = today() } = useParams();
  const navigate = useNavigate();
  const data = usePeriodData();
  const tags = useRemote(HealthTagEndpoints.listSymptomTags);
  const cycle = data.cycles ? cycleOf(data.cycles, date) : undefined;
  const existing = cycle?.dayLogs.find((log) => log.date === date);
  const [inPeriod, setInPeriod] = useState(false);
  const [log, setLog] = useState<DayLog>({
    date,
    flow: null,
    pain: null,
    symptoms: [],
    notes: null,
  });
  const [dirty, setDirty] = useState(false);
  const [leaving, setLeaving] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const loaded = !!data.cycles;
  useEffect(() => {
    if (!loaded) return;
    setInPeriod(!!cycle);
    if (existing) setLog(existing);
    // 只在数据首次到达时初始化表单。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loaded]);
  const edit = (patch: Partial<DayLog>) => {
    setLog((v) => ({ ...v, ...patch }));
    setDirty(true);
  };
  const back = `/services/period?month=${date.slice(0, 7)}`;
  if (date > today())
    return (
      <main>
        <NavBar title="经期日记" fallback="/services/period" />
        <p className="empty">未来的日子还不能记录</p>
      </main>
    );
  async function save(body: DayLog) {
    if (!data.cycles) return;
    setBusy(true);
    setError('');
    try {
      let target = cycleOf(data.cycles, date);
      if (!target && inPeriod) {
        // 前一天刚好是某次经期的最后一天：把那次经期延长到这天（自动并入相邻经期）。
        const adjacent = data.cycles.find((c) => c.endDate === addDays(date, -1));
        if (adjacent) {
          target = await api.call(HealthEndpoints.updateCycle, {
            params: { cycleId: adjacent.cycleId },
            body: { endDate: date },
          });
        } else {
          target = await api.call(HealthEndpoints.createCycle, { body: { startDate: date } });
          if (date < today())
            target = await api.call(HealthEndpoints.updateCycle, {
              params: { cycleId: target.cycleId },
              body: { endDate: date },
            });
        }
      }
      if (target)
        await api.call(HealthEndpoints.updateCycle, {
          params: { cycleId: target.cycleId },
          body: { dayLog: body },
        });
      navigate(back);
    } catch (e) {
      setError(conflictMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <NavBar
        title={monthDay(date)}
        fallback="/services/period"
        onBack={() => (dirty ? setLeaving(true) : navigate(back))}
        right={
          <button
            type="button"
            className="text-button text-action"
            disabled={busy || !loaded || (!cycle && !inPeriod)}
            onClick={() => void save(log)}
          >
            保存
          </button>
        }
      />
      {data.error && !data.cycles && (
        <div className="empty">
          <p role="alert">{data.error}</p>
          <button className="text-button" onClick={data.refresh}>
            重试
          </button>
        </div>
      )}
      {loaded && (
        <div className="stack">
          <label className="check check-card">
            <input
              type="checkbox"
              checked={inPeriod}
              disabled={!!cycle || busy}
              onChange={(event) => {
                setInPeriod(event.target.checked);
                setDirty(true);
              }}
            />
            这天在经期中
          </label>
          {cycle && (
            <small>
              属于 {monthDay(cycle.startDate)} 开始的这次经期；如需移除请到「历史记录」删除整次经期
            </small>
          )}
          {inPeriod && (
            <>
              <h2 className="group-label">流量</h2>
              <div className="chips">
                {flows.map(([value, label]) => (
                  <button
                    key={value}
                    className="chip"
                    aria-pressed={log.flow === value}
                    onClick={() => edit({ flow: log.flow === value ? null : value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <h2 className="group-label">痛感</h2>
              <div className="chips">
                {pains.map(([value, label]) => (
                  <button
                    key={value}
                    className="chip"
                    aria-pressed={log.pain === value}
                    onClick={() => edit({ pain: log.pain === value ? null : value })}
                  >
                    {label}
                  </button>
                ))}
              </div>
              <h2 className="group-label">症状</h2>
              <div className="chips">
                {[
                  ...new Set([
                    ...(tags.data?.items.map((t) => t.name) ?? []),
                    ...(existing?.symptoms ?? []),
                  ]),
                ].map((name) => (
                  <button
                    key={name}
                    className="chip"
                    aria-pressed={log.symptoms.includes(name)}
                    onClick={() =>
                      edit({
                        symptoms: log.symptoms.includes(name)
                          ? log.symptoms.filter((s) => s !== name)
                          : [...log.symptoms, name],
                      })
                    }
                  >
                    {name}
                  </button>
                ))}
              </div>
              <h2 className="group-label">备注</h2>
              <label>
                <textarea
                  aria-label="备注"
                  maxLength={200}
                  value={log.notes ?? ''}
                  onChange={(event) => edit({ notes: event.target.value || null })}
                />
                <small>{(log.notes ?? '').length}/200 · 只有你自己能看到，不会告诉任何角色</small>
              </label>
              {existing && cycle && (
                <button
                  className="danger"
                  disabled={busy}
                  onClick={() =>
                    void save({ date, flow: null, pain: null, symptoms: [], notes: null })
                  }
                >
                  删除这天的记录
                </button>
              )}
            </>
          )}
          {error && <p role="alert">{error}</p>}
        </div>
      )}
      {leaving && (
        <div role="dialog" aria-label="放弃修改" className="panel">
          <p>放弃这次修改？</p>
          <button className="danger" onClick={() => navigate(back)}>
            放弃
          </button>
          <button onClick={() => setLeaving(false)}>取消</button>
        </div>
      )}
    </main>
  );
}

/** 历史记录（period-diary.md 3.3）。 */
export function PeriodHistoryPage() {
  const data = usePeriodData();
  const navigate = useNavigate();
  const [removing, setRemoving] = useState<CycleRecord | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const cycles = data.cycles ?? [];
  return (
    <main>
      <NavBar title="历史记录" fallback="/services/period" />
      {data.error && !data.cycles && (
        <div className="empty">
          <p role="alert">{data.error}</p>
          <button className="text-button" onClick={data.refresh}>
            重试
          </button>
        </div>
      )}
      {data.cycles && cycles.length === 0 && <p className="empty">还没有记录</p>}
      <div className="panel rows">
        {cycles.map((cycle, index) => {
          const end = cycleEnd(cycle);
          const previous = cycles[index + 1];
          return (
            <div key={cycle.cycleId}>
              <button
                className="row-button"
                onClick={() => navigate(`/services/period?month=${cycle.startDate.slice(0, 7)}`)}
              >
                <span>
                  {monthDay(cycle.startDate)} – {cycle.endDate ? monthDay(end) : '至今'} ·{' '}
                  {diffDays(cycle.startDate, end) + 1} 天
                </span>
                {previous && <small>周期 {diffDays(previous.startDate, cycle.startDate)} 天</small>}
              </button>
              <button
                className="text-button danger"
                disabled={busy}
                onClick={() => setRemoving(cycle)}
              >
                删除
              </button>
            </div>
          );
        })}
      </div>
      {removing && (
        <div role="dialog" aria-label="删除经期" className="panel">
          <p>删除这次经期的全部记录？</p>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void api
                .call(HealthEndpoints.deleteCycle, { params: { cycleId: removing.cycleId } })
                .then(() => {
                  setRemoving(null);
                  data.refresh();
                })
                .catch((e) => setError(friendlyError(e)))
                .finally(() => setBusy(false));
            }}
          >
            删除
          </button>
          <button disabled={busy} onClick={() => setRemoving(null)}>
            取消
          </button>
        </div>
      )}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

/** 让谁知道（period-diary.md 第 4 节）。 */
export function PeriodAuthorizationPage() {
  const { state } = useChat();
  const contacts = state.contacts.filter((c) => c.status !== 'pending');
  const names = useCharacterNames(contacts.map((c) => c.characterId));
  const auth = useRemote(HealthEndpoints.getAuthorization, { networkOnly: true });
  const [ids, setIds] = useState<string[] | null>(null);
  const [asking, setAsking] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current = ids ?? auth.data?.authorizedCharacterIds ?? [];
  const nameOf = useCallback(
    (id: string) => contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色',
    [contacts, names],
  );
  async function save(next: string[], done: string) {
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const result = await api.call(HealthEndpoints.updateAuthorization, {
        body: { authorizedCharacterIds: next },
      });
      setIds(result.authorizedCharacterIds);
      setMessage(done);
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  const sorted = [...contacts].sort((a, b) =>
    nameOf(a.characterId).localeCompare(nameOf(b.characterId), 'zh-CN'),
  );
  return (
    <main>
      <NavBar title="让谁知道" fallback="/services/period" />
      <p className="hint">
        你授权的角色会知道你现在是否在经期、第几天、预计下次开始日，以及当天记录的痛感和症状；不知道流量、备注和历史记录。
      </p>
      {auth.error && !auth.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={auth.refresh}>重试</button>
        </div>
      )}
      {auth.data && sorted.length === 0 && <p className="empty">还没有角色</p>}
      {auth.data && sorted.length > 0 && (
        <>
          <h2 className="group-label">通讯录里的角色</h2>
          <div className="panel rows">
            {sorted.map((c) => (
              <div key={c.characterId}>
                <CharacterAvatar id={c.characterId} size={40} />
                <label className="check grow">
                  <input
                    type="checkbox"
                    role="switch"
                    disabled={busy}
                    checked={current.includes(c.characterId)}
                    onChange={(event) => {
                      if (event.target.checked) setAsking(c.characterId);
                      else
                        void save(
                          current.filter((id) => id !== c.characterId),
                          `${nameOf(c.characterId)} 已不再知道`,
                        );
                    }}
                  />
                  {nameOf(c.characterId)}
                </label>
              </div>
            ))}
          </div>
        </>
      )}
      <p className="hint">群聊里不会提起；未授权的角色和人设广场都拿不到这些记录。</p>
      {asking && (
        <div role="dialog" aria-label="确认授权" className="panel">
          <p>
            <strong>让 {nameOf(asking)} 知道？</strong>
          </p>
          <p>TA 会知道你的经期状态，并可能在合适的时候关心你</p>
          <button disabled={busy} onClick={() => setAsking(null)}>
            取消
          </button>
          <button
            className="primary"
            disabled={busy}
            onClick={() => {
              const id = asking;
              setAsking(null);
              void save([...current, id], `${nameOf(id)} 会知道`);
            }}
          >
            让 TA 知道
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}

/** 周期设置与清空经期日记（period-diary.md 3.4、3.5）。 */
export function PeriodSettingsPage() {
  const navigate = useNavigate();
  const [, setSeen] = useIntro();
  const settings = useRemote(HealthEndpoints.getSettings, { networkOnly: true });
  const [value, setValue] = useState<HealthSettings | null>(null);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current = value ?? settings.data;
  async function update(patch: Partial<HealthSettings>) {
    if (!current) return;
    const next = { ...current, ...patch };
    setBusy(true);
    setError('');
    setMessage('');
    try {
      const saved = await api.call(HealthEndpoints.updateSettings, {
        body: { cycleLengthDays: next.cycleLengthDays, periodLengthDays: next.periodLengthDays },
      });
      setValue(saved);
      setMessage('已保存');
    } catch (e) {
      setError(friendlyError(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <main>
      <NavBar title="周期设置" fallback="/services/period" />
      {settings.error && !settings.data && (
        <div className="empty">
          <p>加载失败</p>
          <button onClick={settings.refresh}>重试</button>
        </div>
      )}
      {current && (
        <div className="panel stack">
          <label>
            平时的周期长度
            <select
              disabled={busy}
              value={current.cycleLengthDays}
              onChange={(event) => void update({ cycleLengthDays: Number(event.target.value) })}
            >
              {Array.from({ length: 46 }, (_, i) => i + 15).map((n) => (
                <option key={n} value={n}>
                  {n} 天
                </option>
              ))}
            </select>
          </label>
          <label>
            平时经期天数
            <select
              disabled={busy}
              value={current.periodLengthDays}
              onChange={(event) => void update({ periodLengthDays: Number(event.target.value) })}
            >
              {Array.from({ length: 15 }, (_, i) => i + 1).map((n) => (
                <option key={n} value={n}>
                  {n} 天
                </option>
              ))}
            </select>
          </label>
          <small>记录不足 2 个周期时，用这里的数字预测</small>
        </div>
      )}
      <button className="danger danger-row" disabled={busy} onClick={() => setConfirming(true)}>
        清空经期日记
      </button>
      {confirming && (
        <div role="dialog" aria-label="清空经期日记" className="panel">
          <p>
            <strong>清空经期日记？</strong>
          </p>
          <p>所有记录都会删除，不能恢复。授权的角色也会立即不再知道</p>
          <button disabled={busy} onClick={() => setConfirming(false)}>
            取消
          </button>
          <button
            className="danger"
            disabled={busy}
            onClick={() => {
              setBusy(true);
              setError('');
              void api
                .call(HealthEndpoints.clearAll, { body: { confirm: 'CLEAR' } })
                .then(() => {
                  setSeen(false);
                  navigate('/services/period', { replace: true });
                })
                .catch((e) => setError(friendlyError(e)))
                .finally(() => setBusy(false));
            }}
          >
            清空
          </button>
        </div>
      )}
      {message && <p role="status">{message}</p>}
      {error && <p role="alert">{error}</p>}
    </main>
  );
}
