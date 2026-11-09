import { ApiFailure } from '@weiban/client-core';
import {
  ContactOrganizationSnapshot,
  SaveContactOrganizationRequest,
  type ContactOrganizationTag,
} from '@weiban/contracts';

export type OrganizationOperation =
  | { type: 'set-star'; characterId: string; selected: boolean }
  | { type: 'replace-stars'; characterIds: string[] }
  | { type: 'create-tag' | 'update-tag'; tag: ContactOrganizationTag }
  | { type: 'delete-tag'; tagId: string };
export interface OrganizationState {
  snapshot: ContactOrganizationSnapshot | null;
  loading: boolean;
  busy: boolean;
  error: string;
  problem: 'conflict' | 'network' | 'unavailable' | 'invalid' | null;
  pendingOperation: OrganizationOperation | null;
}
export const EMPTY_ORGANIZATION_STATE: OrganizationState = {
  snapshot: null,
  loading: false,
  busy: false,
  error: '',
  problem: null,
  pendingOperation: null,
};
type Transport = {
  get(signal: AbortSignal): Promise<ContactOrganizationSnapshot>;
  save(
    body: SaveContactOrganizationRequest,
    signal: AbortSignal,
  ): Promise<{ snapshot: ContactOrganizationSnapshot; replayed: boolean }>;
};
const ids = (values: string[]) => [...new Set(values)].sort();
function bodyOf(snapshot: ContactOrganizationSnapshot) {
  return {
    starredCharacterIds: ids(snapshot.starredCharacterIds),
    tags: snapshot.tags.map((tag) => ({ ...tag, characterIds: ids(tag.characterIds) })),
  };
}
export function applyOrganizationOperation(
  snapshot: ContactOrganizationSnapshot,
  operation: OrganizationOperation,
) {
  const next = bodyOf(snapshot);
  if (operation.type === 'set-star')
    next.starredCharacterIds = operation.selected
      ? ids([...next.starredCharacterIds, operation.characterId])
      : next.starredCharacterIds.filter((id) => id !== operation.characterId);
  else if (operation.type === 'replace-stars')
    next.starredCharacterIds = ids(operation.characterIds);
  else if (operation.type === 'delete-tag')
    next.tags = next.tags.filter((tag) => tag.tagId !== operation.tagId);
  else {
    const exists = next.tags.some((tag) => tag.tagId === operation.tag.tagId);
    if (operation.type === 'update-tag' && !exists)
      throw new ApiFailure('conflict', '这个标签已被移除。你的编辑仍保留，可以另存为新标签。', 409);
    if (operation.type === 'create-tag' && exists)
      throw new ApiFailure('conflict', '这个标签已经存在，请重新读取。', 409);
    const edited = {
      ...operation.tag,
      name: operation.tag.name.trim(),
      characterIds: ids(operation.tag.characterIds),
    };
    next.tags = exists
      ? next.tags.map((tag) => (tag.tagId === edited.tagId ? edited : tag))
      : [...next.tags, edited];
    if (new Set(next.tags.map((tag) => tag.name)).size !== next.tags.length)
      throw new ApiFailure('bad_request', '已有同名标签，请换个名字。', 400);
  }
  return next;
}

