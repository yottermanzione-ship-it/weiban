/*
 * 资料编辑二级页面（10-21 G2，按微信截图一比一）：
 * - EditPage：灰底，顶栏「取消 / 标题 / 完成」，完成按钮无改动或必填为空时灰色不可点，有改动才变绿；
 * - ClearInput：白色通栏输入行 + 右侧圆形清除按钮；
 * - CountTextarea：多行输入 + 右下角剩余字数；
 * - FormPage：白底，左上「×」、大标题、上下细线输入框、说明、底部灰 → 绿「确定」（微信「设置拍一拍」）；
 * - InfoPage：白底，左上返回、大图标、标题、说明、底部灰色按钮（微信「微信号」页）。
 * 这些页面都是独立路由，进入 / 返回沿用 RouteMotion 的整页推入转场。
 */
import { useRef, useState, type ReactNode } from 'react';
import { OldIcon } from './old-icons.js';
import { BackArrow, NavBar, useBack } from './shell-kit.js';

export function EditPage({
  title,
  canSave,
  pending = false,
  onSave,
  fallback,
  children,
  className,
}: {
  title: string;
  /** 有有效改动且必填不为空时才为 true。 */
  canSave: boolean;
  pending?: boolean;
  onSave(): void;
  fallback: string;
  children: ReactNode;
  className?: string;
}) {
  const back = useBack(fallback);
  return (
    <main className={`edit-page ${className ?? ''}`}>
      <NavBar
        title={title}
        left={
          <button type="button" className="edit-cancel" disabled={pending} onClick={back}>
            取消
          </button>
        }
        right={
          <button
            type="button"
            className="primary edit-done"
            disabled={!canSave || pending}
            aria-busy={pending}
            onClick={onSave}
          >
            完成
          </button>
        }
      />
      {children}
    </main>
  );
}

/** 白色通栏输入行，有内容时右侧出现灰色圆形清除按钮（微信「设置名字」）。 */
export function ClearInput({
  value,
  onChange,
  maxLength,
  placeholder,
  label,
  type = 'text',
  disabled,
  autoFocus = true,
  onEnter,
}: {
  value: string;
  onChange(value: string): void;
  maxLength?: number;
  placeholder?: string;
  label: string;
  type?: 'text' | 'date';
  disabled?: boolean;
  autoFocus?: boolean;
  onEnter?(): void;
}) {
  const input = useRef<HTMLInputElement>(null);
  return (
    <div className="edit-input-row">
      <input
        ref={input}
        aria-label={label}
        type={type}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus={autoFocus}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => {
          if (event.key === 'Enter' && !event.nativeEvent.isComposing) onEnter?.();
        }}
      />
      {value !== '' && !disabled && (
        <button
          type="button"
          className="edit-clear"
          aria-label="清除"
          // 按下时不让输入框失焦，清除后键盘不收起
          onPointerDown={(event) => event.preventDefault()}
          onClick={() => {
            onChange('');
            input.current?.focus();
          }}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <circle cx="9" cy="9" r="9" fill="currentColor" />
            <path d="M6 6l6 6M12 6l-6 6" stroke="#fff" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      )}
    </div>
  );
}

/** 多行输入，右下角显示还能输入多少字（微信「设置个性签名」）。 */
export function CountTextarea({
  value,
  onChange,
  maxLength,
  label,
  placeholder,
  disabled,
}: {
  value: string;
  onChange(value: string): void;
  maxLength: number;
  label: string;
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <div className="edit-textarea">
      <textarea
        aria-label={label}
        value={value}
        maxLength={maxLength}
        placeholder={placeholder}
        disabled={disabled}
        autoFocus
        rows={3}
        onChange={(event) => onChange(event.target.value)}
      />
      <small aria-label={`还能输入 ${maxLength - value.length} 字`}>
        {maxLength - value.length}
      </small>
    </div>
  );
}

