/**
 * 批量操作弹窗：先二次确认（写清「将影响 N 项」和后果）→ 逐条执行 → 列出每一条结果。
 * 失败项会保留给页面继续选中；确认和结果分两步，避免一次点击就直接删数据。
 */
import { useState, type ReactNode } from 'react';
import { Alert, Button, Modal, Space, Tag } from 'antd';
import { errorText } from '../data/hooks.js';

export interface BatchFailure {
  key: string;
  label: string;
  reason: string;
}

interface BatchResultRow {
  key: string;
  label: string;
  ok: boolean;
  message?: string;
}

/** 表格上方那行「已选 N 项（仅当前页）」+ 操作按钮。 */
export function BatchBar({ count, children }: { count: number; children: ReactNode }) {
  return (
    <Space size={8} wrap>
      <span className="cell-sub">已选 {count} 项（仅当前页）</span>
      {children}
    </Space>
  );
}

/** 关闭弹窗后常驻在列表上方的失败清单；每项都写清名字和原因。 */
export function BatchFailureAlert({
  failures,
  onDismiss,
}: {
  failures: BatchFailure[];
  onDismiss: () => void;
}) {
  if (failures.length === 0) return null;
  return (
    <Alert
      type="warning"
      showIcon
      closable
      onClose={onDismiss}
      message={`有 ${failures.length} 项没有完成，失败项仍保持选中`}
      description={
        <ul style={{ margin: 0, paddingLeft: 18 }}>
          {failures.map((item) => (
            <li key={item.key}>
              {item.label}：{item.reason}
            </li>
          ))}
        </ul>
      }
      style={{ marginBottom: 12 }}
    />
  );
}

/**
 * 通用批量操作弹窗。调用方在打开时传入一份快照 targets，执行期间列表刷新不会改变本次范围。
 * run 返回一句成功说明（可选）；抛错即记为该条失败。
 */
export function BatchOperationModal<T>({
  title,
  intro,
  targets,
  keyOf,
  labelOf,
  confirmText = '确认',
  danger = true,
  confirmDisabled = false,
  run,
  onCancel,
  onFinished,
  children,
}: {
  title: ReactNode;
  intro?: ReactNode;
  targets: readonly T[];
  keyOf: (target: T) => string;
  labelOf: (target: T) => string;
  confirmText?: string;
  danger?: boolean;
  confirmDisabled?: boolean;
  run: (target: T) => Promise<string | void>;
  onCancel: () => void;
  onFinished: (failures: BatchFailure[]) => void;
  children?: ReactNode;
}) {
  const [phase, setPhase] = useState<'confirm' | 'running' | 'done'>('confirm');
  const [results, setResults] = useState<BatchResultRow[]>([]);

  const failures: BatchFailure[] = results
    .filter((row) => !row.ok)
    .map((row) => ({ key: row.key, label: row.label, reason: row.message ?? '未知错误' }));
  const successCount = results.length - failures.length;

  async function start() {
    setPhase('running');
    setResults([]);
    const collected: BatchResultRow[] = [];
    for (const target of targets) {
      try {
        const result = await run(target);
        collected.push({
          key: keyOf(target),
          label: labelOf(target),
          ok: true,
          message: typeof result === 'string' ? result : undefined,
        });
      } catch (error) {
        collected.push({
          key: keyOf(target),
          label: labelOf(target),
          ok: false,
          message: errorText(error),
        });
      }
      setResults([...collected]);
    }
    setPhase('done');
  }

  function close() {
    if (phase === 'done') onFinished(failures);
    else onCancel();
  }

  return (
    <Modal
      open
      centered
      width={600}
      title={title}
      maskClosable={false}
      keyboard={phase !== 'running'}
      closable={phase !== 'running'}
      onCancel={phase === 'running' ? undefined : close}
      footer={
        phase === 'confirm' ? (
          <Space>
            <Button onClick={close}>取消</Button>
            <Button
              type="primary"
              danger={danger}
              disabled={confirmDisabled}
              onClick={() => void start()}
            >
              {confirmText}
            </Button>
          </Space>
        ) : phase === 'done' ? (
          <Button type="primary" onClick={close}>
            关闭
          </Button>
        ) : (
          <Button loading disabled>
            正在处理…
          </Button>
        )
      }
    >
      {phase === 'confirm' ? (
        <div className="delete-impact">
          <Alert
            type={danger ? 'error' : 'warning'}
            showIcon
            message={`将影响 ${targets.length} 项`}
            description={intro}
          />
          <p className="delete-impact-names" style={{ marginTop: 12 }}>
            本次范围（{targets.length} 项）：
            {targets.slice(0, 12).map(labelOf).join('、')}
            {targets.length > 12 ? ` 等 ${targets.length} 项` : ''}
          </p>
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10, marginTop: 12 }}>
            {children}
          </div>
        </div>
      ) : (
        <div>
          <Alert
            type={phase === 'running' ? 'info' : failures.length ? 'warning' : 'success'}
            showIcon
            message={
              phase === 'running'
                ? `正在逐条处理 ${results.length} / ${targets.length}…`
                : `完成：成功 ${successCount} 项${failures.length ? `，失败 ${failures.length} 项` : ''}`
            }
            description={
              phase === 'running'
                ? '请保持页面打开；每条都会单独提交，结果实时列在下面。'
                : failures.length
                  ? '失败项会在关闭后保持选中，可以处理后重试。'
                  : '全部完成。'
            }
          />
          <div style={{ maxHeight: 280, overflowY: 'auto', marginTop: 12 }}>
            {results.map((row) => (
              <div
                key={row.key}
                style={{
                  display: 'flex',
                  gap: 8,
                  alignItems: 'flex-start',
                  padding: '6px 0',
                  borderBottom: '1px solid #f0f0f0',
                }}
              >
                <Tag color={row.ok ? 'green' : 'red'} bordered={false}>
                  {row.ok ? '成功' : '失败'}
                </Tag>
                <span style={{ flex: 1, wordBreak: 'break-all' }}>{row.label}</span>
                {row.message && (
                  <span className="cell-sub" style={{ maxWidth: 260, textAlign: 'right' }}>
                    {row.message}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      )}
    </Modal>
  );
}
