/** Internal cutover protocol, not a user or administrator impersonation API. */
import { createHash, createHmac, timingSafeEqual } from 'node:crypto';
import { z } from 'zod';

export const LEGACY_RELAY_PATH = '/api/v1/internal/channels/legacy/';
export const LEGACY_RELAY_MAX_SKEW_MS = 60_000;
export const LegacyEnvelope = z.strictObject({
  sentAt: z.number().int().positive().safe(),
  nonce: z.uuid(),
  payload: z.string().min(1).max(20_000),
  signature: z.string().regex(/^[0-9a-f]{64}$/),
});
const generation = z.number().int().positive().max(2_147_483_647);
export const LegacyRequest = z.discriminatedUnion('op', [
  z.strictObject({
    op: z.literal('ingest'),
    generation,
    externalId: z.string().min(1).max(256),
    peerHash: z.string().regex(/^[0-9a-f]{64}$/),
    text: z.string().trim().min(1).max(2000),
    createdAt: z.iso.datetime(),
  }),
  z.strictObject({ op: z.literal('poll'), generation }),
  z.strictObject({ op: z.literal('status'), generation }),
  z.strictObject({
    op: z.literal('ack'),
    generation,
    throughSeq: z.number().int().nonnegative().safe(),
  }),
]);
export type LegacyRequest = z.infer<typeof LegacyRequest>;
export type LegacyEnvelope = z.infer<typeof LegacyEnvelope>;

export function legacyAuthAad(bindingId: string): string {
  return `channels:legacy:${bindingId}:auth`;
}

export function legacySignature(
  key: Buffer,
  bindingId: string,
  envelope: Pick<LegacyEnvelope, 'sentAt' | 'nonce' | 'payload'>,
): string {
  return createHmac('sha256', key)
    .update(
      `weiban-legacy-relay-v1\n${bindingId}\n${envelope.sentAt}\n${envelope.nonce}\n${envelope.payload}`,
    )
    .digest('hex');
}

export function validLegacySignature(
  key: Buffer,
  bindingId: string,
  envelope: LegacyEnvelope,
  nowMs: number,
): boolean {
  if (Math.abs(nowMs - envelope.sentAt) > LEGACY_RELAY_MAX_SKEW_MS) return false;
  return timingSafeEqual(
    Buffer.from(legacySignature(key, bindingId, envelope), 'hex'),
    Buffer.from(envelope.signature, 'hex'),
  );
}

/** Stable forever, including after pruning the auxiliary inbox or a timed-out HTTP response. */
export function legacyMessageId(bindingId: string, externalId: string): string {
  const bytes = createHash('sha256')
    .update(`legacy-channel-inbound\0${bindingId}\0${externalId}`)
    .digest()
    .subarray(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x50;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = bytes.toString('hex');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
