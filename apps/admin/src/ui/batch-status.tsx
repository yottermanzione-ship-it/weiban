import { useState } from 'react';
import { Alert, App, Button, Space } from 'antd';
import { errorText } from '../data/hooks.js';

/** 只复用页面已有的单条操作；不引入越权删除或自动重试。 */
export function BatchStatusActions<T>({
  rows,
  name,
  keyOf,
  labelOf,
  update,
  remove,
  onComplete,
  warning,
}: {
  rows: T[];
  name: string;
  keyOf(row: T): string;
  labelOf(row: T): string;
  update?(row: T, enabled: boolean): Promise<unknown>;
  remove?(row: T): Promise<unknown>;
  onComplete(failedKeys: string[]): void;
  warning?: string;
}) {
  const { modal, message } = App.useApp();
  const [busy, setBusy] = useState(false);
  const [failures, setFailures] = useState<Array<{ label: string; reason: string }>>([]);
  function ask(action: 'enable' | 'disable' | 'delete') {
    const snapshot = [...rows];
    if (!snapshot.length || busy) return;
    const verb = action === 'enable' ? '启用' : action === 'disable' ? '停用' : '删除';
    const dialog = modal.confirm({
      title: `${verb}所选 ${snapshot.length} 项${name}？`,
      content:
        action === 'delete'
          ? '仅删除所选记录，已发出的消息不受影响；操作不能在此撤销。'
          : warning || '只修改所选记录的启停状态，其他内容不变。',
      okText: `确认${verb}`,
      cancelText: '取消',
      centered: true,
      okButtonProps: { danger: action !== 'enable' },
      onOk: async () => {
        setBusy(true);
        setFailures([]);
        dialog.update({ cancelButtonProps: { disabled: true }, keyboard: false });
        const failedKeys: string[] = [];
        const errors: Array<{ label: string; reason: string }> = [];
        try {
          for (const row of snapshot) {
            try {
              if (action === 'delete') {
                if (!remove) throw new Error('此列表没有删除操作');
                await remove(row);
              } else {
                if (!update) throw new Error('此列表没有启停操作');
                await update(row, action === 'enable');
              }
            } catch (error) {
              failedKeys.push(keyOf(row));
              errors.push({ label: labelOf(row), reason: errorText(error) });
            }
          }
          setFailures(errors);
          onComplete(failedKeys);
          if (errors.length)
            message.warning(
              `已${verb} ${snapshot.length - errors.length} 项，${errors.length} 项失败，失败项仍保留选中`,
            );
          else message.success(`已${verb} ${snapshot.length} 项`);
        } finally {
          setBusy(false);
        }
      },
    });
  }
  return (
    <Space size={8} wrap>
      {update && (
        <>
          <Button disabled={busy || !rows.length} onClick={() => ask('enable')}>
            批量启用
          </Button>
          <Button danger disabled={busy || !rows.length} onClick={() => ask('disable')}>
            批量停用
          </Button>
        </>
      )}
      {remove && (
        <Button danger disabled={busy || !rows.length} onClick={() => ask('delete')}>
          批量删除
        </Button>
      )}
      {failures.length > 0 && (
        <Alert
          type="warning"
          showIcon
          message="部分记录未完成，未自动重试"
          description={
            <ul>
              {failures.map((item, index) => (
                <li key={index}>
                  {item.label}：{item.reason}
                </li>
              ))}
            </ul>
          }
        />
      )}
    </Space>
  );
}
