import { useImperativeHandle, useRef, type InputHTMLAttributes, type ReactNode, type Ref } from 'react';
import { OldIcon } from './old-icons.js';

/** One field layout for global search, chat search and inline filters. */
export function SearchField({
  children,
  prefix,
  inputRef,
  ...props
}: Omit<InputHTMLAttributes<HTMLInputElement>, 'prefix'> & {
  children?: ReactNode;
  prefix?: ReactNode;
  inputRef?: Ref<HTMLInputElement>;
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
      {children}
    </div>
  );
}
