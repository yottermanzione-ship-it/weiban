/**
 * 管理后台「模型管理」：概览 · 上游账号 · 模型 · 调用记录。
 * 数据仍走 @weiban/contracts 的 model-access 管理接口，界面统一用 Ant Design。
 */
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

  return (
    <Page
      title="模型管理"
      desc="上游账号是「你填的 API 密钥线路」，模型是「用户能选的 AI」，调用记录是「每一次调用花了多少」。"
    >
      <div className="model-page-head">
        <LeaderboardSourceCard />
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
            models={models.data?.items ?? []}
            refresh={() => {
              upstreams.refresh();
              models.refresh();
            }}
          />
        )}
        {tab === 'models' && (
          <ModelsTab
            models={models.data?.items ?? []}
            upstreams={liveUpstreams}
            refresh={() => {
              models.refresh();
              upstreams.refresh();
            }}
          />
        )}
        {tab === 'records' && (
          <RecordsTab
            upstreams={allUpstreams}
            models={models.data?.items ?? []}
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
