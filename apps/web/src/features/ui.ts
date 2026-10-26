/*
 * 用户端公共 UI 组件统一入口（2026-10-26 批 U1）。名称与何时用见 docs/web/ui-components.md；
 * 新页面从这里引入，不再各自手写弹窗 / 确认块 / 原生日期框。
 */
export {
  AlertDialog,
  Dialog,
  InlineAlert,
  showSnackbar,
  showToast,
  SNACKBAR_MS,
  TOAST_MS,
  type ButtonTone,
  type DialogAction,
  type SnackbarEnd,
  type SnackbarOptions,
  type ToastKind,
} from './toast.js';
export {
  ActionSheet,
  CheckSlot,
  ChoiceSheet,
  Sheet as BottomSheet,
  type ActionItem,
  type ChoiceOption,
  type SheetSnap,
} from './shell-kit.js';
export { EditPage as SubPage, PickRow } from './edit-page.js';
export {
  DateField,
  DatePickerSheet,
  SelectField,
  TimeField,
  type SelectOption,
  OptionPickerSheet,
  PickerSheet,
  TimePickerSheet,
  WheelColumn,
  WheelPicker,
  type WheelItem,
} from './wheel-picker.js';
