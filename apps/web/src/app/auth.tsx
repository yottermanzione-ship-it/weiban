import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { pausePush } from '../notifications/client.js';
import { api, localStore } from '../data/client.js';
interface AuthState {
  session: AuthResponse | null;
  loading: boolean;
  onboarding: boolean;
  finishOnboarding(): Promise<boolean>;
  accept(auth: AuthResponse): Promise<void>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
/** U8：启动时等服务器确认登录状态的上限（本机已有会话时）；超过就先用本机会话进入。 */
const ME_WAIT_MS = 3500;
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [onboarding, setOnboarding] = useState(false);
  const latest = useRef<AuthResponse | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .restore()
      .then(async (auth) => {
        // StrictMode 会清理后重跑 effect；旧恢复链不能再刷新或恢复会话。
        if (!active) return;
        if (auth) {
          const cached = auth;
          const owner = { userId: cached.user.userId, sessionId: cached.session.sessionId };
          const fresh = api.call(IdentityEndpoints.me).then((user) => api.updateUser(user));
          // U8：本机已有会话时最多等 ME_WAIT_MS。弱网先用本机会话进入（启动页不再等满 20 秒超时），
          // 资料晚到再更新；会话失效（401）时 api-client 照常清库并发 weiban:unauthenticated 退出。
          const settled = await Promise.race([
            fresh.then(
              (value) => ({ value }),
              () => ({ failed: true as const }),
            ),
            new Promise<null>((resolve) => window.setTimeout(() => resolve(null), ME_WAIT_MS)),
          ]);
          if (!active) return;
          if (settled === null) {
            void fresh
              .then((updated) => {
                if (!active || latest.current !== cached || !api.owns(owner)) return;
                latest.current = updated;
                setSession(updated);
              })
              .catch(() => {});
          } else if ('value' in settled) {
            auth = settled.value;
          } else {
            // 失效请求已经清库，不能在其回调后又恢复旧会话。
            auth = await api.restore();
            if (!active) return;
          }
        }
        if (!active) return;
        const pending =
          auth && (!auth.user.profileCompleted || (await localStore.get('ui:onboarding')) === true);
        if (!active) return;
        if (auth && !api.owns({ userId: auth.user.userId, sessionId: auth.session.sessionId }))
          auth = null;
        if (active) {
          latest.current = auth;
          setOnboarding(!!auth && !!pending);
          setSession(auth);
        }
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const expired = () => {
      const auth = latest.current;
      latest.current = null;
      if (auth)
        void pausePush({ userId: auth.user.userId, sessionId: auth.session.sessionId }).catch(
          () => {},
        );
      setSession(null);
    };
    window.addEventListener('weiban:unauthenticated', expired);
    return () => {
      active = false;
      window.removeEventListener('weiban:unauthenticated', expired);
    };
  }, []);
  const userId = session?.user.userId;
  const sessionId = session?.session.sessionId;
  const finishOnboarding = useCallback(async () => {
    if (!userId || !sessionId) return false;
    const owner = { userId, sessionId };
    if (
      !api.owns(owner) ||
      !(await localStore.setOwnedValues(owner, {
        'ui:onboarding': false,
        'ui:onboardingDraft': null,
      })) ||
      !api.owns(owner)
    )
      return false;
    setOnboarding(false);
    return true;
  }, [userId, sessionId]);
  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        onboarding,
        finishOnboarding,
        accept: async (auth) => {
          const previous = latest.current;
          if (previous)
            await pausePush({
              userId: previous.user.userId,
              sessionId: previous.session.sessionId,
            }).catch(() => {});
          await api.authenticate(auth);
          await localStore.setOwned(
            { userId: auth.user.userId, sessionId: auth.session.sessionId },
            'ui:onboarding',
            !auth.user.profileCompleted,
          );
          setOnboarding(!auth.user.profileCompleted);
          latest.current = auth;
          setSession(auth);
        },
        refreshUser: async () => {
          const auth = await api.updateUser(await api.call(IdentityEndpoints.me));
          latest.current = auth;
          setSession(auth);
        },
        logout: async () => {
          const captured = latest.current;
          const paused = captured
            ? pausePush({
                userId: captured.user.userId,
                sessionId: captured.session.sessionId,
              }).catch(() => {})
            : Promise.resolve();
          // 在清令牌之前发起服务器撤销；迟到响应不能再修改本机或后来登录的会话。
          const revoked = api.call(IdentityEndpoints.logout).catch(() => {});
          await api.forget();
          latest.current = null;
          setSession(null);
          await paused;
          await revoked;
        },
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}
export function useAuth() {
  const value = useContext(AuthContext);
  if (!value) throw new Error('AuthProvider missing');
  return value;
}
