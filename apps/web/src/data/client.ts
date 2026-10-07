import { ApiClient, IndexedLocalStore } from '@weiban/client-core';
export const localStore = new IndexedLocalStore('weiban-app');
export const api = new ApiClient(localStore, fetch, () => {
  window.dispatchEvent(new Event('weiban:unauthenticated'));
});
