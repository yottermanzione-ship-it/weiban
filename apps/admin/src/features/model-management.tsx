/**
 * 模型设置。历史用量的旧链接由这里转发到用量页。
 */
import { useMemo } from 'react';
import { Tabs } from 'antd';
import { Navigate, useSearchParams } from 'react-router-dom';
import { ModelAccessAdminEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/hooks.js';
import { Page } from '../ui/page.js';
import { UpstreamsTab } from './model/upstreams.js';
import { ModelsTab } from './model/models.js';
import { LeaderboardSourceCard } from './model/leaderboard-source.js';
import { ScenarioSettingsCard } from './model/scenario-settings.js';
import { listAllModels, parseAdminModels } from './model/list-parse.js';

export function ModelManagementPage() {
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab');
  if (tab === 'records' || tab === 'overview') {
    const next = new URLSearchParams(params);
    next.delete('tab');
    if (tab === 'records') next.set('view', 'records');
    return <Navigate to={`/usage?${next}`} replace />;
  }
  return (
    <ModelConfiguration
      tab={tab === 'upstreams' || tab === 'settings' ? tab : 'models'}
      onTab={(key) => setParams({ tab: key })}
    />
  );
}

function ModelConfiguration({ tab, onTab }: { tab: string; onTab: (key: string) => void }) {
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const models = useRemote(listAllModels);
  // 3.27：逐行用契约校验（一行坏掉不再让整张表变空），不合法的行单独报出来。
  const parsedModels = useMemo(() => parseAdminModels(models.data?.items), [models.data]);

  // 3.20：已删除（软删）的上游只给调用记录显示账号名用，账号列表与线路选择里隐藏。
  const allUpstreams = upstreams.data?.items ?? [];
  const liveUpstreams = allUpstreams.filter((u) => !u.deletedAt);
  // 3.23：已删除（软删）的模型只给调用记录显示模型名用，其余选择器隐藏。
  // 3.27：模型表仍把它们排在最后并标「已删除」（只供核对历史）；编辑 / 上架 / 删除只作用于未删除的。
  const allModels = parsedModels.models;
  const liveModels = allModels.filter((m) => !m.deletedAt);
  const deletedModels = allModels.filter((m) => m.deletedAt);
  return (
    <Page title="模型管理">
      <Tabs
        className="admin-page-tabs"
        activeKey={tab}
        onChange={onTab}
        destroyOnHidden
        items={[
          {
            key: 'models',
            label: '模型目录',
            children: (
              <ModelsTab
                models={liveModels}
                deletedModels={deletedModels}
                upstreams={liveUpstreams}
                loading={models.loading}
                loadError={models.error}
                upstreamsError={upstreams.error}
                invalidModels={parsedModels.issues}
                refresh={() => {
                  models.refresh();
                  upstreams.refresh();
                }}
              />
            ),
          },
          {
            key: 'upstreams',
            label: '上游账号',
            children: (
              <UpstreamsTab
                upstreams={liveUpstreams}
                models={liveModels}
                loading={upstreams.loading}
                loadError={upstreams.error}
                refresh={() => {
                  upstreams.refresh();
                  models.refresh();
                }}
              />
            ),
          },
          {
            key: 'settings',
            label: '场景与榜单',
            children: (
              <div className="admin-stack">
                <ScenarioSettingsCard models={liveModels} />
                <LeaderboardSourceCard />
              </div>
            ),
          },
        ]}
      />
    </Page>
  );
}
