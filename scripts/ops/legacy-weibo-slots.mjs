/** Metadata-only candidate planner. No I/O, credentials, network, SQL or activation. */
const slots = new Set(['main', 'blue', 'white', 'pink', 'yellow']);
const hash = (value) => typeof value === 'string' && /^[a-f0-9]{64}$/.test(value);
const id = (value) => typeof value === 'string' && /^[A-Za-z0-9:_-]{1,200}$/.test(value);
const sourceFields = new Set([
  'legacyBindingId',
  'legacyUserId',
  'slot',
  'status',
  'personaKey',
  'appIdFingerprint',
  'sourceDigest',
  'credentialProof',
  'peerProof',
]);
function exact(value, allowed) {
  return (
    value &&
    typeof value === 'object' &&
    !Array.isArray(value) &&
    Object.keys(value).every((key) => allowed.has(key))
  );
}
function proof(value, row, kind) {
  return (
    exact(
      value,
      new Set(['legacyBindingId', 'legacyUserId', 'appIdFingerprint', 'evidenceDigest', 'kind']),
    ) &&
    value.legacyBindingId === row.legacyBindingId &&
    value.legacyUserId === row.legacyUserId &&
    value.appIdFingerprint === row.appIdFingerprint &&
    hash(value.evidenceDigest) &&
    value.kind === kind
  );
}

/**
 * Maps already-reviewed non-secret metadata. A proof digest is only a reference: it does
 * not prove custody or authorize activation. Production execution is deliberately absent.
 */
export function planLegacyWeiboSlots({ source, targets = [], userMap, characterMap }) {
  if (!Array.isArray(source) || !Array.isArray(targets) || !userMap || !characterMap)
    throw new Error('METADATA_PLAN_REQUIRED');
  const targetSlots = new Set(),
    targetIds = new Set();
  for (const target of targets) {
    if (
      !exact(
        target,
        new Set(['bindingId', 'userId', 'slot', 'status', 'characterId', 'appIdFingerprint']),
      ) ||
      !id(target.bindingId) ||
      !id(target.userId) ||
      !slots.has(target.slot) ||
      !['active', 'unbound', 'revoked'].includes(target.status) ||
      (target.characterId != null && !id(target.characterId)) ||
      (target.appIdFingerprint != null && !hash(target.appIdFingerprint))
    )
      throw new Error('INVALID_OR_PRIVATE_TARGET_METADATA');
    const key = `${target.userId}:${target.slot}`;
    if (targetSlots.has(key) || targetIds.has(target.bindingId))
      throw new Error('AMBIGUOUS_TARGET_BASELINE');
    targetSlots.add(key);
    targetIds.add(target.bindingId);
  }
  const seenIds = new Set(),
    seenSlots = new Set(),
    seenRoles = new Set(),
    seenApps = new Map();
  const actions = [],
    blocked = [];
  for (const row of source) {
    if (
      !exact(row, sourceFields) ||
      !id(row.legacyBindingId) ||
      !id(row.legacyUserId) ||
      !slots.has(row.slot) ||
      !['active', 'unbound', 'revoked'].includes(row.status) ||
      !hash(row.sourceDigest)
    )
      throw new Error('INVALID_OR_PRIVATE_SOURCE_METADATA');
    const reasons = [];
    if (seenIds.has(row.legacyBindingId)) reasons.push('DUPLICATE_SOURCE_BINDING');
    seenIds.add(row.legacyBindingId);
    const userId = userMap[row.legacyUserId];
    const characterId = characterMap[`${row.legacyUserId}:${row.personaKey}`];
    if (!id(userId)) reasons.push('USER_MAPPING_REQUIRED');
    if (row.status === 'active' && !id(characterId)) reasons.push('CHARACTER_MAPPING_REQUIRED');
    if (row.status === 'active') {
      const slotKey = `${userId}:${row.slot}`,
        roleKey = `${userId}:${characterId}`;
      if (seenSlots.has(slotKey)) reasons.push('ACTIVE_SLOT_COLLISION');
      if (seenRoles.has(roleKey)) reasons.push('ACTIVE_CHARACTER_COLLISION');
      if (seenApps.has(row.appIdFingerprint)) reasons.push('ACTIVE_APPID_COLLISION');
      seenSlots.add(slotKey);
      seenRoles.add(roleKey);
      seenApps.set(row.appIdFingerprint, userId);
    }
    const target = targets.find((item) => item.userId === userId && item.slot === row.slot);
    const occupiedApp = targets.find(
      (item) => item.status === 'active' && item.appIdFingerprint === row.appIdFingerprint,
    );
    if (occupiedApp && occupiedApp.bindingId !== target?.bindingId)
      reasons.push('TARGET_APPID_OCCUPIED');
    const occupiedRole = targets.find(
      (item) =>
        item.userId === userId &&
        item.status === 'active' &&
        item.characterId === characterId &&
        item.bindingId !== target?.bindingId,
    );
    if (occupiedRole) reasons.push('TARGET_CHARACTER_OCCUPIED');
    const action = {
      legacyBindingId: row.legacyBindingId,
      sourceDigest: row.sourceDigest,
      userId: id(userId) ? userId : null,
      characterId: id(characterId) ? characterId : null,
      slot: row.slot,
      sourceStatus: row.status,
      targetBindingId: target?.bindingId ?? null,
      activate: false,
      preserveSource: true,
      execute: false,
      disposition: 'stage-disabled',
      credentialAction: 'none',
      peerAction: 'none',
      required: [],
    };
    if (target) {
      // New site data, including unbound tombstones, always wins. Never merge credentials.
      action.disposition = 'preserve-target';
      action.required = [
        'archive-source-under-owner',
        'explicit-conflict-resolution-before-any-write',
      ];
    } else if (row.status !== 'active') {
      action.disposition = 'archive-inactive';
      action.required = ['owner-scoped-history-receipt'];
    } else {
      if (!hash(row.appIdFingerprint)) reasons.push('APPID_FINGERPRINT_REQUIRED');
      const credentials = proof(row.credentialProof, row, 'protected-decryptable-credentials');
      const peer = proof(row.peerProof, row, 'authenticated-inbound-peer');
      if (credentials) action.credentialAction = 'memory-only-decrypt-and-reseal-with-owner-dek';
      else action.required.push('owner-reauthorization-or-reviewed-credential-custody');
      if (peer) action.peerAction = 'memory-only-owner-and-binding-scoped-peer-reseal';
      else action.required.push('verified-peer-provenance-or-owner-reauthorization');
      action.required.push(
        'legacy-consumer-stop-receipt',
        'inflight-dedupe-reconciliation',
        'target-baseline-unchanged',
        'formal-cutover-authorization',
      );
      if (credentials && peer) action.disposition = 'stage-protected-candidate';
    }
    if (reasons.length) blocked.push({ legacyBindingId: row.legacyBindingId, reasons });
    actions.push(action);
  }
  return {
    version: 1,
    productionReady: false,
    execute: false,
    status: blocked.length ? 'blocked' : 'candidate-only',
    actions,
    blocked,
  };
}
