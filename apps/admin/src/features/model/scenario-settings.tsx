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
  EcologyAdminEndpoints,
  ModelAccessAdminEndpoints,
  type AdminModel,
  type ModelScenario,
  type ModelScenarioSettings,
  type PlatformInternalUse,
} from '@weiban/contracts';
import { api } from '../../data/client.js';
import { errorText, useRemote } from '../../data/hooks.js';
import { HelpTip, SectionCard, useToast } from '../../ui/page.js';
import { SCENARIO_LABELS } from './shared.js';

/** 3.25：成人内容检查（adult_check）不再使用，不在后台显示。 */
type InternalUse = Exclude<PlatformInternalUse, 'adult_check'> | 'ecology_decision';
const INTERNAL_LABELS: Record<
  InternalUse,
  { label: string; help: string }
> = {
  safety: { label: '安全检查', help: '安全关怀识别与次日跟进，平台付费。' },
  small_v: { label: '小V 答疑', help: '用户问小V 时用，平台付费。' },
  ecology_decision: {
    label: '角色生态决策',
    help: '角色「想一想」下一步做什么；按用户积分计费，用户不可选。不配置 = 生态不运行。',
  },
  platform_content: {
    label: '平台内容生成',
    help: '官方角色公共朋友圈、搜索候选等平台承担的生成。',
  },
  planner: { label: '行为规划', help: '后台规划角色行为；不配置时回落规则版，不调模型。' },
  web_search: { label: '联网搜索', help: '平台提供的联网搜索服务。' },
};

const SCENARIO_ORDER: ModelScenario[] = [
  'chat',
  'voice_message',
  'speech_recognition',
  'voice_call',
  'image_generation',
  'private',
];
const INTERNAL_ORDER: InternalUse[] = [
  'safety',
  'small_v',
  'ecology_decision',
  'platform_content',
  'planner',
  // 3.25：成人内容检查不再使用（私密模式不调用检查模型）
  'web_search',
];

export function ScenarioSettingsCard({ models }: { models: AdminModel[] }) {
  const toast = useToast();
  const remote = useRemote(ModelAccessAdminEndpoints.getScenarioSettings);
  const ecology = useRemote(EcologyAdminEndpoints.getOverview);
  const [draft, setDraft] = useState<ModelScenarioSettings>({ recommended: {}, internal: {} });
  const [decision, setDecision] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    if (remote.data) setDraft(remote.data);
  }, [remote.data]);
  useEffect(() => {
    if (ecology.data) setDecision(ecology.data.config.decisionModelKey);
  }, [ecology.data]);

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
      if (ecology.data && decision !== ecology.data.config.decisionModelKey)
        await api.call(EcologyAdminEndpoints.updateConfig, {
          body: { ...ecology.data.config, decisionModelKey: decision },
        });
      toast.success('已保存场景推荐与平台内部模型');
      remote.refresh();
      ecology.refresh();
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
                value={(use === 'ecology_decision' ? decision : draft.internal[use]) ?? undefined}
                options={internalOptions(use)}
                onChange={(v?: string) =>
                  use === 'ecology_decision'
                    ? setDecision(v ?? null)
                    : setDraft((d) => ({ ...d, internal: { ...d.internal, [use]: v ?? null } }))
                }
              />
            </div>
          ))}
        </div>
      </div>
    </SectionCard>
  );
}
