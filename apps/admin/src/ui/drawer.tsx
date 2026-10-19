import { Button, Drawer, Space, Spin } from 'antd';
import type { ReactNode } from 'react';

/**
 * 统一详情/编辑抽屉：从右侧滑出，底部固定「取消 / 保存」。
 * 编辑未保存时点遮罩不关闭，避免误触丢内容。
 */
export function RecordDrawer({
  open,
  onClose,
  title,
  subtitle,
  width = 640,
  loading,
  children,
  footer,
  extra,
}: {
  open: boolean;
  onClose: () => void;
  title: ReactNode;
  subtitle?: ReactNode;
  width?: number;
  loading?: boolean;
  children: ReactNode;
  footer?: ReactNode;
  extra?: ReactNode;
}) {
  return (
    <Drawer
      open={open}
      onClose={onClose}
      width={width}
      maskClosable={false}
      destroyOnHidden
      title={
        <div className="drawer-title">
          <div className="drawer-title-main">{title}</div>
          {subtitle && <div className="drawer-title-sub">{subtitle}</div>}
        </div>
      }
      extra={extra}
      footer={footer}
      styles={{ body: { paddingTop: 16, background: '#F4F5F7' }, footer: { background: '#fff' } }}
    >
      {loading ? (
        <div className="drawer-loading">
          <Spin />
          <span>正在读取…</span>
        </div>
      ) : (
        <div className="drawer-body">{children}</div>
      )}
    </Drawer>
  );
}

/** 抽屉底部按钮。 */
export function DrawerActions({
  onCancel,
  onSubmit,
  saving,
  submitText = '保存',
  disabled,
  extra,
}: {
  onCancel: () => void;
  onSubmit?: () => void;
  saving?: boolean;
  submitText?: string;
  disabled?: boolean;
  extra?: ReactNode;
}) {
  return (
    <div className="drawer-actions">
      <Space size={8}>{extra}</Space>
      <Space size={8}>
        <Button onClick={onCancel}>取消</Button>
        {onSubmit && (
          <Button type="primary" loading={saving} disabled={disabled} onClick={onSubmit}>
            {submitText}
          </Button>
        )}
      </Space>
    </div>
  );
}
