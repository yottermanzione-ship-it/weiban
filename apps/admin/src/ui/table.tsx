import { Alert, Button, Card, InputNumber, Popover, Segmented, Space } from 'antd';
import { ColumnWidthOutlined, ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import type { TablePaginationConfig } from 'antd';
import { Children, isValidElement, useState, type Key, type ReactNode } from 'react';
import { EmptyHint } from './page.js';

export type { ProColumns };

/** 筛选栏：左边筛选条件，右边刷新。 */
export function FilterBar({
  children,
  onRefresh,
  extra,
}: {
  children?: ReactNode;
  onRefresh?: () => void;
  extra?: ReactNode;
}) {
  return (
    <div className="filter-bar">
      <div className="filter-bar-main">{children}</div>
      <Space size={8}>
        {extra}
        {onRefresh && (
          <Button icon={<ReloadOutlined />} onClick={onRefresh}>
            刷新
          </Button>
        )}
      </Space>
    </div>
  );
}

export interface DataTableProps<T extends Record<string, unknown>> {
  columns: ProColumns<T>[];
  data?: T[];
  rowKey: keyof T | ((row: T) => string);
  loading?: boolean;
  error?: string;
  onRefresh?: () => void;
  filters?: ReactNode;
  toolbarExtra?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedKeys?: Key[];
  onSelectionChange?: (keys: Key[], rows: T[]) => void;
  /** 多选是否跨页保留（默认 true）。批量操作要求「只作用于当前页」时传 false。 */
  preserveSelection?: boolean;
  /** 某些行不允许勾选（例如管理员账号、注销中的账号）。 */
  rowSelectable?: (row: T) => boolean;
  /** 勾选提示，传了以后表格上方会显示「已选择 N 项」+ 这句说明。 */
  selectionHint?: ReactNode;
  /** 翻页 / 改每页条数时回调，用于清空只作用于当前页的选择。 */
  onPageChange?: (page: number, pageSize: number) => void;
  batchActions?: (rows: T[]) => ReactNode;
  emptyTitle?: ReactNode;
  emptyHint?: ReactNode;
  emptyAction?: ReactNode;
  pagination?: false | TablePaginationConfig;
  onSort?: (key: string, direction: 'ascend' | 'descend' | null) => void;
  footer?: ReactNode;
  size?: 'small' | 'middle';
  showTools?: boolean;
}

/**
 * 统一列表模板：筛选栏 → 表格（可排序、分页、勾选批量）→ 点一行开抽屉。
 */
export function DataTable<T extends Record<string, unknown>>({
  columns,
  data,
  rowKey,
  loading,
  error,
  onRefresh,
  filters,
  toolbarExtra,
  onRowClick,
  selectedKeys,
  onSelectionChange,
  preserveSelection = true,
  rowSelectable,
  selectionHint,
  onPageChange,
  batchActions,
  emptyTitle,
  emptyHint,
  emptyAction,
  pagination,
  footer,
  size = 'middle',
  showTools = false,
  onSort,
}: DataTableProps<T>) {
  const [density, setDensity] = useState<'small' | 'middle' | 'large'>(size);
  const [widths, setWidths] = useState<Record<string, number>>({});
  const layout = columns.map((column, index) => {
    const title =
      typeof column.title === 'string'
        ? column.title
        : isValidElement<{ children?: ReactNode }>(column.title)
          ? Children.toArray(column.title.props.children)
              .filter((child) => typeof child === 'string' || typeof child === 'number')
              .join('')
              .trim()
          : '';
    const key = String(column.key ?? column.dataIndex ?? (title || index));
    const defaultWidth = typeof column.width === 'number' ? column.width : 160;
    return { key, title: title || `第 ${index + 1} 列`, width: widths[key] ?? defaultWidth };
  });
  const tableWidth = layout.reduce((sum, { width }) => sum + width, onSelectionChange ? 44 : 0);
  const tools = showTools && (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="表格显示"
      content={
        <div className="table-layout-settings">
          <Segmented
            aria-label="表格密度"
            value={density}
            onChange={setDensity}
            options={[
              { value: 'small', label: '紧凑' },
              { value: 'middle', label: '适中' },
              { value: 'large', label: '宽松' },
            ]}
          />
          {layout.map(({ key, title, width }) => (
            <label className="table-width-setting" key={key}>
              <span>{title}</span>
              <InputNumber
                aria-label={`${title}列宽（像素）`}
                size="small"
                min={64}
                max={800}
                step={16}
                value={width}
                onChange={(value) => {
                  if (value != null && value >= 64 && value <= 800) {
                    setWidths((current) => ({ ...current, [key]: value }));
                  }
                }}
              />
            </label>
          ))}
          <Button
            size="small"
            onClick={() => {
              setDensity(size);
              setWidths({});
            }}
          >
            恢复默认
          </Button>
        </div>
      }
    >
      <Button icon={<ColumnWidthOutlined />} aria-label="调整列宽和密度">
        显示设置
      </Button>
    </Popover>
  );
  return (
    <div className={showTools ? 'table-card adjustable-table' : 'table-card'}>
      {(filters || onRefresh || toolbarExtra || tools) && (
        <FilterBar
          onRefresh={onRefresh}
          extra={
            <>
              {toolbarExtra}
              {tools}
            </>
          }
        >
          {filters}
        </FilterBar>
      )}
      {error && (
        <Alert
          type="error"
          showIcon
          message="数据没加载出来"
          description={error}
          className="table-error"
        />
      )}
      <ProTable<T>
        columns={
          showTools ? columns.map((column, i) => ({ ...column, width: layout[i]!.width })) : columns
        }
        dataSource={data ?? []}
        rowKey={rowKey as string}
        loading={loading}
        search={false}
        cardProps={false}
        size={showTools ? density : size}
        tableLayout={showTools ? 'fixed' : undefined}
        scroll={{ x: showTools ? tableWidth : 'max-content' }}
        options={false}
        pagination={
          pagination === false
            ? false
            : {
                defaultPageSize: 20,
                showSizeChanger: true,
                hideOnSinglePage: true,
                locale: {
                  items_per_page: '条/页',
                  prev_page: '上一页',
                  next_page: '下一页',
                  page: '页',
                },
                pageSizeOptions: [10, 20, 50, 100],
                showTotal: (total) => `共 ${total} 条`,
                size: 'default',
                onChange: onPageChange,
                ...pagination,
              }
        }
        onChange={(_page, _filters, sort, extra) => {
          if (onSort && extra.action === 'sort' && !Array.isArray(sort))
            onSort(String(sort.columnKey ?? ''), sort.order ?? null);
        }}
        locale={{
          selectAll: '选择本页',
          selectNone: '清空选择',
          emptyText: <EmptyHint title={emptyTitle} hint={emptyHint} action={emptyAction} />,
        }}
        rowSelection={
          onSelectionChange
            ? {
                selectedRowKeys: selectedKeys,
                ...(showTools ? { columnWidth: 44 } : {}),
                onChange: (keys, rows) => onSelectionChange(keys, rows),
                preserveSelectedRowKeys: preserveSelection,
                getCheckboxProps: rowSelectable
                  ? (record) => ({ disabled: !rowSelectable(record) })
                  : undefined,
              }
            : undefined
        }
        tableAlertRender={
          onSelectionChange && selectionHint
            ? ({ selectedRowKeys }) => (
                <Space size={8} wrap>
                  <span>已选择 {selectedRowKeys.length} 项</span>
                  <span className="cell-sub">{selectionHint}</span>
                </Space>
              )
            : undefined
        }
        tableAlertOptionRender={
          batchActions
            ? ({ selectedRows }) => <Space size={8}>{batchActions(selectedRows)}</Space>
            : undefined
        }
        onRow={
          onRowClick
            ? (record) => ({
                onClick: (event) => {
                  const el = event.target as HTMLElement;
                  if (
                    el.closest(
                      'button,a,input,textarea,.ant-checkbox-wrapper,.ant-table-selection-column,.ant-dropdown-trigger,.ant-switch,.ant-select,.ant-pagination',
                    )
                  )
                    return;
                  onRowClick(record);
                },
                style: { cursor: 'pointer' },
              })
            : undefined
        }
      />
      {footer && <div className="table-footer">{footer}</div>}
    </div>
  );
}

/** 详情抽屉里的小标题 + 内容。 */
export function DetailBlock({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Card size="small" className="detail-block" title={title} bordered={false}>
      {children}
    </Card>
  );
}
