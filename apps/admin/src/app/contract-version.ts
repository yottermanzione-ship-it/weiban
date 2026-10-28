/**
 * V3（2026-10-28，任务卡第 4 项）：后台页面与服务器的契约版本对不上时提示刷新。
 *
 * 背景：后台是单页应用，打开着的标签页不会自动换成新版本；服务器升级契约（例 4.5 新增实时通话计价单位、4.6 新增
 * 音色复刻单位）后，旧页面按旧契约校验新数据，会把带新取值的模型整行判成「不符合契约」藏起来，或在发请求前拦下。
 * 服务器 GET /health 返回自己的 contractVersion（不需要登录）；不一致时在页面顶部提示刷新。
 */
import { CONTRACT_VERSION } from '@weiban/contracts';

/** /health 的返回 → 需要提示时的文字；版本一致、拿不到或格式不对时返回 null（不打扰）。 */
export function contractMismatchNotice(
  health: unknown,
  pageVersion: string = CONTRACT_VERSION,
): string | null {
  const server = (health as { contractVersion?: unknown } | null)?.contractVersion;
  if (typeof server !== 'string' || !/^\d+\.\d+$/.test(server) || server === pageVersion)
    return null;
  return `后台页面是旧版本（契约 ${pageVersion}），服务器已是 ${server}：请刷新页面（Ctrl + F5）后再操作，否则部分模型可能列不出来或无法上架。刷新后仍看到这条提示，说明后台页面没有随服务器一起更新，请联系技术负责人。`;
}
