/**
 * 后台通用的「这是谁」展示：优先昵称（identity.profiles.nickname），其次登录名，
 * 两者都取不到才显示用户 ID 短码。不造任何昵称，缺就是缺。
 *
 * 复制完整用户 ID 的能力保留：主行的 title 是完整 UUID；抽屉里另有可复制的完整 ID。
 * 排序 / 筛选 / 分页 / 导出仍然按 userId，本组件只改「显示成什么」。
 */
import { useMemo, useState, type CSSProperties } from 'react';
import { Select, Typography } from 'antd';
import { AdminUsersEndpoints, Id, type AdminUserLabel } from '@weiban/contracts';
import { useRemote } from '../../data/hooks.js';

/** 短码：UUID 前 8 位 + 省略号（完整值放 title）。 */
export function shortUserId(userId: string): string {
  return `${userId.slice(0, 8)}…`;
}

/**
 * 单行显示名：昵称 → 登录名 → 用户 ID 短码。
 * deleted = 调用方已知账号不存在（已注销），此时不拿 ID 短码冒充名字。
 */
export function userDisplayName(
  userId: string,
  label: AdminUserLabel | undefined,
  deleted = false,
): string {
  const nickname = label?.nickname?.trim();
  const username = label?.username?.trim();
  if (nickname || username) return nickname || username!;
  return deleted ? '已注销账号' : shortUserId(userId);
}

/**
 * 两行身份单元格：主行是昵称（或登录名、ID 短码），副行是登录名 + ID 短码。
 * 主行 title 带完整 UUID，复制 / 核对都不用再翻详情。
 */
export function UserIdentity({
  userId,
  label,
  deleted = false,
  compact = false,
}: {
  userId: string;
  label?: AdminUserLabel;
  /** 账号已注销：没有任何名字时显示「已注销账号」而不是 ID 短码。 */
  deleted?: boolean;
  /** 单行（排行榜、链接列表等没有副行的位置）。 */
  compact?: boolean;
}) {
  const nickname = label?.nickname?.trim() ?? '';
  const username = label?.username?.trim() ?? '';
  const main = userDisplayName(userId, label, deleted);
  const sub = [...(nickname && username ? [username] : []), shortUserId(userId)].join(' · ');
  if (compact) return <span title={userId}>{main}</span>;
  return (
    <div className="cell-main">
      <span className="cell-title" title={userId}>
        {main}
      </span>
      <Typography.Text
        className="cell-sub mono"
        title={userId}
        copyable={{ text: userId, tooltips: ['复制用户编号', '已复制'] }}
        onClick={(event) => event.stopPropagation()}
      >
        {sub}
      </Typography.Text>
    </div>
  );
}

type UserPickerProps = {
  directory: ReturnType<typeof useUserDirectory>;
  placeholder?: string;
  id?: string;
  style?: CSSProperties;
} & (
  | { multiple?: false; value?: string; onChange?: (value: string) => void }
  | { multiple: true; value?: string[]; onChange?: (value: string[]) => void }
);

/** Names are display labels only. Selection, filters and writes always retain the original UUID. */
export function UserPicker(props: UserPickerProps) {
  const [search, setSearch] = useState('');
  const selected = props.multiple ? (props.value ?? []) : props.value ? [props.value] : [];
  const labels = new Map(props.directory.byId);
  for (const id of [...selected, search.trim()]) {
    if (Id.safeParse(id).success && !labels.has(id))
      labels.set(id, { nickname: null, username: null });
  }
  const options = [...labels].map(([id, label]) => ({
    value: id,
    label: `${userDisplayName(id, label)}${label.nickname || label.username ? ` · ${shortUserId(id)}` : ''}`,
    title: id,
    searchText: [id, label.nickname, label.username].join(' ').toLocaleLowerCase(),
  }));
  return (
    <Select<string | string[]>
      id={props.id}
      aria-label={props.placeholder ?? '用户（昵称、账号或编号）'}
      placeholder={props.placeholder ?? '用户（昵称、账号或编号）'}
      style={props.style ?? { width: 280 }}
      showSearch
      allowClear
      mode={props.multiple ? 'multiple' : undefined}
      loading={props.directory.loading}
      value={props.multiple ? (props.value ?? []) : props.value || undefined}
      searchValue={search}
      onSearch={setSearch}
      onChange={(value) => {
        if (props.multiple) props.onChange?.(Array.isArray(value) ? value : []);
        else props.onChange?.(typeof value === 'string' ? value : '');
        setSearch('');
      }}
      options={options}
      filterOption={(input, option) =>
        option?.searchText.includes(input.trim().toLocaleLowerCase()) ?? false
      }
      notFoundContent={
        props.directory.error
          ? '账号目录加载失败，可粘贴完整用户编号'
          : '没有匹配用户，可粘贴完整用户编号'
      }
    />
  );
}

/**
 * 后台「用户 ID → 昵称 / 登录名」目录：一次拉取全部账号（后台规模小，接口上限 5000），
 * 供只返回 userId 的接口页面使用（例：行为规划、角色生态）。查不到（已注销）时返回 undefined。
 */
export function useUserDirectory() {
  const users = useRemote(AdminUsersEndpoints.listUsers);
  const byId = useMemo(
    () =>
      new Map<string, AdminUserLabel>(
        (users.data?.items ?? []).map((u) => [
          u.userId,
          { nickname: u.nickname, username: u.username },
        ]),
      ),
    [users.data],
  );
  return { byId, loading: users.loading, error: users.error, refresh: users.refresh };
}
