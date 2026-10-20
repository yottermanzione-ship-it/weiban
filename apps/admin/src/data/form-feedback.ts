/**
 * 全后台通用的表单报错体验。
 *
 *   const feedback = useFormFeedback(form);
 *   async function save() {
 *     const values = await feedback.validate();   // 校验没过：自动滚到第一个错的字段并提示，返回 null
 *     if (!values) return;
 *     try { await api.call(...) } catch (e) { setError(feedback.report(e)); }
 *   }
 *
 * report(e) 会：
 * - 字段问题（antd 校验 / 契约 ZodError / 服务器 bad_request.details.issues）→ 在对应字段下面写红字，
 *   滚动并聚焦到第一个出错的字段；
 * - 同时弹出一条顶部提示（不用上滑抽屉也能看到）；
 * - 返回一句大白话，调用方可以放到抽屉顶部 / 底部按钮旁。
 */
import { useState } from 'react';
import { App, type FormInstance } from 'antd';
import { errorText } from './hooks.js';
import { markFormFailed, markFormValidated } from './drafts.js';
import {
  describeIssue,
  describeIssues,
  issueFieldText,
  issuesOf,
  lastField,
  type IssuePath,
} from './issues.js';

type NamePath = Parameters<FormInstance['scrollToField']>[0];
type InternalPath = (string | number)[];

export interface FormFeedbackOptions {
  /**
   * 把接口字段路径映射到表单字段名（例 ['rates','input'] → ['priceInput']）。
   * 返回 null 表示这个问题不对应任何表单字段。不传 = 原样对应。
   */
  mapPath?: (path: IssuePath) => NamePath | null | undefined;
}

interface ValidateErrorLike {
  errorFields: { name: InternalPath; errors: string[] }[];
}

export function isValidateError(value: unknown): value is ValidateErrorLike {
  return (
    typeof value === 'object' &&
    value !== null &&
    Array.isArray((value as { errorFields?: unknown }).errorFields)
  );
}

function toInternal(name: NamePath): InternalPath {
  return (Array.isArray(name) ? name : [name]) as InternalPath;
}

/** 滚动到字段并聚焦（抽屉里也能用：scroll-into-view 会处理嵌套滚动容器）。 */
export function focusField(form: FormInstance, name: NamePath) {
  // 等 React 把错误文字渲染出来再滚，位置才准。
  window.setTimeout(() => {
    try {
      form.scrollToField(name, { behavior: 'smooth', block: 'center', focus: true });
    } catch {
      /* 字段已卸载时忽略 */
    }
  }, 30);
}

/**
 * 把错误落到表单上。返回一句给人看的话。
 * 不弹提示；需要弹提示用 useFormFeedback().report。
 */
export function applyFormError(
  form: FormInstance,
  error: unknown,
  options: FormFeedbackOptions = {},
): string {
  if (isValidateError(error)) {
    const fields = error.errorFields.filter((f) => f.errors.length);
    const first = fields[0];
    if (!first) return '';
    focusField(form, first.name);
    return fields.length > 1
      ? `还有 ${fields.length} 处没填好，先看：${first.errors[0]}`
      : (first.errors[0] ?? '请检查填写内容');
  }
  const issues = issuesOf(error);
  if (!issues?.length) return errorText(error);

  const registered = new Set(form.getFieldsError().map((f) => JSON.stringify(f.name)));
  const resolve = (path: IssuePath): InternalPath | null => {
    const mapped = options.mapPath ? options.mapPath(path) : path;
    if (mapped == null) return null;
    const target = toInternal(mapped);
    // 找不到精确字段时退回到上一级（例 tags.3 → tags）。
    for (let len = target.length; len > 0; len -= 1) {
      const candidate = target.slice(0, len);
      if (registered.has(JSON.stringify(candidate))) return candidate;
    }
    return null;
  };

  // 同一字段上「同一项、同一原因」只写一次；重复时留路径更具体的那条（例 routes.0.billingBounds 优先于镜像 billingBounds）。
  const byField = new Map<
    string,
    { name: InternalPath; texts: Map<string, { text: string; depth: number }> }
  >();
  for (const issue of issues) {
    const name = resolve(issue.path);
    if (!name) continue;
    const key = JSON.stringify(name);
    const entry = byField.get(key) ?? { name, texts: new Map() };
    // 映射到的字段不是这个问题本身的字段（例：错误在 JSON 里的某一项）时，带上字段名说清楚。
    const own = lastField(issue.path);
    const target = name.filter((seg): seg is string => typeof seg === 'string').pop();
    const reason = issueFieldText(issue);
    const text = own && target && own !== target ? describeIssue(issue) : reason;
    const dedupe = `${own ?? ''}|${reason}`;
    const prev = entry.texts.get(dedupe);
    if (!prev || prev.depth < issue.path.length)
      entry.texts.set(dedupe, { text, depth: issue.path.length });
    byField.set(key, entry);
  }
  const fields = [...byField.values()].map((f) => ({
    name: f.name,
    errors: [...f.texts.values()].map((t) => t.text),
  }));
  if (fields.length) {
    form.setFields(fields);
    focusField(form, fields[0]!.name);
  }
  return describeIssues(issues);
}

export function useFormFeedback<V = unknown>(form: FormInstance<V>, options: FormFeedbackOptions = {}) {
  const { message } = App.useApp();
  const [error, setError] = useState('');

  function report(failure: unknown): string {
    markFormFailed(form as FormInstance);
    const text = applyFormError(form as FormInstance, failure, options);
    if (text) {
      setError(text);
      void message.error({ content: text, duration: 5, key: 'form-feedback' });
    }
    return text;
  }

  /** 校验全部（或指定）字段；没过时自动定位并提示，返回 null。不会抛出未处理的 Promise 拒绝。 */
  async function validate(nameList?: NamePath[]): Promise<V | null> {
    try {
      const values = await form.validateFields(nameList);
      setError('');
      // 全量校验通过 = 准备保存；抽屉据此判断关闭时是清草稿还是存草稿（data/drafts.ts）
      if (!nameList) markFormValidated(form as FormInstance, (form as FormInstance).getFieldsValue(true));
      return values;
    } catch (failure) {
      report(failure);
      return null;
    }
  }

  /** 前端自己发现的字段问题（例 JSON 写错）：字段下面写红字、定位过去、弹提示。 */
  function reportField(name: NamePath, fieldText: string, summary = fieldText): string {
    markFormFailed(form as FormInstance);
    (form as FormInstance).setFields([{ name, errors: [fieldText] }]);
    focusField(form as FormInstance, name);
    setError(summary);
    void message.error({ content: summary, duration: 5, key: 'form-feedback' });
    return summary;
  }

  return { error, setError, clear: () => setError(''), report, reportField, validate };
}
