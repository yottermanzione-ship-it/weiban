import { useEffect } from 'react';
/*
 * 每台设备自己的显示设置（深色模式、字体大小，PRD SVC-01：不跟账号同步），存本机。
 * 深色模式写 <html data-scheme>，字体大小写 --wb-font-scale（docs/design/tokens.css 头注）。
 */
export type Scheme = 'system' | 'light' | 'dark';
export const fontScales = [
  { value: 0.9, label: '小' },
  { value: 1, label: '标准' },
  { value: 1.1, label: '大' },
  { value: 1.2, label: '较大' },
  { value: 1.35, label: '特大' },
] as const;
const SCHEME_KEY = 'weiban:scheme';
const FONT_KEY = 'weiban:font-scale';
const STATUS_KEY = 'weiban:character-status';
const READ_KEY = 'weiban:read-receipt';
/** 私聊气泡下的「已读 / 已送达」（只对这台设备，默认显示）。 */
export function getReadReceiptVisible() {
  return read(READ_KEY) !== 'hidden';
}
export function setReadReceiptVisible(visible: boolean) {
  write(READ_KEY, visible ? 'shown' : 'hidden');
  window.dispatchEvent(new Event('weiban:display-prefs'));
}
export function getCharacterStatusVisible() {
  return read(STATUS_KEY) !== 'hidden';
}
export function setCharacterStatusVisible(visible: boolean) {
  write(STATUS_KEY, visible ? 'shown' : 'hidden');
  window.dispatchEvent(new Event('weiban:display-prefs'));
}
function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function write(key: string, value: string) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // 无痕模式等：只在本次打开时生效
  }
}
export function getScheme(): Scheme {
  const value = read(SCHEME_KEY);
  return value === 'light' || value === 'dark' ? value : 'system';
}
export function getFontScale(): number {
  const value = Number(read(FONT_KEY));
  return fontScales.some((s) => s.value === value) ? value : 1;
}
export function applyDisplayPrefs() {
  const root = document.documentElement;
  const scheme = getScheme();
  if (scheme === 'system') delete root.dataset.scheme;
  else root.dataset.scheme = scheme;
  root.style.setProperty('--wb-font-scale', String(getFontScale()));
  syncThemeColor(scheme);
}
/**
 * 页面底色：默认灰底（微信式列表页）；登录、注册这类整页白底的页面切成白色，
 * 让 iPhone 顶部安全区 / 状态栏和页面连成一片（U7，总经理 47 号截图）。离开白底页切回灰色。
 */
export type PageSurface = 'page' | 'white';
let surface: PageSurface = 'page';
export function setPageSurface(value: PageSurface) {
  surface = value;
  const root = document.documentElement;
  if (value === 'white') root.dataset.surface = 'white';
  else delete root.dataset.surface;
  syncThemeColor(getScheme());
}
/** 整页白底的页面调用：挂载时切白，离开时切回灰色。 */
export function useWhiteSurface() {
  useEffect(() => {
    setPageSurface('white');
    return () => setPageSurface('page');
  }, []);
}
/**
 * F1-9：浏览器状态栏 / 地址栏颜色（theme-color）跟随顶栏底色（令牌 --wb-color-bg-nav-bar：浅色 #EDEDED、深色 #202020）；
 * 白底页跟随卡片白（--wb-color-bg-surface：浅色 #FFFFFF、深色 #191919）。
 * index.html 按系统深浅各放一个；手动选了深色 / 浅色时两个都改成所选的颜色。
 */
function syncThemeColor(scheme: Scheme) {
  const white = surface === 'white';
  document.querySelectorAll('meta[name="theme-color"]').forEach((meta) => {
    const dark =
      scheme === 'dark' ||
      (scheme === 'system' && (meta.getAttribute('media') ?? '').includes('dark'));
    const light = white ? '#FFFFFF' : '#EDEDED';
    meta.setAttribute('content', dark ? (white ? '#191919' : '#202020') : light);
  });
}
export function setScheme(value: Scheme) {
  write(SCHEME_KEY, value);
  applyDisplayPrefs();
}
export function setFontScale(value: number) {
  write(FONT_KEY, String(value));
  applyDisplayPrefs();
}
