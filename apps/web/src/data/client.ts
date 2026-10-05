import { ApiClient, IndexedLocalStore } from '@weiban/client-core';
export const api = new ApiClient(new IndexedLocalStore('weiban-app'), fetch, () => {
  window.dispatchEvent(new Event('weiban:unauthenticated'));
});
