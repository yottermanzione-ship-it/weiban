import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
import { pausePush } from '../notifications/client.js';
import { api } from '../data/client.js';
interface AuthState {
  session: AuthResponse | null;
  loading: boolean;
  accept(auth: AuthResponse): Promise<void>;
  logout(): Promise<void>;
  refreshUser(): Promise<void>;
}
const AuthContext = createContext<AuthState | null>(null);
export function AuthProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<AuthResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const latest = useRef<AuthResponse | null>(null);
  useEffect(() => {
    let active = true;
    void api
      .restore()
      .then(async (auth) => {
        if (auth) {
          try {
            auth = await api.updateUser(await api.call(IdentityEndpoints.me));
          } catch {
            // 失效请求已经清库，不能在其回调后又恢复旧会话。
            auth = await api.restore();
          }
        }
        if (active) {
          latest.current = auth;
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
  return (
    <AuthContext.Provider
      value={{
        session,
        loading,
        accept: async (auth) => {
          const previous = latest.current;
          if (previous)
            await pausePush({
              userId: previous.user.userId,
              sessionId: previous.session.sessionId,
            }).catch(() => {});
          await api.authenticate(auth);
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
