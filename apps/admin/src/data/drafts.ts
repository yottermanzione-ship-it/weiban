/**
 * 抽屉草稿（10-20 批 E1）：点遮罩 / 右上角 × / 取消关闭抽屉时，把没保存的内容存到本机 localStorage，
 * 下次打开同一条记录（同一个 draftKey）时提示「恢复 / 丢弃」；保存成功后清除。
 *
 * - 键 = 「表单类型:记录 ID」或「表单类型:new」，由各抽屉传入（RecordDrawer 的 draftKey / draft.key）。
 * - 只存在这台电脑的这个浏览器里；隐私窗口、清缓存后会丢，读写一律 try/catch，失败就当没有草稿。
 * - 日期（dayjs）会被还原成 dayjs；文件、图片对象等不能序列化的值不存。
 * - 「保存成功」的判断：useFormFeedback().validate() 全量校验通过、之后没有 report() 失败，就当保存成功。
 */
import dayjs from 'dayjs';
import type { FormInstance } from 'antd';

const PREFIX = 'wb-admin-draft:';
/** 草稿保留 30 天，过期自动忽略。 */
const TTL_MS = 30 * 86_400_000;

export interface StoredDraft {
  savedAt: string;
  value: unknown;
}

function isPlainObject(value: object): boolean {
  const proto = Object.getPrototypeOf(value) as unknown;
  return proto === Object.prototype || proto === null;
}

/** 转成可 JSON 保存的形态：dayjs → { __dayjs: ISO }；不能序列化的对象丢掉。 */
export function encodeDraft(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return typeof value === 'function' || typeof value === 'symbol' ? undefined : value;
  }
  if (dayjs.isDayjs(value)) return { __dayjs: value.toISOString() };
  if (value instanceof Date) return { __dayjs: value.toISOString() };
  if (Array.isArray(value)) return value.map((item) => encodeDraft(item) ?? null);
  if (!isPlainObject(value)) return undefined;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(value)) {
    const encoded = encodeDraft(v);
    if (encoded !== undefined) out[k] = encoded;
  }
  return out;
}

export function decodeDraft(value: unknown): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map(decodeDraft);
  const record = value as Record<string, unknown>;
  if (typeof record.__dayjs === 'string' && Object.keys(record).length === 1)
    return dayjs(record.__dayjs);
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) out[k] = decodeDraft(v);
  return out;
}

/** 比较用的稳定字符串。 */
export function draftFingerprint(value: unknown): string {
  try {
    return JSON.stringify(encodeDraft(value)) ?? '';
  } catch {
    return '';
  }
}

export function readDraft(key: string): StoredDraft | null {
  try {
    const raw = window.localStorage.getItem(PREFIX + key);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as StoredDraft;
    if (!parsed || typeof parsed.savedAt !== 'string') return null;
    if (Date.now() - new Date(parsed.savedAt).getTime() > TTL_MS) {
      window.localStorage.removeItem(PREFIX + key);
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}

export function writeDraft(key: string, value: unknown): void {
  try {
    const stored: StoredDraft = { savedAt: new Date().toISOString(), value: encodeDraft(value) };
    window.localStorage.setItem(PREFIX + key, JSON.stringify(stored));
  } catch {
    /* 存储不可用（隐私模式 / 超限）：不存草稿 */
  }
}

export function clearDraft(key: string): void {
  try {
    window.localStorage.removeItem(PREFIX + key);
  } catch {
    /* 忽略 */
  }
}

// ---------- 表单提交状态（给抽屉判断「是不是已经保存成功」） ----------

interface SubmitState {
  /** 最近一次全量校验通过时的表单值指纹。 */
  fingerprint: string;
  /** 校验通过之后又报过错（接口失败 / 前端发现问题）。 */
  failed: boolean;
}

const submits = new WeakMap<FormInstance, SubmitState>();

export function markFormValidated(form: FormInstance, values: unknown): void {
  submits.set(form, { fingerprint: draftFingerprint(values), failed: false });
}

export function markFormFailed(form: FormInstance): void {
  const state = submits.get(form);
  if (state) state.failed = true;
}

export function formSubmitState(form: FormInstance): SubmitState | undefined {
  return submits.get(form);
}

export function forgetFormSubmit(form: FormInstance): void {
  submits.delete(form);
}
