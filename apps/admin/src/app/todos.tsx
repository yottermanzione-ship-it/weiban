import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import {
  IdentityAdminEndpoints,
  PlazaAdminEndpoints,
  PushAdminEndpoints,
  RoleRequestAdminEndpoints,
  SupportAdminEndpoints,
} from '@weiban/contracts';
import { api } from '../data/client.js';

export interface TodoCounts {
  roleRequests: number;
  support: number;
  reports: number;
  deletions: number;
  alerts: number;
}

const EMPTY: TodoCounts = { roleRequests: 0, support: 0, reports: 0, deletions: 0, alerts: 0 };

interface TodoState {
  counts: TodoCounts;
  loading: boolean;
  refresh: () => void;
}

const TodoContext = createContext<TodoState>({ counts: EMPTY, loading: true, refresh: () => {} });

async function safe<T>(work: Promise<T>): Promise<T | undefined> {
  try {
    return await work;
  } catch {
    return undefined;
  }
}

/** 菜单角标与工作台待办共用一份计数，每 60 秒自动刷新。 */
export function TodoProvider({ children }: { children: ReactNode }) {
  const [counts, setCounts] = useState<TodoCounts>(EMPTY);
  const [loading, setLoading] = useState(true);
  const [revision, setRevision] = useState(0);
  const alive = useRef(true);

  useEffect(() => {
    alive.current = true;
    return () => {
      alive.current = false;
    };
  }, []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [requests, support, reports, deletions, alerts] = await Promise.all([
        safe(api.call(RoleRequestAdminEndpoints.list, { query: { status: 'pending', limit: 1 } })),
        safe(api.call(SupportAdminEndpoints.list, { query: { status: 'open', limit: 1 } })),
        safe(api.call(PlazaAdminEndpoints.listReports, { query: { status: 'pending' } })),
        safe(api.call(IdentityAdminEndpoints.listPendingDeletions)),
        safe(api.call(PushAdminEndpoints.listAdminAlerts, { query: { status: 'open', limit: 1 } })),
      ]);
      if (!active || !alive.current) return;
      setCounts({
        roleRequests: requests?.pendingCount ?? 0,
        support: support?.openCount ?? 0,
        reports: reports?.items.length ?? 0,
        deletions: deletions?.items.length ?? 0,
        alerts: alerts?.openCount ?? 0,
      });
      setLoading(false);
    })();
    return () => {
      active = false;
    };
  }, [revision]);

  useEffect(() => {
    const timer = window.setInterval(() => setRevision((v) => v + 1), 60_000);
    return () => window.clearInterval(timer);
  }, []);

  const refresh = useCallback(() => setRevision((v) => v + 1), []);
  const value = useMemo(() => ({ counts, loading, refresh }), [counts, loading, refresh]);
  return <TodoContext.Provider value={value}>{children}</TodoContext.Provider>;
}

export function useTodos(): TodoState {
  return useContext(TodoContext);
}

export function totalTodos(counts: TodoCounts): number {
  return (
    counts.roleRequests + counts.support + counts.reports + counts.deletions + counts.alerts
  );
}
