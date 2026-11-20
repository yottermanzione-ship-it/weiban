//** 后台身份优先显示昵称和登录名，编号仅显示脱敏短码。 */
import { useState, type CSSProperties } from 'react';
import { App, Select } from 'antd';
import { redactContact } from '../../ui/csv.js';
import { AdminUsersEndpoints, Id, type AdminUserLabel } from '@weiban/contracts';
import { useRemote } from '../../data/hooks.js';
import { useAsync } from '../../data/use-async.js';
import { api } from '../../data/client.js';

export function shortUserId(userId: string): string {
  return userId.slice(0, 4) + '…' + userId.slice(-4);
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
  const nickname = redactContact(label?.nickname?.trim() ?? '');
  const username = redactContact(label?.username?.trim() ?? '');
  if (nickname || username) return nickname || username;
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
  const username = redactContact(label?.username?.trim() ?? '');
  const main = userDisplayName(userId, label, deleted);
  const sub = nickname && username ? username : null;
  if (compact) return <span>{main}</span>;
  return (
    <div className="cell-main">
      <span className="cell-title">{main}</span>
      <span className="cell-sub">
        {sub && <>{sub} · </>}
        <MaskedId id={userId} />
      </span>
    </div>
  );
}

export function MaskedId({ id }: { id: string }) {
  const { message } = App.useApp();
  const code = shortUserId(id);
  return (
    <button
      type="button"
      className="os-id-chip mono"
      title="复制脱敏编号"
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(code);
          message.success('已复制编号短码');
        } catch {
          message.error('复制失败');
        }
      }}
    >
      {code}
    </button>
  );
}

type UserPickerProps = {
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
  const [open, setOpen] = useState(false);
  const results = useRemote(
    AdminUsersEndpoints.lookupLabels,
    { query: { q: search.trim().slice(0, 200) } },
    open,
  );
  const saved = useUserDirectory(selected);
  const labels = new Map(saved.byId);
  for (const row of results.data?.items ?? []) labels.set(row.userId, row);
  for (const id of [...selected, search.trim()]) {
    if (Id.safeParse(id).success && !labels.has(id))
      labels.set(id, { nickname: null, username: null });
  }
  const options = [...labels].map(([id, label]) => ({
    value: id,
    title: shortUserId(id),
    label: `${userDisplayName(id, label)}${label.nickname || label.username ? ` · ${shortUserId(id)}` : ''}`,
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
      onOpenChange={setOpen}
      loading={open && results.loading}
      value={props.multiple ? (props.value ?? []) : props.value || undefined}
      searchValue={search}
      onSearch={(input) => {
        const ids = input
          .trim()
          .split(/[,，\s]+/)
          .filter(Boolean);
        if (props.multiple && ids.length > 1 && ids.every((id) => Id.safeParse(id).success)) {
          props.onChange?.([...new Set([...selected, ...ids])]);
          setSearch('');
        } else setSearch(input);
      }}
      onChange={(value) => {
        if (props.multiple) props.onChange?.(Array.isArray(value) ? value : []);
        else props.onChange?.(typeof value === 'string' ? value : '');
        setSearch('');
      }}
      options={options}
      filterOption={false}
      notFoundContent={
        results.error ? '账号搜索失败，可粘贴完整用户编号' : '没有匹配用户，可粘贴完整用户编号'
      }
    />
  );
}

/** 只补齐当前记录中的账号编号；空列表无需请求。 */
export function useUserDirectory(input: readonly (string | null | undefined)[]) {
  const ids = [...new Set(input.filter((id): id is string => !!id))].sort();
  const users = useAsync(ids.join(','), async () => {
    const batches = [];
    for (let offset = 0; offset < ids.length; offset += 150) {
      batches.push(
        api.call(AdminUsersEndpoints.lookupLabels, {
          query: { ids: ids.slice(offset, offset + 150).join(',') },
        }),
      );
    }
    return new Map<string, AdminUserLabel>(
      (await Promise.all(batches)).flatMap((result) =>
        result.items.map((user) => [user.userId, user] as const),
      ),
    );
  });
  return { byId: users.data ?? new Map<string, AdminUserLabel>(), refresh: users.refresh };
}
