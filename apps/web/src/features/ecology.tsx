/*
 * 角色生态设置（v5 批 C，docs/refactor/17-ecology-settings.md）。
 * 我 › 偏好 › 角色生态：总开关、活跃程度（四档）、动作开关、角色开关。PRO+ 专属，按动作消耗积分。
 * 不做免打扰、不做花费上限（17 号 §3、§6）。
 */
import { useState } from 'react';
import {
  EcologyEndpoints,
  type EcologyActionGroup,
  type EcologyActionKey,
  type UpdateEcologySettings,
  type EcologyActivityLevel,
  type EcologySettings,
} from '@weiban/contracts';
import { useChat } from '../app/chat.js';
import { api } from '../data/client.js';
import { useCharacterNames } from '../data/character-names.js';
import { friendlyError, useRemote } from '../data/use-remote.js';
import { CharacterAvatar } from './character-avatar.js';
import {
  CheckCircle,
  GroupHeader,
  MenuGroup,
  MenuRow,
  NavBar,
  SegmentedTabs,
  SwitchRow,
} from './shell-kit.js';
import { Dialog, showToast } from './toast.js';

const GROUP_NAMES: Record<EcologyActionGroup, string> = {
  chat: '和你聊天',
  moments: '朋友圈',
  life: 'TA 自己的生活',
  care: '关心你',
  play: '小程序与玩法',
  group: '群聊',
};
const GROUP_ORDER: EcologyActionGroup[] = ['chat', 'moments', 'life', 'care', 'play', 'group'];

/** 总经理 10-26：角色多了会把动作开关挤到看不见 → 「按角色 / 按动作」分段 Tab 各占一页。 */
type EcologyTab = 'characters' | 'actions';
const TAB_KEY = 'weiban:ecology-tab';
function readTab(): EcologyTab {
  try {
    return sessionStorage.getItem(TAB_KEY) === 'actions' ? 'actions' : 'characters';
  } catch {
    return 'characters';
  }
}

function points(n: number | null | undefined): string {
  if (n === null || n === undefined) return '暂无法估算';
  return `约 ${n < 10 ? n.toFixed(1).replace(/\.0$/, '') : Math.round(n)} 积分`;
}

