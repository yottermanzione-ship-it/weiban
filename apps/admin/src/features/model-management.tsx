/**
 * 模型设置。历史用量的旧链接由这里转发到用量页。
 */
import { useMemo } from 'react';
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
  const [params] = useSearchParams();
  const tab = params.get('tab');
  if (tab === 'records' || tab === 'overview') {
    const next = new URLSearchParams(params);
    next.delete('tab');
    if (tab === 'records') next.set('view', 'records');
    return <Navigate to={`/usage?${next}`} replace />;
  }
  return <ModelConfiguration tab={tab ?? 'models'} />;
}
function ModelConfiguration({ tab }: { tab: string }) {
  const upstreams = useRemote(ModelAccessAdminEndpoints.listUpstreams);
  const models = useRemote(listAllModels);
  // 3.27：逐行用契约校验（一行坏掉不再让整张表变空），不合法的行单独报出来。
  const parsedModels = useMemo(() => parseAdminModels(models.data?.items), [models.data]);

  // 3.20：已删除（软删）的上游只给调用记录显示账号名用，账号列表与线路选择里隐藏。
  const allUpstreams = upstreams.data?.items ?? [];
  const liveUpstreams = allUpstreams.filter((u) => !u.deletedAt);
  // 3.23：已删除（软删）的模型只给调用记录显示模型名用，其余选择器隐藏。
  const allModels = parsedModels.models;
  const liveModels = allModels.filter((m) => !m.deletedAt);
  return (
    <Page
      title={
        tab === 'settings'
          ? '场景推荐'
          : tab === 'ranking'
            ? 'Arena 文本榜'
            : tab === 'upstreams'
              ? '上游账号'
              : '模型目录'
      }
    >
      {tab === 'settings' ? (
        <ScenarioSettingsCard models={liveModels} />
      ) : tab === 'ranking' ? (
        <LeaderboardSourceCard />
      ) : tab === 'upstreams' ? (
        <UpstreamsTab
          upstreams={liveUpstreams}
          models={liveModels}
          bindingStatus={
            models.error
              ? '关联模型读取失败，请刷新重试。'
              : models.loading
                ? '正在读取关联模型…'
                : parsedModels.issues.length
                  ? '部分关联模型资料无法读取，请在模型目录核对。'
                  : ''
          }
          loading={upstreams.loading}
          loadError={upstreams.error}
          refresh={() => {
            upstreams.refresh();
            models.refresh();
          }}
        />
      ) : (
        <ModelsTab
          models={liveModels}
          upstreams={liveUpstreams}
          accountDirectory={allUpstreams}
          loading={models.loading}
          loadError={models.error}
          upstreamsError={upstreams.error}
          invalidModels={parsedModels.issues}
          refresh={() => {
            models.refresh();
            upstreams.refresh();
          }}
        />
      )}
    </Page>
  );
}
