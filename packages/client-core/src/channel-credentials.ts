/** 只在本机内存识别龙虾助手发放的凭据；不执行配置命令，不记录或发送粘贴原文。 */
export function parseWeiboCredentials(text: string): { appId: string; appSecret: string } | null {
  if (!text.trim() || text.length > 16384) return null;
  const values = (name: string): string[] => {
    const found = new Set<string>();
    const labels = name === 'appId' ? 'app[_\\s-]*(?:id|key)' : 'app[_\\s-]*secret';
    for (const match of text.matchAll(
      new RegExp(
        `(?:^|[\\s"'{\\[,;])${labels}["']?\\s*[:：=]\\s*['"\x60]?([A-Za-z0-9._-]{8,256})(?![A-Za-z0-9._-])`,
        'gi',
      ),
    )) {
      found.add(match[1]!);
    }
    for (const match of text.matchAll(
      new RegExp(`channels\\.weibo\\.${name}['"]?\\s+['"]([A-Za-z0-9._-]{8,256})['"]`, 'gi'),
    )) {
      found.add(match[1]!);
    }
    return [...found];
  };
  const ids = values('appId');
  const secrets = values('appSecret');
  if (ids.length === 1 && secrets.length === 1) return { appId: ids[0]!, appSecret: secrets[0]! };
  if (ids.length || secrets.length) return null;
  const pair = text
    .trim()
    .split(/[\s,;]+/)
    .map((v) => v.replace(/^['"`]+|['"`]+$/g, ''));
  return pair.length === 2 && pair.every((v) => /^[A-Za-z0-9._-]{8,256}$/.test(v))
    ? { appId: pair[0]!, appSecret: pair[1]! }
    : null;
}
