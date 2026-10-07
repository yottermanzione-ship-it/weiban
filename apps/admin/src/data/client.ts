import { ApiClient, IndexedLocalStore } from '@weiban/client-core';
/** 管理业务响应和上游密钥不落库；只存管理会话。 */
export const api = new ApiClient(
  new IndexedLocalStore('weiban-admin'),
  fetch,
  () => window.dispatchEvent(new Event('weiban-admin:unauthenticated')),
  false,
);
