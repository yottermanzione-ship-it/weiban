export { ApiClient, ApiFailure, type RequestOptions } from './api-client.js';
export { IndexedLocalStore, type LocalStore, type StoreOwner } from './local-store.js';
export { formatMoney, yuanToMicros } from './money.js';

export { SyncEngine } from './sync-engine.js';
export { SyncRunner, LocalSaveError, type SyncDriverPort } from './sync-runner.js';
export * from './sync-state.js';
export { avatarLetters, avatarPaletteIndex, avatarForeground } from './avatar.js';
export * from './persona-sections.js';
export {
  joinPersonaText,
  splitPersonaTextWith,
  type PersonaTextDocument,
  type PersonaTextPart,
} from './persona-text.js';
