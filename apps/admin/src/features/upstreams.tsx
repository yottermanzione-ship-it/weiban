import { useState, type FormEvent } from 'react';
import { ModelAccessAdminEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { errorText, useRemote } from '../data/hooks.js';
import { Feedback } from '../components/feedback.js';
const statusLabels = {
  active: '正常',
  invalid: '密钥无效',
  quota_exhausted: '上游余额不足',
  unavailable: '暂不可用',
};
export function UpstreamsPage() {
  const list = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const [editing, setEditing] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  const [error, setError] = useState('');
  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    const apiKey = String(form.get('apiKey') ?? '');
    const field = event.currentTarget.elements.namedItem('apiKey');
    if (field instanceof HTMLInputElement) field.value = '';
    setPending(true);
    setError('');
    try {
      if (editing)
        await api.call(ModelAccessAdminEndpoints.rotateUpstreamKey, {
          params: { upstreamId: editing },
          body: { apiKey },
        });
      else
        await api.call(ModelAccessAdminEndpoints.createUpstream, {
          body: {
            name: String(form.get('name')),
            baseUrl: String(form.get('baseUrl')),
            kind: 'openai_compatible',
            apiKey,
          },
        });
      setMessage('连通测试通过，已保存');
      setEditing(null);
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  async function action(id: string, kind: 'test' | 'delete') {
    if (kind === 'delete' && !window.confirm('确认删除这个上游？仍有启用模型时无法删除。')) return;
    setPending(true);
    setError('');
    try {
      if (kind === 'test')
        await api.call(ModelAccessAdminEndpoints.testUpstream, { params: { upstreamId: id } });
      else await api.call(ModelAccessAdminEndpoints.deleteUpstream, { params: { upstreamId: id } });
      setMessage(kind === 'test' ? '连通测试完成' : '上游已删除');
      list.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      <h1>上游管理</h1>
      <form key={editing ?? 'new'} className="panel form-grid" onSubmit={(e) => void save(e)}>
        <h2>{editing ? '更换上游密钥' : '登记上游'}</h2>
        {!editing && (
          <>
            <label>
              显示名称
              <input name="name" required maxLength={40} />
            </label>
            <label>
              API基础地址
              <input name="baseUrl" type="url" required placeholder="https://…/v1" />
            </label>
          </>
        )}
        <label>
          平台API密钥
          <input
            name="apiKey"
            type="password"
            autoComplete="off"
            spellCheck={false}
            required
            minLength={8}
            maxLength={512}
          />
        </label>
        <button className="primary" disabled={pending}>
          测试并保存
        </button>
        {editing && (
          <button type="button" onClick={() => setEditing(null)}>
            取消更换
          </button>
        )}
        <p className="hint">密钥只用于本次提交，页面不保存原文；登记后只显示掩码。</p>
      </form>
      <Feedback message={message} error={error || list.error} />
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>基础地址</th>
            <th>密钥掩码</th>
            <th>状态</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          {list.data?.items.map((item) => (
            <tr key={item.upstreamId}>
              <td>{item.name}</td>
              <td>{item.baseUrl}</td>
              <td>{item.maskedKey}</td>
              <td>{statusLabels[item.status]}</td>
              <td>
                <button disabled={pending} onClick={() => void action(item.upstreamId, 'test')}>
                  测试连接
                </button>
                <button disabled={pending} onClick={() => setEditing(item.upstreamId)}>
                  更换密钥
                </button>
                <button disabled={pending} onClick={() => void action(item.upstreamId, 'delete')}>
                  删除
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </>
  );
}
