/** Stable import identities; changing a manifest's root/order never creates another copy. */
import { v5 } from 'uuid';
const IMPORT_NAMESPACE = 'fa7689fb-cb3e-53ba-ae54-a3b4eb7410df';
export function stickerImportId(kind: 'pack' | 'sticker' | 'media', ...parts: string[]): string {
  return v5(JSON.stringify([kind, ...parts]), IMPORT_NAMESPACE);
}
