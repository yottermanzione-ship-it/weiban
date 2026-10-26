/*
 * 微信式滚轮选择器（26 号 §2「表单选值梯度」：日期 / 时间用滚轮，不用浏览器原生框）。
 * - WheelColumn：一列滚轮，滚动停下自动吸附到最近一项；中间一行是选中项，上下渐隐；
 *   键盘 ↑ / ↓ 切换，点某一项直接滚到它。
 * - PickerSheet：底部面板外壳（复用 Sheet），顶栏「取消 / 标题 / 确定」，确定才提交。
 * - DatePickerSheet / TimePickerSheet / OptionPickerSheet：日期、时间、一般选项三种现成用法。
 */
import {
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import { ChoiceSheet, Sheet } from './shell-kit.js';

/** 每行高度与可见行数（选中行在正中）。改这里要同步 ui-components.css 的 --wheel-row。 */
const ROW = 48;
const VISIBLE = 5;
/** 滚动停下多久后判定为「停了」，再吸附并回报选中值。 */
const SETTLE_MS = 110;

export interface WheelItem<T extends string | number> {
  value: T;
  label: string;
}

export function WheelColumn<T extends string | number>({
  items,
  value,
  onChange,
  label,
}: {
  items: WheelItem<T>[];
  value: NoInfer<T>;
  onChange(value: NoInfer<T>): void;
  /** 读屏用的列名，如「年」「月」。 */
  label: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const scrolling = useRef(false);
  const timer = useRef(0);
  const baseId = useId();
  const index = Math.max(
    0,
    items.findIndex((item) => item.value === value),
  );
  // 外部值变化（或列表变短，如 31 日 → 2 月）时滚到对应行；用户正在滑时不抢。
  useLayoutEffect(() => {
    const el = ref.current;
    if (!el || scrolling.current) return;
    if (Math.abs(el.scrollTop - index * ROW) > 1) el.scrollTop = index * ROW;
  }, [index, items.length]);
  useEffect(() => () => window.clearTimeout(timer.current), []);
  const settle = () => {
    const el = ref.current;
    scrolling.current = false;
    if (!el) return;
    const next = Math.max(0, Math.min(items.length - 1, Math.round(el.scrollTop / ROW)));
    const item = items[next];
    if (item && item.value !== value) onChange(item.value);
    else el.scrollTo({ top: next * ROW, behavior: 'smooth' });
  };
  const step = (delta: number) => {
    const item = items[Math.max(0, Math.min(items.length - 1, index + delta))];
    if (item && item.value !== value) onChange(item.value);
  };
  return (
    <div
      ref={ref}
      className="wheel-column"
      role="listbox"
      tabIndex={0}
      aria-label={label}
      aria-activedescendant={`${baseId}-${index}`}
      onScroll={() => {
        scrolling.current = true;
        window.clearTimeout(timer.current);
        timer.current = window.setTimeout(settle, SETTLE_MS);
      }}
      onKeyDown={(event) => {
        if (event.key === 'ArrowUp') step(-1);
        else if (event.key === 'ArrowDown') step(1);
        else return;
        event.preventDefault();
      }}
    >
      {items.map((item, i) => (
        <div
          key={String(item.value)}
          id={`${baseId}-${i}`}
          role="option"
          aria-selected={i === index}
          className={i === index ? 'wheel-item on' : 'wheel-item'}
          onClick={() => {
            if (item.value !== value) onChange(item.value);
          }}
        >
          {item.label}
        </div>
      ))}
    </div>
  );
}

/** 多列并排 + 中间选中带的两条细线。 */
export function WheelPicker({ children }: { children: ReactNode }) {
  return (
    <div className="wheel-picker" style={{ height: ROW * VISIBLE }}>
      <div className="wheel-band" aria-hidden />
      {children}
    </div>
  );
}

/** 滚轮选择面板外壳：复用底部面板 Sheet，左「取消」中标题右绿色「确定」。点蒙层等同取消。 */
export function PickerSheet({
  title,
  onCancel,
  onConfirm,
  confirmLabel = '确定',
  confirmDisabled = false,
  onClear,
  clearLabel = '清除',
  children,
}: {
  title: string;
  onCancel(): void;
  onConfirm(): void;
  confirmLabel?: string;
  confirmDisabled?: boolean;
  /** 可选值（如「结束日期」）：面板底部出现一行「清除」，点了把值清空并关闭。 */
  onClear?(): void;
  clearLabel?: string;
  children: ReactNode;
}) {
  return (
    <Sheet
      title={title}
      closeLabel="取消"
      onClose={onCancel}
      action={
        <button
          type="button"
          className="primary sheet-confirm"
          disabled={confirmDisabled}
          onClick={onConfirm}
        >
          {confirmLabel}
        </button>
      }
    >
      <div className="picker-sheet-body">{children}</div>
      {onClear && (
        <button type="button" className="picker-sheet-clear" onClick={onClear}>
          {clearLabel}
        </button>
      )}
    </Sheet>
  );
}

const pad = (n: number) => String(n).padStart(2, '0');
const daysIn = (year: number, month: number) => new Date(year, month, 0).getDate();
function parseDate(text: string | null | undefined) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(text ?? '');
  return m ? { y: Number(m[1]), m: Number(m[2]), d: Number(m[3]) } : null;
}
const range = (from: number, to: number) =>
  Array.from({ length: Math.max(0, to - from + 1) }, (_, i) => from + i);

/** 日期滚轮（年 / 月 / 日），值为 YYYY-MM-DD；min / max 同格式，默认 1900-01-01 到今天。 */
export function DatePickerSheet({
  title,
  value,
  min = '1900-01-01',
  max,
  onConfirm,
  onCancel,
  onClear,
  clearLabel,
}: {
  title: string;
  value: string | null;
  min?: string;
  max?: string;
  onConfirm(value: string): void;
  onCancel(): void;
  onClear?(): void;
  clearLabel?: string;
}) {
  const today = new Date();
  const lo = parseDate(min) ?? { y: 1900, m: 1, d: 1 };
  const hi = parseDate(max) ?? {
    y: today.getFullYear(),
    m: today.getMonth() + 1,
    d: today.getDate(),
  };
  // 没有值时：范围跨度大（生日）从 2000 年起；近期范围（提醒、纪念日、搜索）从今天起
  const near = lo.y > 2000 || hi.y < 2000 || hi.y - lo.y < 30;
  const start =
    parseDate(value) ??
    (near
      ? {
          y: Math.min(hi.y, Math.max(lo.y, today.getFullYear())),
          m: today.getMonth() + 1,
          d: today.getDate(),
        }
      : { y: 2000, m: 1, d: 1 });
  const [y, setY] = useState(start.y);
  const [mo, setMo] = useState(start.m);
  const [d, setD] = useState(start.d);
  const monthFrom = y === lo.y ? lo.m : 1;
  const monthTo = y === hi.y ? hi.m : 12;
  const month = Math.min(monthTo, Math.max(monthFrom, mo));
  const dayFrom = y === lo.y && month === lo.m ? lo.d : 1;
  const dayTo = y === hi.y && month === hi.m ? hi.d : daysIn(y, month);
  const day = Math.min(dayTo, Math.max(dayFrom, d));
  const years = useMemo(
    () => range(lo.y, hi.y).map((n) => ({ value: n, label: `${n}年` })),
    [lo.y, hi.y],
  );
  const months = range(monthFrom, monthTo).map((n) => ({ value: n, label: `${n}月` }));
  const days = range(dayFrom, dayTo).map((n) => ({ value: n, label: `${n}日` }));
  return (
    <PickerSheet
      title={title}
      onCancel={onCancel}
      onClear={onClear}
      clearLabel={clearLabel}
      onConfirm={() => onConfirm(`${y}-${pad(month)}-${pad(day)}`)}
    >
      <WheelPicker>
        <WheelColumn label="年" items={years} value={y} onChange={setY} />
        <WheelColumn label="月" items={months} value={month} onChange={setMo} />
        <WheelColumn label="日" items={days} value={day} onChange={setD} />
      </WheelPicker>
    </PickerSheet>
  );
}

/** 时间滚轮（时 / 分），值为 HH:mm；minuteStep 如 5 则分钟按 5 分一档。 */
export function TimePickerSheet({
  title,
  value,
  minuteStep = 1,
  onConfirm,
  onCancel,
}: {
  title: string;
  value: string | null;
  minuteStep?: number;
  onConfirm(value: string): void;
  onCancel(): void;
}) {
  const m = /^(\d{2}):(\d{2})$/.exec(value ?? '');
  const [h, setH] = useState(m ? Number(m[1]) : 9);
  const [mi, setMi] = useState(
    m ? Math.min(60 - minuteStep, Math.round(Number(m[2]) / minuteStep) * minuteStep) : 0,
  );
  const hours = range(0, 23).map((n) => ({ value: n, label: pad(n) }));
  const minutes = range(0, Math.floor(59 / minuteStep)).map((n) => ({
    value: n * minuteStep,
    label: pad(n * minuteStep),
  }));
  return (
    <PickerSheet
      title={title}
      onCancel={onCancel}
      onConfirm={() => onConfirm(`${pad(h)}:${pad(mi)}`)}
    >
      <WheelPicker>
        <WheelColumn label="时" items={hours} value={h} onChange={setH} />
        <WheelColumn label="分" items={minutes} value={mi} onChange={setMi} />
      </WheelPicker>
    </PickerSheet>
  );
}

/** 一般选项滚轮（单列）：选项较多、又想保留「滑着挑」手感时用；少量选项优先 ChoiceSheet。 */
export function OptionPickerSheet<T extends string | number>({
  title,
  options,
  value,
  onConfirm,
  onCancel,
}: {
  title: string;
  options: WheelItem<T>[];
  value: T | null;
  onConfirm(value: T): void;
  onCancel(): void;
}) {
  const [current, setCurrent] = useState<T | undefined>(value ?? options[0]?.value);
  return (
    <PickerSheet
      title={title}
      onCancel={onCancel}
      confirmDisabled={current === undefined}
      onConfirm={() => {
        if (current !== undefined) onConfirm(current);
      }}
    >
      <WheelPicker>
        {current !== undefined && (
          <WheelColumn label={title} items={options} value={current} onChange={setCurrent} />
        )}
      </WheelPicker>
    </PickerSheet>
  );
}

// ---------- 表单里的选择框（替代浏览器原生 date / time / select，2026-10-26 批 U2） ----------

/** 输入框外观的触发按钮：显示当前值（空则灰字占位），右侧小箭头；点开对应的选择面板。 */
function PickerTrigger({
  text,
  placeholder,
  disabled,
  className,
  label,
  onOpen,
}: {
  text: string | null | undefined;
  placeholder: string;
  disabled?: boolean;
  className?: string;
  label?: string;
  onOpen(): void;
}) {
  return (
    <button
      type="button"
      className={`picker-field ${text ? '' : 'empty'} ${className ?? ''}`}
      aria-haspopup="dialog"
      aria-label={label ? `${label}：${text || placeholder}` : undefined}
      disabled={disabled}
      onClick={onOpen}
    >
      <span className="picker-field-text">{text || placeholder}</span>
      <svg className="picker-field-caret" width="8" height="14" viewBox="0 0 8 14" aria-hidden>
        <path d="M1 1l6 6-6 6" fill="none" stroke="currentColor" strokeWidth="1.4" />
      </svg>
    </button>
  );
}

/** 日期选择框（值 YYYY-MM-DD，空串表示未选）：点开日期滚轮；clearable 时面板底部有「清除」。 */
export function DateField({
  value,
  onChange,
  title,
  label,
  min,
  max,
  placeholder = '请选择',
  disabled,
  className,
  clearable = false,
  clearLabel,
}: {
  value: string;
  onChange(value: string): void;
  title: string;
  label?: string;
  min?: string;
  max?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  clearable?: boolean;
  clearLabel?: string;
}) {
  const [open, setOpen] = useState(false);
  const d = parseDate(value);
  const text = d ? `${d.y}年${d.m}月${d.d}日` : value;
  return (
    <>
      <PickerTrigger
        text={text}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        label={label ?? title}
        onOpen={() => setOpen(true)}
      />
      {open && (
        <DatePickerSheet
          title={title}
          value={value || null}
          min={min}
          max={max}
          clearLabel={clearLabel}
          onCancel={() => setOpen(false)}
          onClear={
            clearable && value
              ? () => {
                  setOpen(false);
                  onChange('');
                }
              : undefined
          }
          onConfirm={(next) => {
            setOpen(false);
            if (next !== value) onChange(next);
          }}
        />
      )}
    </>
  );
}

/** 时间选择框（值 HH:mm）：点开时间滚轮。 */
export function TimeField({
  value,
  onChange,
  title,
  label,
  placeholder = '请选择',
  minuteStep,
  disabled,
  className,
}: {
  value: string;
  onChange(value: string): void;
  title: string;
  label?: string;
  placeholder?: string;
  minuteStep?: number;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <>
      <PickerTrigger
        text={value}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        label={label ?? title}
        onOpen={() => setOpen(true)}
      />
      {open && (
        <TimePickerSheet
          title={title}
          value={value || null}
          minuteStep={minuteStep}
          onCancel={() => setOpen(false)}
          onConfirm={(next) => {
            setOpen(false);
            if (next !== value) onChange(next);
          }}
        />
      )}
    </>
  );
}

export interface SelectOption<T extends string | number> {
  value: T;
  label: string;
  disabled?: boolean;
}

/**
 * 选项选择框（替代原生 select）：≤10 个选项点开 Choice Sheet（点一项即选中），
 * 更多时用单列滚轮 OptionPickerSheet。
 */
export function SelectField<T extends string | number>({
  value,
  options,
  onChange,
  title,
  label,
  placeholder = '请选择',
  disabled,
  className,
}: {
  value: T;
  options: SelectOption<T>[];
  onChange(value: T): void;
  title: string;
  label?: string;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const current = options.find((option) => option.value === value);
  return (
    <>
      <PickerTrigger
        text={current?.label}
        placeholder={placeholder}
        disabled={disabled}
        className={className}
        label={label ?? title}
        onOpen={() => setOpen(true)}
      />
      {open &&
        (options.length <= 10 ? (
          <ChoiceSheet
            title={title}
            options={options}
            value={value}
            onClose={() => setOpen(false)}
            onChange={onChange}
          />
        ) : (
          <OptionPickerSheet
            title={title}
            options={options.filter((option) => !option.disabled)}
            value={current ? value : null}
            onCancel={() => setOpen(false)}
            onConfirm={(next) => {
              setOpen(false);
              if (next !== value) onChange(next);
            }}
          />
        ))}
    </>
  );
}
