import type { InputHTMLAttributes, ReactNode, Ref } from 'react';
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
  return (
    <label className="search-entry wx-search-box">
      <OldIcon name="wechat/search" size={16} />
      {prefix}
      <input
        {...props}
        ref={inputRef}
        type="search"
        aria-label={props['aria-label'] ?? props.placeholder ?? '搜索'}
      />
      {children}
    </label>
  );
}
