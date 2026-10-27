/*
 * 中文输入法回车只选字（26 号 §5；2026-10-27 批 U5）。
 *
 * 用拼音输入法时，候选词出来后按回车是「把拼音按字母上屏 / 选字」，不能当成「发送 / 提交 / 搜索」。
 * - Chrome / 安卓 WebView：选字那次 keydown 带 isComposing = true（keyCode 229）；
 * - Safari：先触发 compositionend，紧接着的回车 keydown 里 isComposing 已经是 false，只能靠时间差判断。
 * isImeEnter 三种情况都认；installImeEnterGuard 在全站单行输入框上拦掉选字回车的默认动作（表单隐式提交）。
 */
let composedAt = 0;

/** 这次回车是不是输入法在选字 / 上屏（是就不要当成提交）。 */
export function isImeEnter(event: KeyboardEvent | { nativeEvent: KeyboardEvent }): boolean {
  const native = 'nativeEvent' in event ? event.nativeEvent : event;
  return native.isComposing || native.keyCode === 229 || performance.now() - composedAt < 60;
}

let installed = false;
/** 全站一次：单行输入框里选字的回车不触发表单提交（搜索框、资料编辑、评论等不用各自处理）。 */
export function installImeEnterGuard() {
  if (installed || typeof document === 'undefined') return;
  installed = true;
  document.addEventListener(
    'compositionend',
    () => {
      composedAt = performance.now();
    },
    true,
  );
  document.addEventListener(
    'keydown',
    (event) => {
      if (event.key !== 'Enter' || !isImeEnter(event)) return;
      const target = event.target;
      // Chrome 选字中本来就不会隐式提交，只拦 Safari 那种「选字刚结束」的回车。
      if (target instanceof HTMLInputElement && !event.isComposing) event.preventDefault();
    },
    true,
  );
}
