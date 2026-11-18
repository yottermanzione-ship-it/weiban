import { useState, type CSSProperties } from 'react';
import { Select } from 'antd';
import {
  CharacterAdminEndpoints,
  type AdminCharacterLabel,
  type CharacterBasis,
  type CharacterPublishStatus,
} from '@weiban/contracts';
import { api } from '../data/client.js';
import { useRemote } from '../data/hooks.js';
import { useAsync } from '../data/use-async.js';

export function useCharacterLabels(input: readonly (string | undefined | null)[]) {
  const ids = [...new Set(input.filter((id): id is string => !!id))].sort();
  const remote = useAsync(ids.join(','), async () => {
    const batches = [];
    for (let offset = 0; offset < ids.length; offset += 150) {
      batches.push(
        api.call(CharacterAdminEndpoints.lookup, {
          query: { ids: ids.slice(offset, offset + 150).join(',') },
        }),
      );
    }
    return new Map<string, AdminCharacterLabel>(
      (await Promise.all(batches)).flatMap((result) =>
        result.items.map((row) => [row.characterId, row] as const),
      ),
    );
  });
  return remote.data ?? new Map<string, AdminCharacterLabel>();
}

type Props = {
  status?: CharacterPublishStatus;
  basis?: CharacterBasis;
  exclude?: ReadonlySet<string>;
  style?: CSSProperties;
  placeholder?: string;
  disabled?: boolean;
  allowClear?: boolean;
  id?: string;
} & (
  | { multiple?: false; value?: string | null; onChange?: (value: string) => void }
  | { multiple: true; value?: string[]; onChange?: (value: string[]) => void }
);

export function CharacterPicker(props: Props) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState('');
  const selected = props.multiple ? (props.value ?? []) : props.value ? [props.value] : [];
  const labels = new Map(useCharacterLabels(selected));
  const results = useRemote(
    CharacterAdminEndpoints.lookup,
    {
      query: { q: search.trim().slice(0, 200), status: props.status, basis: props.basis },
    },
    open,
  );
  for (const item of results.data?.items ?? []) labels.set(item.characterId, item);
  const ids = [
    ...new Set([...selected, ...(results.data?.items ?? []).map((item) => item.characterId)]),
  ];
  return (
    <Select<string | string[]>
      id={props.id}
      aria-label={props.placeholder ?? '角色'}
      placeholder={props.placeholder ?? '搜索角色名称或编号'}
      style={props.style}
      allowClear={props.allowClear}
      disabled={props.disabled}
      showSearch
      filterOption={false}
      loading={open && results.loading}
      onOpenChange={setOpen}
      searchValue={search}
      onSearch={setSearch}
      mode={props.multiple ? 'multiple' : undefined}
      value={props.multiple ? selected : props.value || undefined}
      onChange={(value) => {
        if (props.multiple) props.onChange?.(Array.isArray(value) ? value : []);
        else props.onChange?.(typeof value === 'string' ? value : '');
        setSearch('');
      }}
      notFoundContent={results.error ? '搜索失败，请重试' : '没有匹配角色'}
      options={ids
        .filter((id) => !props.exclude?.has(id))
        .map((id) => {
          const row = labels.get(id);
          return {
            value: id,
            label: row ? `${row.name}${row.status === 'published' ? '' : '（未上架）'}` : id,
          };
        })}
    />
  );
}
