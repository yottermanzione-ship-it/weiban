import { Alert, Button, Card, Space } from 'antd';
import { ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ProColumns } from '@ant-design/pro-components';
import type { Key, ReactNode } from 'react';
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
  batchActions?: (rows: T[]) => ReactNode;
  emptyTitle?: ReactNode;
  emptyHint?: ReactNode;
  emptyAction?: ReactNode;
  pagination?: false;
  footer?: ReactNode;
  size?: 'small' | 'middle';
  scrollX?: number | string;
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
  batchActions,
  emptyTitle,
  emptyHint,
  emptyAction,
  pagination,
  footer,
  size = 'middle',
  scrollX = 'max-content',
}: DataTableProps<T>) {
  return (
    <div className="table-card">
      {(filters || onRefresh || toolbarExtra) && (
        <FilterBar onRefresh={onRefresh} extra={toolbarExtra}>
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
        columns={columns}
        dataSource={data ?? []}
        rowKey={rowKey as string}
        loading={loading}
        search={false}
        cardProps={false}
        size={size}
        scroll={{ x: scrollX }}
        options={{ reload: false, density: true, setting: true, fullScreen: false }}
        pagination={
          pagination === false
            ? false
            : {
                defaultPageSize: 20,
                showSizeChanger: true,
                pageSizeOptions: [10, 20, 50, 100],
                showTotal: (total) => `共 ${total} 条`,
                size: 'default',
              }
        }
        locale={{
          emptyText: <EmptyHint title={emptyTitle} hint={emptyHint} action={emptyAction} />,
        }}
        rowSelection={
          onSelectionChange
            ? {
                selectedRowKeys: selectedKeys,
                onChange: (keys, rows) => onSelectionChange(keys, rows),
                preserveSelectedRowKeys: true,
              }
            : { preserveSelectedRowKeys: false }
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
