import {
  Alert,
  Button,
  Card,
  Checkbox,
  InputNumber,
  Popover,
  Segmented,
  Skeleton,
  Space,
  type TablePaginationConfig,
} from 'antd';
import { ColumnWidthOutlined, DownloadOutlined, ReloadOutlined } from '@ant-design/icons';
import { ProTable, type ProColumns, type ProTableProps } from '@ant-design/pro-components';
import { Children, isValidElement, useState, type Key, type ReactNode } from 'react';
import { DENSITY_OPTIONS, useAppearance } from '../app/appearance.js';
import { downloadCsv, type SafeCsv } from './csv.js';
import { EmptyHint } from './page.js';

export type { ProColumns };

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
      <Space size={8} wrap>
        {extra}
        {onRefresh && (
          <Button icon={<ReloadOutlined />} aria-label="刷新" onClick={onRefresh}>
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
  views?: ReactNode;
  filters?: ReactNode;
  chips?: ReactNode;
  toolbarExtra?: ReactNode;
  onRowClick?: (row: T) => void;
  selectedKeys?: Key[];
  onSelectionChange?: (keys: Key[], rows: T[]) => void;
  /** 多选是否跨页保留（默认 true）。 */
  preserveSelection?: boolean;
  rowSelectable?: (row: T) => boolean;
  selectionHint?: ReactNode;
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
  expandable?: ProTableProps<T, Record<string, unknown>>['expandable'];
  exportCsv?: SafeCsv<T>;
  exportSelection?: readonly T[];
}

type ColumnPrefs = NonNullable<
  NonNullable<
    ProTableProps<Record<string, unknown>, Record<string, unknown>>['columnsState']
  >['value']
>;

function columnTitle(title: ReactNode) {
  return typeof title === 'string'
    ? title
    : isValidElement<{ children?: ReactNode }>(title)
      ? Children.toArray(title.props.children)
          .filter((child) => typeof child === 'string' || typeof child === 'number')
          .join('')
          .trim()
      : '';
}

function initialColumns(key: string): ColumnPrefs {
  try {
    const saved: unknown = JSON.parse(localStorage.getItem(key) ?? '{}');
    if (!saved || typeof saved !== 'object' || Array.isArray(saved)) return {};
    return Object.fromEntries(Object.entries(saved).filter(([, value]) => value?.show === false));
  } catch {
    return {};
  }
}

/** 统一列表模板。业务筛选与服务端分页由各自页面负责。 */
export function WeibanDataGrid<T extends Record<string, unknown>>({
  columns,
  data = [],
  rowKey,
  loading,
  error,
  onRefresh,
  views,
  filters,
  chips,
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
  expandable,
  exportCsv,
  exportSelection,
}: DataTableProps<T>) {
  const exportLabel =
    pagination && pagination.total !== undefined ? '导出本页 CSV' : '导出当前列表 CSV';
  const appearance = useAppearance();
  const density = appearance.density ?? size;
  const [widths, setWidths] = useState<Record<string, number>>({});
  const layout = columns.map((column, index) => {
    const title = columnTitle(typeof column.title === 'function' ? null : column.title);
    const key = String(column.key ?? column.dataIndex ?? (title || index));
    const defaultWidth = typeof column.width === 'number' ? column.width : 160;
    return { key, title: title || '列 ' + (index + 1), width: widths[key] ?? defaultWidth };
  });
  const storageKey =
    'weiban.os.columns:' + window.location.pathname + ':' + layout.map(({ key }) => key).join('|');
  const [columnPrefs, setColumnPrefs] = useState<{ key: string; value: ColumnPrefs }>();
  const visibility =
    columnPrefs?.key === storageKey ? columnPrefs.value : initialColumns(storageKey);
  const tableWidth = layout.reduce(
    (sum, { key, width }) => sum + (visibility[key]?.show === false ? 0 : width),
    (onSelectionChange ? 44 : 0) + (expandable ? 36 : 0),
  );
  const gridColumns = columns.map((column, index) => {
    const { key, width } = layout[index]!;
    return {
      ...column,
      key,
      width: showTools ? width : (column.width ?? (index === 0 ? 180 : undefined)),
      fixed: column.fixed ?? (index === 0 ? ('left' as const) : undefined),
    };
  });
  const sameKeys = columns.length > 1;
  const setVisibility = (value: ColumnPrefs) => {
    setColumnPrefs({ key: storageKey, value });
    try {
      localStorage.setItem(storageKey, JSON.stringify(value));
    } catch {
      /* 可继续临时使用 */
    }
  };

  const tools = (sameKeys || showTools) && (
    <Popover
      trigger="click"
      placement="bottomRight"
      title="表格显示"
      content={
        <div className="table-layout-settings">
          {showTools && (
            <Segmented
              aria-label="表格密度"
              value={density}
              onChange={appearance.setDensity}
              options={[...DENSITY_OPTIONS]}
            />
          )}
          {layout.map(({ key, title, width }, index) => (
            <div className="table-width-setting" key={key}>
              <Checkbox
                checked={visibility[key]?.show !== false}
                disabled={index === 0}
                onChange={(event) =>
                  setVisibility({ ...visibility, [key]: { show: event.target.checked } })
                }
              >
                {title}
              </Checkbox>
              {showTools && (
                <InputNumber
                  aria-label={title + '列宽（像素）'}
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
              )}
            </div>
          ))}
          <Button
            size="small"
            onClick={() => {
              if (showTools) appearance.setDensity(size);
              setWidths({});
              setVisibility({});
            }}
          >
            恢复默认
          </Button>
        </div>
      }
    >
      <Button
        icon={<ColumnWidthOutlined />}
        aria-label={showTools ? '调整列宽和密度' : '选择显示的列'}
      >
        {showTools ? '显示设置' : '列显隐'}
      </Button>
    </Popover>
  );

  return (
    <div className={showTools ? 'table-card adjustable-table' : 'table-card'}>
      {views && <div className="os-grid-views">{views}</div>}
      {(filters || onRefresh || toolbarExtra || tools || exportCsv) && (
        <FilterBar
          onRefresh={onRefresh}
          extra={
            <>
              {toolbarExtra}
              {tools}
              {exportCsv && (
                <Button
                  disabled={!data.length || loading || !!error}
                  icon={<DownloadOutlined />}
                  aria-label={exportLabel}
                  onClick={() => downloadCsv(exportCsv, data)}
                >
                  {exportLabel}
                </Button>
              )}
            </>
          }
        >
          {filters}
        </FilterBar>
      )}
      {chips}
      {error && (
        <Alert
          type="error"
          showIcon
          message="数据没加载出来"
          description={error}
          className="table-error"
          action={
            onRefresh && (
              <Button size="small" onClick={onRefresh}>
                重试
              </Button>
            )
          }
        />
      )}
      <ProTable<T>
        columns={gridColumns}
        columnsState={{ value: visibility, onChange: setVisibility }}
        dataSource={data}
        rowKey={typeof rowKey === 'function' ? rowKey : (row: T) => String(row[rowKey])}
        loading={loading && data.length > 0}
        search={false}
        cardProps={false}
        size={density}
        tableLayout={showTools ? 'fixed' : undefined}
        scroll={{ x: showTools ? tableWidth : 'max-content' }}
        sticky={{ offsetHeader: 64, offsetScroll: selectedKeys?.length ? 66 : 0 }}
        expandable={expandable && { columnWidth: 36, ...expandable }}
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
                showTotal: (total) => '共 ' + total + ' 条',
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
          emptyText: loading ? (
            <Skeleton className="table-skeleton" active title={false} paragraph={{ rows: 5 }} />
          ) : error ? null : (
            <EmptyHint title={emptyTitle} hint={emptyHint} action={emptyAction} />
          ),
        }}
        rowSelection={
          onSelectionChange
            ? {
                selectedRowKeys: selectedKeys,
                columnWidth: 44,
                onChange: (keys, rows) => onSelectionChange(keys, rows),
                preserveSelectedRowKeys: preserveSelection,
                getCheckboxProps: rowSelectable
                  ? (record) => ({ disabled: !rowSelectable(record) })
                  : undefined,
              }
            : undefined
        }
        tableAlertRender={
          onSelectionChange
            ? ({ selectedRowKeys }) => (
                <div className="os-selection-summary">
                  <span>已选择 {selectedRowKeys.length} 项</span>
                  {selectionHint}
                </div>
              )
            : undefined
        }
        tableAlertOptionRender={
          onSelectionChange
            ? ({ selectedRowKeys, selectedRows, onCleanSelected }) => {
                const keys = new Set(selectedRowKeys);
                const selected =
                  exportSelection ??
                  data.filter((row) =>
                    keys.has(typeof rowKey === 'function' ? rowKey(row) : String(row[rowKey])),
                  );
                return (
                  <Space size={8} wrap>
                    {batchActions?.(selectedRows)}
                    {exportCsv && (
                      <Button
                        size="small"
                        icon={<DownloadOutlined />}
                        disabled={loading || !!error || !selected.length}
                        onClick={() => downloadCsv(exportCsv, selected)}
                      >
                        {exportSelection ? '导出已选' : '导出本页已选'}
                      </Button>
                    )}
                    {!batchActions && (
                      <Button type="link" size="small" onClick={onCleanSelected}>
                        清空选择
                      </Button>
                    )}
                  </Space>
                );
              }
            : undefined
        }
        onRow={
          onRowClick
            ? (record) => ({
                tabIndex: 0,
                onClick: (event) => {
                  const el = event.target as Element | null;
                  if (
                    el?.closest(
                      'button,a,input,textarea,.ant-checkbox-wrapper,.ant-table-selection-column,.ant-dropdown-trigger,.ant-switch,.ant-select,.ant-pagination,.ant-table-row-expand-icon,[role=button]',
                    )
                  )
                    return;
                  onRowClick(record);
                },
                onKeyDown: (event) => {
                  if (event.key === 'Enter' && event.target === event.currentTarget)
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

export { WeibanDataGrid as DataTable };

export function DetailBlock({ title, children }: { title: ReactNode; children: ReactNode }) {
  return (
    <Card size="small" className="detail-block" title={title} variant="borderless">
      {children}
    </Card>
  );
}
