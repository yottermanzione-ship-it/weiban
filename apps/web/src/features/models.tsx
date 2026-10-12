import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Check } from '@phosphor-icons/react';
import { ApiFailure } from '@weiban/client-core';
import { NavBar } from './shell-kit.js';
import { showToast } from './toast.js';
import { ModelAccessEndpoints, type ModelRole } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
type UserModelRole = Exclude<ModelRole, 'adult_check'>;
const roleLabels: Record<UserModelRole, string> = {
  chat: '聊天模型',
  background: '后台模型',
  adult: '成人模式模型',
};
export function ModelsPage() {
  const models = useRemote(ModelAccessEndpoints.listModels);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const [pending, setPending] = useState(false);
  const [message, setMessage] = useState('');
  async function choose(role: UserModelRole, key: string) {
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

/** 聊天信息 › 聊天模型 › 为 TA 选模型（billing.md 6.1）。null = 跟随默认（服务 › 模型里的聊天模型）。 */
export function CharacterModelPage() {
  const { characterId = '' } = useParams();
  const models = useRemote(ModelAccessEndpoints.listModels);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const override = useRemote(ModelAccessEndpoints.getCharacterOverride, {
    params: { characterId },
    networkOnly: true,
  });
  const [pending, setPending] = useState(false);
  const current = override.data?.chat?.modelKey ?? '';
  const defaultName =
    models.data?.items.find((m) => m.modelKey === selection.data?.chat?.modelKey)?.displayName ??
    '平台默认';
  async function choose(key: string) {
    if (key === current) return;
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.setCharacterOverride, {
        params: { characterId },
        body: { chat: key ? { modelKey: key } : null },
      });
      override.refresh();
      showToast('已保存，下一条回复起使用');
    } catch (e) {
      showToast(
        e instanceof ApiFailure && e.code === 'model_not_allowed'
          ? '这个模型不能给 TA 用'
          : friendlyError(e),
      );
    } finally {
      setPending(false);
    }
  }
  const option = (key: string, title: string, note: string, disabled = false) => (
    <button
      key={key || 'default'}
      type="button"
      role="radio"
      aria-checked={current === key}
      className="menu-row"
      disabled={pending || disabled}
      onClick={() => void choose(key)}
    >
      <span className="menu-label">
        {title}
        <br />
        <small className="hint">{note}</small>
      </span>
      {current === key && <Check size={20} weight="bold" aria-hidden />}
    </button>
  );
  return (
    <main>
      <NavBar title="TA 用的模型" />
      {(override.error || models.error) && <p role="alert">{override.error || models.error}</p>}
      <div className="menu-group" role="radiogroup" aria-label="TA 用的模型">
        {option('', '跟随默认', `现在是 ${defaultName}，在「服务 › 模型」里改`)}
        {models.data?.items.map((model) =>
          option(
            model.modelKey,
            model.displayName,
            [
              model.vendorName,
              model.available ? '' : '暂不可用',
              model.capabilities.includes('adult_content') ? '允许成人内容' : '',
            ]
              .filter(Boolean)
              .join(' · '),
            !model.available,
          ),
        )}
      </div>
      {override.data?.chat && !override.data.chat.available && (
        <p className="error">TA 用的模型暂不可用，回复时会提示你临时改用默认模型</p>
      )}
      <p className="hint">只影响和 TA 的私聊；群聊里每个角色也按各自的设置回复。</p>
    </main>
  );
}
