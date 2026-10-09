/**
 * 管理后台情景模式管理页（ADM-05 第 8 条）。
 * 对接 /api/v1/admin/scenario-modes（ScenarioModeAdminController，T-049 新增）。
 * 内置模式（isBuiltin=true）不能删除，只能修改预设提示词和启用状态。
 * 修改预设提示词后应触发人设稳定检查——前端展示提示，实际检查由后台任务队列完成（MODE-04）。
 */
import { useState, type FormEvent } from 'react';
import { errorText } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';

interface ScenarioMode {
  id: string;
  name: string;
  description: string;
  presetPrompt: string | null;
  appliesTo: 'all' | 'non_minor' | 'adult_eligible';
  hasRomanceContent: boolean;
  hasAdultContent: boolean;
  isBuiltin: boolean;
  enabled: boolean;
  sortOrder: number;
}

const APPLIES_LABELS: Record<string, string> = {
  all: '所有角色',
  non_minor: '非儿童角色',
  adult_eligible: '有成人模式资格的角色',
};

async function fetchModes(): Promise<ScenarioMode[]> {
  const res = await fetch('/api/v1/admin/scenario-modes', {
    headers: { Authorization: `Bearer ${localStorage.getItem('admin_token') ?? ''}` },
  });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const body = (await res.json()) as { items: ScenarioMode[] };
  return body.items;
}

