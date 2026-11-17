import { useState } from 'react';
import { Button } from 'antd';
import { DataTable, type DataTableProps } from './table.js';
import { BatchFailureAlert, BatchOperationModal, type BatchFailure } from './batch-operation.js';
import { useListSelection } from '../data/list-selection.js';
import { errorText } from '../data/hooks.js';
import { useToast } from './page.js';

type Operation<T> = {
  label: string;
  danger?: boolean;
  applies: (row: T) => boolean;
  run: (row: T) => Promise<unknown>;
};
export function BulkTable<T extends Record<string, unknown>>({
  scope,
  nameOf,
  operations,
  allMatching,
  afterBatch,
  ...table
}: DataTableProps<T> & {
  scope: string;
  nameOf: (row: T) => string;
  operations: Operation<T>[];
  allMatching?: () => Promise<T[]>;
  afterBatch: () => void;
}) {
  const toast = useToast();
  const rows = table.data ?? [];
  const keyOf = (row: T) =>
    typeof table.rowKey === 'function' ? table.rowKey(row) : String(row[table.rowKey]);
  const selection = useListSelection(scope, rows, keyOf);
  const eligible = (row: T) => operations.some((op) => op.applies(row));
  const [batch, setBatch] = useState<{ op: Operation<T>; targets: T[] } | null>(null);
  const [failures, setFailures] = useState<BatchFailure[]>([]);
  async function all() {
    try {
      await selection.selectAll(async () =>
        (allMatching ? await allMatching() : rows).filter(eligible),
      );
    } catch (e) {
      toast.error(errorText(e));
    }
  }
  return (
    <>
      <BatchFailureAlert failures={failures} onDismiss={() => setFailures([])} />
      <DataTable
        {...table}
        rowSelectable={(row) => !table.loading && !table.error && eligible(row)}
        onPageChange={(p, n) => {
          selection.changePage();
          table.onPageChange?.(p, n);
        }}
        selectedKeys={selection.keys}
        preserveSelection
        onSelectionChange={(keys) => selection.select(keys)}
        selectionHint={
          <Button type="link" size="small" onClick={() => void all()}>
            {allMatching ? '选择全部匹配项' : '选择全部已加载项'}
          </Button>
        }
        batchActions={() =>
          operations.map((op) => {
            const targets = selection.rows.filter(op.applies);
            return (
              <Button
                key={op.label}
                size="small"
                danger={op.danger}
                disabled={!targets.length || !!table.loading || !!table.error}
                onClick={() => setBatch({ op, targets: [...targets] })}
              >
                {op.label}（{targets.length}）
              </Button>
            );
          })
        }
      />
      {batch && (
        <BatchOperationModal
          title={batch.op.label}
          targets={batch.targets}
          keyOf={keyOf}
          labelOf={nameOf}
          confirmText={batch.op.label}
          danger={batch.op.danger ?? false}
          run={async (row) => {
            await batch.op.run(row);
          }}
          onCancel={() => setBatch(null)}
          onFinished={(failed) => {
            setFailures(failed);
            selection.select(failed.map((f) => f.key));
            setBatch(null);
            afterBatch();
          }}
        />
      )}
    </>
  );
}

export async function collectPages<T>(
  fetchPage: (cursor?: string) => Promise<{ items: T[]; nextCursor: string | null }>,
  key: (row: T) => string,
) {
  const seen = new Set<string>(),
    rows = new Map<string, T>();
  let cursor: string | undefined;
  do {
    const page = await fetchPage(cursor);
    for (const row of page.items) rows.set(key(row), row);
    cursor = page.nextCursor ?? undefined;
    if (cursor && seen.has(cursor)) throw new Error('列表游标没有前进，请刷新后重试');
    if (cursor) seen.add(cursor);
  } while (cursor);
  return [...rows.values()];
}
