/**
 * 旧版 Android WebView 兼容补丁（2026-11-11）。
 *
 * ColorOS / Android 11 自带或长期未更新的 WebView 可能停在 Chromium 83～92，缺失下面这些新 API：
 * - `Array.prototype.at` / `String.prototype.replaceAll`（Chromium 85 / 92）
 * - `Object.hasOwn`（93）
 * - `structuredClone`（98）
 * 缺了以后整页脚本会在启动或某个页面直接抛错；而错误上报模块本身也用了 structuredClone，
 * 结果连真实错误都存不下来。必须在任何其它模块之前引入。
 */

function define(target: object, key: string, value: unknown): void {
  if (!(key in target))
    Object.defineProperty(target, key, { value, writable: true, configurable: true });
}

define(Array.prototype, 'at', function at(this: unknown[], index: number) {
  const length = this.length >>> 0;
  let k = Math.trunc(index) || 0;
  if (k < 0) k += length;
  return k < 0 || k >= length ? undefined : this[k];
});

define(String.prototype, 'at', function at(this: string, index: number) {
  const chars = Array.from(this);
  let k = Math.trunc(index) || 0;
  if (k < 0) k += chars.length;
  return k < 0 || k >= chars.length ? undefined : chars[k];
});

define(String.prototype, 'replaceAll', function replaceAll(
  this: string,
  search: string | RegExp,
  replacement: string,
) {
  if (search instanceof RegExp) {
    const flags = search.flags.includes('g') ? search.flags : `${search.flags}g`;
    return this.replace(new RegExp(search.source, flags), replacement);
  }
  return this.split(search).join(replacement);
});

define(Object, 'hasOwn', (object: object, key: PropertyKey) =>
  Object.prototype.hasOwnProperty.call(object, key),
);

// 本项目只在日志、缓存和同步状态里传可 JSON 化的普通对象，JSON 克隆足够；undefined 保持 undefined。
define(globalThis, 'structuredClone', <T>(value: T): T =>
  value === undefined ? value : (JSON.parse(JSON.stringify(value)) as T),
);
