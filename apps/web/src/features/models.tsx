import { useEffect, useState, type ReactNode } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { OldIcon } from './old-icons.js';
import { ApiFailure } from '@weiban/client-core';
import { GroupHeader, MenuGroup, MenuRow, NavBar, TextTabs } from './shell-kit.js';
import { formatPoints, multiplierText } from './points.js';
import { Dialog, showToast } from './toast.js';
import {
  ModelAccessEndpoints,
  type ModelInfo,
  type ModelScenario,
  type ScenarioConfig,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote, friendlyError } from '../data/use-remote.js';
import { useChat } from '../app/chat.js';
import { useCharacterNames } from '../data/character-names.js';
import { CharacterAvatar } from './character-avatar.js';
import { unavailableText } from './model-unavailable.js';

/**
 * 3.22：每个场景单独选模型（不做多模态「直接听语音 / 直接生成」）。
 * 3.24 去掉「图片识别」：你发的图片直接交给文本聊天（私密模式下交给私密模式）的模型看。
 */
export const SCENARIOS: Array<{ key: ModelScenario; label: string; hint: string }> = [
  { key: 'chat', label: '文本聊天', hint: '私聊、群聊回复（含看你发的图片），以及记忆整理等后台文字任务' },
  { key: 'voice_message', label: '语音消息', hint: '角色发语音时的声音合成' },
  { key: 'speech_recognition', label: '语音识别', hint: '把你的语音转成文字（含通话）' },
  { key: 'voice_call', label: '语音通话', hint: '通话时角色说话用的模型' },
  { key: 'image_generation', label: '发照片', hint: '角色发照片、自拍' },
  { key: 'private', label: '私密模式', hint: '私密模式聊天用的模型（私密模式下发的图片也给它看）' },
];
const TEXT_SCENARIOS: readonly ModelScenario[] = ['chat', 'voice_call', 'private'];
const scenarioLabel = (s: ModelScenario) => SCENARIOS.find((x) => x.key === s)?.label ?? s;

function discountText(rate: number) {
  const tenth = Math.round(rate * 100) / 10;
  return `限时 ${Number.isInteger(tenth) ? tenth.toFixed(0) : tenth.toFixed(1)} 折`;
}

/**
 * 模型行副标题（10-20 统一格式）：「消耗倍率 ×1.1 · 约每条 5.35 积分」；
 * 3.22 限时折扣：「消耗倍率 ~~×1.0~~ ×0.5 · 限时 5 折 · 约每条 …」（约每条已是折后数）。
 * scenario 传了时按该场景「约每次」估算（语音消息约 100 字、语音识别约 15 秒、发照片 1 张）。
 */
export function ModelPriceLine({
  model,
  scenario,
}: {
  model: Pick<
    ModelInfo,
    'pointsPerReply' | 'displayMultiplier' | 'discount' | 'pointsPerUse' | 'pointsPerReplyBasis'
  > & { scenarios?: ModelInfo['scenarios'] };
  scenario?: ModelScenario;
}) {
  // 没指定场景的非文字模型（语音、图片）：按它的第一个场景显示「约每次」。
  scenario ??=
    model.pointsPerReply == null
      ? (model.scenarios?.find((s) => model.pointsPerUse?.[s as ModelScenario] != null) as
          ModelScenario | undefined)
      : undefined;
  const parts: ReactNode[] = [];
  const m = multiplierText(model);
  const d = model.discount;
  if (m && d && model.displayMultiplier != null) {
    parts.push(
      <span key="m">
        消耗倍率 <s className="price-was">{m}</s>{' '}
        {multiplierText({ displayMultiplier: model.displayMultiplier * d.rate })}
      </span>,
    );
  } else if (m) parts.push(<span key="m">消耗倍率 {m}</span>);
  if (d)
    parts.push(
      <span key="d" className="price-discount">
        {discountText(d.rate)}
      </span>,
    );
  const text = !scenario || TEXT_SCENARIOS.includes(scenario);
  const per = scenario
    ? (model.pointsPerUse?.[scenario] ?? (text ? model.pointsPerReply : null))
    : model.pointsPerReply;
  if (per != null)
    parts.push(<span key="p">{`约每${text ? '条' : '次'} ${formatPoints(per)} 积分`}</span>);
  if (!parts.length) return <>—</>;
  return (
    <>
      {parts.map((p, i) => (
        <span key={i}>
          {i > 0 && ' · '}
          {p}
        </span>
      ))}
    </>
  );
}

