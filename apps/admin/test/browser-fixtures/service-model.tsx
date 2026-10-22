/** 真实模型表单 + 显式 API 夹具；不是生产费用联调。 */
import { useState } from 'react';
import { createRoot } from 'react-dom/client';
import { MemoryRouter } from 'react-router-dom';
import { App, ConfigProvider } from 'antd';
import {
  AdminModelWrite,
  ModelAccessAdminEndpoints,
  type Upstream,
  type AdminModel,
} from '@weiban/contracts';
import '../../../../docs/design/tokens.css';
import '../../src/app/styles.css';
import { ModelWizard } from '../../src/features/model/models.js';
import { api } from '../../src/data/client.js';
const saved: unknown[] = [];
Object.assign(window, { serviceSaved: saved });
Object.assign(api, {
  cached: async () => undefined,
  call: async (endpoint: unknown, options: { body?: unknown }) => {
    if (endpoint === ModelAccessAdminEndpoints.upsertModel) {
      const body = AdminModelWrite.parse(options.body);
      saved.push(body);
      return body;
    }
    return { items: [], fetchedAt: null, usdCnyRate: 7.2 };
  },
});
const upstream = {
  upstreamId: '019f7f00-0000-7000-8000-000000000131',
  name: 'DeepSeek 联网搜索',
  kind: 'deepseek_search',
  baseUrl: 'https://search.example.test',
  status: 'active',
  enabled: true,
} as Upstream;
const legacy = new URLSearchParams(window.location.search).has('legacy')
  ? ({
      modelKey: 'deepseek/legacy-search',
      displayName: '旧搜索服务',
      vendorName: 'DeepSeek',
      upstreamId: upstream.upstreamId,
      upstreamModelId: 'deepseek-search',
      enabled: true,
      capabilities: ['web_search'],
      scenarios: [],
      tags: [],
      defaultFor: [],
      sortOrder: 0,
      leaderboardRank: null,
      rates: { input: 0, output: 0, cache: 0 },
      costRates: { input: 0, output: 0, cache: 0 },
      hasTimeBands: false,
      pointsPerReply: 0,
      updatedAt: '2026-10-22T10:00:00.000Z',
      billingBounds: {
        format: 'billing-bounds-v1',
        text: {
          contextTokens: 128000,
          maxOutputTokens: 8192,
          totalOutputIncludesReasoning: true,
          outputParameter: 'max_tokens',
          maxImages: 0,
        },
      },
    } as AdminModel)
  : null;
function Fixture() {
  const [result, setResult] = useState('');
  return (
    <>
      <ModelWizard
        model={legacy}
        existingKeys={[]}
        upstreams={[upstream]}
        onClose={() => {}}
        onSaved={() => setResult(JSON.stringify(saved.at(-1)))}
      />
      <output aria-label="保存数据" style={{ position: 'fixed', top: 0, left: 0, maxWidth: 400 }}>
        {result}
      </output>
    </>
  );
}
createRoot(document.getElementById('root')!).render(
  <MemoryRouter>
    <ConfigProvider>
      <App>
        <Fixture />
      </App>
    </ConfigProvider>
  </MemoryRouter>,
);
