/**
 * 模型设置。历史用量的旧链接由这里转发到用量页。
 */
import { Navigate, useSearchParams } from 'react-router-dom';
import { ModelAccessAdminEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/hooks.js';
import { Page } from '../ui/page.js';
import { UpstreamsTab } from './model/upstreams.js';
import { ModelsTab } from './model/models.js';
import { LeaderboardSourceCard } from './model/leaderboard-source.js';
import { ScenarioSettingsCard } from './model/scenario-settings.js';

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
  const upstreams = useRemote(
    ModelAccessAdminEndpoints.listUpstreams,
    {},
    tab !== 'ranking' && tab !== 'settings',
  );
  const catalog = useRemote(
    ModelAccessAdminEndpoints.listCatalog,
    { query: { view: 'active' } },
    tab === 'settings',
  );
  // 3.20：已删除（软删）的上游只给调用记录显示账号名用，账号列表与线路选择里隐藏。
  const allUpstreams = upstreams.data?.items ?? [];
  const liveUpstreams = allUpstreams.filter((u) => !u.deletedAt);
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
        <ScenarioSettingsCard models={catalog.data?.items ?? []} />
      ) : tab === 'ranking' ? (
        <LeaderboardSourceCard />
      ) : tab === 'upstreams' ? (
        <UpstreamsTab
          upstreams={liveUpstreams}
          loading={upstreams.loading}
          loadError={upstreams.error}
          refresh={upstreams.refresh}
        />
      ) : (
        <ModelsTab
          upstreams={liveUpstreams}
          accountDirectory={allUpstreams}
          upstreamsError={upstreams.error}
          refreshUpstreams={upstreams.refresh}
        />
      )}
    </Page>
  );
}
