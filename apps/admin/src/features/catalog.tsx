import { useState, type FormEvent } from 'react';
import {
  ModelAccessAdminEndpoints,
  ModelCapability,
  type AdminCatalogEntry,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';
const capabilities: Record<string, string> = {
  vision: '识图',
  web_search: '联网搜索',
  image_generation: '生成图片',
  voice_output: '语音输出',
  voice_input: '语音输入',
  realtime_voice: '实时语音',
  adult_content: '允许成人内容',
  unsupported: '其他能力',
};
export function CatalogPage() {
  const list = useRemote(ModelAccessAdminEndpoints.listCatalog);
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const [editing, setEditing] = useState<AdminCatalogEntry | null>(null);
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');
  const [message, setMessage] = useState('');
  const [formRevision, setFormRevision] = useState(0);
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setPending(true);
    setError('');
    const form = new FormData(event.currentTarget);
    try {
      const modelKey = String(form.get('modelKey'));
      const body = {
        modelKey,
        displayName: String(form.get('displayName')),
        vendorName: String(form.get('vendorName')),
        upstreamId: String(form.get('upstreamId')),
        upstreamModelId: String(form.get('upstreamModelId')),
        capabilities: form.getAll('capabilities'),
        tags: String(form.get('tags') ?? '')
          .split(/[，,]/)
          .map((t) => t.trim())
          .filter(Boolean),
        leaderboardRank: form.get('rank') ? Number(form.get('rank')) : null,
        sortOrder: Number(form.get('sortOrder') || 0),
        defaultFor: form.getAll('defaultFor'),
        enabled: form.has('enabled'),
      };
      await api.call(ModelAccessAdminEndpoints.upsertCatalogEntry, {
        params: { modelKey },
        body: body as Omit<AdminCatalogEntry, 'updatedAt'>,
      });
      setMessage('模型目录已保存');
      setEditing(null);
      setFormRevision((v) => v + 1);
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <h1>模型目录</h1>
      <form
        key={`${editing?.modelKey ?? 'new'}:${formRevision}`}
        className="panel form-grid"
        onSubmit={(e) => void save(e)}
      >
        <h2>{editing ? '编辑模型' : '新增模型'}</h2>
        <label>
          模型键
          <input
            name="modelKey"
            required
            defaultValue={editing?.modelKey ?? ''}
            readOnly={!!editing}
            placeholder="出品方/模型名"
          />
        </label>
        <label>
          显示名称
          <input name="displayName" required defaultValue={editing?.displayName ?? ''} />
        </label>
        <label>
          出品方
          <input name="vendorName" required defaultValue={editing?.vendorName ?? ''} />
        </label>
        <label>
          调用上游
          <select name="upstreamId" required defaultValue={editing?.upstreamId ?? ''}>
            <option value="" disabled>
              选择上游
            </option>
            {upstreams.data?.items.map((u) => (
              <option key={u.upstreamId} value={u.upstreamId}>
                {u.name}
              </option>
            ))}
          </select>
        </label>
        <label>
          上游模型名称
          <input name="upstreamModelId" required defaultValue={editing?.upstreamModelId ?? ''} />
        </label>
        <label>
          标签（逗号分隔）
          <input name="tags" defaultValue={editing?.tags.join('，') ?? ''} />
        </label>
        <label>
          排序
          <input name="sortOrder" type="number" defaultValue={editing?.sortOrder ?? 0} />
        </label>
        <label>
          排行榜名次
          <input name="rank" type="number" min={1} defaultValue={editing?.leaderboardRank ?? ''} />
        </label>
        <fieldset>
          <legend>能力标签</legend>
          {ModelCapability.options.map((c) => (
            <label className="check" key={c}>
              <input
                type="checkbox"
                name="capabilities"
                value={c}
                defaultChecked={editing?.capabilities.includes(c) ?? false}
              />
              {capabilities[c] ?? c}
            </label>
          ))}
        </fieldset>
        <fieldset>
          <legend>平台默认</legend>
          {(['chat', 'background', 'vision'] as const).map((v) => (
            <label className="check" key={v}>
              <input
                type="checkbox"
                name="defaultFor"
                value={v}
                defaultChecked={editing?.defaultFor.includes(v) ?? false}
              />
              {{ chat: '聊天', background: '后台', vision: '识图' }[v]}
            </label>
          ))}
        </fieldset>
        <label className="check">
          <input name="enabled" type="checkbox" defaultChecked={editing?.enabled ?? false} />
          启用（先发布价格）
        </label>
        <p className="hint">无审查模型不能设为平台默认，启用模型必须有当前生效价格。</p>
        <button className="primary" disabled={pending}>
          保存模型
        </button>
        {editing && (
          <button type="button" onClick={() => setEditing(null)}>
            取消编辑
          </button>
        )}
      </form>
      <Feedback message={message} error={error || list.error || upstreams.error} />
      <table>
        <thead>
          <tr>
            <th>模型</th>
            <th>模型键</th>
            <th>状态</th>
            <th>默认用途</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((m) => (
            <tr key={m.modelKey}>
              <td>{m.displayName}</td>
              <td>{m.modelKey}</td>
              <td>{m.enabled ? '启用' : '停用'}</td>
              <td>{m.defaultFor.join(' / ') || '—'}</td>
              <td>
                <button onClick={() => setEditing(m)}>编辑</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
