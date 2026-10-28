import type { AdminModel, Upstream } from '@weiban/contracts';

export const PURPOSE_LABELS: Record<string, string> = {
  chat_reply: '聊天回复',
  safety_check: '安全检查',
  memory: '记忆',
  simulation: '推演',
  proactive: '主动消息',
  moments: '朋友圈',
  vision: '识图',
  voice: '语音',
  image_generation: '图片生成',
  web_search: '联网搜索',
  import_analysis: '导入分析',
  admin_distill: '管理员蒸馏',
  admin_persona_check: '人设检查',
  admin_public_update_search: '公开动态搜索',
  admin_eval: '评测',
  admin_upstream_test: '连通测试',
  safety_followup: '关怀跟进',
  behavior_planning: '行为规划',
  admin_test: '管理员测试',
};

export const ERROR_LABELS: Record<string, string> = {
  invalid_key: '密钥失效',
  quota_exhausted: '余额不足',
  insufficient_balance: '积分不足',
  rate_limited: '被限流',
  timeout: '超时',
  network_error: '网络错误',
  provider_error: '上游错误',
  model_unavailable: '模型不可用',
  upstream_test_failed: '连通测试未通过',
};

/** 供应商下拉：接口地址由后台自己维护，前端不预填域名（工程规范 R4）。 */
export const PROVIDERS: Array<{ id: string; name: string }> = [
  { id: 'xiaomi_mimo', name: '小米 MiMo' },
  { id: 'dashscope', name: '阿里云百炼' },
  { id: 'deepseek', name: 'DeepSeek' },
  { id: 'moonshot', name: '月之暗面' },
  { id: 'zhipu', name: '智谱' },
  { id: 'openrouter', name: 'OpenRouter' },
  { id: 'openai_compatible', name: 'OpenAI 兼容（自定义）' },
];

export function providerName(id: string | undefined): string {
  return PROVIDERS.find((p) => p.id === id)?.name ?? id ?? '—';
}

export const DEFAULT_FOR_LABELS: Record<string, string> = {
  chat: '聊天默认',
  background: '后台默认',
  vision: '识图默认',
  planner: '行为规划',
  adult_check: '成人边界检查',
  speech_synthesis: '语音合成',
  speech_recognition: '语音识别',
  image_generation: '图片生成',
  web_search: '联网搜索',
};

/** 3.22：模型使用场景（取代原「默认给谁用」）。3.24 去掉「图片识别」：图片随文本聊天 / 私密模式模型。 */
export const SCENARIO_LABELS: Record<string, string> = {
  chat: '文本聊天',
  voice_message: '语音消息',
  speech_recognition: '语音识别',
  voice_call: '语音通话',
  private: '私密模式',
};

export const CAPABILITY_LABELS: Record<string, string> = {
  vision: '识图',
  voice_input: '语音输入',
  voice_output: '语音输出',
  web_search: '联网搜索',
  image_generation: '图片生成',
  adult_content: '成人内容',
};

/** 3.24：要求具备识图能力的场景（用户发的图片随这两个场景的模型发送）。 */
export const VISION_REQUIRED_SCENARIOS = ['chat', 'private'] as const;

/** 3.24：模型「暂时无法使用」的具体原因（后台口径，契约 ModelUnavailableDetail）。 */
export const UNAVAILABLE_DETAIL_LABELS: Record<string, string> = {
  model_removed: '已下架',
  no_route: '没有启用的线路',
  upstream_disabled: '上游账号已停用',
  upstream_invalid_key: '上游密钥无效',
  upstream_quota_exhausted: '上游余额不足',
  upstream_unavailable: '上游连接异常，被健康检查暂停',
  upstream_cooldown: '上游连续失败，暂停几分钟后自动重试',
  billing_bounds_missing: '缺计费上限',
  billing_bounds_paused: '线路被旧规则暂停（用量未知）',
  price_missing: '价目表里没有价格',
  output_limit_too_small: '最大输出太小，不够一条回复',
};

