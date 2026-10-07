import { useState } from 'react';
import { ModelAccessEndpoints, type ModelRole } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
const roleLabels: Record<ModelRole, string> = {
  chat: '聊天模型',
  background: '后台模型',
  adult: '成人模式模型',
};
export function ModelsPage() {
  const models = useRemote(ModelAccessEndpoints.listModels);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function choose(role: ModelRole, key: string) {
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.updateSelection, {
        body: { [role]: key ? { modelKey: key } : null },
      });
      selection.refresh();
      setMessage('已保存，下次回复起使用新的模型');
    } catch (e) {
      setMessage(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <h1 className="page-title">模型</h1>
      <div className="panel stack">
        {(['chat', 'background', 'adult'] as const).map((role) => (
          <label key={role}>
            {roleLabels[role]}
            <select
              disabled={pending || !selection.data}
              value={selection.data?.[role]?.modelKey ?? ''}
              onChange={(e) => void choose(role, e.target.value)}
            >
              <option value="">
                {role === 'chat' ? '平台默认' : role === 'background' ? '沿用聊天模型' : '未设置'}
              </option>
              {models.data?.items
                .filter((m) => role === 'adult' || !m.capabilities.includes('adult_content'))
                .map((model) => (
                  <option key={model.modelKey} value={model.modelKey} disabled={!model.available}>
                    {model.displayName}
                    {model.available ? '' : '（暂不可用）'}
                    {model.capabilities.includes('adult_content') ? ' · 允许成人内容' : ''}
                  </option>
                ))}
            </select>
            {selection.data?.[role] && !selection.data[role]!.available && (
              <span className="error">已选模型暂不可用，请重新选择</span>
            )}
          </label>
        ))}
        <p className="hint">后台模型未设置时沿用聊天模型。成人模式模型未设置时不能开启成人模式。</p>
        <p role="status">{message || selection.error || models.error}</p>
      </div>
      <h2>模型目录</h2>
      <div className="panel rows">
        {models.data?.items.map((model) => (
          <div key={model.modelKey}>
            <strong>{model.displayName}</strong>
            <p>
              {model.vendorName} · {model.tags.join(' · ') || '聊天模型'}
            </p>
            <small>{model.available ? '可用' : '暂不可用'}</small>
          </div>
        ))}
      </div>
    </main>
  );
}
