import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { IdentityEndpoints, type AuthResponse } from '@weiban/contracts';
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
        if (active) setSession(auth);
      })
      .catch(() => {
        if (active) setSession(null);
      })
      .finally(() => {
        if (active) setLoading(false);
      });
    const expired = () => setSession(null);
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
          await api.authenticate(auth);
          setSession(auth);
        },
        refreshUser: async () => {
          setSession(await api.updateUser(await api.call(IdentityEndpoints.me)));
        },
        logout: async () => {
          try {
            await api.call(IdentityEndpoints.logout);
          } finally {
            await api.forget();
            setSession(null);
          }
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