/** 3.24：怎么处理（后台提示）。 */
export const UNAVAILABLE_DETAIL_HINTS: Record<string, string> = {
  no_route: '在模型抽屉里启用至少一条线路。',
  upstream_disabled: '到「上游账号」启用账号，或给模型换一条线路。',
  upstream_invalid_key: '到「上游账号」更换密钥后点「测试连通」。',
  upstream_quota_exhausted: '去服务商处充值，再到「上游账号」点「测试连通」恢复。',
  upstream_unavailable:
    '系统每分钟自动探测，连通后自动恢复；也可以到「上游账号」手动「测试连通」看具体原因。',
  upstream_cooldown: '暂停到期后自动重试；频繁出现请看「调用记录」里的失败原因。',
  billing_bounds_missing: '打开模型抽屉，给线路填上计费上限。',
  billing_bounds_paused: '打开模型抽屉，核对计费上限后勾选「已重新核对」和「启用这条线路」保存。',
  price_missing: '在模型抽屉的「价格」里填上售价保存。',
  output_limit_too_small: '把线路计费上限的「最大输出」改到 600 以上。',
};

/** 3.24：上游最近一次失败的类别（Upstream.lastError）→ 大白话。 */
export const UPSTREAM_ERROR_LABELS: Record<string, string> = {
  invalid_key: '密钥无效',
  insufficient_balance: '余额不足',
  quota_exhausted: '余额不足',
  network_error: '网络不通或超时',
  provider_error: '服务商返回错误',
  rate_limited: '被限流',
  timeout: '超时',
};

export type UpstreamState = 'normal' | 'abnormal' | 'disabled' | 'pending';

export function upstreamState(u: Upstream): UpstreamState {
  if (u.enabled === false) return 'disabled';
  if (u.maskedKey === '未配置') return 'pending';
  if (u.status !== 'active') return 'abnormal';
  if (u.cooldownUntil && new Date(u.cooldownUntil).getTime() > Date.now()) return 'abnormal';
  return 'normal';
}

export const UPSTREAM_STATE_LABELS: Record<UpstreamState, string> = {
  normal: '正常',
  abnormal: '异常',
  disabled: '已停用',
  pending: '待配置',
};

/** 3.24：上游协议（契约 UpstreamKind）。 */
export const KIND_LABELS: Record<string, string> = {
  openai_compatible: 'OpenAI 兼容',
  anthropic: 'Anthropic（Claude 原生）',
  dashscope: '阿里云百炼原生',
  bocha_search: '博查搜索',
  deepseek_search: 'DeepSeek 搜索',
  jev: 'Jev',
};

/** 3.24：账号异常的具体原因（列表、详情、测试结果都用它），正常时为 null。 */
export function upstreamReason(u: Upstream): string | null {
  const last = u.lastError ? (UPSTREAM_ERROR_LABELS[u.lastError] ?? u.lastError) : null;
  if (u.enabled === false) return '已停用，不分配调用';
  if (u.maskedKey === '未配置') return '尚未填写密钥，请编辑后配置密钥';
  if (u.status === 'invalid') return '密钥无效：请更换密钥后测试';
  if (u.status === 'quota_exhausted') return '余额不足：去服务商处充值后测试';
  if (u.status === 'unavailable')
    return `连接异常，已被健康检查暂停${last ? `（最近：${last}）` : ''}；每分钟自动探测，连通后恢复`;
  if (u.cooldownUntil && new Date(u.cooldownUntil).getTime() > Date.now()) {
    const until = new Date(new Date(u.cooldownUntil).getTime() + 8 * 3_600_000)
      .toISOString()
      .slice(11, 16);
    return `连续失败 ${u.consecutiveFailures ?? 0} 次，暂停到 ${until}${last ? `（最近：${last}）` : ''}`;
  }
  return null;
}

/** 北京时间今天 0 点，往前 offsetDays 天。 */
export function beijingMidnight(offsetDays = 0): Date {
  const now = new Date();
  const bj = new Date(now.getTime() + 8 * 3_600_000);
  const day = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), bj.getUTCDate()) - 8 * 3_600_000;
  return new Date(day - offsetDays * 86_400_000);
}

export type RangeKey = 'today' | '7d' | '30d' | 'month';

