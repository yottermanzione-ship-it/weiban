/** Account-owned cloud state; the historical unowned localStorage key is untouched. */
import {
  createContext,
  createElement,
  useContext,
  useEffect,
  useMemo,
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { ContactOrganizationEndpoints } from '@weiban/contracts';
import { useAuth } from '../app/auth.js';
import { api } from './client.js';
import { useUpdates } from './updates.js';
import { ContactOrganizationController, EMPTY_ORGANIZATION_STATE } from './contact-organization.js';
const Context = createContext<ContactOrganizationController | null>(null);
const noopSubscribe = () => () => {};
const empty = () => EMPTY_ORGANIZATION_STATE;
export function ContactOrganizationProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const owner = session ? `${session.user.userId}:${session.session.sessionId}` : 'public';
  const controller = useMemo(
    () =>
      owner === 'public'
        ? null
        : new ContactOrganizationController(owner, () => api.ownerKey(), {
            get: (signal) =>
              api.call(ContactOrganizationEndpoints.get, { networkOnly: true, signal }),
            save: (body, signal) =>
              api.call(ContactOrganizationEndpoints.save, { body, networkOnly: true, signal }),
          }),
    [owner],
  );
  useEffect(() => {
    if (!controller) return;
    controller.activate();
    void controller.refresh();
    const foreground = () => {
      if (document.visibilityState === 'visible') void controller.refresh();
    };
    const focus = () => {
      void controller.refresh();
    };
    document.addEventListener('visibilitychange', foreground);
    window.addEventListener('focus', focus);
    return () => {
      document.removeEventListener('visibilitychange', foreground);
      window.removeEventListener('focus', focus);
      controller.dispose();
    };
  }, [controller]);
  useUpdates((update) => {
    if (
      (update.type === 'data.changed' &&
        (update.data as { section?: string })?.section === 'contact_organization') ||
      update.type.startsWith('contact.')
    )
      void controller?.refresh();
  });
  return createElement(Context.Provider, { value: controller }, children);
}
export function useContactOrganization() {
  const controller = useContext(Context);
  const state = useSyncExternalStore(
    controller?.subscribe ?? noopSubscribe,
    controller?.snapshot ?? empty,
    empty,
  );
  return { ...state, controller, ready: !!state.snapshot && !!controller?.isCurrent() };
}
export function useStars() {
  const organization = useContactOrganization();
  const stars = organization.ready ? organization.snapshot!.starredCharacterIds : [];
  return {
    ...organization,
    stars,
    isStarred: (id: string) => stars.includes(id),
    toggle(id: string) {
      if (organization.ready && !organization.busy && !organization.pendingOperation)
        void organization.controller!.change({
          type: 'set-star',
          characterId: id,
          selected: !stars.includes(id),
        });
    },
  };
}
