/**
 * 3.27：后台「模型」列表的逐行校验。
 *
 * 背景：`GET /api/v1/admin/model/models` 的响应在 client-core 里是**整包**按契约解析的
 * （`endpoint.response.parse`）。只要其中**任意一行**不符合契约（历史数据、刚改过的枚举 / 计费上限、
 * 服务端漏字段），zod 就抛错，`useRemote` 拿不到任何数据 —— 页面于是显示成「还没有模型」，
 * 一行坏掉、整表消失，而且看不出是哪一行、哪个字段。
 *
 * 这里的做法：请求只要求 `{ items: unknown[] }`，每行单独用契约里的 `AdminModel` 校验。
 * - 合法的照常展示（37 条目录 / 25 条路由该有的行都在）；
 * - 不合法的收敛成一条**可见的警告**（模型键 + 第一个不符合的字段），不静默丢弃、也不补默认值。
 */
import { AdminModel } from '@weiban/contracts';

export interface AdminModelIssue {
  /** 出问题的模型键（行里连模型键都没有时给出占位说明）。 */
  modelKey: string;
  /** 第一个不符合契约的字段说明，例：「routes.0.priority: 必须是整数」。 */
  message: string;
}

export interface ParsedAdminModels {
  models: AdminModel[];
  issues: AdminModelIssue[];
}

function describeIssue(issue: { path: readonly PropertyKey[]; message: string }): string {
  const path = issue.path.length ? issue.path.map(String).join('.') : '(整行)';
  return `${path}: ${issue.message}`;
}

/** 逐行校验。`items` 不是数组时返回空结果（由调用方按请求错误处理）。 */
export function parseAdminModels(items: readonly unknown[] | undefined): ParsedAdminModels {
  const models: AdminModel[] = [];
  const issues: AdminModelIssue[] = [];
  for (const item of items ?? []) {
    const parsed = AdminModel.safeParse(item);
    if (parsed.success) {
      models.push(parsed.data);
      continue;
    }
    const key = (item as { modelKey?: unknown } | null)?.modelKey;
    issues.push({
      modelKey: typeof key === 'string' && key ? key : '(没有模型键的行)',
      message: parsed.error.issues[0] ? describeIssue(parsed.error.issues[0]) : '不符合契约',
    });
  }
  return { models, issues };
}
