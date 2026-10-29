/** Permanent, aria-hidden drawers are not active modal interruptions (e.g. the chat pull panel). */
export function isGuideBlockingDialog(element: HTMLElement, allowedDialog?: string): boolean {
  return (
    element.getClientRects().length > 0 &&
    !element.closest('[aria-hidden="true"],[inert]') &&
    !element.classList.contains('guided-tour-card') &&
    !(allowedDialog && element.matches(allowedDialog)) &&
    (typeof element.checkVisibility !== 'function' ||
      element.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true }))
  );
}
