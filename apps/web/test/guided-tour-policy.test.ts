import { describe, expect, it } from 'vitest';
import { isGuideBlockingDialog } from '../src/features/guided-tour-policy.js';
function dialog({ hidden = false, guide = false, allowed = false, visible = true } = {}) {
  return {
    getClientRects: () => [{}],
    closest: () => (hidden ? {} : null),
    classList: { contains: () => guide },
    matches: () => allowed,
    checkVisibility: () => visible,
  } as unknown as HTMLElement;
}
describe('guided tour modal interruption policy', () => {
  it('ignores the permanent aria-hidden pull drawer on the real conversation list', () =>
    expect(isGuideBlockingDialog(dialog({ hidden: true }))).toBe(false));
  it('ignores its own explanation and the expected scenario sheet', () => {
    expect(isGuideBlockingDialog(dialog({ guide: true }))).toBe(false);
    expect(isGuideBlockingDialog(dialog({ allowed: true }), '[aria-label="情景预设"]')).toBe(false);
  });
  it('does not mistake transparent/hidden dialogs for active confirmations', () =>
    expect(isGuideBlockingDialog(dialog({ visible: false }))).toBe(false));
  it('still yields to a real unrelated confirmation', () =>
    expect(isGuideBlockingDialog(dialog())).toBe(true));
});