function Tick() {
  return <OldIcon name="wechat/check" size={22} className="ink-brand" />;
}

const nameOf = (models: ModelInfo[] | undefined, key: string | null | undefined) =>
  key ? (models?.find((m) => m.modelKey === key)?.displayName ?? key.split('/').pop()) : null;

// ---------- 设置 › 模型配置 ----------

/** 设置 › 模型配置（原「我的模型」）：按场景 / 按角色两种视图。 */
export function ModelsPage() {
  const [view, setView] = useState<'scenario' | 'character'>('scenario');
  return (
    <main>
      <NavBar title="模型配置" fallback="/services" />
      <TextTabs<'scenario' | 'character'>
        items={[
          { value: 'scenario', label: '按场景' },
          { value: 'character', label: '按角色' },
        ]}
        value={view}
        onChange={setView}
      />
      {view === 'scenario' ? <ScenarioView /> : <CharacterView />}
    </main>
  );
}

function ScenarioView() {
  const config = useRemote(ModelAccessEndpoints.getScenarioConfig, { networkOnly: true });
  const models = useRemote(ModelAccessEndpoints.listModels);
  const [pending, setPending] = useState(false);
  const rows = config.data?.scenarios ?? [];
  const canRecommend = rows.some(
    (r) => r.scenario !== 'private' && !r.selection && r.recommendedModelKey,
  );
  async function recommend() {
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.applyRecommendedScenarios, { body: {} });
      config.refresh();
      showToast('已按推荐配置好', 2000, 'success');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <>
      {config.data?.needsSetup && (
        <p className="notice-bar">还没选「文本聊天」模型，选好后才能和角色聊天</p>
      )}
      <GroupHeader>每个场景单独选一个模型</GroupHeader>
      <MenuGroup>
        {SCENARIOS.map((s) => {
          const row = rows.find((r) => r.scenario === s.key);
          const chosen = nameOf(models.data?.items, row?.selection?.modelKey);
          return (
            <MenuRow
              key={s.key}
              to={`/models/scenario/${s.key}`}
              label={s.label}
              subtitle={s.hint}
              value={
                chosen ? (
                  row?.selection?.available === false ? (
                    <span className="ink-danger">
                      {chosen}（{unavailableText(row.selection.unavailableDetail)}）
                    </span>
                  ) : (
                    chosen
                  )
                ) : (
                  <span className="ink-muted">未配置</span>
                )
              }
            />
          );
        })}
      </MenuGroup>
      {canRecommend && (
        <div className="page-actions">
          <button
            type="button"
            className="primary wide"
            disabled={pending}
            onClick={() => void recommend()}
          >
            一键选推荐（只填未配置的场景）
          </button>
        </div>
      )}
      <p className="hint page-note">
        角色的日常动态（发文字、发语音、发照片）按对应场景自动使用这里的模型，不用单独选。
      </p>
      {(config.error || models.error) && (
        <p role="alert" className="notice-bar">
          {config.error || models.error}
        </p>
      )}
    </>
  );
}

function CharacterView() {
  const { state } = useChat();
  const contacts = state.contacts.filter((c) => c.status === 'active');
  const names = useCharacterNames(contacts.map((c) => c.characterId));
  return (
    <>
      <GroupHeader>给某个角色单独指定（未指定的场景跟随场景设置）</GroupHeader>
      <MenuGroup>
        {contacts.map((c) => (
          <MenuRow
            key={c.characterId}
            to={`/characters/${c.characterId}/model`}
            leading={<CharacterAvatar id={c.characterId} size={36} />}
            label={c.remark || names[c.characterId] || '角色'}
          />
        ))}
      </MenuGroup>
      {state.initialized && contacts.length === 0 && <p className="empty">还没有添加角色</p>}
    </>
  );
}

