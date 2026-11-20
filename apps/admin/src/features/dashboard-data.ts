import {
  AdminUsersEndpoints,
  CharacterAdminEndpoints,
  ModelAccessAdminEndpoints,
  ModelAccessAdminUsageEndpoints,
  VoiceAdminEndpoints,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { settle } from '../data/use-async.js';
import { startOfBeijingDay } from '../ui/format.js';

export async function loadDashboard() {
  const filter = { from: startOfBeijingDay(-29), to: new Date().toISOString() };

  const [trend, rank, users, models, liveModels, roles, voices, upstreams] = await Promise.all([
    settle(
      api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: { filter, groupBy: ['day'], limit: 30 },
      }),
    ),
    settle(
      api.call(ModelAccessAdminUsageEndpoints.usageSummary, {
        body: { filter, groupBy: ['model'], limit: 1000 },
      }),
    ),
    settle(api.call(AdminUsersEndpoints.overview, { query: { view: 'counts' } })),
    settle(api.call(ModelAccessAdminEndpoints.modelPage, { query: { pageSize: 1 } })),
    settle(api.call(ModelAccessAdminEndpoints.modelPage, { query: { pageSize: 1, status: 'on' } })),
    settle(api.call(CharacterAdminEndpoints.directory, { query: { page: 1, pageSize: 1 } })),
    settle(api.call(VoiceAdminEndpoints.listVoices)),
    settle(api.call(ModelAccessAdminEndpoints.listUpstreams)),
  ]);

  return {
    from: filter.from,
    to: filter.to,
    trend,
    rank,
    users,
    models: models?.total,
    liveModels: liveModels?.total,
    roles: roles?.total,
    voices: voices?.items.filter((voice) => voice.enabled).length,
    upstreams: upstreams?.items.filter((item) => !item.deletedAt),
  };
}

export type DashboardData = Awaited<ReturnType<typeof loadDashboard>>;
