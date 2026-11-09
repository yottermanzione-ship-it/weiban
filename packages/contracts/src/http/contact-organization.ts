import { z } from 'zod';
import { API_PREFIX, Id, Timestamp, defineEndpoint } from '../common.js';

/** Personal contact organization, isolated by the authenticated account. */
export const ContactOrganizationTag = z.object({
  tagId: Id,
  name: z.string().trim().min(1).max(100),
  characterIds: z.array(Id).max(2000),
});
export type ContactOrganizationTag = z.infer<typeof ContactOrganizationTag>;
export const ContactOrganizationSnapshot = z.object({
  revision: z.number().int().nonnegative().max(2_147_483_647),
  starredCharacterIds: z.array(Id).max(2000),
  tags: z.array(ContactOrganizationTag).max(100),
  updatedAt: Timestamp.nullable(),
});
export type ContactOrganizationSnapshot = z.infer<typeof ContactOrganizationSnapshot>;
export const SaveContactOrganizationRequest = z.object({
  clientCommandId: Id,
  expectedRevision: z.number().int().nonnegative().max(2_147_483_646),
  starredCharacterIds: z.array(Id).max(2000),
  tags: z.array(ContactOrganizationTag).max(100),
});
export type SaveContactOrganizationRequest = z.infer<typeof SaveContactOrganizationRequest>;
export const ContactOrganizationEndpoints = {
  get: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/contacts/organization`,
    auth: 'user',
    response: ContactOrganizationSnapshot,
    summary: '本人星标朋友与好友标签；空账号不自动认领设备上的旧记录',
  }),
  save: defineEndpoint({
    method: 'PUT',
    path: `${API_PREFIX}/contacts/organization`,
    auth: 'user',
    body: SaveContactOrganizationRequest,
    response: z.object({ snapshot: ContactOrganizationSnapshot, replayed: z.boolean() }),
    summary: '按明确版本保存本人星标和标签；同命令只应用一次，冲突不覆盖',
  }),
} as const;
