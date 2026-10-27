/**
 * 3.22（批 E3）：模型管理页顶部「场景推荐模型」与「平台内部模型」。
 * - 场景推荐模型：只用于用户端首次引导的「一键选推荐」，不是兜底默认（用户没配置的场景就不可用）；
 * - 平台内部模型：安全检查、小V 答疑、角色生态决策等平台付费或后台自动运行的任务，用户不可选。
 *   「角色生态决策」仍存在生态配置里（与「模型与计费 › 角色生态」是同一个设置）。
 * 取代原来模型上的「默认给谁用」（defaultFor）。
 */
import { useEffect, useState } from 'react';
import { Alert, Button, Select } from 'antd';
import {
  ModelAccessAdminEndpoints,
  type AdminModel,
  type ModelScenario,
  type ModelScenarioSettings,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
import { HelpTip, SectionCard, useToast } from '../../ui/page.js';
import { SCENARIO_LABELS } from './shared.js';

/**
 * 3.29：这里只保留平台内部的安全/小V/平台内容/联网搜索，以及场景推荐。
 * 生态 Gate（Jev）在「角色生态」页唯一配置；行为规划跟随用户自己的 chat 模型，不再后台选模型。
 */
type InternalUse = 'safety' | 'small_v' | 'platform_content' | 'web_search';
const INTERNAL_LABELS: Record<InternalUse, { label: string; help: string }> = {
  safety: { label: '安全检查', help: '安全关怀识别与次日跟进，平台付费。' },
  small_v: { label: '小V 答疑', help: '用户问小V 时用，平台付费。' },
  platform_content: {
    label: '平台内容生成',
    help: '官方角色公共朋友圈（平台承担）。不选＝公共朋友圈关闭（功能保留，选回模型即恢复）；用户自己的微博同步朋友圈、生态私人朋友圈不经过它。',
  },
  web_search: { label: '联网搜索', help: '平台提供的联网搜索服务（需搜索类上游）。' },
};

const SCENARIO_ORDER: ModelScenario[] = [
  'chat',
  'voice_message',
  'speech_recognition',
  'voice_call',
];
const INTERNAL_ORDER: InternalUse[] = [
  'safety',
  'small_v',
  'platform_content',
  // 3.25：成人内容检查不再使用（私密模式不调用检查模型）
  'web_search',
];

export function ScenarioSettingsCard({ models }: { models: AdminModel[] }) {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getScenarioSettings);
  const [draft, setDraft] = useState<ModelScenarioSettings>({ recommended: {}, internal: {} });
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (remote.data) setDraft(remote.data);
  }, [remote.data]);

  const enabled = models.filter((m) => m.enabled);
  const optionsFor = (scenario: ModelScenario) =>
    enabled
      .filter((m) => m.scenarios?.includes(scenario))
      .filter((m) => scenario === 'private' || !m.capabilities.includes('adult_content'))
      .map((m) => ({ value: m.modelKey, label: `${m.displayName}（${m.modelKey}）` }));
  const internalOptions = (_use: InternalUse) =>
    enabled
      .filter((m) => !m.capabilities.includes('adult_content'))
      .map((m) => ({ value: m.modelKey, label: `${m.displayName}（${m.modelKey}）` }));

  async function save() {
    setSaving(true);
    setError('');
    try {
      await api.call(ModelAccessAdminEndpoints.updateScenarioSettings, { body: draft });
      toast.success('已保存场景推荐与平台内部模型');
      remote.refresh();
    } catch (e) {
      setError(errorText(e));
    } finally {
      setSaving(false);
    }
  }

  return (
    <SectionCard
      title="场景推荐模型 · 平台内部模型"
      desc="推荐模型只用于用户首次引导的「一键选推荐」，不是兜底默认；平台内部模型用户不可选。"
      extra={
        <Button type="primary" loading={saving} onClick={() => void save()}>
          保存
        </Button>
      }
    >
      {(error || remote.error) && (
        <Alert type="error" showIcon message={error || remote.error} style={{ marginBottom: 12 }} />
      )}
      <div className="scenario-settings">
        <div>
          <div className="scenario-settings-title">
            场景推荐模型
            <HelpTip text="每个场景只列勾选了「可用于该场景」的已上架模型。" />
          </div>
          {SCENARIO_ORDER.map((scenario) => (
            <div className="scenario-settings-row" key={scenario}>
              <span className="scenario-settings-label">{SCENARIO_LABELS[scenario]}</span>
              <Select
                allowClear
                showSearch
                style={{ flex: 1, minWidth: 0 }}
                placeholder="未指定"
                value={draft.recommended[scenario] ?? undefined}
                options={optionsFor(scenario)}
                onChange={(v?: string) =>
                  setDraft((d) => ({
                    ...d,
                    recommended: { ...d.recommended, [scenario]: v ?? null },
                  }))
                }
              />
            </div>
          ))}
          {/* 3.28：私密模型只有这一处来源；推荐里的 private 已移除，避免两个私密开关。 */}
          <div className="scenario-settings-row" key="fixed-private">
            <span className="scenario-settings-label">
              固定私密模型
              <HelpTip text="私密模式统一使用这个模型，用户不可选；不配置 = 私密模式暂不可用。改这里不会动其它场景的推荐。" />
            </span>
            <Select
              allowClear
              showSearch
              style={{ flex: 1, minWidth: 0 }}
              placeholder="未指定（私密模式不可用）"
              value={draft.fixed?.private ?? undefined}
              options={optionsFor('private')}
              onChange={(v?: string) => setDraft((d) => ({ ...d, fixed: { private: v ?? null } }))}
            />
          </div>
        </div>
        <div>
          <div className="scenario-settings-title">
            平台内部模型
            <HelpTip text="平台付费或后台自动运行的任务；用户不能选。" />
          </div>
          {INTERNAL_ORDER.map((use) => (
            <div className="scenario-settings-row" key={use}>
              <span className="scenario-settings-label">
                {INTERNAL_LABELS[use].label}
                <HelpTip text={INTERNAL_LABELS[use].help} />
              </span>
              <Select
                allowClear
                showSearch
                style={{ flex: 1, minWidth: 0 }}
                placeholder="未指定"
                value={draft.internal[use] ?? undefined}
                options={internalOptions(use)}
                onChange={(v?: string) =>
                  setDraft((d) => ({ ...d, internal: { ...d.internal, [use]: v ?? null } }))
                }
              />
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
