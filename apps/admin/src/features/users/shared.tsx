/**
 * 用户板块（10-20 批 E2）公共部分：账号 + 钱包合并、档位名、价格格式、订阅记录合并。
 */
import { useMemo } from 'react';
import type { z } from 'zod';
import {
  AdminAccountSummary,
  AdminUsersEndpoints,
  BillingAdminEndpoints,
  type AdminUserSummary,
  type MembershipChange,
  type MembershipOrder,
} from '@weiban/contracts';
import { useRemote } from '../../data/hooks.js';
import { StatusTag } from '../../ui/page.js';

export type Account = z.infer<typeof AdminAccountSummary>;

export type UserRow = {
  userId: string;
  user: AdminUserSummary;
  account?: Account;
};

export const PLAN_NAME: Record<string, string> = { month: '月卡', quarter: '季卡', year: '年卡' };

/** 分 → 「¥12.9」。 */
export function yuanFen(fen: number): string {
  const v = fen / 100;
  return `¥${Number.isInteger(v) ? v : v.toFixed(2).replace(/0$/, '')}`;
}

export const DAY_MS = 86_400_000;

export function daysLeft(expiresAt: string | null | undefined): number | null {
  if (!expiresAt) return null;
  const ms = new Date(expiresAt).getTime() - Date.now();
  return ms > 0 ? Math.ceil(ms / DAY_MS) : null;
}

/** 列表里显示的名字：昵称（登录名）。 */
export function displayName(user: Pick<AdminUserSummary, 'username' | 'nickname'> | undefined): string {
  if (!user) return '已注销账号';
  if (user.nickname && user.nickname !== user.username) return `${user.nickname}（${user.username}）`;
  return user.username || '已注销账号';
}

/** 账号列表 + 钱包列表，按 userId 合并（钱包在 billing，资料 / 会员 / 封禁在 identity）。 */
export function useUserRows() {
  const users = useRemote(AdminUsersEndpoints.listUsers);
  const accounts = useRemote(BillingAdminEndpoints.listAccounts);
  const rows = useMemo<UserRow[]>(() => {
    const wallets = new Map((accounts.data?.items ?? []).map((a) => [a.userId, a]));
    return (users.data?.items ?? []).map((user) => ({
      userId: user.userId,
      user,
      account: wallets.get(user.userId),
    }));
  }, [users.data, accounts.data]);
  const byId = useMemo(() => new Map(rows.map((r) => [r.userId, r])), [rows]);
  return {
    rows,
    byId,
    loading: users.loading || accounts.loading,
    error: users.error || accounts.error,
    refresh: () => {
      users.refresh();
      accounts.refresh();
    },
  };
}

export function MembershipTag({ user }: { user: AdminUserSummary }) {
  if (user.membership.tier !== 'pro_plus') return <StatusTag>免费</StatusTag>;
  const left = daysLeft(user.membership.expiresAt);
  return (
    <StatusTag tone={left !== null && left <= 7 ? 'warning' : 'success'}>
      PRO+{left !== null && left <= 7 ? ` · ${left} 天后到期` : ''}
    </StatusTag>
  );
}

export function AccountStateTag({ user }: { user: AdminUserSummary }) {
  if (user.status === 'deleting') return <StatusTag tone="default">注销中</StatusTag>;
  if (user.ban) return <StatusTag tone="error">已封禁</StatusTag>;
  return <StatusTag tone="success">正常</StatusTag>;
}

// ---------- 会员订阅记录：订单（开通 / 续期）+ 手动调整（改到期 / 取消）合并 ----------

export type SubKind = 'open' | 'renew' | 'adjust' | 'cancel';

export const SUB_KIND_NAME: Record<SubKind, string> = {
  open: '开通',
  renew: '续期',
  adjust: '调整到期日',
  cancel: '取消会员',
};

export type SubRecord = {
  key: string;
  kind: SubKind;
  userId: string;
  createdAt: string;
  operatorUserId: string | null;
  order?: MembershipOrder;
  change?: MembershipChange;
};

export function mergeSubRecords(orders: MembershipOrder[], changes: MembershipChange[]): SubRecord[] {
  const list: SubRecord[] = [
    ...orders.map((order) => ({
      key: `o:${order.orderId}`,
      kind: (order.renewal ? 'renew' : 'open') as SubKind,
      userId: order.userId,
      createdAt: order.createdAt,
      operatorUserId: order.operatorUserId,
      order,
    })),
    ...changes.map((change) => ({
      key: `c:${change.changeId}`,
      kind: (change.expiresAt ? 'adjust' : 'cancel') as SubKind,
      userId: change.userId,
      createdAt: change.createdAt,
      operatorUserId: change.operatorUserId,
      change,
    })),
  ];
  return list.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
}

export function SubKindTag({ kind }: { kind: SubKind }) {
  const tone = kind === 'open' ? 'success' : kind === 'renew' ? 'processing' : kind === 'cancel' ? 'error' : 'warning';
  return <StatusTag tone={tone}>{SUB_KIND_NAME[kind]}</StatusTag>;
}
