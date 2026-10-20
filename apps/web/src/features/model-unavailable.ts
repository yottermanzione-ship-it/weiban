/**
 * 3.24（试用反馈第二轮 F2 第 5 条）：模型「暂时无法使用」的具体原因（用户端口径，契约 ModelUnavailableDetail）。
 * 用户看不到上游是谁，这里只说清是平台哪一环的问题、会不会自动恢复。
 */
const TEXT: Record<string, string> = {
  model_removed: '已下架',
  no_route: '平台还没开通线路',
  upstream_disabled: '平台暂停了这条线路',
  upstream_invalid_key: '平台的服务密钥失效，管理员处理中',
  upstream_quota_exhausted: '平台在服务商的余额不足，管理员处理中',
  upstream_unavailable: '服务连接异常，已自动暂停，恢复后即可使用',
  upstream_cooldown: '服务连续出错，暂停几分钟后自动重试',
  billing_bounds_missing: '平台还没配置好计费上限',
  billing_bounds_paused: '用量核对未通过，平台已暂停，等待处理',
  price_missing: '平台还没给它定价',
  output_limit_too_small: '平台设置的回复长度上限太小',
};

/** 具体原因的一句话；不认识 / 没有原因时返回通用说法。 */
export function unavailableText(detail: string | null | undefined): string {
  return (detail && TEXT[detail]) || '暂时无法使用';
}
