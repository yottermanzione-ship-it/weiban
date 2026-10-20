/**
 * 用户列表（10-20 批 E2，参考旧版 UsersPage「搜用户 → 开会员」）：
 * 顶部总用户数、PRO+ 会员数、7 天内到期名单（可点）；搜索账号 / 昵称 / ID；点一行打开用户详情抽屉。
 */
import { useState } from 'react';
import { Alert, Button, Input, Segmented, Space } from 'antd';
import { AdminUsersEndpoints } from '@weiban/contracts';
import { useRemote } from '../../data/hooks.js';
import { HelpTip, Page } from '../../ui/page.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import { formatDate, formatPoints, formatYuan, relativeTime } from '../../ui/format.js';
import {
  AccountStateTag,
  MembershipTag,
  daysLeft,
  displayName,
  useUserRows,
  type UserRow,
} from './shared.js';
import { UserDetailDrawer } from './detail.js';

type Quick = 'all' | 'pro' | 'expiring' | 'banned';

export function UserListPage() {
  const users = useUserRows();
  const overview = useRemote(AdminUsersEndpoints.overview);
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<Quick>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<'profile' | 'membership'>('profile');

  function refreshAll() {
    users.refresh();
    overview.refresh();
  }

  function open(userId: string, tab: 'profile' | 'membership' = 'profile') {
    setOpenTab(tab);
    setOpenId(userId);
  }

  const q = query.trim().toLowerCase();
  const list = users.rows.filter(({ user }) => {
    if (quick === 'pro' && user.membership.tier !== 'pro_plus') return false;
    if (quick === 'expiring') {
      const left = daysLeft(user.membership.expiresAt);
      if (user.membership.tier !== 'pro_plus' || left === null || left > 7) return false;
    }
    if (quick === 'banned' && !user.ban) return false;
    if (!q) return true;
    return (
      user.userId.toLowerCase().includes(q) ||
      user.username.toLowerCase().includes(q) ||
      !!user.nickname?.toLowerCase().includes(q)
    );
  });

  const nameOf = (id: string | null) => {
    if (!id) return '系统';
    const row = users.byId.get(id);
    return row ? displayName(row.user) : `${id.slice(0, 8)}…`;
  };

  const columns: ProColumns<UserRow>[] = [
    {
      title: '用户',
      width: 240,
      render: (_, { user }) => (
        <div className="cell-main">
          <span className="cell-title">
            {user.nickname || user.username || '已注销账号'}
            {user.role === 'admin' && <span className="cell-sub"> · 管理员</span>}
          </span>
          <span className="cell-sub">
            {user.username} · <span className="mono">{user.userId.slice(0, 8)}</span>
          </span>
        </div>
      ),
    },
    {
      title: '会员',
      width: 200,
      render: (_, { user }) => (
        <div className="cell-main">
          <span>
            <MembershipTag user={user} />
          </span>
          {user.membership.tier === 'pro_plus' && (
            <span className="cell-sub">到期 {formatDate(user.membership.expiresAt)}</span>
          )}
        </div>
      ),
    },
    {
      title: '余额（积分）',
      width: 140,
      sorter: (a, b) => (a.account?.balanceMicros ?? 0) - (b.account?.balanceMicros ?? 0),
      render: (_, { account }) =>
        account ? (
          <div className="cell-main">
            <span className="cell-title">{formatPoints(account.balanceMicros)}</span>
            <span className="cell-sub">赠送 {formatPoints(account.bonusBalanceMicros ?? 0)}</span>
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: '近 30 天消耗',
      width: 130,
      sorter: (a, b) =>
        (a.account?.spentLast30DaysMicros ?? 0) - (b.account?.spentLast30DaysMicros ?? 0),
      render: (_, { account }) =>
        account ? (
          <div className="cell-main">
            <span>{formatPoints(account.spentLast30DaysMicros)} 积分</span>
            <span className="cell-sub">{formatYuan(account.spentLast30DaysMicros)}</span>
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: '注册 / 活跃',
      width: 150,
      sorter: (a, b) => a.user.createdAt.localeCompare(b.user.createdAt),
      render: (_, { user }) => (
        <div className="cell-main">
          <span>{formatDate(user.createdAt)}</span>
          <span className="cell-sub">
            {user.lastActiveAt ? `${relativeTime(user.lastActiveAt)}活跃` : '没活跃过'}
          </span>
        </div>
      ),
    },
    {
      title: '状态',
      width: 90,
      render: (_, { user }) => <AccountStateTag user={user} />,
    },
  ];

  const ov = overview.data;
  const openRow = openId ? users.byId.get(openId) : undefined;

  return (
    <Page
      title="用户列表"
      desc="搜到用户后点一行：看资料、开通 / 续期会员、加扣积分、看用量、封禁或删除，都在右侧抽屉里完成。"
      extra={<Button onClick={refreshAll}>刷新</Button>}
    >
      <div className="user-overview">
        <button type="button" className="stat-card stat-button" onClick={() => setQuick('all')}>
          <div className="stat-label">总用户数</div>
          <div className="stat-value">{ov ? ov.totalUsers.toLocaleString('zh-CN') : '—'}</div>
          <div className="stat-delta">不含注销中的账号</div>
        </button>
        <button type="button" className="stat-card stat-button" onClick={() => setQuick('pro')}>
          <div className="stat-label">PRO+ 会员</div>
          <div className="stat-value">{ov ? ov.proPlusUsers.toLocaleString('zh-CN') : '—'}</div>
          <div className="stat-delta">当前有效的付费会员</div>
        </button>
        <div className="stat-card user-expiring">
          <div className="stat-label">
            7 天内到期 {ov ? `· ${ov.expiringSoon.length} 人` : ''}
            <HelpTip text="点名字打开该用户的会员页，可直接续期。" />
          </div>
          {ov && ov.expiringSoon.length === 0 && (
            <div className="detail-muted">这 7 天没有会员到期</div>
          )}
          <div className="chip-list">
            {ov?.expiringSoon.slice(0, 12).map((u) => (
              <button
                key={u.userId}
                type="button"
                className="chip chip-button"
                onClick={() => open(u.userId, 'membership')}
              >
                {u.nickname || u.username}
                <span className="chip-sub">
                  {daysLeft(u.expiresAt) ?? 0} 天 · {formatDate(u.expiresAt)}
                </span>
              </button>
            ))}
            {ov && ov.expiringSoon.length > 12 && (
              <Button size="small" type="link" onClick={() => setQuick('expiring')}>
                全部 {ov.expiringSoon.length} 人 ›
              </Button>
            )}
          </div>
        </div>
      </div>
      {overview.error && <Alert type="error" showIcon message={overview.error} />}
      <DataTable<UserRow>
        rowKey="userId"
        columns={columns}
        data={list}
        loading={users.loading}
        error={users.error}
        onRefresh={refreshAll}
        onRowClick={(r) => open(r.userId)}
        filters={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索账号 / 昵称 / 用户 ID"
              style={{ width: 260 }}
              value={query}
              onChange={(e) => setQuery(e.target.value)}
            />
            <Segmented<Quick>
              value={quick}
              onChange={setQuick}
              options={[
                { value: 'all', label: '全部' },
                { value: 'pro', label: 'PRO+' },
                { value: 'expiring', label: '7 天内到期' },
                { value: 'banned', label: '已封禁' },
              ]}
            />
          </Space>
        }
        emptyTitle={users.rows.length ? '没有符合条件的用户' : '还没有用户'}
        emptyHint={
          users.rows.length
            ? '换个关键词，或切回「全部」。'
            : '用户在网页端注册后会自动出现在这里，不需要手动添加。'
        }
      />
      {openRow && (
        <UserDetailDrawer
          key={openRow.userId}
          row={openRow}
          nameOf={nameOf}
          initialTab={openTab}
          onClose={() => setOpenId(null)}
          onChanged={refreshAll}
        />
      )}
    </Page>
  );
}
