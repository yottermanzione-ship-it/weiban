import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { OldIcon } from './old-icons.js';
import { ApiFailure } from '@weiban/client-core';
import { GroupHeader, MenuGroup, MenuRow, NavBar } from './shell-kit.js';
import { perReplyText } from './wallet.js';
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
/** 模型页（5.4）：设置页式单选列表，分组「聊天模型」「后台模型」「成人模式模型」，选中右侧 ✓。 */
export function ModelsPage() {
  const models = useRemote(ModelAccessEndpoints.listModels);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const [pending, setPending] = useState(false);
  async function choose(role: UserModelRole, key: string) {
    if ((selection.data?.[role]?.modelKey ?? '') === key) return;
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.updateSelection, {
        body: { [role]: key ? { modelKey: key } : null },
      });
      selection.refresh();
      showToast('已保存，下次回复起使用新的模型', 2000, 'success');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <main>
      <NavBar title="模型" fallback="/services" />
      {(['chat', 'background', 'adult'] as const).map((role) => {
        const current = selection.data?.[role]?.modelKey ?? '';
        const list =
          models.data?.items.filter(
            (m) => role === 'adult' || !m.capabilities.includes('adult_content'),
          ) ?? [];
        return (
          <section key={role}>
            <GroupHeader>{roleLabels[role]}</GroupHeader>
            <MenuGroup>
              <MenuRow
                label={
                  role === 'chat' ? '平台默认' : role === 'background' ? '沿用聊天模型' : '未设置'
                }
                chevron={false}
                disabled={pending || !selection.data}
                right={current === '' ? <Tick /> : undefined}
                onClick={() => void choose(role, '')}
              />
              {list.map((model) => (
                <MenuRow
                  key={model.modelKey}
                  label={model.displayName}
                  subtitle={[
                    perReplyText(model),
                    model.vendorName,
                    ...model.tags,
                    model.available ? '' : '暂不可用',
                  ]
                    .filter(Boolean)
                    .join(' · ')}
                  chevron={false}
                  disabled={pending || !model.available}
                  right={current === model.modelKey ? <Tick /> : undefined}
                  onClick={() => void choose(role, model.modelKey)}
                />
              ))}
            </MenuGroup>
            {selection.data?.[role] && !selection.data[role]!.available && (
              <p className="error page-note">已选模型暂不可用，请重新选择</p>
            )}
          </section>
        );
      })}
      <p className="hint page-note">
        后台模型未设置时沿用聊天模型。成人模式模型未设置时不能开启成人模式。
      </p>
      {(selection.error || models.error) && (
        <p role="alert" className="notice-bar">
          {selection.error || models.error}
        </p>
      )}
    </main>
  );
}

function Tick() {
  return <OldIcon name="wechat/check" size={22} className="ink-brand" />;
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
      showToast('已保存，下一条回复起使用', 2000, 'success');
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
  return (
    <main>
      <NavBar title="TA 用的模型" />
      {(override.error || models.error) && <p role="alert">{override.error || models.error}</p>}
      <GroupHeader>聊天模型</GroupHeader>
      <MenuGroup>
        <MenuRow
          label="跟随默认"
          subtitle={`现在是 ${defaultName}，在「服务 › 模型」里改`}
          chevron={false}
          disabled={pending}
          right={current === '' ? <Tick /> : undefined}
          onClick={() => void choose('')}
        />
        {models.data?.items.map((model) => (
          <MenuRow
            key={model.modelKey}
            label={model.displayName}
            subtitle={[
              perReplyText(model),
              model.vendorName,
              model.available ? '' : '暂不可用',
              model.capabilities.includes('adult_content') ? '允许成人内容' : '',
            ]
              .filter(Boolean)
              .join(' · ')}
            chevron={false}
            disabled={pending || !model.available}
            right={current === model.modelKey ? <Tick /> : undefined}
            onClick={() => void choose(model.modelKey)}
          />
        ))}
      </MenuGroup>
      {override.data?.chat && !override.data.chat.available && (
        <p className="error page-note">TA 用的模型暂不可用，回复时会提示你临时改用默认模型</p>
      )}
      <p className="hint page-note">只影响和 TA 的私聊；群聊里每个角色也按各自的设置回复。</p>
    </main>
  );
}
