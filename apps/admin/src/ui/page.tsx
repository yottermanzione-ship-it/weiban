import { App, Button, Card, Empty, Space, Tag, Tooltip, Typography } from 'antd';
import { QuestionCircleOutlined } from '@ant-design/icons';
import type { ReactNode } from 'react';

/** 页面标题 + 一句话说明 + 右侧主要按钮。 */
export function Page({
  title,
  desc,
  extra,
  children,
}: {
  title: ReactNode;
  desc?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
}) {
  return (
    <div className="page">
      <div className="page-head">
        <div className="page-head-text">
          <h1>{title}</h1>
          {desc && <p>{desc}</p>}
        </div>
        {extra && <div className="page-head-extra">{extra}</div>}
      </div>
      {children}
    </div>
  );
}

/** 术语解释：问号图标 + 鼠标悬停说明。 */
export function HelpTip({ text }: { text: ReactNode }) {
  return (
    <Tooltip title={text}>
      <QuestionCircleOutlined className="help-tip" />
    </Tooltip>
  );
}

/** 字段下面那行大白话说明。 */
export function FieldHelp({ children }: { children: ReactNode }) {
  return <span className="field-help">{children}</span>;
}

export function SectionCard({
  title,
  desc,
  extra,
  children,
  bodyStyle,
}: {
  title?: ReactNode;
  desc?: ReactNode;
  extra?: ReactNode;
  children: ReactNode;
  bodyStyle?: React.CSSProperties;
}) {
  return (
    <Card
      className="section-card"
      title={
        title ? (
          <div className="section-card-title">
            <span>{title}</span>
            {desc && <span className="section-card-desc">{desc}</span>}
          </div>
        ) : undefined
      }
      extra={extra}
      styles={{ body: { padding: 16, ...bodyStyle } }}
    >
      {children}
    </Card>
  );
}

/** 表单分组标题。 */
export function FormSection({ title, desc }: { title: ReactNode; desc?: ReactNode }) {
  return (
    <div className="form-section">
      <span>{title}</span>
      {desc && <span className="form-section-desc">{desc}</span>}
    </div>
  );
}

/** 空状态：说清这里会出现什么、怎么加第一条。 */
export function EmptyHint({
  title = '还没有数据',
  hint,
  action,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  action?: ReactNode;
}) {
  return (
    <div className="empty-hint">
      <Empty
        image={Empty.PRESENTED_IMAGE_SIMPLE}
        description={
          <div>
            <div className="empty-title">{title}</div>
            {hint && <div className="empty-desc">{hint}</div>}
          </div>
        }
      >
        {action}
      </Empty>
    </div>
  );
}

const STATUS_COLORS: Record<string, string> = {
  success: 'green',
  warning: 'orange',
  error: 'red',
  processing: 'blue',
  default: 'default',
  purple: 'purple',
  cyan: 'cyan',
};

export type StatusTone = keyof typeof STATUS_COLORS;

/** 状态标签：颜色只表达状态，不表达品牌。 */
export function StatusTag({
  tone = 'default',
  children,
}: {
  tone?: StatusTone;
  children: ReactNode;
}) {
  return (
    <Tag color={STATUS_COLORS[tone]} bordered={false} className="status-tag">
      {children}
    </Tag>
  );
}

/** 危险操作二次确认（删除、下架、封禁、撤回）。 */
export function useDangerConfirm() {
  const { modal } = App.useApp();
  return ({
    title,
    content,
    okText = '确认',
    onOk,
  }: {
    title: ReactNode;
    content: ReactNode;
    okText?: string;
    onOk: () => void | Promise<void>;
  }) => {
    modal.confirm({
      title,
      content,
      okText,
      cancelText: '取消',
      okButtonProps: { danger: true },
      centered: true,
      onOk,
    });
  };
}

export function useToast() {
  const { message } = App.useApp();
  return message;
}

/** 说明性质的灰色小字块。 */
export function Note({ children }: { children: ReactNode }) {
  return <div className="note-block">{children}</div>;
}

export function Toolbar({ children }: { children: ReactNode }) {
  return (
    <Space size={8} wrap>
      {children}
    </Space>
  );
}

export function TextMuted({ children }: { children: ReactNode }) {
  return <Typography.Text type="secondary">{children}</Typography.Text>;
}

export function EmptyButton() {
  return <Button disabled>—</Button>;
}
