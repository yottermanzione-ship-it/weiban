import { ApiClient, IndexedLocalStore } from '@weiban/client-core';
import { ClientLogEndpoints } from '@weiban/contracts';
import { runtimeLogs } from './runtime-logs.js';
export const localStore = new IndexedLocalStore('weiban-app');
export const api = new ApiClient(localStore, fetch, () => {
  window.dispatchEvent(new Event('weiban:unauthenticated'));
});
api.observeOwner((owner) => runtimeLogs.setOwner(owner));
api.observeFailures((event) => runtimeLogs.apiFailure(event));
runtimeLogs.configure(async (body, owner, keepalive) => {
  if (owner) await api.call(ClientLogEndpoints.report, { body, keepalive, networkOnly: true });
  else await api.call(ClientLogEndpoints.reportAnonymous, { body, keepalive, networkOnly: true });
});
runtimeLogs.setOwner(null);
