/**
 * 管理后台「模型管理」：概览 · 上游账号 · 模型 · 调用记录。
 * 数据仍走 @weiban/contracts 的 model-access 管理接口，界面统一用 Ant Design。
 */
import { useMemo, useState } from 'react';
import { Tabs } from 'antd';
import { useSearchParams } from 'react-router-dom';
import { z } from 'zod';
import { ModelAccessAdminEndpoints } from '@weiban/contracts';
import { useRemote } from '../data/hooks.js';
import { Page } from '../ui/page.js';
import { OverviewTab } from './model/overview.js';
import { UpstreamsTab } from './model/upstreams.js';
import { ModelsTab } from './model/models.js';
import { RecordsTab } from './model/records.js';
import { LeaderboardSourceCard } from './model/leaderboard-source.js';
import { ScenarioSettingsCard } from './model/scenario-settings.js';
import { parseAdminModels } from './model/list-parse.js';

/**
 * 3.27：模型列表按行读取（同一条接口、同一套字段），见 `model/list-parse.ts`。
 * 整包解析时一行不符合契约就会让整张表变空，而且看不出是哪一行。
 */
const AllAdminModelsResponse = z.object({ items: z.array(z.unknown()) });
const listAllModels = {
  ...ModelAccessAdminEndpoints.listModels,
  response: AllAdminModelsResponse,
};

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
  const models = useRemote(listAllModels);
  // 3.27：逐行用契约校验（一行坏掉不再让整张表变空），不合法的行单独报出来。
  const parsedModels = useMemo(() => parseAdminModels(models.data?.items), [models.data]);

  const go = (next: Tab) => setParams({ tab: next });
  // 3.20：已删除（软删）的上游只给调用记录显示账号名用，账号列表与线路选择里隐藏。
  const allUpstreams = upstreams.data?.items ?? [];
  const liveUpstreams = allUpstreams.filter((u) => !u.deletedAt);
  // 3.23：已删除（软删）的模型只给调用记录显示模型名用，其余选择器隐藏。
  // 3.27：模型表仍把它们排在最后并标「已删除」（只供核对历史）；编辑 / 上架 / 删除只作用于未删除的。
  const allModels = parsedModels.models;
  const liveModels = allModels.filter((m) => !m.deletedAt);
  const deletedModels = allModels.filter((m) => m.deletedAt);
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
            loading={upstreams.loading}
            loadError={upstreams.error}
            refresh={() => {
              upstreams.refresh();
              models.refresh();
            }}
          />
        )}
        {tab === 'models' && (
          <ModelsTab
            models={liveModels}
            deletedModels={deletedModels}
            upstreams={liveUpstreams}
            // 3.27：请求失败的文案必须传下去——原先把 useRemote 的 error 丢掉，
            // 接口一失败就显示成「还没有模型」，把真正的原因（非 2xx / 响应不符合契约 / 超时）藏起来了。
            loading={models.loading}
            loadError={models.error}
            upstreamsError={upstreams.error}
            invalidModels={parsedModels.issues}
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