/** One authenticated owner, no disk state. Retry receipts keep the exact original full body. */
export class ContactOrganizationController {
  private view: OrganizationState = EMPTY_ORGANIZATION_STATE;
  private readonly listeners = new Set<() => void>();
  private readonly requests = new Set<AbortController>();
  private active = true;
  private epoch = 0;
  private loading: Promise<void> | null = null;
  private pendingBody: SaveContactOrganizationRequest | null = null;
  constructor(
    readonly owner: string,
    private readonly currentOwner: () => string,
    private readonly transport: Transport,
    private readonly uuid: () => string = () => crypto.randomUUID(),
  ) {}
  snapshot = () => this.view;
  subscribe = (listener: () => void) => {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  };
  isCurrent() {
    return this.active && this.owner !== 'public' && this.currentOwner() === this.owner;
  }
  activate() {
    this.active = true;
  }
  dispose() {
    this.active = false;
    this.epoch++;
    for (const request of this.requests) request.abort();
    this.requests.clear();
    this.loading = null;
    this.pendingBody = null;
    this.view = EMPTY_ORGANIZATION_STATE;
  }
  private set(patch: Partial<OrganizationState>) {
    if (!this.isCurrent()) return;
    this.view = { ...this.view, ...patch };
    this.listeners.forEach((listener) => listener());
  }
  private accept(snapshot: ContactOrganizationSnapshot) {
    const parsed = ContactOrganizationSnapshot.parse(snapshot);
    if (!this.view.snapshot || parsed.revision >= this.view.snapshot.revision)
      this.set({ snapshot: parsed });
    return parsed;
  }
  private async request<T>(work: (signal: AbortSignal) => Promise<T>) {
    if (!this.isCurrent()) throw new ApiFailure('session_changed', '登录状态已改变', 0);
    const epoch = this.epoch;
    const controller = new AbortController();
    this.requests.add(controller);
    try {
      const result = await work(controller.signal);
      if (!this.isCurrent() || controller.signal.aborted || epoch !== this.epoch)
        throw new ApiFailure('session_changed', '登录状态已改变', 0);
      return result;
    } catch (error) {
      if (!this.isCurrent() || controller.signal.aborted || epoch !== this.epoch)
        throw new ApiFailure('session_changed', '登录状态已改变', 0);
      throw error;
    } finally {
      this.requests.delete(controller);
    }
  }
  private async latest() {
    return this.accept(await this.request((signal) => this.transport.get(signal)));
  }
  async refresh(): Promise<void> {
    if (!this.isCurrent()) return;
    if (this.loading) return this.loading;
    const epoch = this.epoch;
    this.set({ loading: true });
    const run = (async () => {
      try {
        await this.latest();
        if (!this.view.pendingOperation) this.set({ error: '', problem: null });
      } catch (error) {
        if (this.isCurrent() && !(error instanceof ApiFailure && error.code === 'session_changed'))
          this.set({
            error: '星标和标签暂未同步，请稍后重试。',
            problem:
              error instanceof ApiFailure && [403, 404].includes(error.status)
                ? 'unavailable'
                : 'network',
          });
      } finally {
        if (epoch === this.epoch) this.set({ loading: false });
      }
    })();
    this.loading = run;
    try {
      await run;
    } finally {
      if (this.loading === run) this.loading = null;
    }
  }
  private async sendPending() {
    const body = this.pendingBody!;
    const result = await this.request((signal) =>
      this.transport.save(structuredClone(body), signal),
    );
    this.accept(result.snapshot);
    this.pendingBody = null;
    this.set({ pendingOperation: null, error: '', problem: null });
    return true;
  }
  private async failed(error: unknown) {
    if (!this.isCurrent() || (error instanceof ApiFailure && error.code === 'session_changed'))
      return false;
    if (error instanceof ApiFailure && (error.status === 409 || error.code === 'conflict')) {
      this.pendingBody = null;
      this.set({
        error: '云端已有新的修改。你的编辑仍保留，请核对最新内容后再确认保存。',
        problem: 'conflict',
      });
      try {
        await this.latest();
      } catch {
        this.set({ error: '云端已有新的修改，暂未读到最新内容。请重试读取后再确认。' });
      }
    } else if (error instanceof ApiFailure && error.status >= 400 && error.status < 500) {
      this.pendingBody = null;
      this.set({
        error: [403, 404].includes(error.status)
          ? '当前暂时无法保存星标和标签，编辑仍保留。'
          : '未能保存，请检查标签名称及好友是否仍可用。编辑仍保留。',
        problem: [403, 404].includes(error.status) ? 'unavailable' : 'invalid',
      });
    } else
      this.set({
        error: this.pendingBody
          ? '保存结果暂未确认，请重试同一项保存。'
          : '暂未读取到最新云端内容，编辑仍保留，请重试。',
        problem: 'network',
      });
    return false;
  }
  async change(operation: OrganizationOperation, expectedRevision?: number): Promise<boolean> {
    if (!this.isCurrent() || this.view.busy) return false;
    if (this.pendingBody) {
      this.set({ error: '上一次保存结果待确认，请先重试。' });
      return false;
    }
    this.set({
      busy: true,
      error: '',
      problem: null,
      pendingOperation: structuredClone(operation),
    });
    try {
      const latest = await this.latest();
      if (!this.isCurrent()) return false;
      if (expectedRevision !== undefined && latest.revision !== expectedRevision)
        throw new ApiFailure('conflict', 'cloud changed', 409);
      const values = applyOrganizationOperation(latest, operation);
      if (JSON.stringify(values) === JSON.stringify(bodyOf(latest))) {
        this.set({ pendingOperation: null });
        return true;
      }
      this.pendingBody = SaveContactOrganizationRequest.parse({
        clientCommandId: this.uuid(),
        expectedRevision: latest.revision,
        ...values,
      });
      return await this.sendPending();
    } catch (error) {
      return await this.failed(error);
    } finally {
      this.set({ busy: false });
    }
  }
  async retry(): Promise<boolean> {
    if (!this.isCurrent() || this.view.busy || !this.view.pendingOperation) return false;
    if (!this.pendingBody)
      return this.change(
        this.view.pendingOperation,
        this.view.problem === 'conflict' ? this.view.snapshot?.revision : undefined,
      );
    this.set({ busy: true, error: '', problem: null });
    try {
      return await this.sendPending();
    } catch (error) {
      return await this.failed(error);
    } finally {
      this.set({ busy: false });
    }
  }
  continueEditing() {
    if (!this.view.busy && !this.pendingBody)
      this.set({ pendingOperation: null, error: '', problem: null });
  }
  get uncertain() {
    return this.pendingBody !== null;
  }
}

export const LEGACY_STARS_KEY = 'weiban:starred-characters';
/** The old global key has no owner. This only classifies; it never imports or erases it. */
export function legacyStarCandidates(raw: string | null, activeCharacterIds: string[]) {
  if (!raw) return { present: false, characterIds: [], unavailable: 0 };
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    return { present: true, characterIds: [], unavailable: 1 };
  }
  if (!Array.isArray(value)) return { present: true, characterIds: [], unavailable: 1 };
  const unique = [...new Set(value)],
    allowed = new Set(activeCharacterIds);
  const characterIds = unique.filter(
    (item): item is string => typeof item === 'string' && allowed.has(item),
  );
  return {
    present: unique.length > 0,
    characterIds,
    unavailable: unique.length - characterIds.length,
  };
}
