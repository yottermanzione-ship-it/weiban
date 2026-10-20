/**
 * 管理后台「模型管理」：概览 · 上游账号 · 模型 · 调用记录。
 * 数据仍走 @weiban/contracts 的 model-access 管理接口，界面统一用 Ant Design。
 */
import { useState } from 'react';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { ModelAccessAdminEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/hooks.js';
import { Page } from '../ui/page.js';
import { OverviewTab } from './model/overview.js';
import { UpstreamsTab } from './model/upstreams.js';
import { ModelsTab } from './model/models.js';
import { RecordsTab } from './model/records.js';
import { LeaderboardSourceCard } from './model/leaderboard-source.js';
import { ScenarioSettingsCard } from './model/scenario-settings.js';

type Tab = 'overview' | 'upstreams' | 'models' | 'records';

const TABS: Array<{ key: Tab; label: string }> = [
  { key: 'overview', label: '概览' },
  { key: 'upstreams', label: '上游账号' },
  { key: 'models', label: '模型' },
  { key: 'records', label: '调用记录' },
];

export function ModelManagementPage() {
  const [params, setParams] = useSearchParams();
  const tab = (TABS.find((t) => t.key === params.get('tab'))?.key ?? 'overview') as Tab;
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const models = useRemote(ModelAccessAdminEndpoints.listModels);

  const go = (next: Tab) => setParams({ tab: next });
  // 3.20：已删除（软删）的上游只给调用记录显示账号名用，账号列表与线路选择里隐藏。
  const allUpstreams = upstreams.data?.items ?? [];
  const liveUpstreams = allUpstreams.filter((u) => !u.deletedAt);
  // 3.23：已删除（软删）的模型同理：只给调用记录显示模型名用，其余地方隐藏。
  const allModels = models.data?.items ?? [];
  const liveModels = allModels.filter((m) => !m.deletedAt);
  // 删除模型后场景推荐 / 平台内部模型卡片重新读取（被删的模型已从设置里清掉）
  const [settingsVersion, setSettingsVersion] = useState(0);

  return (
    <Page
      title="模型管理"
      desc="上游账号是「你填的 API 密钥线路」，模型是「用户能选的 AI」，调用记录是「每一次调用花了多少」。"
    >
      <div className="model-page-head">
        <LeaderboardSourceCard />
        <ScenarioSettingsCard key={settingsVersion} models={liveModels} />
      </div>
      <div className="page-tabs">
        <Tabs
          activeKey={tab}
          onChange={(key) => go(key as Tab)}
          items={TABS.map((t) => ({ key: t.key, label: t.label }))}
        />
        {tab === 'overview' && <OverviewTab onGo={(next) => go(next)} />}
        {tab === 'upstreams' && (
          <UpstreamsTab
            upstreams={liveUpstreams}
            models={liveModels}
            refresh={() => {
              upstreams.refresh();
              models.refresh();
            }}
          />
        )}
        {tab === 'models' && (
          <ModelsTab
            models={liveModels}
            upstreams={liveUpstreams}
            onDeleted={() => setSettingsVersion((v) => v + 1)}
            refresh={() => {
              models.refresh();
              upstreams.refresh();
            }}
          />
        )}
        {tab === 'records' && (
          <RecordsTab
            upstreams={allUpstreams}
            models={allModels}
            initial={{
              upstreamId: params.get('upstream') ?? '',
              modelKey: params.get('model') ?? '',
              status: params.get('status') === 'failed' ? 'failed' : '',
            }}
          />
        )}
      </div>
    </Page>
  );
}
