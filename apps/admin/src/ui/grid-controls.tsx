import { useId, type ReactNode } from 'react';
import { Button, Checkbox, Popover, Space, Tag } from 'antd';
import { PlusOutlined } from '@ant-design/icons';

export interface FilterChip {
  key: string;
  label: ReactNode;
  remove: () => void;
}

export function FilterChips({
  chips,
  count,
  onClear,
}: {
  chips: FilterChip[];
  count?: number;
  onClear: () => void;
}) {
  if (!chips.length) return null;
  return (
    <div className="os-filter-chips">
      {chips.map((chip) => (
        <Tag
          closable
          key={chip.key}
          onClose={(event) => {
            event.preventDefault();
            chip.remove();
          }}
        >
          {chip.label}
        </Tag>
      ))}
      <Button size="small" type="link" onClick={onClear}>
        清空全部
      </Button>
      {count !== undefined && <span className="mono">匹配 {count} 条</span>}
    </div>
  );
}

export function FacetFilter<T extends string>({
  label,
  value,
  options,
  onChange,
  disabled,
}: {
  label: string;
  value: T[];
  options: { value: T; label: string; count?: number }[];
  onChange: (values: T[]) => void;
  disabled?: boolean;
}) {
  const id = useId();
  return (
    <Popover
      title={label}
      trigger="click"
      placement="bottomLeft"
      content={
        <div className="os-facet-options" id={id}>
          <Checkbox.Group<T> value={value} onChange={onChange}>
            <Space direction="vertical">
              {options.map((option) => (
                <Checkbox key={option.value} value={option.value}>
                  {option.label}{' '}
                  {option.count !== undefined && <span className="mono">· {option.count}</span>}
                </Checkbox>
              ))}
            </Space>
          </Checkbox.Group>
          {value.length > 0 && (
            <Button type="link" size="small" onClick={() => onChange([])}>
              清除 {label}
            </Button>
          )}
        </div>
      }
    >
      <Button
        icon={<PlusOutlined />}
        className={value.length ? 'os-facet is-active' : 'os-facet'}
        aria-controls={id}
        disabled={disabled}
      >
        {label}
        {value.length ? ' · ' + value.length : ''}
      </Button>
    </Popover>
  );
}