export function EcologyPage() {
  const remote = useRemote(EcologyEndpoints.get, { networkOnly: true });
  const [local, setLocal] = useState<EcologySettings | null>(null);
  const [busy, setBusy] = useState(false);
  const [intro, setIntro] = useState(false);
  const [tab, setTabState] = useState<EcologyTab>(readTab);
  const setTab = (next: EcologyTab) => {
    setTabState(next);
    try {
      sessionStorage.setItem(TAB_KEY, next);
    } catch {
      // 隐私模式等读写不了存储时，只是不记住上次的 Tab
    }
  };
  const data = local ?? remote.data ?? null;
  const { state } = useChat();
  const characterIds = data?.characters.map((c) => c.characterId) ?? [];
  const names = useCharacterNames(characterIds);

  async function patch(body: UpdateEcologySettings) {
    setBusy(true);
    try {
      setLocal(await api.call(EcologyEndpoints.update, { body }));
    } catch (e) {
      showToast(friendlyError(e), 2500, 'error');
    } finally {
      setBusy(false);
    }
  }

  async function setCharacter(characterId: string, enabled: boolean) {
    if (!data) return;
    setLocal({
      ...data,
      characters: data.characters.map((c) =>
        c.characterId === characterId ? { ...c, enabled } : c,
      ),
    });
    try {
      await api.call(EcologyEndpoints.setCharacter, { params: { characterId }, body: { enabled } });
      setLocal(await api.call(EcologyEndpoints.get, {}));
    } catch (e) {
      showToast(friendlyError(e), 2500, 'error');
      setLocal(null);
      remote.refresh();
    }
  }

  function toggleMaster(enabled: boolean) {
    if (!data) return;
    if (enabled && !data.introSeen) {
      setIntro(true);
      return;
    }
    void patch({ enabled });
  }

  const nameOf = (id: string) =>
    state.contacts.find((c) => c.characterId === id)?.remark || names[id] || '角色';

  return (
    <main className="ecology-page">
      <NavBar title="角色生态" fallback="/me" />
      {remote.error && !data && (
        <div className="notice-bar" role="alert">
          <p>{remote.error}</p>
          <button className="text-button" onClick={remote.refresh}>
            重试
          </button>
        </div>
      )}
      {!data && !remote.error && (
        <MenuGroup>
          <div className="skeleton-row" />
        </MenuGroup>
      )}
      {data && (
        <>
          <p className="ecology-lead">
            打开后，角色会像真人一样隔一阵子「想一想」：看看你们最近聊了什么、你发的朋友圈、今天是什么日子，自己决定要不要找你、发朋友圈，或者什么也不做。
          </p>
          <MenuGroup>
            <SwitchRow
              label="角色生态"
              subtitle={
                !data.eligible
                  ? 'PRO+ 会员专属'
                  : !data.runnable
                    ? '平台暂未开放，开启后会在开放时自动生效'
                    : '会员专属，按角色做的事消耗积分'
              }
              checked={data.enabled}
              disabled={busy || (!data.eligible && !data.enabled)}
              onChange={toggleMaster}
            />
          </MenuGroup>
          {data.enabled && data.pausedReason === 'insufficient_balance' && (
            <p className="ecology-note warn">积分不足，角色们暂时安静了。充值后会自动恢复。</p>
          )}
          {data.enabled && (
            <>
              <GroupHeader>活跃程度</GroupHeader>
              <MenuGroup>
                {data.levels.map((l) => (
                  <MenuRow
                    key={l.level}
                    label={l.label}
                    subtitle={`约每天 ${l.minPerDay === l.maxPerDay ? l.minPerDay : `${l.minPerDay}～${l.maxPerDay}`} 次 · ${points(l.pointsPerCharacterPerDay)}/角色`}
                    chevron={false}
                    right={<CheckCircle checked={data.activityLevel === l.level} />}
                    onClick={() =>
                      data.activityLevel !== l.level &&
                      void patch({ activityLevel: l.level as EcologyActivityLevel })
                    }
                  />
                ))}
              </MenuGroup>
              {/* 用分组容器承载：和其它分组同一套通栏、同一左边界。 */}
              <MenuGroup className="ecology-total">
                <span>按现在的设置，预计每天</span>
                <strong>{points(data.estimatedPointsPerDay)}</strong>
                <small>实际按角色做了什么扣积分；角色什么也不做时只花「想一想」的一点点。</small>
              </MenuGroup>

              <SegmentedTabs
                label="开关分类"
                value={tab}
                onChange={setTab}
                items={[
                  {
                    value: 'characters',
                    label: `按角色${data.characters.length ? ` · ${data.characters.filter((c) => c.enabled).length}/${data.characters.length}` : ''}`,
                  },
                  { value: 'actions', label: '按动作' },
                ]}
              />
              {tab === 'characters' && (
                <section role="tabpanel" aria-label="按角色">
                  <GroupHeader>哪些角色参与</GroupHeader>
                  <MenuGroup>
                    {data.characters.length === 0 && (
                      <MenuRow label="还没有好友角色" chevron={false} disabled />
                    )}
                    {data.characters.map((c) => (
                      <div key={c.characterId} className="ecology-character">
                        <CharacterAvatar id={c.characterId} size={36} />
                        <SwitchRow
                          label={nameOf(c.characterId)}
                          checked={c.enabled}
                          onChange={(v) => void setCharacter(c.characterId, v)}
                        />
                      </div>
                    ))}
                  </MenuGroup>
                </section>
              )}

              {tab === 'actions' && (
                <section role="tabpanel" aria-label="按动作">
                  {GROUP_ORDER.map((group) => {
                    const actions = data.actions.filter((a) => a.group === group);
                    if (!actions.length) return null;
                    return (
                      <section key={group}>
                        <GroupHeader>{GROUP_NAMES[group]}</GroupHeader>
                        <MenuGroup>
                          {actions.map((a) => (
                            <SwitchRow
                              key={a.key}
                              ariaLabel={a.label}
                              label={a.label}
                              subtitle={
                                a.available ? undefined : (a.unavailableReason ?? '即将上线')
                              }
                              checked={a.available && a.enabled}
                              disabled={busy || !a.available}
                              onChange={(enabled) =>
                                void patch({
                                  actions: [{ key: a.key as EcologyActionKey, enabled }],
                                })
                              }
                            />
                          ))}
                        </MenuGroup>
                      </section>
                    );
                  })}
                </section>
              )}
              <p className="ecology-footnote">
                每次角色「想一想」都会写一两句碎碎念，在角色资料页「TA
                的碎碎念」里能看到，附带这次做了什么、花了多少积分。 你在聊天里让 TA
                去做的事（比如「去发个朋友圈」）不受这里的开关限制。
              </p>
            </>
          )}
        </>
      )}
      {intro && data && (
        <Dialog
          title="打开角色生态"
          actions={[
            { label: '取消', onClick: () => setIntro(false) },
            {
              label: '打开角色生态',
              tone: 'primary',
              onClick: () => {
                setIntro(false);
                void patch({ enabled: true, introSeen: true });
              },
            },
          ]}
        >
          <p>角色生态是 PRO+ 会员专属。</p>
          <p>
            角色每次「想一想」和真正去做的事（发消息、发朋友圈、点赞评论……）都会消耗你的积分，积分不足时会自动暂停。
          </p>
          <p>可以随时用「活跃程度」和角色开关控制花费。</p>
        </Dialog>
      )}
    </main>
  );
}
