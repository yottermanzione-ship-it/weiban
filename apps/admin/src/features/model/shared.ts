import type { Upstream } from '@weiban/contracts';

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

export const CAPABILITY_LABELS: Record<string, string> = {
  vision: '识图',
  voice_input: '语音输入',
  voice_output: '语音输出',
  web_search: '联网搜索',
  image_generation: '图片生成',
  adult_content: '成人内容',
};

export type UpstreamState = 'normal' | 'abnormal' | 'disabled';

export function upstreamState(u: Upstream): UpstreamState {
  if (u.enabled === false) return 'disabled';
  if (u.status !== 'active') return 'abnormal';
  if (u.cooldownUntil && new Date(u.cooldownUntil).getTime() > Date.now()) return 'abnormal';
  return 'normal';
}

export const UPSTREAM_STATE_LABELS: Record<UpstreamState, string> = {
  normal: '正常',
  abnormal: '异常',
  disabled: '已停用',
};

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
