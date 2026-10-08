/** 用户可见记忆管理；来源/内容范围/所有者仅由服务端盖章。 */
import { z } from 'zod';
import { API_PREFIX, Id, NoContent, Timestamp, defineEndpoint } from '../common.js';
export const MemoryCategory = z.enum([
  'basic',
  'preference',
  'status',
  'people',
  'dates',
  'episode',
  'commitment',
]);
export const MemoryStatus = z.enum(['current', 'past']);
export const MemoryVisibility = z.enum(['default', 'only_this_character']);
export const MemorySharingClass = z.enum(['shareable', 'never', 'basic']);
export const MemoryEntry = z.object({
  memoryId: Id,
  characterId: Id,
  category: MemoryCategory,
  content: z.string().trim().min(1).max(1000),
  status: MemoryStatus,
  importance: z.number().int().min(1).max(10),
  dueAt: Timestamp.nullable(),
  visibility: MemoryVisibility,
  sharingClass: MemorySharingClass,
  scope: z.enum(['normal', 'adult']),
  sourceMessageIds: z.array(Id).max(100),
  createdBy: z.enum(['extracted', 'user_manual']),
  knownBy: z.array(Id),
  createdAt: Timestamp,
  updatedAt: Timestamp,
});
export type MemoryEntry = z.infer<typeof MemoryEntry>;
export const UpdateMemoryRequest = MemoryEntry.pick({
  content: true,
  category: true,
  status: true,
  importance: true,
  dueAt: true,
  visibility: true,
  sharingClass: true,
})
  .partial()
  .strict();
export const CreateMemoryRequest = z
  .object({
    /** 同用户同角色内幂等；不会被当作实际数据库主键。 */
    clientMemoryId: Id,
    content: z.string().trim().min(1).max(1000),
    category: MemoryCategory,
    importance: z.number().int().min(1).max(10).optional(),
    dueAt: Timestamp.nullable().optional(),
    visibility: MemoryVisibility.optional(),
  })
  .strict();
const params = z.object({ characterId: Id });
const itemParams = params.extend({ memoryId: Id });
export const MemoryEndpoints = {
  list: defineEndpoint({
    method: 'GET',
    path: `${API_PREFIX}/characters/:characterId/memories`,
    auth: 'user',
    params,
    query: z.object({
      afterId: Id.optional(),
      limit: z.coerce.number().int().min(1).max(100).default(50),
    }),
    response: z.object({ items: z.array(MemoryEntry), nextCursor: Id.nullable() }),
    summary: 'TA记住了什么（含成人来源，只有当前用户可管理）',
  }),
  create: defineEndpoint({
    method: 'POST',
    path: `${API_PREFIX}/characters/:characterId/memories`,
    auth: 'user',
    params,
    body: CreateMemoryRequest,
    response: MemoryEntry,
    summary: '我想让TA记住…（幂等）',
  }),
  update: defineEndpoint({
    method: 'PATCH',
    path: `${API_PREFIX}/characters/:characterId/memories/:memoryId`,
    auth: 'user',
    params: itemParams,
    body: UpdateMemoryRequest,
    response: MemoryEntry,
    summary: '修正一条记忆，手动修改优先',
  }),
  remove: defineEndpoint({
    method: 'DELETE',
    path: `${API_PREFIX}/characters/:characterId/memories/:memoryId`,
    auth: 'user',
    params: itemParams,
    response: NoContent,
    summary: '删除记忆并阻止旧来源重新抽取',
  }),
} as const;
