import { Component, type ReactNode, type ErrorInfo } from 'react';
import { runtimeLogs } from '../data/runtime-logs.js';
import { finishBoot } from './boot-splash.js';
export class RuntimeErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    runtimeLogs.captureRender(error, info.componentStack);
    // U8：启动期间出错时立刻撤掉启动层，否则错误提示被盖住、看起来卡在启动页。
    finishBoot(true);
  }
  override render() {
    return this.state.failed ? (
      <main className="empty" role="alert">
        <p>页面暂时打不开，请重新加载。</p>
        <button type="button" onClick={() => location.reload()}>
          重新加载
        </button>
      </main>
    ) : (
      this.props.children
    );
  }
}