// ---------- 某个场景选模型 ----------

/** 模型配置 › 某个场景：只列后台标注可用于该场景的模型。文本聊天保留排行榜 / 热门榜。 */
export function ScenarioModelPage() {
  const { scenario = 'chat' } = useParams() as { scenario?: ModelScenario };
  const meta = SCENARIOS.find((s) => s.key === scenario) ?? SCENARIOS[0]!;
  const models = useRemote(ModelAccessEndpoints.listModels, { query: { scenario: meta.key } });
  const config = useRemote(ModelAccessEndpoints.getScenarioConfig, { networkOnly: true });
  const info = useRemote(ModelAccessEndpoints.getLeaderboardInfo);
  const [tab, setTab] = useState<'rank' | 'popular'>('rank');
  const [pending, setPending] = useState(false);
  const row = config.data?.scenarios.find((r) => r.scenario === meta.key);
  const current = row?.selection?.modelKey ?? '';
  const recommended = row?.recommendedModelKey ?? null;
  const all =
    models.data?.items.filter(
      (m) => meta.key === 'private' || !m.capabilities.includes('adult_content'),
    ) ?? [];
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
  async function choose(key: string | null) {
    if (pending || (key ?? '') === current) return;
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.updateScenarioConfig, {
        body: { selections: { [meta.key]: key ? { modelKey: key } : null } },
      });
      config.refresh();
      info.refresh();
      showToast(key ? '已保存，下次起使用新的模型' : '已清除', 2000, 'success');
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  const modelRow = (model: ModelInfo, rank?: number, onBoard = false) => (
    <MenuRow
      key={model.modelKey}
      label={
        <>
          {rank != null && <span className="rank-no">{rank}</span>}
          {model.displayName}
          {model.modelKey === recommended && <span className="tag-recommend">推荐</span>}
        </>
      }
      subtitle={
        <>
          <ModelPriceLine model={model} scenario={meta.key} />
          {onBoard && ` · ${model.vendorName}`}
          {onBoard &&
            tab === 'popular' &&
            rank != null &&
            ` · ${counts.get(model.modelKey)} 人选用`}
          {!model.available && ` · 暂不可用：${unavailableText(model.unavailableDetail)}`}
        </>
      }
      chevron={false}
      disabled={pending || !config.data || !model.available}
      right={current === model.modelKey ? <Tick /> : undefined}
      onClick={() => void choose(model.modelKey)}
    />
  );
  return (
    <main>
      <NavBar title={meta.label} fallback="/models" />
      <p className="hint page-note">{meta.hint}</p>
      {meta.key === 'chat' && (
        <>
          <TextTabs<'rank' | 'popular'>
            items={[
              { value: 'rank', label: '模型排行榜' },
              { value: 'popular', label: '热门榜' },
            ]}
            value={tab}
            onChange={setTab}
          />
          {tab === 'rank' ? (
            info.data?.source && (
              <p className="hint page-note">
                <a href={info.data.source.url} target="_blank" rel="noreferrer">
                  来源：{info.data.source.label}
                  {info.data.source.asOf ? ` · ${info.data.source.asOf}` : ''}
                </a>
              </p>
            )
          ) : (
            <p className="hint page-note">按「文本聊天」选用人数排序，不含角色单独设置。</p>
          )}
          <MenuGroup>
            {ranked.map((m, i) => modelRow(m, tab === 'rank' ? m.leaderboardRank! : i + 1, true))}
          </MenuGroup>
          {!models.loading && !info.loading && ranked.length === 0 && (
            <p className="empty">{tab === 'rank' ? '暂未配置模型排名' : '还没有选用数据'}</p>
          )}
          <GroupHeader>全部可选模型</GroupHeader>
        </>
      )}
      <MenuGroup>{all.map((m) => modelRow(m))}</MenuGroup>
      {!models.loading && all.length === 0 && (
        <p className="empty">平台暂未提供可用于「{meta.label}」的模型</p>
      )}
      {current && meta.key !== 'chat' && (
        <MenuGroup>
          <MenuRow
            label="不使用（清除）"
            center
            chevron={false}
            disabled={pending}
            onClick={() => void choose(null)}
          />
        </MenuGroup>
      )}
      {row?.selection && !row.selection.available && (
        <p className="error page-note">
          已选模型暂不可用（{unavailableText(row.selection.unavailableDetail)}），可以先换一个
        </p>
      )}
      {(models.error || config.error) && (
        <p role="alert" className="notice-bar">
          {models.error || config.error}
        </p>
      )}
    </main>
  );
}

