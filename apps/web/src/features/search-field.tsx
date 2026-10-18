import {
  useImperativeHandle,
  useRef,
  type InputHTMLAttributes,
  type ReactNode,
  type Ref,
} from 'react';
import { OldIcon } from './old-icons.js';

/** One field layout for global search, chat search and inline filters. */
export function SearchField({
  children,
  prefix,
  inputRef,
  onClear,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  children?: ReactNode;
  prefix?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
  onClear?: () => void;
}) {
  const field = useRef<HTMLInputElement>(null);
  useImperativeHandle(inputRef, () => field.current!, []);
  return (
    <div
      className="search-entry wx-search-box"
      onClick={(event) => {
        // A label cannot contain the scope/clear buttons. Preserve blank-space/icon
        // focusing without stealing a nested control's click or keyboard action.
        if (
          event.target instanceof Element &&
          !event.target.closest('button, a, input, select, textarea, [role="button"], [tabindex]')
        )
          field.current?.focus();
      }}
    >
      <OldIcon name="wechat/search" size={16} />
      {prefix}
      <input
        {...props}
        ref={field}
        type="search"
        aria-label={props['aria-label'] ?? props.placeholder ?? '搜索'}
      />
      {onClear && String(props.value ?? '').length > 0 && (
        <button
          type="button"
          className="wx-search-clear"
          aria-label="清除搜索"
          disabled={props.disabled || props.readOnly}
          onClick={() => {
            onClear();
            field.current?.focus();
          }}
        >
          <OldIcon name="wechat/close" size={16} />
        </button>
      )}
      {children}
    </div>
  );
}
