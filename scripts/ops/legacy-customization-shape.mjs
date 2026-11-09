/** Pure preflight for the old text-only importer. Never stringify structured persona patches. */
export function legacyTextSupplement(row) {
  if (row?.state !== 'customized') return null;
  let patch;
  try {
    patch = JSON.parse(row.patch_json);
  } catch {
    throw new Error('LEGACY_CUSTOMIZATION_INVALID_JSON');
  }
  if (!patch || typeof patch !== 'object' || Array.isArray(patch))
    throw new Error('LEGACY_CUSTOMIZATION_OBJECT_REQUIRED');
  const keys = Object.keys(patch);
  if (keys.some((key) => !['raw_persona', 'legacy_fields'].includes(key)))
    throw new Error('LEGACY_CUSTOMIZATION_STRUCTURED_MAPPING_REQUIRED');
  if (
    Object.hasOwn(patch, 'legacy_fields') &&
    (!patch.legacy_fields ||
      typeof patch.legacy_fields !== 'object' ||
      Array.isArray(patch.legacy_fields) ||
      Object.keys(patch.legacy_fields).length > 0)
  )
    throw new Error('LEGACY_CUSTOMIZATION_STRUCTURED_MAPPING_REQUIRED');
  if (!Object.hasOwn(patch, 'raw_persona')) return null;
  // The old merge-patch format stores objects and null deletions here. Converting
  // either to a string discards meaning; a reviewed structured adapter is required.
  if (typeof patch.raw_persona !== 'string')
    throw new Error('LEGACY_CUSTOMIZATION_STRUCTURED_MAPPING_REQUIRED');
  const text = patch.raw_persona.replaceAll('\u0000', '').trim();
  if (text.length > 5000) throw new Error('LEGACY_SUPPLEMENT_TOO_LONG');
  return text || null;
}

/** Run before the importer's first write so an unsupported row cannot leave a partial import. */
export function preflightLegacyTextSupplements(rows) {
  if (!Array.isArray(rows)) throw new Error('LEGACY_CUSTOMIZATION_ROWS_REQUIRED');
  for (const row of rows) legacyTextSupplement(row);
}
