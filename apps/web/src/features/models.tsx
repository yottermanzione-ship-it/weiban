import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { OldIcon } from './old-icons.js';
import { ApiFailure } from '@weiban/client-core';
import { GroupHeader, MenuGroup, MenuRow, NavBar, TextTabs } from './shell-kit.js';
import { perReplyText } from './wallet.js';
import { showToast } from './toast.js';
import { ModelAccessEndpoints } from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
/** 全局聊天模型；榜单和热门选用共用同一真实选择入口。 */
export function ModelsPage() {
  const models = useRemote(ModelAccessEndpoints.listModels);
  const selection = useRemote(ModelAccessEndpoints.getSelection);
  const info = useRemote(ModelAccessEndpoints.getLeaderboardInfo);
  const [tab, setTab] = useState<'rank' | 'popular'>('rank');
  const [pending, setPending] = useState(false);
  const current = selection.data?.chat?.modelKey ?? '';
  const all = models.data?.items.filter((m) => !m.capabilities.includes('adult_content')) ?? [];
  const counts = new Map(info.data?.popular.map((p) => [p.modelKey, p.users]));
  const ranked =
    tab === 'rank'
      ? all
          .filter((m) => m.leaderboardRank != null)
          .sort((a, b) => a.leaderboardRank! - b.leaderboardRank!)
      : all
          .filter((m) => (counts.get(m.modelKey) ?? 0) > 0)
          .sort(
            (a, b) =>
              counts.get(b.modelKey)! - counts.get(a.modelKey)! ||
              a.displayName.localeCompare(b.displayName),
          );
  async function choose(key: string) {
    if (pending || key === current) return;
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.updateSelection, {
        body: { chat: key ? { modelKey: key } : null },
      });
      selection.refresh();
      info.refresh();
      showToast('已保存，下次回复起使用新的模型', 2000, 'success');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const row = (model: (typeof all)[number], rank?: number) => (
    <MenuRow
      key={model.modelKey}
      label={
        <>
          {rank != null && <span className="rank-no">{rank}</span>}
          {model.displayName}
        </>
      }
      subtitle={[
        perReplyText(model),
        model.vendorName,
        tab === 'popular' && rank != null ? `${counts.get(model.modelKey)} 人选用` : '',
        model.available ? '' : '暂不可用',
      ]
        .filter(Boolean)
        .join(' · ')}
      chevron={false}
      disabled={pending || !selection.data || !model.available}
      right={current === model.modelKey ? <Tick /> : undefined}
      onClick={() => void choose(model.modelKey)}
    />
  );
  return (
    <main>
      <NavBar
        title="模型"
        fallback="/services"
        right={
          info.data?.source ? (
            <a
              className="text-action"
              href={info.data.source.url}
              target="_blank"
              rel="noreferrer"
              aria-label={`榜单来源：${info.data.source.label}`}
            >
              来源
            </a>
          ) : undefined
        }
      />
      <GroupHeader>聊天模型</GroupHeader>
      <MenuGroup>
        <MenuRow
          label="平台默认"
          chevron={false}
          disabled={pending || !selection.data}
          right={current === '' ? <Tick /> : undefined}
          onClick={() => void choose('')}
        />
      </MenuGroup>
      <TextTabs<'rank' | 'popular'>
        items={[
          { value: 'rank', label: '模型排行榜' },
          { value: 'popular', label: '热门榜' },
        ]}
        value={tab}
        onChange={setTab}
      />
      {tab === 'rank' ? (
        <p className="hint page-note">
          管理员维护的模型排名。
          {info.data?.source ? (
            <a href={info.data.source.url} target="_blank" rel="noreferrer">
              参考来源：{info.data.source.label}
              {info.data.source.asOf ? `（${info.data.source.asOf}）` : ''}
            </a>
          ) : (
            '榜单来源待配置'
          )}
        </p>
      ) : (
        <p className="hint page-note">按当前全局聊天模型选用人数排序，不含角色单独设置。</p>
      )}
      <MenuGroup>
        {ranked.map((m, i) => row(m, tab === 'rank' ? m.leaderboardRank! : i + 1))}
      </MenuGroup>
      {!models.loading && !info.loading && ranked.length === 0 && (
        <p className="empty">{tab === 'rank' ? '暂未配置模型排名' : '还没有选用数据'}</p>
      )}
      <GroupHeader>全部可选聊天模型</GroupHeader>
      <MenuGroup>{all.map((m) => row(m))}</MenuGroup>
      {selection.data?.chat && !selection.data.chat.available && (
        <p className="error page-note">已选模型暂不可用，请重新选择</p>
      )}
      {(models.error || selection.error || info.error) && (
        <p role="alert" className="notice-bar">
          {models.error || selection.error || info.error}
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
