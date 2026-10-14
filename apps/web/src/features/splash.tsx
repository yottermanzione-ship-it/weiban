/*
 * 启动页（总经理 2026-10-14 G1.1）：沿用旧版灰底品牌，去掉进度条，至少停留 1.3 秒、
 * 同时等登录状态恢复完成，再淡出进入登录页或主页。只在整页打开时出现一次，站内切页不出现。
 * 动画只用 transform / opacity。
 */
import { useEffect, useState } from 'react';

/** 最短品牌停留时间；登录状态恢复更慢时继续等待。 */
const MIN_MS = 1300;
const FADE_MS = 250;

/** ready 为真且已停留够最短时间后，返回 'fading'，再过淡出时间返回 'done'。 */
export function useSplash(ready: boolean) {
  const [elapsed, setElapsed] = useState(false);
  const [phase, setPhase] = useState<'show' | 'fading' | 'done'>('show');
  useEffect(() => {
    const timer = window.setTimeout(() => setElapsed(true), MIN_MS);
    return () => window.clearTimeout(timer);
  }, []);
  useEffect(() => {
    if (ready && elapsed && phase === 'show') setPhase('fading');
  }, [ready, elapsed, phase]);
  useEffect(() => {
    if (phase !== 'fading') return;
    const timer = window.setTimeout(() => setPhase('done'), FADE_MS);
    return () => window.clearTimeout(timer);
  }, [phase]);
  return phase;
}

export function SplashScreen({ fading }: { fading: boolean }) {
  return (
    <div className={`splash ${fading ? 'fading' : ''}`} role="status" aria-label="正在打开微伴">
      <div className="splash-brand">
        <img src="/assets/old-ui/brand/icon.png" alt="" width={88} height={88} />
        <strong>微伴</strong>
      </div>
    </div>
  );
}
