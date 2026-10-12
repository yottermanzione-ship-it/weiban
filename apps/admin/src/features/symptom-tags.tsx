/**
 * 经期症状标签（ADM-04 第 5 条；设计 admin-content.md 4.5）。
 * 接口：HealthTagAdminEndpoints，整体保存。后台看不到任何用户的经期记录。
 */
import { useState } from 'react';
import { HealthTagAdminEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

interface Row {
  tagId?: string;
  name: string;
  enabled: boolean;
}

export function SymptomTagsPage() {
  const remote = useRemote(HealthTagAdminEndpoints.listSymptomTags);
  const [rows, setRows] = useState<Row[] | null>(null);
  const [name, setName] = useState('');
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  const current: Row[] =
    rows ??
    [...(remote.data?.items ?? [])]
      .sort((a, b) => a.order - b.order)
      .map(({ tagId, name: n, enabled }) => ({ tagId, name: n, enabled }));
  const change = (next: Row[]) => {
    setRows(next);
    setMessage('');
  };
  const move = (index: number, delta: number) => {
    const next = [...current];
    const target = index + delta;
    if (target < 0 || target >= next.length) return;
    [next[index], next[target]] = [next[target]!, next[index]!];
    change(next);
  };
  async function save() {
    setPending(true);
    setError('');
    setMessage('');
    try {
      const result = await api.call(HealthTagAdminEndpoints.putSymptomTags, {
        body: {
          items: current.map((row, order) => ({
            ...(row.tagId ? { tagId: row.tagId } : {}),
            name: row.name,
            order,
            enabled: row.enabled,
          })),
        },
      });
      setRows(
        [...result.items]
          .sort((a, b) => a.order - b.order)
          .map(({ tagId, name: n, enabled }) => ({ tagId, name: n, enabled })),
      );
      setMessage('已保存');
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <h1>经期症状标签</h1>
      <p className="inline-tip">这里只能维护标签。任何用户的经期记录在后台都看不到。</p>
      {remote.error && (
        <p role="alert" className="error-banner">
          加载失败：{remote.error} <button onClick={remote.refresh}>重试</button>
        </p>
      )}
      <form
        className="panel inline"
        onSubmit={(e) => {
          e.preventDefault();
          const value = name.trim();
          if (!value || current.some((r) => r.name === value)) return;
          change([...current, { name: value, enabled: true }]);
          setName('');
        }}
      >
        <label>
          标签名
          <input maxLength={6} value={name} onChange={(e) => setName(e.target.value)} />
        </label>
        <button disabled={!name.trim() || current.length >= 50}>新建标签</button>
      </form>
      <table>
        <thead>
          <tr>
            <th>标签名</th>
            <th>排序</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {current.map((row, index) => (
            <tr key={row.tagId ?? `new-${row.name}`}>
              <td>{row.name}</td>
              <td>
                <button aria-label="上移" disabled={index === 0} onClick={() => move(index, -1)}>
                  ↑
                </button>
                <button
                  aria-label="下移"
                  disabled={index === current.length - 1}
                  onClick={() => move(index, 1)}
                >
                  ↓
                </button>
              </td>
              <td>
                <span className={row.enabled ? 'tag success' : 'tag'}>
                  {row.enabled ? '已上架' : '已下架'}
                </span>
              </td>
              <td>
                <button
                  onClick={() =>
                    change(current.map((r, i) => (i === index ? { ...r, enabled: !r.enabled } : r)))
                  }
                >
                  {row.enabled ? '下架' : '上架'}
                </button>
                {!row.tagId && (
                  <button onClick={() => change(current.filter((_, i) => i !== index))}>
                    移除
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <p className="hint">下架的标签：已记录过的用户仍能在自己的历史记录里看到，新记录不能再选。</p>
      <Feedback message={message} error={error} />
      <button className="primary" disabled={pending || rows === null} onClick={() => void save()}>
        保存
      </button>
    </>
  );
}
