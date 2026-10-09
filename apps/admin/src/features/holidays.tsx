/**
 * 节日清单（ADM-04 第 4 条、SIM-09；设计 docs/design/pages/admin-content.md 第 2 节）。
 * 接口：HolidayAdminEndpoints。契约只有「每年（公历月日）/ 只此一次」两种日期规则，
 * 设计稿里的农历、类型、发节日卡、适用分类契约暂无，本页不显示。
 */
import { useState, type FormEvent } from 'react';
import { HolidayAdminEndpoints, type HolidayDateType, type HolidayEvent } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

function bjToday(): string {
  return new Date().toLocaleDateString('sv-SE', { timeZone: 'Asia/Shanghai' });
}
/** 今年对应的公历日期（YYYY-MM-DD）。 */
function thisYear(item: HolidayEvent): string {
  return item.dateType === 'annual' ? `${bjToday().slice(0, 4)}-${item.dateValue}` : item.dateValue;
}

interface Draft {
  name: string;
  dateType: HolidayDateType;
  dateValue: string;
  romantic: boolean;
  enabled: boolean;
}

export function HolidaysPage() {
  const [romantic, setRomantic] = useState<'' | 'yes' | 'no'>('');
  const [enabled, setEnabled] = useState<'' | 'true' | 'false'>('');
  const list = useRemote(HolidayAdminEndpoints.list, {
    query: { enabled: enabled || undefined, limit: 200 },
  });
  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  const [editing, setEditing] = useState<{ item: HolidayEvent | null; draft: Draft } | null>(null);
  const [tipOpen, setTipOpen] = useState(true);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const today = bjToday();
  const rows = (list.data?.items ?? [])
    .filter((h) => (romantic === '' ? true : romantic === 'yes' ? h.romantic : !h.romantic))
    .sort((a, b) => {
      const pa = thisYear(a) < today;
      const pb = thisYear(b) < today;
      if (pa !== pb) return pa ? 1 : -1;
      return thisYear(a).localeCompare(thisYear(b));
    });
  async function run(operation: () => Promise<unknown>, done: string, after?: () => void) {
    setPending(true);
    setError('');
    setMessage('');
    try {
      await operation();
      setMessage(done);
      after?.();
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  function toggle(item: HolidayEvent, value: boolean) {
    setOverrides((o) => ({ ...o, [item.holidayId]: value }));
    setError('');
    void api
      .call(HolidayAdminEndpoints.update, {
        params: { holidayId: item.holidayId },
        body: { enabled: value },
      })
      .then(() => list.refresh())
      .catch((e: unknown) => {
        setOverrides((o) => ({ ...o, [item.holidayId]: !value }));
        setError(`没保存成功：${errorText(e)}`);
      });
  }
  function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!editing) return;
    const { item, draft } = editing;
    void run(
      () =>
        item
          ? api.call(HolidayAdminEndpoints.update, {
              params: { holidayId: item.holidayId },
              body: {
                name: draft.name,
                dateValue: draft.dateValue,
                romantic: draft.romantic,
                enabled: draft.enabled,
              },
            })
          : api.call(HolidayAdminEndpoints.create, {
              body: {
                name: draft.name,
                dateType: draft.dateType,
                dateValue: draft.dateValue,
                romantic: draft.romantic,
              },
            }),
      '已保存',
      () => setEditing(null),
    );
  }
  const draft = editing?.draft;
  const setDraft = (patch: Partial<Draft>) =>
    setEditing((v) => (v ? { ...v, draft: { ...v.draft, ...patch } } : v));
  return (
    <>
      <div className="page-head">
        <h1>节日清单</h1>
        <button
          className="primary"
          onClick={() =>
            setEditing({
              item: null,
              draft: {
                name: '',
                dateType: 'annual',
                dateValue: '',
                romantic: false,
                enabled: true,
              },
            })
          }
        >
          新建节日
        </button>
      </div>
      {tipOpen && (
        <p className="inline-tip">
          生日、认识纪念日、用户自定义纪念日不在这里维护（来自用户资料和纪念日功能）。{' '}
          <button onClick={() => setTipOpen(false)}>知道了</button>
        </p>
      )}
      <div className="panel form-grid">
        <label>
          恋爱向
          <select value={romantic} onChange={(e) => setRomantic(e.target.value as '')}>
            <option value="">全部</option>
            <option value="yes">是</option>
            <option value="no">否</option>
          </select>
        </label>
        <label>
          启用
          <select value={enabled} onChange={(e) => setEnabled(e.target.value as '')}>
            <option value="">全部</option>
            <option value="true">已启用</option>
            <option value="false">已停用</option>
          </select>
        </label>
      </div>
      <Feedback message={message} error={error} />
      {list.error && (
        <p role="alert" className="error-banner">
          加载失败：{list.error} <button onClick={list.refresh}>重试</button>
        </p>
      )}
      {editing && draft && (
        <form className="panel stack" onSubmit={submit}>
          <h2>{editing.item ? '编辑节日' : '新建节日'}</h2>
          <label>
            名称 *
            <input
              required
              maxLength={10}
              value={draft.name}
              onChange={(e) => setDraft({ name: e.target.value })}
            />
          </label>
          <label>
            日期规则 *
            <select
              disabled={!!editing.item}
              value={draft.dateType}
              onChange={(e) =>
                setDraft({ dateType: e.target.value as HolidayDateType, dateValue: '' })
              }
            >
              <option value="annual">公历每年</option>
              <option value="once">只此一次</option>
            </select>
          </label>
          <label>
            日期 *
            {draft.dateType === 'once' ? (
              <input
                type="date"
                required
                value={draft.dateValue}
                onChange={(e) => setDraft({ dateValue: e.target.value })}
              />
            ) : (
              <input
                required
                placeholder="MM-DD，例如 12-25"
                pattern="\d{2}-\d{2}"
                value={draft.dateValue}
                onChange={(e) => setDraft({ dateValue: e.target.value })}
              />
            )}
          </label>
          <label className="inline">
            <input
              type="checkbox"
              checked={draft.romantic}
              onChange={(e) => setDraft({ romantic: e.target.checked })}
            />
            恋爱向
          </label>
          <span className="hint">
            开启后，只有关系类型为恋人或在恋爱模式中的角色会用恋爱口吻祝福
          </span>
          {editing.item && (
            <label className="inline">
              <input
                type="checkbox"
                checked={draft.enabled}
                onChange={(e) => setDraft({ enabled: e.target.checked })}
              />
              启用
            </label>
          )}
          <div className="inline">
            <button className="primary" disabled={pending}>
              保存
            </button>
            <button type="button" disabled={pending} onClick={() => setEditing(null)}>
              取消
            </button>
            {editing.item && (
              <button
                type="button"
                className="danger"
                disabled={pending}
                onClick={() => {
                  const item = editing.item!;
                  if (window.confirm('删除后，这一天角色不会再发节日祝福。此操作会记入审计记录'))
                    void run(
                      () =>
                        api.call(HolidayAdminEndpoints.remove, {
                          params: { holidayId: item.holidayId },
                        }),
                      '已删除',
                      () => setEditing(null),
                    );
                }}
              >
                删除
              </button>
            )}
          </div>
        </form>
      )}
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>日期规则</th>
            <th>{today.slice(0, 4)} 年日期</th>
            <th>恋爱向</th>
            <th>启用</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {rows.map((item) => {
            const on = overrides[item.holidayId] ?? item.enabled;
            return (
              <tr key={item.holidayId} className={thisYear(item) < today ? 'past' : ''}>
                <td>{item.name}</td>
                <td>{item.dateType === 'annual' ? `公历 ${item.dateValue}` : '只此一次'}</td>
                <td>{thisYear(item).slice(5)}</td>
                <td>{item.romantic ? '是' : '—'}</td>
                <td>
                  <input
                    type="checkbox"
                    role="switch"
                    aria-label={`启用${item.name}`}
                    checked={on}
                    onChange={(e) => toggle(item, e.target.checked)}
                  />
                </td>
                <td>
                  <button
                    onClick={() =>
                      setEditing({
                        item,
                        draft: {
                          name: item.name,
                          dateType: item.dateType,
                          dateValue: item.dateValue,
                          romantic: item.romantic,
                          enabled: on,
                        },
                      })
                    }
                  >
                    编辑
                  </button>
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {list.data && rows.length === 0 && <p className="hint">还没有节日</p>}
    </>
  );
}
