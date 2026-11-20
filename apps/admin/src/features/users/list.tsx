import { useListSelection } from '../../data/list-selection.js';
/**
 * 用户列表（10-20 批 E2，参考旧版 UsersPage「搜用户 → 开会员」）：
 * 顶部总用户数、PRO+ 会员数、7 天内到期名单（可点）；搜索账号 / 昵称 / ID；点一行打开用户详情抽屉。
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Alert, Button, Checkbox, Input, Segmented, Space } from 'antd';
import { ArrowDownIcon, ArrowsDownUpIcon, ArrowUpIcon } from '@phosphor-icons/react';
import { AdminUsersEndpoints, BillingAdminEndpoints } from '@weiban/contracts';
import { api } from '../../data/client.js';
import { useRemote } from '../../data/hooks.js';
import { Page } from '../../ui/page.js';
import { RecordDrawer } from '../../ui/drawer.js';
import { DataTable, type ProColumns } from '../../ui/table.js';
import {
  BatchBar,
  BatchFailureAlert,
  BatchOperationModal,
  type BatchFailure,
} from '../../ui/batch-operation.js';
import {
  formatDate,
  formatDateTime,
  formatPoints,
  formatYuan,
  relativeTime,
} from '../../ui/format.js';
import {
  AccountStateTag,
  MembershipTag,
  displayName,
  useSelectedUser,
  type UserRow,
} from './shared.js';
import { UserDetailDrawer } from './detail.js';
import { UserIdentity, shortUserId, userDisplayName } from './identity.js';
import { FilterChips } from '../../ui/grid-controls.js';
import { redactContact } from '../../ui/csv.js';
import './user-list.css';

type Quick = 'all' | 'pro' | 'expiring' | 'banned';

const USER_SORTS = {
  balance: ['balance_asc', 'balance_desc'],
  spent: ['spent_asc', 'spent_desc'],
  registered: ['oldest', 'newest'],
  active: ['active_asc', 'active_desc'],
} as const;
type UserSortField = keyof typeof USER_SORTS;
type UserSort = (typeof USER_SORTS)[UserSortField][number];

function SortHeader({
  children,
  field,
  sort,
  onSort,
}: {
  children: string;
  field: UserSortField;
  sort: UserSort;
  onSort: (value: UserSort) => void;
}) {
  const [asc, desc] = USER_SORTS[field];
  const first = field === 'registered' || field === 'active' ? desc : asc;
  const next = sort === asc ? desc : sort === desc ? asc : first;
  const Icon = sort === asc ? ArrowUpIcon : sort === desc ? ArrowDownIcon : ArrowsDownUpIcon;
  return (
    <button
      type="button"
      className="user-column-sort"
      aria-pressed={sort === asc || sort === desc}
      aria-label={children + (next === asc ? '升序' : '降序')}
      title={children + (next === asc ? '升序' : '降序')}
      onClick={() => onSort(next)}
    >
      <span>{children}</span>
      <Icon size={13} aria-hidden />
    </button>
  );
}

export function UserListPage() {
  const [searchParams, setSearchParams] = useSearchParams();
  const linkedUser = searchParams.get('userId');
  const linkedTab = searchParams.get('tab');
  const overview = useRemote(AdminUsersEndpoints.overview, { query: { view: 'counts' } });
  const [query, setQuery] = useState('');
  const [quick, setQuick] = useState<Quick>('all');
  const [openId, setOpenId] = useState<string | null>(null);
  const [openTab, setOpenTab] = useState<'profile' | 'membership' | 'runtime'>('profile');
  const [page, setPage] = useState(1);
  const [pageSize, setPageSize] = useState(20);
  const [sort, setSort] = useState<UserSort>('newest');
  function changeSort(value: UserSort) {
    setPage(1);
    setSort(value);
  }
  const users = useRemote(BillingAdminEndpoints.userPage, {
    query: { q: query.trim(), group: quick, page, pageSize, sort },
  });
  const list = users.data?.items ?? [];
  const selection = useListSelection<UserRow>(
    JSON.stringify([query, quick]),
    list,
    (r) => r.userId,
  );
  const selectedRows = selection.rows;
  const setSelected = selection.select;
  function changeQuery(value: string) {
    setPage(1);
    setQuery(value);
  }
  function changeQuick(value: Quick) {
    setPage(1);
    setQuick(value);
  }
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  const [batch, setBatch] = useState<{
    kind: 'delete' | 'ban' | 'unban';
    rows: UserRow[];
  } | null>(null);
  const [reason, setReason] = useState('');
  const [ackDelete, setAckDelete] = useState(false);
  useEffect(() => {
    if (linkedUser) {
      setOpenId(linkedUser);
      setOpenTab(linkedTab === 'runtime' ? 'runtime' : 'profile');
    }
  }, [linkedUser, linkedTab]);
  function refreshAll() {
    users.refresh();
    overview.refresh();
  }

  function open(userId: string, tab: 'profile' | 'membership' = 'profile') {
    setOpenTab(tab);
    setOpenId(userId);
  }

  function closeUser() {
    setOpenId(null);
    if (linkedUser)
      setSearchParams(
        (params) => {
          params.delete('userId');
          params.delete('tab');
          return params;
        },
        { replace: true },
      );
  }

  async function selectMatching() {
    try {
      await selection.selectAll(async () =>
        (
          await api.call(AdminUsersEndpoints.selectableUsers, {
            query: { q: query.trim(), group: quick },
          })
        ).items.map((user) => ({ userId: user.userId, user })),
      );
    } catch {
      setFailures([{ key: 'selection', label: '选择筛选结果', reason: '读取失败，请重试' }]);
    }
  }
  function openBatch(kind: 'delete' | 'ban' | 'unban') {
    if (!selectedRows.length) return;
    setReason('');
    setAckDelete(false);
    setBatch({ kind, rows: [...selectedRows] });
  }

  async function runBatch(row: UserRow): Promise<string> {
    if (!batch) return '';
    if (batch.kind === 'delete') {
      await api.call(AdminUsersEndpoints.deleteUser, {
        params: { userId: row.user.userId },
        body: { confirmUsername: row.user.username, reason: reason.trim() },
      });
      return '已进入注销流程';
    }
    if (batch.kind === 'ban') {
      await api.call(AdminUsersEndpoints.banUser, {
        params: { userId: row.user.userId },
        body: { reason: reason.trim() },
      });
      return '已封禁';
    }
    await api.call(AdminUsersEndpoints.unbanUser, { params: { userId: row.user.userId } });
    return row.user.ban ? '已解除封禁' : '本来就没有封禁';
  }

  const batchVerb = batch?.kind === 'delete' ? '注销' : batch?.kind === 'ban' ? '封禁' : '解封';
  const batchConfirmText =
    batch?.kind === 'delete' ? '确认注销' : batch?.kind === 'ban' ? '确认封禁' : '确认解封';
  const batchDisabled =
    batch?.kind === 'delete'
      ? reason.trim().length < 2 || !ackDelete
      : batch?.kind === 'ban'
        ? reason.trim().length < 2
        : false;

  const nameOf = (id: string | null) => {
    if (!id) return '系统';
    const row = list.find((r) => r.userId === id);
    return row ? userDisplayName(id, row.user) : shortUserId(id);
  };

  const columns: ProColumns<UserRow>[] = [
    {
      title: '用户',
      width: 240,
      render: (_, { user }) => (
        <UserIdentity userId={user.userId} label={user} deleted={user.status === 'deleting'} />
      ),
    },
    {
      title: '会员',
      width: 134,
      align: 'center',
      render: (_, { user }) => (
        <div className="user-centered-value user-membership-value">
          <MembershipTag user={user} />
          {user.membership.tier === 'pro_plus' && (
            <span className="cell-sub">到期 {formatDate(user.membership.expiresAt)}</span>
          )}
        </div>
      ),
    },
    {
      title: (
        <SortHeader field="balance" sort={sort} onSort={changeSort}>
          余额（积分）
        </SortHeader>
      ),
      width: 126,
      key: 'balance',
      align: 'center',
      render: (_, { account }) =>
        account ? (
          <div className="user-centered-value user-balance-value">
            <span className="cell-title mono">{formatPoints(account.balanceMicros)}</span>
            <span className="cell-sub mono">
              赠送 {formatPoints(account.bonusBalanceMicros ?? 0)}
            </span>
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: (
        <SortHeader field="spent" sort={sort} onSort={changeSort}>
          近 30 天消耗
        </SortHeader>
      ),
      width: 137,
      key: 'spent',
      align: 'right',
      render: (_, { account }) =>
        account ? (
          <div className="cell-main">
            <span className="mono">{formatPoints(account.spentLast30DaysMicros)} 积分</span>
            <span className="cell-sub">{formatYuan(account.spentLast30DaysMicros)}</span>
          </div>
        ) : (
          '—'
        ),
    },
    {
      title: (
        <div className="user-dates" aria-label="注册时间 / 最近活跃">
          <SortHeader field="registered" sort={sort} onSort={changeSort}>
            注册时间
          </SortHeader>
          <SortHeader field="active" sort={sort} onSort={changeSort}>
            最近活跃
          </SortHeader>
        </div>
      ),
      width: 160,
      key: 'created',
      render: (_, { user }) => (
        <div className="user-dates">
          <span>
            <small>注册</small>{' '}
            <time className="mono" dateTime={user.createdAt}>
              {formatDate(user.createdAt)}
            </time>
          </span>
          <span>
            <small>活跃</small>{' '}
            {user.lastActiveAt ? (
              <time dateTime={user.lastActiveAt} title={formatDateTime(user.lastActiveAt)}>
                {relativeTime(user.lastActiveAt)}
              </time>
            ) : (
              '暂无记录'
            )}
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
  const detail = useSelectedUser(openId);
  const openRow = detail.row;

  return (
    <Page title="用户列表">
      {overview.error && <Alert type="error" showIcon message={overview.error} />}
      <BatchFailureAlert failures={failures} onDismiss={() => setFailures([])} />
      <DataTable<UserRow>
        showTools
        rowKey="userId"
        columns={columns}
        data={list}
        loading={users.loading}
        error={users.error}
        onRefresh={refreshAll}
        onRowClick={(r) => open(r.userId)}
        selectedKeys={selection.keys}
        onSelectionChange={(keys) => setSelected(keys.map(String))}
        preserveSelection
        selectionHint={
          <Button type="link" size="small" onClick={() => void selectMatching()}>
            选择全部匹配的可操作用户
          </Button>
        }
        pagination={{
          current: page,
          pageSize,
          total: users.data?.total ?? 0,
          pageSizeOptions: [20, 50, 100],
          onChange: (p, n) => {
            selection.changePage();
            setPage(n === pageSize ? p : 1);
            setPageSize(n);
          },
        }}
        rowSelectable={({ user }) => user.role !== 'admin' && user.status === 'active'}
        batchActions={() => (
          <BatchBar count={selectedRows.length}>
            <Button size="small" disabled={!selectedRows.length} onClick={() => openBatch('ban')}>
              批量封禁
            </Button>
            <Button size="small" disabled={!selectedRows.length} onClick={() => openBatch('unban')}>
              批量解封
            </Button>
            <Button
              size="small"
              danger
              disabled={!selectedRows.length}
              onClick={() => openBatch('delete')}
            >
              批量注销
            </Button>
            <Button
              size="small"
              type="text"
              disabled={!selectedRows.length}
              onClick={() => setSelected([])}
            >
              清空选择
            </Button>
          </BatchBar>
        )}
        views={
          <Segmented<Quick>
            className="os-view-tabs"
            value={quick}
            onChange={changeQuick}
            options={[
              { value: 'all', label: ov ? '全部账号 · ' + ov.totalUsers : '全部账号' },
              { value: 'pro', label: ov ? 'PRO+ · ' + ov.proPlusUsers : 'PRO+' },
              {
                value: 'expiring',
                label: ov
                  ? '7 天内到期 · ' + (ov.expiringSoonCount ?? ov.expiringSoon.length)
                  : '7 天内到期',
              },
              { value: 'banned', label: '已封禁' },
            ]}
          />
        }
        filters={
          <Space wrap>
            <Input.Search
              allowClear
              placeholder="搜索账号 / 昵称 / 用户 ID"
              value={query}
              onChange={(e) => changeQuery(e.target.value.slice(0, 200))}
            />
            <Button onClick={() => changeSort('balance_asc')}>余额从低到高</Button>
          </Space>
        }
        chips={
          <FilterChips
            count={users.data?.total}
            chips={
              query.trim()
                ? [
                    {
                      key: 'q',
                      label: '关键词：' + redactContact(query.trim()),
                      remove: () => changeQuery(''),
                    },
                  ]
                : []
            }
            onClear={() => {
              changeQuery('');
              changeQuick('all');
            }}
          />
        }
        exportSelection={selectedRows}
        exportCsv={{
          filename: '微伴用户',
          fields: [
            { title: '用户编号', value: (row) => shortUserId(row.userId) },
            { title: '用户昵称', value: (row) => userDisplayName(row.userId, row.user) },
            { title: '会员', value: ({ user }) => user.membership.tier },
            {
              title: '余额（积分）',
              value: ({ account }) => (account ? formatPoints(account.balanceMicros) : null),
            },
            { title: '注册时间', value: ({ user }) => formatDate(user.createdAt) },
            { title: '最近活跃', value: ({ user }) => formatDateTime(user.lastActiveAt) },
            {
              title: '状态',
              value: ({ user }) =>
                user.status === 'deleting' ? '注销中' : user.ban ? '封禁' : '正常',
            },
          ],
        }}
        emptyTitle={query.trim() || quick !== 'all' ? '没有符合条件的用户' : '还没有用户'}
        emptyHint={query.trim() || quick !== 'all' ? undefined : '用户注册后会自动出现在这里。'}
        emptyAction={
          (query.trim() || quick !== 'all') && (
            <Button
              onClick={() => {
                changeQuery('');
                changeQuick('all');
              }}
            >
              清空筛选
            </Button>
          )
        }
      />
      {batch && (
        <BatchOperationModal
          title={`${batchVerb}选中的 ${batch.rows.length} 个账号？`}
          intro={
            batch.kind === 'delete' ? (
              <>
                将影响 {batch.rows.length}{' '}
                项。这会走与用户自助注销相同的流程：账号立即下线、不能登录，
                聊天、角色、记忆、积分等数据全部删除，不能恢复。管理员账号和注销中的账号不能勾选。
                每条单独提交，失败项会列出来并保持选中。
              </>
            ) : batch.kind === 'ban' ? (
              <>
                将影响 {batch.rows.length}{' '}
                项。封禁后不能登录，已登录的设备全部下线；数据保留，随时可以解封。
                每条单独提交，失败项会列出来并保持选中。
              </>
            ) : (
              <>
                将影响 {batch.rows.length} 项。解封后可以重新登录；本来就没封禁的账号不受影响。
                每条单独提交，失败项会列出来并保持选中。
              </>
            )
          }
          targets={batch.rows}
          keyOf={(row) => row.user.userId}
          labelOf={(row) => displayName(row.user)}
          confirmText={batchConfirmText}
          danger={batch.kind !== 'unban'}
          confirmDisabled={batchDisabled}
          run={runBatch}
          onCancel={() => setBatch(null)}
          onFinished={(failed) => {
            setFailures(failed);
            setSelected(failed.map((item) => item.key));
            setBatch(null);
            refreshAll();
          }}
        >
          {batch.kind === 'delete' && (
            <>
              <div className="field-line">
                <span className="field-label">
                  注销原因
                  <span className="field-label-hint">必填，至少 2 个字，记入审计</span>
                </span>
                <Input.TextArea
                  rows={2}
                  maxLength={200}
                  showCount
                  value={reason}
                  placeholder="例：用户联系客服要求注销 / 清理测试账号"
                  onChange={(e) => setReason(e.target.value)}
                />
              </div>
              <Checkbox checked={ackDelete} onChange={(e) => setAckDelete(e.target.checked)}>
                我确认这些账号将进入注销流程，数据删除后不能恢复
              </Checkbox>
            </>
          )}
          {batch.kind === 'ban' && (
            <div className="field-line">
              <span className="field-label">
                封禁原因
                <span className="field-label-hint">必填，至少 2 个字，记入审计</span>
              </span>
              <Input.TextArea
                rows={2}
                maxLength={200}
                showCount
                value={reason}
                placeholder="例：批量处理广告 / 违规账号"
                onChange={(e) => setReason(e.target.value)}
              />
            </div>
          )}
        </BatchOperationModal>
      )}
      {openId && !openRow && (
        <RecordDrawer open title="用户详情" onClose={closeUser}>
          {detail.error ? (
            <Alert
              type="error"
              showIcon
              message={detail.error}
              action={<Button onClick={detail.refresh}>重试</Button>}
            />
          ) : (
            '正在读取…'
          )}
        </RecordDrawer>
      )}
      {openRow && (
        <UserDetailDrawer
          key={openRow.userId}
          row={openRow}
          nameOf={nameOf}
          initialTab={openTab}
          onClose={closeUser}
          onChanged={() => {
            refreshAll();
            detail.refresh();
          }}
        />
      )}
    </Page>
  );
}
