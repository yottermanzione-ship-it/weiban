/**
 * 儿童特征检测规则层（SAFE-03 第 4 条，character-card-spec.md 3.3）。
 * 仅做规则层（零费用）检测；模型层检测由 AI 负责人在 ai-runtime 模块实现。
 * 命中任意规则 → childFeaturesDetected = true。
 */

/** 年龄关键词列表（精确词表，命中即判定为儿童特征）。 */
const AGE_KEYWORDS = [
  '幼儿园',
  '小学生',
  '初中生',
  '高中生',
  '萝莉',
  '正太',
  '未成年',
  '在读初中',
  '在读小学',
  '在读高中',
  '奶声奶气',
  '肉嘟嘟',
  '小学六年级',
  '小学五年级',
  '小学四年级',
  '小学三年级',
  '小学二年级',
  '小学一年级',
];

/**
 * 匹配明确小于 18 的年龄数字，例：8岁、十二岁、3岁、17岁。
 * 支持阿拉伯数字和部分中文数字（一至十七）。
 */
const AGE_NUMBER_PATTERN =
  /(?:^|[^0-9a-z])([1-9]|1[0-7])\s*岁(?:[^数]|$)|十[一二三四五六七]岁|[一二三四五六七八九]\s*岁/u;

/**
 * 规则层儿童特征检测。
 * @param texts 人设相关文本（描述、口头禅、示例对话等）的拼接或数组
 * @returns true 表示命中至少一条规则
 */
export function childFeaturesIn(texts: string | string[]): boolean {
  const combined = typeof texts === 'string' ? texts : texts.join('\n');
  for (const keyword of AGE_KEYWORDS) {
    if (combined.includes(keyword)) return true;
  }
  return AGE_NUMBER_PATTERN.test(combined);
}