// ---------- 按角色 ----------

/** 聊天信息 › TA 用的模型 = 模型配置 › 按角色 › 某角色：逐场景单独指定，未指定 = 跟随场景设置。 */
export function CharacterModelPage() {
  const { characterId = '' } = useParams();
  const models = useRemote(ModelAccessEndpoints.listModels);
  const config = useRemote(ModelAccessEndpoints.getCharacterScenarios, {
    params: { characterId },
    networkOnly: true,
  });
  const names = useCharacterNames([characterId]);
  const { state } = useChat();
  const contact = state.contacts.find((c) => c.characterId === characterId);
  const title = contact?.remark || names[characterId] || 'TA';
  return (
    <main>
      <NavBar title="TA 用的模型" fallback="/models" />
      <p className="hint page-note">{`给「${title}」单独指定；没指定的场景跟随「模型配置 › 按场景」。`}</p>
      <MenuGroup>
        {SCENARIOS.map((s) => {
          const row = config.data?.scenarios.find((r) => r.scenario === s.key);
          const own = nameOf(models.data?.items, row?.selection?.modelKey);
          const effective = nameOf(models.data?.items, row?.effective?.modelKey);
          return (
            <MenuRow
              key={s.key}
              to={`/characters/${characterId}/model/${s.key}`}
              label={s.label}
              value={own ?? <span className="ink-muted">{`跟随（${effective ?? '未配置'}）`}</span>}
            />
          );
        })}
      </MenuGroup>
      {config.error && <p role="alert">{config.error}</p>}
      <p className="hint page-note">只影响这个角色；群聊里每个角色也按各自的设置回复。</p>
    </main>
  );
}

