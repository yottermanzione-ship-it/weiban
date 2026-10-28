import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { TimelineEndpoints, type TimelineMood } from '@weiban/contracts';
import { getCharacterStatusVisible } from '../data/display-prefs.js';
import { useRemote } from '../data/use-remote.js';
const moods: Record<TimelineMood, [string, string]> = {
  happy: ['😊', '开心'],
  neutral: ['🙂', '平静'],
  tired: ['😴', '有点累'],
  annoyed: ['😤', '有点烦'],
  excited: ['🤩', '兴奋'],
  sad: ['🥺', '难过'],
  anxious: ['🥺', '有点不安'],
};
let measurer: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null | undefined;
/**
 * 表情墨迹中线与昵称墨迹中线的竖直差（px）。昵称用自带 MiSans，表情用机型自己的系统表情字体，
 * 各家度量与图形位置不同，CSS 固定偏移只能对准一种机型（U7 的 1.05em 即如此），所以在本机实测。
 * 两者都是 flex 居中的盒子：墨迹中线相对盒中线 = (字体上沿 - 字体下沿 - 墨迹上沿 + 墨迹下沿) / 2。
 */
function inkShift(emoji: HTMLElement): number {
  const name = emoji.parentElement?.firstElementChild;
  if (!(name instanceof HTMLElement) || name === emoji) return 0;
  if (measurer === undefined)
    measurer =
      typeof OffscreenCanvas === 'undefined' ? null : new OffscreenCanvas(1, 1).getContext('2d');
  const ctx = measurer;
  if (!ctx) return 0;
  const offset = (element: HTMLElement, sample: string) => {
    const style = getComputedStyle(element);
    ctx.font = `${style.fontStyle} ${style.fontWeight} ${style.fontSize} ${style.fontFamily}`;
    const m = ctx.measureText(sample);
    return (
      (m.fontBoundingBoxAscent -
        m.fontBoundingBoxDescent -
        m.actualBoundingBoxAscent +
        m.actualBoundingBoxDescent) /
      2
    );
  };
  const shift =
    offset(name, name.textContent?.trim() || '国') - offset(emoji, emoji.textContent ?? '');
  const ratio = window.devicePixelRatio || 1;
  return Number.isFinite(shift) ? Math.round(shift * ratio) / ratio : 0;
}
export function CharacterStatus({
  characterId,
  enabled,
}: {
  characterId: string;
  enabled: boolean;
}) {
  const [visible, setVisible] = useState(getCharacterStatusVisible);
  const [, setNow] = useState(() => new Date());
  useEffect(() => {
    const refresh = () => {
      setVisible(getCharacterStatusVisible());
      setNow(new Date());
    };
    window.addEventListener('weiban:display-prefs', refresh);
    window.addEventListener('storage', refresh);
    window.addEventListener('focus', refresh);
    const timer = window.setInterval(refresh, 60_000);
    return () => {
      window.removeEventListener('weiban:display-prefs', refresh);
      window.removeEventListener('storage', refresh);
      window.removeEventListener('focus', refresh);
      window.clearInterval(timer);
    };
  }, []);
  const status = useRemote(
    TimelineEndpoints.getStatus,
    { params: { characterId }, networkOnly: true },
    enabled && visible,
  );
  const updated = status.data?.updatedAt ? new Date(status.data.updatedAt) : null;
  const mood = status.data?.mood;
  const now = new Date();
  const ref = useRef<HTMLSpanElement>(null);
  const shown =
    enabled &&
    visible &&
    mood &&
    updated &&
    updated.toDateString() === now.toDateString() &&
    updated <= now
      ? moods[mood][0]
      : null;
  useLayoutEffect(() => {
    const element = ref.current;
    if (!element) return;
    let live = true;
    const align = () => {
      if (live) element.style.transform = `translateY(${inkShift(element)}px)`;
    };
    align();
    // MiSans 是 swap 加载的网页字体：加载完昵称换字体后再量一次。
    void document.fonts?.ready.then(align);
    return () => {
      live = false;
    };
  }, [shown]);
  if (!shown || !mood || !updated) return null;
  const [emoji, label] = moods[mood];
  return (
    <span
      ref={ref}
      className="character-status"
      role="img"
      aria-label={`状态：${label}`}
      title={`${label} · ${updated.toLocaleTimeString('zh-CN', { hour: '2-digit', minute: '2-digit' })}`}
    >
      {emoji}
    </span>
  );
}
