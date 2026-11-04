/**
 * 搜索身份修正页（5.6，T-20261104e）的纯逻辑：输入解析、别名可做的操作、审计动作的中文名。不依赖 React，单测直接跑。
 */
import type { AdminSearchAlias, AdminSearchAliasOp, SearchAliasStatus } from '@weiban/contracts';

/** 多行输入 → 去空行、去重（每行一个标识 / 网址 / 角色 ID）。 */
export function parseLines(text: string, max = 20): string[] {
  const seen = new Set<string>();
  for (const line of text.split(/\r?\n/u)) {
    const value = line.trim();
    if (value) seen.add(value);
  }
  return [...seen].slice(0, max);
}

/**
 * 出处输入：每行「标题 | 网址」或只写网址（标题留空时服务器用网址）。
 * 不是 http(s) 地址的行返回在 invalid 里，页面提示后不提交。
 */
export function parseSourceLines(text: string): {
  sources: Array<{ url: string; title: string }>;
  invalid: string[];
} {
  const sources: Array<{ url: string; title: string }> = [];
  const invalid: string[] = [];
  for (const line of parseLines(text, 10)) {
    const bar = line.lastIndexOf('|');
    const title = bar >= 0 ? line.slice(0, bar).trim() : '';
    const url = (bar >= 0 ? line.slice(bar + 1) : line).trim();
    if (!/^https?:\/\/\S+$/iu.test(url)) {
      invalid.push(line);
      continue;
    }
    if (!sources.some((s) => s.url === url)) sources.push({ url, title: title.slice(0, 300) });
  }
  return { sources: sources.slice(0, 5), invalid };
}

/** 出处列表 → 输入框文字（编辑时回填）。 */
export function sourcesToText(sources: ReadonlyArray<{ url: string; title: string }>): string {
  return sources
    .map((s) => (s.title && s.title !== s.url ? `${s.title} | ${s.url}` : s.url))
    .join('\n');
}

/** 一个别名现在能做的操作（与服务器的状态机一致）。 */
export function aliasActions(
  alias: Pick<AdminSearchAlias, 'status' | 'origin'>,
): AdminSearchAliasOp[] {
  const status: SearchAliasStatus = alias.status;
  if (status === 'pending') return ['approve', 'reject'];
  if (status === 'blocked') return ['restore'];
  return ['remove'];
}

const ALIAS_OP_LABELS: Record<AdminSearchAliasOp, string> = {
  propose: '添加（待审核）',
  approve: '通过',
  reject: '驳回',
  remove: '从搜索里去掉',
  restore: '恢复',
};

export function aliasOpLabel(op: AdminSearchAliasOp): string {
  return ALIAS_OP_LABELS[op];
}

const STATUS_LABELS: Record<SearchAliasStatus, string> = {
  pending: '待审核',
  approved: '已通过',
  blocked: '已去掉',
};

export function aliasStatusLabel(status: SearchAliasStatus): string {
  return STATUS_LABELS[status];
}

const ACTION_LABELS: Record<string, string> = {
  'search.entity_created': '新建实体',
  'search.entity_updated': '修改身份 / 出处',
  'search.entity_linked': '修改关联',
  'search.entity_merged': '合并实体',
  'search.entity_merged_away': '被合并',
  'search.entity_split': '拆分实体',
  'search.entity_split_created': '拆分出的新实体',
  'search.character_linked': '关联到实体',
  'search.character_unlinked': '取消关联',
  'search.alias_proposed': '添加别名',
  'search.alias_approved': '通过别名',
  'search.alias_rejected': '驳回别名',
  'search.alias_removed': '去掉别名',
  'search.alias_restored': '恢复别名',
};

/** 审计动作的中文名；不认识的原样显示。 */
export function correctionLabel(action: string): string {
  return ACTION_LABELS[action] ?? action;
}

/** 修改原因：2～200 字（与契约一致），不够时返回提示。 */
export function reasonProblem(reason: string): string | null {
  const length = reason.trim().length;
  if (length < 2) return '请写明修改原因（至少 2 个字）';
  if (length > 200) return '修改原因最多 200 字';
  return null;
}
