import { createHash } from 'node:crypto';
import { z } from 'zod';
import {
  ContactOrganizationSnapshot,
  ContactOrganizationTag,
  Id,
  SaveContactOrganizationRequest,
} from '@weiban/contracts';
import { AppError, parseContract } from '../../../platform/index.js';

export type OrganizationValue = Pick<ContactOrganizationSnapshot, 'starredCharacterIds' | 'tags'>;
export const organizationDigest = (value: unknown) =>
  createHash('sha256').update(JSON.stringify(value)).digest('hex');
export const organizationNameAad = (tagId: string) => `contacts:organization:tag:${tagId}:name`;
export function normalizeOrganization(input: OrganizationValue): OrganizationValue {
  const ids = new Set<string>(),
    names = new Set<string>();
  const tags = input.tags.map((tag) => {
    const parsed = parseContract(ContactOrganizationTag, tag);
    parsed.tagId = parsed.tagId.toLowerCase();
    if (ids.has(parsed.tagId))
      throw new AppError('bad_request', '标签编号不能重复', {
        details: { reason: 'duplicate_tag_id' },
      });
    if (names.has(parsed.name))
      throw new AppError('bad_request', '标签名称不能重复', {
        details: { reason: 'duplicate_tag_name' },
      });
    ids.add(parsed.tagId);
    names.add(parsed.name);
    return {
      ...parsed,
      characterIds: [...new Set(parsed.characterIds.map((id) => id.toLowerCase()))].sort(),
    };
  });
  return {
    starredCharacterIds: [
      ...new Set(input.starredCharacterIds.map((id) => id.toLowerCase())),
    ].sort(),
    tags,
  };
}
export function normalizeOrganizationRequest(input: unknown) {
  const request = parseContract(SaveContactOrganizationRequest, input);
  return {
    ...request,
    clientCommandId: request.clientCommandId.toLowerCase(),
    ...normalizeOrganization(request),
  };
}
const Digest = z.string().regex(/^[a-f0-9]{64}$/);
/** Internal reviewed migration input. There is no HTTP import route. */
export const LegacyOrganizationImport = z.object({
  sourceAccountId: Id,
  sourceDigest: Digest,
  expectedTargetDigest: Digest,
  expectedRevision: z.literal(0),
  starredCharacterIds: z.array(Id).max(2000),
  tags: z.array(ContactOrganizationTag).max(100),
  contactEpochs: z.array(z.object({ characterId: Id, requestId: Id })).max(2000),
  review: z.object({
    synthetic: z.literal(true),
    decisionId: z.string().regex(/^synthetic-[a-z0-9-]+$/),
    ownershipVerified: z.literal(true),
    deletionInventoryComplete: z.literal(true),
    targetNeverEditedVerified: z.literal(true),
    targetNoEditProofDigest: Digest,
    localNewSiteStateVerified: z.literal(true),
    localNewSiteStateProofDigest: Digest,
  }),
});
export type LegacyOrganizationImport = z.infer<typeof LegacyOrganizationImport>;
