import { Component, type ReactNode, type ErrorInfo } from 'react';
import { runtimeLogs } from '../data/runtime-logs.js';
export class RuntimeErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  override state = { failed: false };
  static getDerivedStateFromError() {
    return { failed: true };
  }
  override componentDidCatch(error: unknown, info: ErrorInfo) {
    runtimeLogs.captureRender(error, info.componentStack);
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