async function saveMode(
  id: string | null,
  data: Partial<ScenarioMode>,
  token: string,
): Promise<ScenarioMode> {
  const url = id ? `/api/v1/admin/scenario-modes/${id}` : '/api/v1/admin/scenario-modes';
  const method = id ? 'PATCH' : 'POST';
  const res = await fetch(url, {
    method,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify(data),
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
  return res.json() as Promise<ScenarioMode>;
}

async function deleteMode(id: string, token: string): Promise<void> {
  const res = await fetch(`/api/v1/admin/scenario-modes/${id}`, {
    method: 'DELETE',
    headers: { Authorization: `Bearer ${token}` },
  });
  if (!res.ok) {
    const body = (await res.json().catch(() => ({}))) as { message?: string };
    throw new Error(body.message ?? `HTTP ${res.status}`);
  }
}

function getToken(): string {
  return localStorage.getItem('admin_token') ?? '';
}

export function ScenarioModesPage() {
  const [modes, setModes] = useState<ScenarioMode[]>([]);
  const [loadError, setLoadError] = useState('');
  const [loaded, setLoaded] = useState(false);

  const [editing, setEditing] = useState<ScenarioMode | null>(null);
  const [isNew, setIsNew] = useState(false);
  const [pending, setPending] = useState(false);
  const [saveError, setSaveError] = useState('');
  const [saveMessage, setSaveMessage] = useState('');
  const [promptChanged, setPromptChanged] = useState(false);

  async function load() {
    setLoadError('');
    try {
      const items = await fetchModes();
      setModes(items);
      setLoaded(true);
    } catch (e) {
      setLoadError(errorText(e));
    }
  }

  function startNew() {
    setEditing({
      id: '',
      name: '',
      description: '',
      presetPrompt: null,
      appliesTo: 'all',
      hasRomanceContent: false,
      hasAdultContent: false,
      isBuiltin: false,
      enabled: true,
      sortOrder: 0,
    });
    setIsNew(true);
    setSaveError('');
    setSaveMessage('');
    setPromptChanged(false);
  }

  function startEdit(m: ScenarioMode) {
    setEditing({ ...m });
    setIsNew(false);
    setSaveError('');
    setSaveMessage('');
    setPromptChanged(false);
  }

  function cancel() {
    setEditing(null);
    setIsNew(false);
  }

  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!editing) return;
    setSaveError('');
    setSaveMessage('');
    setPending(true);
    const form = new FormData(e.currentTarget);
    const data: Partial<ScenarioMode> = {
      name: String(form.get('name') ?? ''),
      description: String(form.get('description') ?? ''),
      presetPrompt: String(form.get('presetPrompt') ?? '') || null,
      enabled: form.get('enabled') === 'on',
      sortOrder: Number(form.get('sortOrder') ?? 0),
      ...(editing.isBuiltin
        ? {}
        : {
            appliesTo: form.get('appliesTo') as ScenarioMode['appliesTo'],
            hasRomanceContent: form.get('hasRomanceContent') === 'on',
            hasAdultContent: form.get('hasAdultContent') === 'on',
          }),
    };
    try {
      const saved = await saveMode(isNew ? null : editing.id, data, getToken());
      setModes((prev) =>
        isNew ? [...prev, saved] : prev.map((m) => (m.id === saved.id ? saved : m)),
      );
      setEditing(null);
      setIsNew(false);
      setSaveMessage(
        promptChanged
          ? '已保存。修改了预设提示词，需要重新运行人设稳定检查后才能发布相关角色。'
          : '已保存',
      );
    } catch (err) {
      setSaveError(errorText(err));
    } finally {
      setPending(false);
    }
  }

  async function remove(m: ScenarioMode) {
    if (!window.confirm(`确认删除情景模式「${m.name}」？此操作不可撤销。`)) return;
    try {
      await deleteMode(m.id, getToken());
      setModes((prev) => prev.filter((x) => x.id !== m.id));
    } catch (err) {
      setSaveError(errorText(err));
    }
  }

  if (!loaded) {
    return (
      <div className="stack">
        <h1>情景模式管理</h1>
        <button type="button" onClick={() => void load()}>
          加载情景模式
        </button>
        <Feedback error={loadError} />
      </div>
    );
  }

  return (
    <div className="stack">
      <h1>情景模式管理</h1>
      <Feedback error={saveError} message={saveMessage} />

      {!editing && (
        <button type="button" onClick={startNew}>
          新增情景模式
        </button>
      )}

      {editing && (
        <form className="panel form-grid" onSubmit={(e) => void submit(e)}>
          <h2>{isNew ? '新增情景模式' : `编辑：${editing.name}`}</h2>
          {editing.isBuiltin && (
            <p className="text-warn">内置模式只能修改预设提示词和启用状态，其他字段为只读。</p>
          )}
          <label>
            模式名称
            <input
              name="name"
              required
              maxLength={32}
              defaultValue={editing.name}
              readOnly={editing.isBuiltin}
            />
          </label>
          <label>
            说明
            <input
              name="description"
              maxLength={200}
              defaultValue={editing.description}
              readOnly={editing.isBuiltin}
            />
          </label>
          <label>
            预设提示词（系统提示词片段，可选）
            <textarea
              name="presetPrompt"
              rows={4}
              defaultValue={editing.presetPrompt ?? ''}
              onChange={() => setPromptChanged(true)}
            />
          </label>
          {promptChanged && (
            <p className="text-warn">
              修改预设提示词后，需要重新运行人设稳定检查（MODE-04）才能发布相关角色。
            </p>
          )}
          {!editing.isBuiltin && (
            <>
              <label>
                适用范围
                <select name="appliesTo" defaultValue={editing.appliesTo}>
                  <option value="all">所有角色</option>
                  <option value="non_minor">非儿童角色</option>
                  <option value="adult_eligible">有成人模式资格的角色</option>
                </select>
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="hasRomanceContent"
                  defaultChecked={editing.hasRomanceContent}
                />
                含恋爱内容（自动排除儿童角色）
              </label>
              <label className="checkbox-label">
                <input
                  type="checkbox"
                  name="hasAdultContent"
                  defaultChecked={editing.hasAdultContent}
                />
                含成人内容（只对成人模式资格为「是」的角色开放）
              </label>
            </>
          )}
          <label>
            排序（数字越小越靠前）
            <input type="number" name="sortOrder" defaultValue={editing.sortOrder} min={0} />
          </label>
          <label className="checkbox-label">
            <input type="checkbox" name="enabled" defaultChecked={editing.enabled} />
            启用
          </label>
          <div className="form-actions">
            <button type="submit" disabled={pending}>
              {pending ? '保存中…' : '保存'}
            </button>
            <button type="button" onClick={cancel}>
              取消
            </button>
          </div>
        </form>
      )}

      <table>
        <thead>
          <tr>
            <th>ID</th>
            <th>名称</th>
            <th>适用范围</th>
            <th>类型</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {modes.map((m) => (
            <tr key={m.id}>
              <td>{m.id}</td>
              <td>
                {m.name}
                {m.isBuiltin && <span className="badge">内置</span>}
              </td>
              <td>{APPLIES_LABELS[m.appliesTo] ?? m.appliesTo}</td>
              <td>{m.hasAdultContent ? '成人' : m.hasRomanceContent ? '恋爱' : '普通'}</td>
              <td>{m.enabled ? '启用' : '停用'}</td>
              <td>
                <button type="button" onClick={() => startEdit(m)}>
                  编辑
                </button>
                {!m.isBuiltin && (
                  <button type="button" onClick={() => void remove(m)} className="danger">
                    删除
                  </button>
                )}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
