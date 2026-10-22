import { Alert, Button, Drawer, Space, Spin, type FormInstance } from 'antd';
import {
  createContext,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  type ReactNode,
} from 'react';
import {
  clearDraft,
  decodeDraft,
  draftFingerprint,
  forgetFormSubmit,
  formSubmitState,
  readDraft,
  writeDraft,
  type StoredDraft,
} from '../data/drafts.js';
import { relativeTime } from './format.js';

/**
 * 不是 antd 表单的编辑抽屉（自己用 useState 管内容的）接草稿用：
 * key = 「表单类型:记录 ID / new」，value = 当前内容，restore = 把草稿写回去。
 */
export interface DrawerDraft<T = unknown> {
  key: string;
  value: T;
  restore(value: T): void;
}

interface DrawerCloseApi {
  /** 用户主动关闭（取消按钮）前调用：没保存的内容存草稿。 */
  beforeClose: () => void;
  /** 底部「保存」被点击（给非 antd 表单的抽屉判断是否保存成功）。 */
  submitted: () => void;
}

const DrawerCloseContext = createContext<DrawerCloseApi | null>(null);

/**
 * 统一详情/编辑抽屉：从右侧滑出，底部固定「取消 / 保存」。
 *
 * 10-20 批 E1：点遮罩、右上角 ×、Esc、取消都能关闭；编辑抽屉传了 form + draftKey（或 draft）时，
 * 关闭时把没保存的内容存成本机草稿，下次打开同一条记录提示「恢复 / 丢弃」，保存成功后清除草稿。
 * 详见 data/drafts.ts。
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
  form,
  draftKey,
  draft,
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
  /** antd 表单实例：与 draftKey 一起传，关闭时自动存草稿。 */
  form?: FormInstance;
  /** 草稿键：「表单类型:记录 ID」或「表单类型:new」。 */
  draftKey?: string;
  /** 不是 antd 表单的编辑抽屉用这个接草稿。 */
  draft?: DrawerDraft;
}) {
  const key = draft?.key ?? (form && draftKey ? draftKey : null);
  const [pending, setPending] = useState<StoredDraft | null>(() => (key ? readDraft(key) : null));
  const latest = useRef({ key, form, draft: draft as DrawerDraft | undefined });
  latest.current = { key, form, draft: draft as DrawerDraft | undefined };
  /** 非 antd 表单：打开时的内容指纹（判断改没改）与「点过保存」标记。 */
  const initialPrint = useRef<string | null>(null);
  if (initialPrint.current === null && draft) initialPrint.current = draftFingerprint(draft.value);
  const customSubmitted = useRef(false);

  function currentValue(): unknown {
    const { form: f, draft: d } = latest.current;
    return f ? f.getFieldsValue(true) : d?.value;
  }

  function isDirty(): boolean {
    const { form: f, draft: d } = latest.current;
    if (f) return f.isFieldsTouched();
    if (d) return draftFingerprint(d.value) !== initialPrint.current;
    return false;
  }

  /**
   * reason = close：用户主动关（遮罩 / × / Esc / 取消）；unmount：抽屉被收起或卸载（多半是保存成功后）。
   */
  function persist(reason: 'close' | 'unmount') {
    const { key: k, form: f } = latest.current;
    if (!k) return;
    try {
      if (f) {
        const state = formSubmitState(f);
        const savedOk = state && !state.failed;
        if (reason === 'unmount' && savedOk) {
          clearDraft(k);
          return;
        }
        if (
          reason === 'close' &&
          savedOk &&
          state.fingerprint === draftFingerprint(currentValue())
        ) {
          clearDraft(k);
          return;
        }
        if (reason === 'close') forgetFormSubmit(f);
        if (isDirty()) writeDraft(k, currentValue());
        return;
      }
      if (reason === 'unmount' && customSubmitted.current) {
        clearDraft(k);
        return;
      }
      if (reason === 'close') customSubmitted.current = false;
      if (isDirty()) writeDraft(k, currentValue());
    } catch {
      /* 草稿是锦上添花，出错不影响关闭 */
    }
  }

  // 卸载时（父组件把抽屉整个拿掉）：用 layout effect，赶在表单字段卸载之前读到值。
  const persistRef = useRef(persist);
  persistRef.current = persist;
  useLayoutEffect(() => () => persistRef.current('unmount'), []);
  // 一直挂着、靠 open 开关的抽屉：open 由 true 变 false 时同样处理。
  const wasOpen = useRef(open);
  useEffect(() => {
    if (wasOpen.current && !open) persistRef.current('unmount');
    if (!wasOpen.current && open) {
      setPending(key ? readDraft(key) : null);
      customSubmitted.current = false;
      initialPrint.current = draft ? draftFingerprint(draft.value) : null;
    }
    wasOpen.current = open;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [open]);

  // 同一个抽屉换了记录（键变了）：重新读草稿。
  const lastKey = useRef(key);
  useEffect(() => {
    if (lastKey.current === key) return;
    lastKey.current = key;
    setPending(key ? readDraft(key) : null);
  }, [key]);

  function close() {
    persist('close');
    onClose();
  }

  function restore() {
    if (!pending) return;
    const value = decodeDraft(pending.value);
    const { form: f, draft: d } = latest.current;
    try {
      if (f) f.setFieldsValue(value as never);
      else d?.restore(value);
    } catch {
      /* 表单结构变了，恢复不了就算了 */
    }
    setPending(null);
  }

  function discard() {
    if (key) clearDraft(key);
    setPending(null);
  }

  const api: DrawerCloseApi = {
    beforeClose: () => persist('close'),
    submitted: () => {
      customSubmitted.current = true;
    },
  };

  return (
    <DrawerCloseContext.Provider value={api}>
      <Drawer
        open={open}
        onClose={close}
        width={width}
        maskClosable
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
          <div className="drawer-body">
            {pending && (
              <Alert
                className="drawer-draft"
                type="warning"
                showIcon
                message={`有未保存的草稿（${relativeTime(pending.savedAt)}关闭时留下的）`}
                description="恢复会把上次没保存的内容填回表单；丢弃后不能找回。"
                action={
                  <Space direction="vertical" size={6}>
                    <Button size="small" type="primary" onClick={restore}>
                      恢复
                    </Button>
                    <Button size="small" onClick={discard}>
                      丢弃
                    </Button>
                  </Space>
                }
              />
            )}
            {children}
          </div>
        )}
      </Drawer>
    </DrawerCloseContext.Provider>
  );
}

/** 抽屉底部按钮。error：提交失败时显示在按钮左边的一句红字，点完按钮不用上滑就能看到。 */
export function DrawerActions({
  onCancel,
  onSubmit,
  saving,
  submitText = '保存',
  disabled,
  extra,
  error,
}: {
  onCancel: () => void;
  onSubmit?: () => void;
  saving?: boolean;
  submitText?: string;
  disabled?: boolean;
  extra?: ReactNode;
  error?: ReactNode;
}) {
  const drawer = useContext(DrawerCloseContext);
  return (
    <div className="drawer-actions">
      <Space size={8} className="drawer-actions-left">
        {extra}
        {error && (
          <span
            className="drawer-actions-error"
            role="alert"
            title={typeof error === 'string' ? error : undefined}
          >
            {error}
          </span>
        )}
      </Space>
      <Space size={8}>
        <Button
          onClick={() => {
            drawer?.beforeClose();
            onCancel();
          }}
        >
          取消
        </Button>
        {onSubmit && (
          <Button
            type="primary"
            loading={saving}
            disabled={disabled}
            onClick={() => {
              drawer?.submitted();
              onSubmit();
            }}
          >
            {submitText}
          </Button>
        )}
      </Space>
    </div>
  );
}
