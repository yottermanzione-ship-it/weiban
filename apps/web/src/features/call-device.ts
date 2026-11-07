/** Optional native device controls. Business requests still use the shared web API. */
type Route = 'speaker' | 'earpiece' | 'headset' | 'system';
export interface CallDeviceState {
  accepted: boolean;
  route: Route;
  canSwitch: boolean;
}
interface Bridge {
  postMessage(message: string): void;
  onmessage: ((event: { data: string }) => void) | null;
}
const pending = new Map<string, { finish(state: CallDeviceState | null): void }>();
let attached: Bridge | undefined;
function bridge(): Bridge | undefined {
  return (window as typeof window & { weibanDevice?: Bridge }).weibanDevice;
}
export function hasCallDevice(): boolean {
  return !!bridge();
}
export function callDevice(
  type: 'begin-call' | 'end-call' | 'speaker' | 'status' | 'theme',
  data: {
    callId?: string;
    enabled?: boolean;
    dark?: boolean;
    surface?: 'page' | 'white' | 'call';
  } = {},
): Promise<CallDeviceState | null> {
  const native = bridge();
  if (!native) return Promise.resolve(null);
  if (attached !== native) {
    attached = native;
    native.onmessage = (event) => {
      try {
        const value = JSON.parse(event.data) as Record<string, unknown>;
        if (
          typeof value.id !== 'string' ||
          typeof value.accepted !== 'boolean' ||
          typeof value.canSwitch !== 'boolean' ||
          !['speaker', 'earpiece', 'headset', 'system'].includes(String(value.route))
        )
          return;
        pending.get(value.id)?.finish({
          accepted: value.accepted,
          canSwitch: value.canSwitch,
          route: value.route as Route,
        });
      } catch {
        /* Ignore malformed native replies; the bounded request times out. */
      }
    };
  }
  return new Promise((resolve) => {
    const id = crypto.randomUUID();
    const finish = (state: CallDeviceState | null) => {
      clearTimeout(timer);
      pending.delete(id);
      resolve(state);
    };
    const timer = window.setTimeout(() => finish(null), 2000);
    pending.set(id, { finish });
    try {
      native.postMessage(JSON.stringify({ id, type, ...data }));
    } catch {
      finish(null);
    }
  });
}
