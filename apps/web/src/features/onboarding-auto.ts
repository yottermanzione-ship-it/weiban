import { createContext, useContext, useEffect } from 'react';
import type { AutoFlow } from './guide-triggers.js';

/**
 * 新手引导自动弹出的请求入口（触发规则见 guide-triggers.ts，执行在 onboarding-guide.tsx 的 Provider）。
 * 单独成文件，聊天页、服务页、下拉面板引用它时不会和引导模块互相 import。
 */
export interface AutoGuideApi {
  /** 请求自动弹出；返回撤回函数。已看过、正在引导或新手流程中时 Provider 会忽略。 */
  request(flow: AutoFlow): () => void;
}

export const AutoGuideContext = createContext<AutoGuideApi | null>(null);

/**
 * 页面满足触发条件（enabled）时请求弹出对应引导；离开页面或条件不再满足时撤回还没弹出的请求。
 * 不在 Provider 里（测试夹具等）时什么也不做。
 */
export function useAutoGuide(flow: AutoFlow, enabled: boolean): void {
  const api = useContext(AutoGuideContext);
  useEffect(() => (api && enabled ? api.request(flow) : undefined), [api, flow, enabled]);
}
