/*
 * U8 启动页控制（总经理 10-27：旧版微伴那样的绿色启动页 + 真实加载进度条，进首页前一次准备好）。
 *
 * 启动层本身写在 index.html（#boot-splash，样式 src/boot/boot.css），打开网址的第一帧就是绿的；
 * JS 到了以后这里接管进度条：从 CSS 自己走到的位置接着按真实进度往前走（只进不退），
 * 准备好后补到 100%、淡出、移除，并去掉 html[data-boot] 与 body 的 bgcolor，
 * 页面底色和状态栏颜色（theme-color）切回各页面自己的颜色。
 *
 * 最短停留沿用总经理 10-14 定的 1.3 秒（G1.1），但从打开网址算起（含下载脚本的时间），
 * 已缓存的再次启动不会因为预加载额外变慢。上限见 app/preload.ts。
 */
import { refreshThemeColor } from '../data/display-prefs.js';

/** 最短品牌停留（从打开网址算起）。 */
const MIN_MS = 1300;
/** 进度条补满到 100% 后再停一下才淡出，让最后一段动画走完。 */
const FULL_HOLD_MS = 180;
/** 与 boot.css 的 transition 一致。 */
const FADE_MS = 350;
/** JS 接管后无论如何最晚这时撤掉启动层。 */
const SAFETY_MS = 12_000;

let shown = 0;
let finishing = false;

function splash(): HTMLElement | null {
  return document.getElementById('boot-splash');
}

function render() {
  const root = splash();
  const fill = root?.querySelector<HTMLElement>('.boot-bar-fill');
  const text = root?.querySelector<HTMLElement>('.boot-bar-text');
  const percent = Math.round(shown * 100);
  if (fill) fill.style.width = `${(shown * 100).toFixed(1)}%`;
  if (text) text.textContent = `${percent}%`;
}

/** main.tsx 一开始调用：从 CSS 自己走到的位置接管进度条。 */
export function takeOverSplash(): void {
  const root = splash();
  if (!root) {
    document.documentElement.removeAttribute('data-boot');
    document.body.removeAttribute('bgcolor');
    return;
  }
  const fill = root.querySelector<HTMLElement>('.boot-bar-fill');
  const bar = root.querySelector<HTMLElement>('.boot-bar');
  if (fill && bar) {
    const total = bar.getBoundingClientRect().width;
    const current = total > 0 ? fill.getBoundingClientRect().width / total : 0;
    shown = Math.min(0.3, Math.max(0, current));
  }
  root.classList.add('boot-js');
  render();
  // 兜底：正常流程 8 秒内一定结束（app/preload.ts）；万一哪里卡住，也不能让人一直停在启动页。
  window.setTimeout(() => finishBoot(true), SAFETY_MS);
}

/** 真实进度（0~1）；只进不退，结束前最多到 99%。 */
export function setBootProgress(fraction: number): void {
  if (finishing) return;
  const next = Math.min(0.99, Math.max(shown, fraction));
  if (next - shown < 0.005) return;
  shown = next;
  render();
}

/** 准备好了（或到了上限）：补满、等够最短停留、淡出并移除启动层。 */
export function finishBoot(immediate = false): void {
  if (finishing) return;
  finishing = true;
  shown = 1;
  render();
  const wait = immediate ? 0 : Math.max(FULL_HOLD_MS, MIN_MS - performance.now());
  window.setTimeout(() => {
    const root = splash();
    document.documentElement.removeAttribute('data-boot');
    document.body.removeAttribute('bgcolor');
    refreshThemeColor();
    if (root) dismiss(root);
  }, wait);
}

/**
 * 淡出并移除启动层。淡出一开始（此时已不挡点击）就不再是「状态」区域：读屏不再播报，
 * 也不和页面里的提示（同为 role=status，如「头像已保存」）混在一起；淡出结束一定移除。
 */
function dismiss(root: HTMLElement) {
  root.removeAttribute('role');
  root.removeAttribute('aria-label');
  root.setAttribute('aria-hidden', 'true');
  root.inert = true;
  root.classList.add('boot-out');
  window.setTimeout(() => root.remove(), FADE_MS);
}
