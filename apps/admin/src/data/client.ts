import { ApiClient, IndexedLocalStore } from '@weiban/client-core';

/** 管理业务响应和上游密钥不落库；只存管理会话。 */
export const api = new ApiClient(
  new IndexedLocalStore('weiban-admin'),
  fetch,
  () => window.dispatchEvent(new Event('weiban-admin:unauthenticated')),
  false,
);

/**
 * 少数还没有进契约的管理接口（情景模式）仍用原生 fetch，
 * 这里从本地会话里取同一个 token，避免再去读一个不存在的 localStorage 键。
 */
export async function adminToken(): Promise<string> {
  const session = await api.restore();
  return session?.session.token ?? '';
}