/** 某角色 › 某场景：跟随场景设置 / 单独指定一个模型。 */
export function CharacterScenarioPickerPage() {
  const { characterId = '', scenario = 'chat' } = useParams() as {
    characterId?: string;
    scenario?: ModelScenario;
  };
  const meta = SCENARIOS.find((s) => s.key === scenario) ?? SCENARIOS[0]!;
  const models = useRemote(ModelAccessEndpoints.listModels, { query: { scenario: meta.key } });
  const config = useRemote(ModelAccessEndpoints.getCharacterScenarios, {
    params: { characterId },
    networkOnly: true,
  });
  const [pending, setPending] = useState(false);
  const row = config.data?.scenarios.find((r) => r.scenario === meta.key);
  const current = row?.selection?.modelKey ?? '';
  const followName = nameOf(
    models.data?.items,
    row?.effective && !row.selection ? row.effective.modelKey : null,
  );
  async function choose(key: string) {
    if (pending || key === current) return;
    setPending(true);
    try {
      await api.call(ModelAccessEndpoints.updateCharacterScenarios, {
        params: { characterId },
        body: { selections: { [meta.key]: key ? { modelKey: key } : null } },
      });
      config.refresh();
      showToast('已保存，下一次起使用', 2000, 'success');
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
      <NavBar title={`TA 的${meta.label}`} />
      <MenuGroup>
        <MenuRow
          label="跟随场景设置"
          subtitle={
            current
              ? '改回跟随「模型配置 › 按场景」'
              : `现在是 ${followName ?? '未配置'}，在「模型配置 › 按场景」里改`
          }
          chevron={false}
          disabled={pending}
          right={current === '' ? <Tick /> : undefined}
          onClick={() => void choose('')}
        />
      </MenuGroup>
      <MenuGroup>
        {models.data?.items.map((model) => (
          <MenuRow
            key={model.modelKey}
            label={model.displayName}
            subtitle={
              <>
                <ModelPriceLine model={model} scenario={meta.key} />
                {!model.available && ` · 暂不可用：${unavailableText(model.unavailableDetail)}`}
                {model.capabilities.includes('adult_content') && ' · 允许成人内容'}
              </>
            }
            chevron={false}
            disabled={pending || !model.available}
            right={current === model.modelKey ? <Tick /> : undefined}
            onClick={() => void choose(model.modelKey)}
          />
        ))}
      </MenuGroup>
      {row?.selection && !row.selection.available && (
        <p className="error page-note">
          TA 用的模型暂不可用（{unavailableText(row.selection.unavailableDetail)}），回复时会提示你临时改用场景设置
        </p>
      )}
      {(models.error || config.error) && <p role="alert">{models.error || config.error}</p>}
    </main>
  );
}

// ---------- 首次引导 ----------

/**
 * 3.22 首次引导：文本聊天还没配置时，进入聊天（或任何需要模型的功能）弹出引导，
 * 含「一键选推荐」；配置好之前不能发消息（block() 返回 true 时调用方停止发送并已弹出引导）。
 */
export function useModelSetupGate(onConfigured?: () => void) {
  const config = useRemote(ModelAccessEndpoints.getScenarioConfig, { networkOnly: true });
  const [open, setOpen] = useState(false);
  const needsSetup = config.data?.needsSetup === true;
  useEffect(() => {
    if (needsSetup) setOpen(true);
  }, [needsSetup]);
  return {
    needsSetup,
    block(): boolean {
      if (!needsSetup) return false;
      setOpen(true);
      return true;
    },
    element:
      open && config.data ? (
        <ModelSetupGuide
          config={config.data}
          onClose={() => setOpen(false)}
          onDone={() => {
            setOpen(false);
            config.refresh();
            onConfigured?.();
          }}
        />
      ) : null,
  };
}

export function ModelSetupGuide({
  config,
  onClose,
  onDone,
}: {
  config: ScenarioConfig;
  onClose(): void;
  onDone(): void;
}) {
  const navigate = useNavigate();
  const models = useRemote(ModelAccessEndpoints.listModels);
  const [pending, setPending] = useState(false);
  const picks = config.scenarios.filter(
    (r) => r.scenario !== 'private' && !r.selection && r.recommendedModelKey,
  );
  async function recommend() {
    if (pending) return;
    setPending(true);
    try {
      const next = await api.call(ModelAccessEndpoints.applyRecommendedScenarios, { body: {} });
      if (next.needsSetup) {
        showToast('平台还没给文本聊天指定推荐模型，请自己选一个');
        navigate('/models/scenario/chat');
        return;
      }
      showToast('已按推荐配置好，可以开始聊天了', 2000, 'success');
      onDone();
    } catch (e) {
      showToast(friendlyError(e));
    } finally {
      setPending(false);
    }
  }
  return (
    <Dialog
      title="先选好模型"
      actions={[
        { label: '稍后', onClick: onClose },
        { label: '自己选', onClick: () => navigate('/models') },
        {
          label: pending ? '配置中…' : '一键选推荐',
          primary: true,
          onClick: () => void recommend(),
        },
      ]}
    >
      <p className="setup-guide-text">
        每个场景用哪个模型由你决定，选好「文本聊天」后才能发消息。一键选推荐会填入：
      </p>
      <ul className="setup-guide-list">
        {picks.map((r) => (
          <li key={r.scenario}>
            <span>{scenarioLabel(r.scenario as ModelScenario)}</span>
            <b>{nameOf(models.data?.items, r.recommendedModelKey)}</b>
          </li>
        ))}
        {picks.length === 0 && <li>平台暂未指定推荐模型，请点「自己选」</li>}
      </ul>
    </Dialog>
  );
}
