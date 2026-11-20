import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import {
  ClientLogAdminEndpoints,
  IdentityAdminEndpoints,
  PlazaAdminEndpoints,
  PushAdminEndpoints,
  RoleRequestAdminEndpoints,
  SupportAdminEndpoints,
  type ClientLogIssue,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { settle } from '../data/use-async.js';

export interface TodoCounts {
  roleRequests?: number;
  support?: number;
  reports?: number;
  deletions?: number;
  alerts?: number;
  clientIssues?: number;
}

interface TodoState {
  counts: TodoCounts;
  clientIssues?: ClientLogIssue[];
  clientIssuesHasMore: boolean;
  syncedAt?: Date;
  loading: boolean;
  partial: boolean;
  refresh: () => void;
}

const INITIAL = { counts: {}, clientIssuesHasMore: false, loading: true, partial: false };
const TodoContext = createContext<TodoState>({ ...INITIAL, refresh: () => {} });

/** 导航、提醒菜单和驾驶舱共用一份数据。异常列表只取最新一页。 */
export function TodoProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<Omit<TodoState, 'refresh'>>(INITIAL);
  const [revision, setRevision] = useState(0);
  const refresh = useCallback(() => setRevision((value) => value + 1), []);

  useEffect(() => {
    let active = true;
    void (async () => {
      const [requests, support, reports, deletions, alerts, issues] = await Promise.all([
        settle(
          api.call(RoleRequestAdminEndpoints.list, { query: { status: 'pending', limit: 1 } }),
        ),
        settle(api.call(SupportAdminEndpoints.list, { query: { status: 'open', limit: 1 } })),
        settle(api.call(PlazaAdminEndpoints.pendingReportCount)),
        settle(api.call(IdentityAdminEndpoints.pendingDeletionCount)),
        settle(
          api.call(PushAdminEndpoints.listAdminAlerts, {
            query: { status: 'open', view: 'actionable', limit: 1 },
          }),
        ),
        settle(api.call(ClientLogAdminEndpoints.list, { query: { status: 'open', limit: 30 } })),
      ]);
      if (!active) return;
      const partial = [requests, support, reports, deletions, alerts, issues].some(
        (value) => value === undefined,
      );
      setState((previous) => ({
        counts: {
          roleRequests: requests?.pendingCount,
          support: support?.openCount,
          reports: reports?.total,
          deletions: deletions?.total,
          alerts: alerts?.openCount,
          clientIssues: issues?.items.length,
        },
        clientIssues: issues?.items,
        clientIssuesHasMore: Boolean(issues?.nextCursor),
        loading: false,
        partial,
        syncedAt: partial ? previous.syncedAt : new Date(),
      }));
    })();
    return () => {
      active = false;
    };
  }, [revision]);

  useEffect(() => {
    const timer = window.setInterval(refresh, 60_000);
    const events = [
      'weiban-admin:alerts-changed',
      'weiban-admin:role-requests-changed',
      'weiban-admin:client-issues-changed',
    ];
    events.forEach((event) => window.addEventListener(event, refresh));
    return () => {
      window.clearInterval(timer);
      events.forEach((event) => window.removeEventListener(event, refresh));
    };
  }, [refresh]);

  const value = useMemo(() => ({ ...state, refresh }), [state, refresh]);
  return <TodoContext.Provider value={value}>{children}</TodoContext.Provider>;
}

export function useTodos() {
  return useContext(TodoContext);
}
