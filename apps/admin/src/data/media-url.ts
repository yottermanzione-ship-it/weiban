/** 管理后台与用户媒体入口可分域；同一API代理保留签名令牌，避免跨域图片被CSP拦截。 */
export function adminMediaUrl(value: string): string {
  const url = new URL(value);
  if (
    ['http:', 'https:'].includes(url.protocol) &&
    /^\/api\/v1\/media\/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\/content$/i.test(
      url.pathname,
    )
  )
    return `${url.pathname}${url.search}`;
  return value;
}
