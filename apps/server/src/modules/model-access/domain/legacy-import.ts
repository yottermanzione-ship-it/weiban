/** Private maintenance format. Not an HTTP/Android contract; no legacy defaults are applied. */
import { createHash } from 'node:crypto';
import { isIP } from 'node:net';
import { z } from 'zod';

export class LegacyImportError extends Error {
  constructor(readonly code: string) {
    super(code);
  }
}
export function legacyFail(code: string): never {
  throw new LegacyImportError(code);
}
const text = z.string().max(200);
const sourceId = z
  .string()
  .min(1)
  .max(160)
  .regex(/^[A-Za-z0-9_.:-]+$/);
const sha = z.string().regex(/^[0-9a-f]{64}$/);
const vendor = z.enum(['mimo', 'openai_compatible', 'dashscope', 'siliconflow']);
const scene = z.enum(['text', 'vision', 'voice_asr', 'voice_tts', 'voice_clone', 'voice_realtime']);
const account = z
  .object({
    sourceId,
    name: text,
    vendor,
    baseUrl: z.string().max(2048),
    apiKey: z.string().min(8).max(512),
    sourceEnabled: z.boolean(),
    sourceOrder: z.number().int(),
    targetEnabled: z.literal(false),
  })
  .strict();
const endpoint = z
  .object({
    sourceId,
    scene,
    label: text,
    model: text,
    modelPool: z.array(text).max(16),
    visionDirect: z.boolean(),
    sourceEnabled: z.boolean(),
    sourceOrder: z.number().int(),
    connectionRef: sourceId,
    targetEnabled: z.literal(false),
  })
  .strict();
const payloadSchema = z
  .object({
    format: z.literal('weiban-legacy-upstreams-v1'),
    exportId: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    recipientSha256: sha,
    targetPolicy: z.literal('disabled-pending-validation'),
    accounts: z.array(account).min(1).max(200),
    endpoints: z.array(endpoint).max(1000),
    envCredentials: z
      .array(
        z
          .object({
            sourceName: text,
            apiKey: z.string().max(65536),
            targetEnabled: z.literal(false),
          })
          .strict(),
      )
      .max(13),
  })
  .strict();
export const legacyScopeSchema = z
  .object({ sourceId, vendor, baseUrl: z.string().max(2048) })
  .strict();
export type LegacyScope = z.infer<typeof legacyScopeSchema>;
const metadataSchema = z
  .object({
    format: z.literal('weiban-legacy-receiver-v1'),
    batchId: z.uuid(),
    operatorId: z.uuid(),
    createdAt: z.iso.datetime(),
    expiresAt: z.iso.datetime(),
    recipientSha256: sha,
    approvedAccounts: z.array(legacyScopeSchema).min(1).max(200),
  })
  .strict();
export type LegacyReceiverMetadata = z.infer<typeof metadataSchema>;
export type LegacyPayload = z.infer<typeof payloadSchema>;
export type LegacyAccount = z.infer<typeof account>;

export function normalizeLegacyUrl(value: string, secret = ''): string {
  try {
    const u = new URL(value),
      host = u.hostname.replace(/^\[|\]$/g, '').toLowerCase();
    const decoded = decodeURIComponent(u.pathname);
    if (
      u.protocol !== 'https:' ||
      u.username ||
      u.password ||
      u.search ||
      u.hash ||
      (u.port && u.port !== '443') ||
      isIP(host) ||
      host === 'localhost' ||
      /\.(?:local|internal|localhost)$/.test(host) ||
      /api[-_]?key|token|secret|sk-/i.test(decoded) ||
      (secret && (value.includes(secret) || decoded.includes(secret)))
    )
      legacyFail('URL_REJECTED');
    return u.toString().replace(/\/+$/, '');
  } catch {
    return legacyFail('URL_REJECTED');
  }
}
export function parseLegacyScope(value: unknown): LegacyScope[] {
  const result = z.array(legacyScopeSchema).min(1).max(200).safeParse(value);
  if (!result.success) legacyFail('SCOPE_INVALID');
  if (new Set(result.data.map((r) => r.sourceId)).size !== result.data.length)
    legacyFail('SCOPE_INVALID');
  return result.data.map((r) => ({ ...r, baseUrl: normalizeLegacyUrl(r.baseUrl) }));
}
export function parseLegacyMetadata(value: unknown): LegacyReceiverMetadata {
  const result = metadataSchema.safeParse(value);
  if (!result.success) legacyFail('RECEIVER_METADATA_INVALID');
  const lifetime = Date.parse(result.data.expiresAt) - Date.parse(result.data.createdAt);
  if (lifetime <= 0 || lifetime > 3600000) legacyFail('RECEIVER_METADATA_INVALID');
  const scope = parseLegacyScope(result.data.approvedAccounts);
  return { ...result.data, approvedAccounts: scope };
}
export function receiverAad(meta: LegacyReceiverMetadata): string {
  return `legacy-import-receiver:${meta.batchId}:${createHash('sha256').update(JSON.stringify(meta)).digest('hex')}`;
}
export function validateLegacyPayload(
  raw: unknown,
  meta: LegacyReceiverMetadata,
  now: Date,
): LegacyPayload {
  const parsed = payloadSchema.safeParse(raw);
  if (!parsed.success) legacyFail('PACKAGE_INVALID');
  const data = parsed.data,
    timestamp = now.getTime(),
    created = Date.parse(data.createdAt),
    expires = Date.parse(data.expiresAt);
  if (data.recipientSha256 !== meta.recipientSha256) legacyFail('RECIPIENT_MISMATCH');
  if (
    timestamp >= Date.parse(meta.expiresAt) ||
    timestamp < Date.parse(meta.createdAt) - 300000 ||
    created > timestamp + 300000 ||
    created < Date.parse(meta.createdAt) - 300000 ||
    expires <= timestamp ||
    expires <= created ||
    expires - created > 3600000
  )
    legacyFail('PACKAGE_EXPIRED');
  if (data.envCredentials.length) legacyFail('ENV_MAPPING_REQUIRED');
  const scope = new Map(meta.approvedAccounts.map((a) => [a.sourceId, a]));
  if (
    data.accounts.length !== scope.size ||
    new Set(data.accounts.map((a) => a.sourceId)).size !== scope.size ||
    new Set(data.endpoints.map((e) => e.sourceId)).size !== data.endpoints.length
  )
    legacyFail('SCOPE_MISMATCH');
  for (const row of data.accounts) {
    const expected = scope.get(row.sourceId);
    if (
      !expected ||
      expected.vendor !== row.vendor ||
      normalizeLegacyUrl(row.baseUrl, row.apiKey) !== normalizeLegacyUrl(expected.baseUrl)
    )
      legacyFail('SCOPE_MISMATCH');
    if (!/^(?:provider|endpoint):/.test(row.sourceId) || row.apiKey.trim().length < 8)
      legacyFail('CREDENTIAL_INVALID');
    row.baseUrl = normalizeLegacyUrl(row.baseUrl, row.apiKey);
  }
  if (data.endpoints.some((e) => !scope.has(e.connectionRef))) legacyFail('REFERENCE_INVALID');
  return data;
}
export function legacyKind(value: LegacyAccount['vendor']): 'dashscope' | 'openai_compatible' {
  return value === 'dashscope' ? 'dashscope' : 'openai_compatible';
}