export function rangeOf(key: RangeKey): { from: string; to: string } {
  const to = new Date();
  if (key === 'today') return { from: beijingMidnight(0).toISOString(), to: to.toISOString() };
  if (key === '7d') return { from: beijingMidnight(6).toISOString(), to: to.toISOString() };
  if (key === '30d') return { from: beijingMidnight(29).toISOString(), to: to.toISOString() };
  const bj = new Date(to.getTime() + 8 * 3_600_000);
  const first = Date.UTC(bj.getUTCFullYear(), bj.getUTCMonth(), 1) - 8 * 3_600_000;
  return { from: new Date(first).toISOString(), to: to.toISOString() };
}

export function toLocalInput(iso: string): string {
  return new Date(new Date(iso).getTime() + 8 * 3_600_000).toISOString().slice(0, 16);
}

export function fromLocalInput(value: string): string {
  return new Date(`${value}:00+08:00`).toISOString();
}

type ServiceRate = NonNullable<AdminModel['serviceRates']>[number];
export type EditableServiceRate = Omit<ServiceRate, 'unit'> & {
  unit: Exclude<ServiceRate['unit'], 'unsupported'>;
};

/**
 * 4.6：编辑表单里能回写的服务单价。服务器比这个页面新、出现页面还不认识的计价单位时（契约容错读成 'unsupported'），
 * 这些项不进表单、也不回写（服务单价「只替换传入单位」，不传 = 服务器上原样保留）。
 */
export function editableServiceRates(rates: AdminModel['serviceRates']): EditableServiceRate[] {
  return (rates ?? []).filter((r): r is EditableServiceRate => r.unit !== 'unsupported');
}

/** 已有模型 → upsertModel 请求体（原样回写，只改调用方覆盖的字段）。 */
export function toWrite(m: AdminModel) {
  return {
    modelKey: m.modelKey,
    displayName: m.displayName,
    vendorName: m.vendorName,
    upstreamId: m.upstreamId,
    upstreamModelId: m.upstreamModelId,
    capabilities: m.capabilities,
    tags: m.tags,
    leaderboardRank: m.leaderboardRank,
    ...(m.arenaModelName !== undefined ? { arenaModelName: m.arenaModelName } : {}),
    sortOrder: m.sortOrder,
    defaultFor: m.defaultFor,
    ...(m.scenarios ? { scenarios: m.scenarios } : {}),
    enabled: m.enabled,
    billingBounds: m.billingBounds ?? null,
    rates: m.rates,
    costRates: m.costRates,
    ...(m.routes?.length ? { routes: m.routes } : {}),
  };
}

/** 3.23：平台内部模型用途（删除模型确认框里列出受影响的用途）。 */
export const INTERNAL_USE_LABELS: Record<string, string> = {
  safety: '安全检查',
  small_v: '小V 答疑',
  platform_content: '平台内容生成',
  planner: '行为规划',
  adult_check: '成人内容检查',
  web_search: '联网搜索',
};

/**
 * 3.27：软删除行的键 / 显示名可能带 `#deleted:<随机>` 后缀（0117 删除时改写 model_key；
 * 历史数据里显示名也可能带着它）。展示名去掉后缀，模型键照原样显示（副行保留完整键供核对）。
 */
export function stripDeletedSuffix(value: string): string {
  return value.replace(/#deleted:[0-9A-Za-z-]+$/, '').trim();
}

/** 3.27：列表里显示的模型名（去掉 `#deleted:` 后缀；去掉后为空时退回原文）。 */
export function modelDisplayName(m: Pick<AdminModel, 'displayName'>): string {
  return stripDeletedSuffix(m.displayName) || m.displayName;
}

/**
 * 3.23：按模型键找显示名。已删除的模型（deletedAt 非空）只给历史记录显示名字，加「（已删除）」；
 * 同键重新添加过时优先用现存的那个。找不到时原样显示键。
 */
export function modelLabel(models: readonly AdminModel[], key: string): string {
  const live = models.find((m) => m.modelKey === key && !m.deletedAt);
  if (live) return modelDisplayName(live);
  const gone = models.find((m) => m.modelKey === key);
  return gone ? `${modelDisplayName(gone)}（已删除）` : key;
}