/** 白底单字段表单页（微信「设置拍一拍」）：左上 ×、大标题、细线输入、说明，底部灰 → 绿「确定」。 */
export function FormPage({
  title,
  value,
  onChange,
  maxLength,
  placeholder,
  label,
  description,
  canSubmit,
  pending = false,
  onSubmit,
  fallback,
  children,
  prefix,
}: {
  title: string;
  value: string;
  onChange(value: string): void;
  /** 3.27（H1 拍一拍）：输入框前的固定文字（微信「拍了拍我」+ 后缀输入）。 */
  prefix?: ReactNode;
  maxLength?: number;
  placeholder?: string;
  label: string;
  description?: ReactNode;
  canSubmit: boolean;
  pending?: boolean;
  onSubmit(): void;
  fallback: string;
  children?: ReactNode;
}) {
  const back = useBack(fallback);
  return (
    <main className="form-page">
      <header className="form-page-bar">
        <button
          type="button"
          className="form-page-close"
          aria-label="关闭"
          disabled={pending}
          onClick={back}
        >
          <svg width="18" height="18" viewBox="0 0 18 18" aria-hidden>
            <path d="M2 2l14 14M16 2L2 16" stroke="currentColor" strokeWidth="1.6" />
          </svg>
        </button>
      </header>
      <h1 className="form-page-title">{title}</h1>
      <div className={prefix ? 'form-page-field has-prefix' : 'form-page-field'}>
        {prefix && <span className="form-page-prefix">{prefix}</span>}
        <input
          aria-label={label}
          value={value}
          maxLength={maxLength}
          placeholder={placeholder}
          disabled={pending}
          autoFocus
          onChange={(event) => onChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.nativeEvent.isComposing && canSubmit && !pending)
              onSubmit();
          }}
        />
      </div>
      {description && <div className="form-page-desc">{description}</div>}
      {children}
      <div className="form-page-bottom">
        <button
          type="button"
          className="primary form-page-submit"
          disabled={!canSubmit || pending}
          aria-busy={pending}
          onClick={onSubmit}
        >
          确定
        </button>
      </div>
    </main>
  );
}

/** 白底说明页（微信「微信号」）：返回、大图标、标题、说明，底部灰色按钮。 */
export function InfoPage({
  icon,
  title,
  description,
  actionLabel,
  onAction,
  actionDisabled,
  fallback,
  children,
}: {
  icon: ReactNode;
  title: ReactNode;
  description?: ReactNode;
  actionLabel: string;
  onAction(): void;
  actionDisabled?: boolean;
  fallback: string;
  children?: ReactNode;
}) {
  const back = useBack(fallback);
  return (
    <main className="info-page">
      <header className="form-page-bar">
        <button type="button" className="nav-bar-back" aria-label="返回" onClick={back}>
          <BackArrow />
        </button>
      </header>
      <div className="info-page-icon">{icon}</div>
      <h1 className="info-page-title">{title}</h1>
      {description && <div className="info-page-desc">{description}</div>}
      {children}
      <div className="form-page-bottom info">
        <button
          type="button"
          className="secondary-button"
          disabled={actionDisabled}
          onClick={onAction}
        >
          {actionLabel}
        </button>
      </div>
    </main>
  );
}

/** 单选列表行：文字左对齐，选中项右侧绿色对号（微信「设置性别」）。 */
export function PickRow({
  label,
  checked,
  onClick,
  disabled,
}: {
  label: ReactNode;
  checked: boolean;
  onClick(): void;
  disabled?: boolean;
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={checked}
      className="pick-row"
      disabled={disabled}
      onClick={onClick}
    >
      <span>{label}</span>
      {checked && <OldIcon name="wechat/check" size={22} className="ink-brand" />}
    </button>
  );
}

/** 编辑页通用的「草稿 + 是否有改动」状态。初始值只取第一次，之后服务器刷新不覆盖正在编辑的内容。 */
export function useDraft(initial: string) {
  const [first] = useState(initial);
  const [value, setValue] = useState(initial);
  return { value, setValue, changed: value.trim() !== first.trim(), initial: first };
}
