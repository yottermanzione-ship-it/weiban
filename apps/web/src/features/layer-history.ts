/*
 * 页内浮层进浏览器历史（2026-10-27 批 U5，接 U2 遗留 4 / U3 写法）：
 * 页内二级页面（SubPageLayer / PushLayer）、全屏看图打开时往历史里压一条「同地址 + 层编号」的记录，
 * 安卓返回键 / 浏览器后退只关掉最上面这一层（等同「取消」），不会离开整页。
 * 用界面上的「取消 / 完成 / ×」关掉时，自己压的那条记录也一并退掉，历史里不留空步；
 * 同一拍里关掉好几层（例如地区分组选完连同上一层一起关）合并成一次后退。
 *
 * 已经自己用地址参数管理二级页的页面（自建角色 `?edit=`）用 LayerHistoryContext 传 false 关掉，免得压两次。
 */
import { createContext, useContext, useEffect, useRef } from 'react';
import { useLocation, useNavigate, type Location } from 'react-router-dom';

export const LayerHistoryContext = createContext(true);

let nextLayer = 0;
const layersOf = (state: unknown): number[] => {
  const layers = (state as { wbLayers?: unknown } | null)?.wbLayers;
  return Array.isArray(layers) ? (layers as number[]) : [];
};
/** react-router 把 location.state 存在 history.state.usr 里。 */
const historyLayers = () =>
  layersOf((window.history.state as { usr?: unknown } | null)?.usr ?? null);

/** 待退掉的层（界面按钮关掉的）；下一拍合并成一次 history.go(-n)。 */
const closing = new Set<number>();
let flushTimer = 0;
/** 正在后退时，新的压栈要等后退完成（history.go 是异步的，pushState 是同步的）。 */
let popping: Promise<void> | null = null;

function scheduleClose(id: number) {
  closing.add(id);
  if (flushTimer) return;
  flushTimer = window.setTimeout(() => {
    flushTimer = 0;
    const layers = historyLayers();
    let count = 0;
    for (let i = layers.length - 1; i >= 0 && closing.has(layers[i]!); i--) count++;
    closing.clear();
    // 已经跳去别的页面（历史顶上不是这些层）时不动。
    if (!count) return;
    popping = new Promise((resolve) => {
      const done = () => {
        window.removeEventListener('popstate', done);
        window.clearTimeout(fallback);
        popping = null;
        resolve();
      };
      const fallback = window.setTimeout(done, 600);
      window.addEventListener('popstate', done);
      window.history.go(-count);
    });
  }, 0);
}

/**
 * 浮层挂载期间占一条浏览器历史；用户按返回时调 onBack（通常就是浮层的「取消」）。
 * enabled 为 false（或外层 LayerHistoryContext 为 false）时什么都不做。
 */
export function useLayerHistory(onBack: () => void, enabled = true) {
  const on = useContext(LayerHistoryContext) && enabled;
  const navigate = useNavigate();
  const location = useLocation();
  const id = useRef(0);
  const confirmed = useRef(false);
  const latest = useRef({ onBack, navigate, location });
  useEffect(() => {
    latest.current = { onBack, navigate, location };
  });
  useEffect(() => {
    if (!on) return;
    let alive = true;
    const push = () => {
      if (!alive) return;
      const me = ++nextLayer;
      id.current = me;
      const here: Location = latest.current.location;
      const state = (here.state ?? null) as Record<string, unknown> | null;
      latest.current.navigate(
        { pathname: here.pathname, search: here.search, hash: here.hash },
        { state: { ...(state ?? {}), wbLayers: [...layersOf(state), me] } },
      );
    };
    /*
     * 推迟到下一拍再压历史：开发模式 StrictMode 会「挂载 → 卸载 → 再挂载」一次，
     * 同步压 + 退会和第二次压打架；推迟后第一次的计时器在卸载时就被取消了。
     */
    const timer = window.setTimeout(() => {
      if (popping) void popping.then(push);
      else push();
    }, 0);
    return () => {
      alive = false;
      window.clearTimeout(timer);
      const me = id.current;
      id.current = 0;
      confirmed.current = false;
      if (me) scheduleClose(me);
    };
  }, [on]);
  useEffect(() => {
    const me = id.current;
    if (!me) return;
    if (layersOf(location.state).includes(me)) confirmed.current = true;
    else if (confirmed.current) {
      // 用户按了返回：这一层的记录已经退掉，只需要关界面。
      confirmed.current = false;
      id.current = 0;
      latest.current.onBack();
    }
  }, [location]);
}
